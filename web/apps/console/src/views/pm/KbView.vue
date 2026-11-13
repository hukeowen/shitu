<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type JobView, type KbEntry, type KbPending, type MemberView } from '@shitu/api-client'
import { IconBookOpen, IconBriefcase, IconBuildingComplex, IconCircleExclamationPoint, IconInfo, IconMessageSquare, IconPlus } from '@shitu/ui-icons'
import { boxSubmit, isBlocked } from '@/composables/boxSubmit'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'

/**
 * A-11 知识库管理（T-305，老板 / 项目经理）：岗位常见问答供求职者岗位问答（C-409）自动回复。
 * 条目三种范围：公司通用（仅老板可建 / 改）、项目级、岗位级；项目经理只能维护负责项目内的条目。
 * 「待补充问题」= 求职者提问未命中知识库，补充答案后写入岗位级条目并通知提问人；无意义问题可忽略。
 */
type Tab = 'entries' | 'pending'
type Scope = 'COMPANY' | 'PROJECT' | 'JOB'

const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
const { projects } = useProjects()
const isOwner = computed(() => meStore.hasRole('OWNER'))

const tab = ref<Tab>(route.query.tab === 'pending' ? 'pending' : 'entries')
watch(tab, (t) => router.replace({ query: { ...route.query, tab: t } }))

const members = ref<MemberView[]>([])
const memberName = (id: string) => (id === meStore.me?.memberId ? meStore.me?.name : members.value.find((m) => m.memberId === id)?.name) ?? id

// ---------------------------------------------------------------- 岗位下拉（按项目）
const jobsCache = reactive<Record<string, JobView[]>>({})
async function jobsOf(projectId: string): Promise<JobView[]> {
  if (!projectId) return []
  if (!jobsCache[projectId]) {
    try {
      jobsCache[projectId] = (await tenantApi.jobs({ projectId, page: 1, pageSize: 100 })).records
    } catch {
      jobsCache[projectId] = []
    }
  }
  return jobsCache[projectId]
}

// ---------------------------------------------------------------- 条目
const filter = reactive({ projectId: '', jobId: '', keyword: '' })
const filterJobs = ref<JobView[]>([])
const entries = ref<KbEntry[]>([])
const loading = ref(false)
const loadError = ref('')
/** 条目拿到过数据（没拿到时指标和页签不显示数字） */
const entriesReady = ref(false)
/** 后端拒绝过的删除 / 忽略：只置灰这一条的这个操作，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<number, { q: string; text: string }>>({})
const blockedPending = reactive<Record<number, { q: string; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  entriesReady.value = false
  Object.keys(blocked).forEach((k) => delete blocked[Number(k)])
  try {
    entries.value = await tenantApi.kbList({
      projectId: filter.projectId || undefined,
      jobId: filter.jobId || undefined,
      keyword: filter.keyword.trim() || undefined,
    })
    entriesReady.value = true
  } catch (e) {
    loadError.value = errorMessage(e, '知识库加载失败')
    entries.value = []
  } finally {
    loading.value = false
  }
}
watch(
  () => filter.projectId,
  async (pid) => {
    filter.jobId = ''
    filterJobs.value = await jobsOf(pid)
    load()
  },
)
watch(() => filter.jobId, load)

function scopeOf(e: { projectId: string | null; jobId: string | null }): Scope {
  return e.jobId ? 'JOB' : e.projectId ? 'PROJECT' : 'COMPANY'
}
/** 公司通用条目只有老板能改；项目 / 岗位条目后端再按负责项目校验 */
function writable(e: KbEntry) {
  return scopeOf(e) !== 'COMPANY' || isOwner.value
}
const counts = computed(() => ({
  company: entries.value.filter((e) => scopeOf(e) === 'COMPANY').length,
  project: entries.value.filter((e) => scopeOf(e) === 'PROJECT').length,
  job: entries.value.filter((e) => scopeOf(e) === 'JOB').length,
}))

// ---------------------------------------------------------------- 新增 / 编辑
const dlg = reactive({
  visible: false,
  saving: false,
  editId: null as number | null,
  scope: 'PROJECT' as Scope,
  projectId: '',
  jobId: '',
  question: '',
  answer: '',
  jobs: [] as JobView[],
  scopeText: '',
  why: '',
})
// 保存被后端业务拒绝后置灰；改了内容再放开
watch(
  () => [dlg.scope, dlg.projectId, dlg.jobId, dlg.question, dlg.answer],
  () => (dlg.why = ''),
)

function openCreate() {
  dlg.editId = null
  dlg.scope = isOwner.value ? 'COMPANY' : 'PROJECT'
  dlg.projectId = filter.projectId || ''
  dlg.jobId = filter.jobId || ''
  dlg.question = ''
  dlg.answer = ''
  dlg.jobs = filterJobs.value
  if (dlg.jobId) dlg.scope = 'JOB'
  else if (dlg.projectId) dlg.scope = 'PROJECT'
  dlg.why = ''
  dlg.visible = true
}
function openEdit(e: KbEntry) {
  dlg.editId = e.id
  dlg.question = e.question
  dlg.answer = e.answer
  dlg.scopeText = e.jobTitle ? `岗位 · ${e.jobTitle}（${e.projectName ?? ''}）` : e.projectName ? `项目 · ${e.projectName}` : '公司通用'
  dlg.why = ''
  dlg.visible = true
}
watch(
  () => dlg.projectId,
  async (pid) => {
    if (!dlg.visible || dlg.editId != null) return
    if (!dlg.jobs.some((j) => j.jobId === dlg.jobId && j.projectId === pid)) dlg.jobId = ''
    dlg.jobs = await jobsOf(pid)
  },
)

async function save() {
  if (dlg.saving) return
  const q = dlg.question.trim()
  const a = dlg.answer.trim()
  if (!q) return ElMessage.warning('请填写问题')
  if (!a) return ElMessage.warning('请填写答案')
  if (dlg.editId == null) {
    if (dlg.scope !== 'COMPANY' && !dlg.projectId) return ElMessage.warning('请选择项目')
    if (dlg.scope === 'JOB' && !dlg.jobId) return ElMessage.warning('请选择岗位')
  }
  dlg.saving = true
  try {
    if (dlg.editId != null) {
      await tenantApi.kbUpdate(dlg.editId, { question: q, answer: a })
      ElMessage.success('条目已更新')
    } else {
      await tenantApi.kbCreate({
        projectId: dlg.scope === 'COMPANY' ? null : dlg.projectId,
        jobId: dlg.scope === 'JOB' ? dlg.jobId : null,
        question: q,
        answer: a,
      })
      ElMessage.success('条目已新增')
    }
    dlg.visible = false
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) dlg.why = `暂时不能保存：${errorMessage(e)}`
  } finally {
    dlg.saving = false
  }
}

async function remove(e: KbEntry) {
  const s = boxSubmit(`删除问答「${e.question}」？删除后求职者提问将不再命中此条。`, '删除', () => tenantApi.kbDelete(e.id), (why) => {
    blocked[e.id] = { q: e.question, text: why }
  })
  try {
    await ElMessageBox.confirm(s.message, '删除条目', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      beforeClose: s.beforeClose,
    })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('已删除')
  load()
}
/** 操作列宽按本页实际出现的按钮算（规范 Page States「console 表格操作列宽」） */
const entryOpsWidth = computed(() => actionsColWidth(entries.value.map((e) => ({ labels: writable(e) ? ['编辑', '删除'] : ['仅老板可改'] }))))

// ---------------------------------------------------------------- 待补充问题
const pending = ref<KbPending[]>([])
const pendingLoading = ref(false)
const pendingError = ref('')
const pendingReady = ref(false)
const pendingMax = computed(() => Math.max(1, ...pending.value.map((p) => p.askedTimes)))
const projectName = (id: string) => projects.value.find((p) => p.projectId === id)?.name ?? ''

async function loadPending() {
  pendingLoading.value = true
  pendingError.value = ''
  pendingReady.value = false
  Object.keys(blockedPending).forEach((k) => delete blockedPending[Number(k)])
  try {
    pending.value = await tenantApi.kbPending()
    pendingReady.value = true
  } catch (e) {
    pendingError.value = errorMessage(e, '待补充问题加载失败')
    pending.value = []
  } finally {
    pendingLoading.value = false
  }
}

const ans = reactive({ visible: false, saving: false, item: null as KbPending | null, question: '', answer: '', why: '' })
watch(
  () => [ans.question, ans.answer],
  () => (ans.why = ''),
)
function openAnswer(p: KbPending) {
  ans.item = p
  ans.question = p.question
  ans.answer = ''
  ans.why = ''
  ans.visible = true
}
async function submitAnswer() {
  const p = ans.item
  if (!p || ans.saving) return
  const q = ans.question.trim()
  const a = ans.answer.trim()
  if (!q) return ElMessage.warning('问题不能为空')
  if (!a) return ElMessage.warning('请填写答案')
  ans.saving = true
  try {
    await tenantApi.kbAnswer(p.id, a, q !== p.question ? q : undefined)
    ElMessage.success('答案已写入岗位知识库，并已通知提问的求职者')
    ans.visible = false
    loadPending()
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) ans.why = `暂时不能补充答案：${errorMessage(e)}`
  } finally {
    ans.saving = false
  }
}
async function ignore(p: KbPending) {
  const s = boxSubmit(`忽略问题「${p.question}」？适用于无意义或与岗位无关的提问，忽略后不再出现在待补充列表。`, '忽略', () => tenantApi.kbIgnore(p.id), (why) => {
    blockedPending[p.id] = { q: p.question, text: why }
  })
  try {
    await ElMessageBox.confirm(s.message, '忽略问题', {
      confirmButtonText: '忽略',
      cancelButtonText: '取消',
      type: 'warning',
      beforeClose: s.beforeClose,
    })
  } catch {
    return
  }
  ElMessage.success('已忽略')
  loadPending()
}
const pendingOpsWidth = computed(() => actionsColWidth([{ labels: ['补充答案', '忽略'] }]))

onMounted(async () => {
  load()
  loadPending()
  members.value = await tenantApi.members().catch(() => [])
})
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>知识库管理</h2>
        <p>录入岗位常见问答，供求职者岗位问答自动回复；未命中的问题回流到「待补充」</p>
      </div>
      <span class="spacer" />
      <el-button type="primary" @click="openCreate"><IconPlus :size="16" class="btn-i" />新增问答</el-button>
    </div>

    <div class="kpis">
      <div class="stat stat--icon stat--link" role="link" tabindex="0" @click="tab = 'entries'" @keydown.enter.space.prevent="tab = 'entries'">
        <IconBookOpen :size="20" class="stat-i" />
        <div class="stat-l">问答条目</div><div class="stat-v">{{ entriesReady ? entries.length : '—' }}</div><div class="stat-d">当前筛选范围</div>
      </div>
      <div class="stat stat--icon">
        <IconBuildingComplex :size="20" class="stat-i" />
        <div class="stat-l">公司通用</div><div class="stat-v">{{ entriesReady ? counts.company : '—' }}</div><div class="stat-d">适用全部岗位 · 仅老板维护</div>
      </div>
      <div class="stat stat--icon">
        <IconBriefcase :size="20" class="stat-i" />
        <div class="stat-l">项目 / 岗位级</div><div class="stat-v">{{ entriesReady ? counts.project + counts.job : '—' }}</div>
        <div class="stat-d">{{ entriesReady ? `项目 ${counts.project} · 岗位 ${counts.job}` : '项目 / 岗位' }}</div>
      </div>
      <div class="stat stat--icon stat--link" role="link" tabindex="0" @click="tab = 'pending'" @keydown.enter.space.prevent="tab = 'pending'">
        <IconMessageSquare :size="20" class="stat-i" />
        <div class="stat-l">待补充问题</div><div class="stat-v">{{ pendingReady ? pending.length : '—' }}</div><div class="stat-d">求职者提问未命中 · 建议补充</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'entries'" :class="{ on: tab === 'entries' }" @click="tab = 'entries'">
            问答条目<span v-if="entriesReady" class="n">{{ entries.length }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="tab === 'pending'" :class="{ on: tab === 'pending' }" @click="tab = 'pending'">
            待补充问题<span v-if="pendingReady" class="n">{{ pending.length }}</span>
          </button>
        </div>
        <span class="spacer" />
        <template v-if="tab === 'entries'">
          <el-select v-model="filter.projectId" placeholder="全部项目" clearable filterable style="width: 160px">
            <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
          <el-select v-model="filter.jobId" placeholder="全部岗位" clearable filterable :disabled="!filter.projectId" style="width: 160px">
            <el-option v-for="j in filterJobs" :key="j.jobId" :label="j.title" :value="j.jobId" />
          </el-select>
          <el-input v-model="filter.keyword" placeholder="搜索问题 / 答案" clearable style="width: 160px" @keyup.enter="load" @clear="load" />
          <el-button @click="load">查询</el-button>
        </template>
        <el-button v-else @click="loadPending">刷新</el-button>
      </div>

      <template v-if="tab === 'entries'">
        <div v-if="filter.projectId" class="notice-bar tbl-tip">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>按项目筛选时同时显示公司通用条目（求职者提问时三级条目都会参与匹配）。</span>
        </div>
        <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.q }}」{{ b.text }}。刷新后重新判断</p>
        <el-table v-loading="loading" :data="entries" row-key="id">
          <el-table-column label="问题 / 答案" min-width="300">
            <template #default="{ row }">
              <b class="q">{{ row.question }}</b>
              <div class="a">答：{{ row.answer }}</div>
            </template>
          </el-table-column>
          <el-table-column label="适用范围" min-width="170">
            <template #default="{ row }">
              <span v-if="scopeOf(row) === 'COMPANY'" class="status-tag">公司通用</span>
              <template v-else-if="scopeOf(row) === 'PROJECT'"><span class="status-tag status-tag--info">项目</span> <span class="scope-n">{{ row.projectName }}</span></template>
              <template v-else>
                <span class="status-tag status-tag--pending">岗位</span> <span class="scope-n">{{ row.jobTitle }}</span>
                <div class="sub">{{ row.projectName }}</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="更新" width="148">
            <template #default="{ row }">
              <div>{{ memberName(row.updatedBy) }}</div>
              <div class="sub nowrap">{{ fmtDateTime(row.updatedAt) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="entryOpsWidth" align="right" class-name="ops-col">
            <template #default="{ row }">
              <div v-if="writable(row)" class="acts">
                <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button size="small" link type="danger" :disabled="!!blocked[row.id]" @click="remove(row)">删除</el-button>
              </div>
              <span v-else class="sub">仅老板可改</span>
            </template>
          </el-table-column>
          <template #empty>
            <div v-if="loadError" class="state-box">
              <IconCircleExclamationPoint :size="48" />
              <h4>{{ loadError }}</h4>
              <p>请检查网络后重新加载</p>
              <el-button @click="load">重新加载</el-button>
            </div>
            <div v-else-if="!loading" class="state-box">
              <IconBookOpen :size="48" />
              <h4>暂无问答条目</h4>
              <p>{{ filter.projectId || filter.keyword.trim() ? '当前筛选范围内没有条目，换个筛选条件试试' : '录入岗位常见问答后，求职者提问会自动回复' }}</p>
              <el-button type="primary" @click="openCreate">新增问答</el-button>
            </div>
            <span v-else />
          </template>
        </el-table>
      </template>

      <template v-else>
        <p v-for="(b, id) in blockedPending" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.q }}」{{ b.text }}。刷新后重新判断</p>
        <el-table v-loading="pendingLoading" :data="pending" row-key="id">
          <el-table-column label="求职者提问" min-width="260">
            <template #default="{ row }"><b class="q">{{ row.question }}</b></template>
          </el-table-column>
          <el-table-column label="岗位" min-width="160">
            <template #default="{ row }">
              <div>{{ row.jobTitle }}</div>
              <div class="sub">{{ projectName(row.projectId) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="提问次数" width="150">
            <template #default="{ row }">
              <div class="asked">
                <div class="track"><i :style="{ width: `${Math.round((row.askedTimes / pendingMax) * 100)}%` }" /></div>
                <span class="asked-n">{{ row.askedTimes }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="最近提问" width="150">
            <template #default="{ row }"><span class="nowrap">{{ fmtDateTime(row.lastAskedAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" :width="pendingOpsWidth" align="right" class-name="ops-col">
            <template #default="{ row }">
              <div class="acts">
                <el-button size="small" link type="primary" @click="openAnswer(row)">补充答案</el-button>
                <el-button size="small" link type="primary" :disabled="!!blockedPending[row.id]" @click="ignore(row)">忽略</el-button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <div v-if="pendingError" class="state-box">
              <IconCircleExclamationPoint :size="48" />
              <h4>{{ pendingError }}</h4>
              <p>请检查网络后重新加载</p>
              <el-button @click="loadPending">重新加载</el-button>
            </div>
            <div v-else-if="!pendingLoading" class="state-box">
              <IconMessageSquare :size="48" />
              <h4>没有待补充的问题</h4>
              <p>求职者提问没有命中知识库时，问题会出现在这里</p>
            </div>
            <span v-else />
          </template>
        </el-table>
        <div class="card__ft foot">同一岗位的相同问题合并显示；补充答案后写入该岗位的知识库条目，并以站内信通知所有提过此问题的求职者。</div>
      </template>
    </div>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dlg.visible" :title="dlg.editId != null ? '编辑问答' : '新增问答'" width="580px" :close-on-click-modal="false">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item v-if="dlg.editId == null" label="适用范围" required>
          <el-radio-group v-model="dlg.scope">
            <el-radio-button value="COMPANY" :disabled="!isOwner">公司通用</el-radio-button>
            <el-radio-button value="PROJECT">项目</el-radio-button>
            <el-radio-button value="JOB">岗位</el-radio-button>
          </el-radio-group>
          <div v-if="!isOwner" class="field-hint">公司通用条目仅老板可创建，项目经理请选择项目或岗位。</div>
        </el-form-item>
        <el-form-item v-else label="适用范围"><span>{{ dlg.scopeText }}</span></el-form-item>
        <el-form-item v-if="dlg.editId == null && dlg.scope !== 'COMPANY'" label="项目" required>
          <el-select v-model="dlg.projectId" placeholder="选择项目" filterable style="width: 100%">
            <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dlg.editId == null && dlg.scope === 'JOB'" label="岗位" required>
          <el-select v-model="dlg.jobId" placeholder="选择岗位" filterable :disabled="!dlg.projectId" style="width: 100%">
            <el-option v-for="j in dlg.jobs" :key="j.jobId" :label="j.title" :value="j.jobId" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题" required>
          <el-input v-model="dlg.question" maxlength="200" show-word-limit placeholder="如：工资什么时候发？" />
        </el-form-item>
        <el-form-item label="答案" required>
          <el-input v-model="dlg.answer" type="textarea" :rows="5" maxlength="2000" show-word-limit placeholder="统一、可追溯的口径，避免夸大承诺" />
        </el-form-item>
      </el-form>
      <p v-if="dlg.why" class="blocked-why" role="alert">{{ dlg.why }}</p>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" :disabled="!!dlg.why" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 补充答案 -->
    <el-dialog v-model="ans.visible" title="补充答案" width="580px" :close-on-click-modal="false">
      <template v-if="ans.item">
        <div class="notice-bar dlg-tip">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>岗位 <b>{{ ans.item.jobTitle }}</b> · 被问 {{ ans.item.askedTimes }} 次。答案将写入该岗位的知识库条目，并通知提问的求职者。</span>
        </div>
        <el-form label-width="80px" @submit.prevent>
          <el-form-item label="问题" required>
            <el-input v-model="ans.question" maxlength="200" show-word-limit />
            <div class="field-hint">可规范措辞后再入库（如去掉口语、错别字）</div>
          </el-form-item>
          <el-form-item label="答案" required>
            <el-input v-model="ans.answer" type="textarea" :rows="5" maxlength="2000" show-word-limit />
          </el-form-item>
        </el-form>
        <p v-if="ans.why" class="blocked-why" role="alert">{{ ans.why }}</p>
      </template>
      <template #footer>
        <el-button @click="ans.visible = false">取消</el-button>
        <el-button type="primary" :loading="ans.saving" :disabled="!!ans.why" @click="submitAnswer">保存并通知</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.btn-i { margin-right: var(--space-1); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.q { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.a { margin-top: var(--space-1); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-2); white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.scope-n { color: var(--text-1); }
.sub { margin-top: 2px; font-size: var(--font-size-min); color: var(--text-3); }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
/* 提问次数横条（规范第 10 类）：单一系列用 --chart-1，数值 12px 二级文字 */
.asked { display: flex; align-items: center; gap: var(--space-2); }
.track { flex: 1; height: 6px; border-radius: 3px; background: var(--bg-fill); overflow: hidden; }
.track i { display: block; height: 100%; border-radius: 3px; background: var(--chart-1); }
.asked-n { min-width: 16px; text-align: right; font-size: var(--font-size-min); color: var(--text-2); font-variant-numeric: tabular-nums; }
.foot { font-size: var(--font-size-min); color: var(--text-3); }
.field-hint { width: 100%; margin-top: var(--space-1); font-size: var(--font-size-min); line-height: 1.5; color: var(--text-3); }
.dlg-tip { margin-bottom: var(--space-4); }
</style>
