<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type JobView, type KbEntry, type KbPending, type MemberView } from '@shitu/api-client'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
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

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    entries.value = await tenantApi.kbList({
      projectId: filter.projectId || undefined,
      jobId: filter.jobId || undefined,
      keyword: filter.keyword.trim() || undefined,
    })
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
})

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
  dlg.visible = true
}
function openEdit(e: KbEntry) {
  dlg.editId = e.id
  dlg.question = e.question
  dlg.answer = e.answer
  dlg.scopeText = e.jobTitle ? `岗位 · ${e.jobTitle}（${e.projectName ?? ''}）` : e.projectName ? `项目 · ${e.projectName}` : '公司通用'
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
  } finally {
    dlg.saving = false
  }
}

async function remove(e: KbEntry) {
  try {
    await ElMessageBox.confirm(`删除问答「${e.question}」？删除后求职者提问将不再命中此条。`, '删除条目', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await tenantApi.kbDelete(e.id)
    ElMessage.success('已删除')
    load()
  } catch (err) {
    ElMessage.error(errorMessage(err))
  }
}

// ---------------------------------------------------------------- 待补充问题
const pending = ref<KbPending[]>([])
const pendingLoading = ref(false)
const pendingError = ref('')
const pendingMax = computed(() => Math.max(1, ...pending.value.map((p) => p.askedTimes)))
const projectName = (id: string) => projects.value.find((p) => p.projectId === id)?.name ?? ''

async function loadPending() {
  pendingLoading.value = true
  pendingError.value = ''
  try {
    pending.value = await tenantApi.kbPending()
  } catch (e) {
    pendingError.value = errorMessage(e, '待补充问题加载失败')
    pending.value = []
  } finally {
    pendingLoading.value = false
  }
}

const ans = reactive({ visible: false, saving: false, item: null as KbPending | null, question: '', answer: '' })
function openAnswer(p: KbPending) {
  ans.item = p
  ans.question = p.question
  ans.answer = ''
  ans.visible = true
}
async function submitAnswer() {
  const p = ans.item
  if (!p) return
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
  } finally {
    ans.saving = false
  }
}
async function ignore(p: KbPending) {
  try {
    await ElMessageBox.confirm(`忽略问题「${p.question}」？适用于无意义或与岗位无关的提问，忽略后不再出现在待补充列表。`, '忽略问题', {
      confirmButtonText: '忽略',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await tenantApi.kbIgnore(p.id)
    ElMessage.success('已忽略')
    loadPending()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

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
      <el-button type="primary" @click="openCreate">+ 新增问答</el-button>
    </div>

    <div class="grid g-4">
      <div class="stat stat--link" @click="tab = 'entries'"><div class="stat-l">问答条目</div><div class="stat-v">{{ entries.length }}</div><div class="stat-d">当前筛选范围</div></div>
      <div class="stat"><div class="stat-l">公司通用</div><div class="stat-v">{{ counts.company }}</div><div class="stat-d">适用全部岗位 · 仅老板维护</div></div>
      <div class="stat"><div class="stat-l">项目 / 岗位级</div><div class="stat-v">{{ counts.project + counts.job }}</div><div class="stat-d">项目 {{ counts.project }} · 岗位 {{ counts.job }}</div></div>
      <div class="stat stat--link" :class="{ 'stat--warn': pending.length > 0 }" @click="tab = 'pending'">
        <div class="stat-l">待补充问题</div><div class="stat-v">{{ pending.length }}</div><div class="stat-d">求职者提问未命中 · 建议补充</div>
      </div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="toolbar">
        <div class="filter-tabs">
          <button :class="{ on: tab === 'entries' }" @click="tab = 'entries'">问答条目<span class="n">{{ entries.length }}</span></button>
          <button :class="{ on: tab === 'pending' }" @click="tab = 'pending'">待补充问题<span class="n">{{ pending.length }}</span></button>
        </div>
        <span class="spacer" />
        <template v-if="tab === 'entries'">
          <el-select v-model="filter.projectId" placeholder="全部项目" clearable filterable style="width: 180px">
            <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
          <el-select v-model="filter.jobId" placeholder="全部岗位" clearable filterable :disabled="!filter.projectId" style="width: 180px">
            <el-option v-for="j in filterJobs" :key="j.jobId" :label="j.title" :value="j.jobId" />
          </el-select>
          <el-input v-model="filter.keyword" placeholder="搜索问题 / 答案" clearable style="width: 180px" @keyup.enter="load" @clear="load" />
          <el-button @click="load">查询</el-button>
        </template>
        <el-button v-else @click="loadPending">刷新</el-button>
      </div>

      <template v-if="tab === 'entries'">
        <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
          <el-button size="small" @click="load">重试</el-button>
        </el-alert>
        <div v-if="filter.projectId" class="note note--info" style="margin: 0 0 10px">按项目筛选时同时显示公司通用条目（求职者提问时三级条目都会参与匹配）。</div>
        <el-table v-loading="loading" :data="entries" row-key="id">
          <el-table-column label="问题 / 答案" min-width="320">
            <template #default="{ row }">
              <b class="q">{{ row.question }}</b>
              <div class="a t-xs">答：{{ row.answer }}</div>
            </template>
          </el-table-column>
          <el-table-column label="适用范围" min-width="170">
            <template #default="{ row }">
              <span v-if="scopeOf(row) === 'COMPANY'" class="tag tag--ink">公司通用</span>
              <template v-else-if="scopeOf(row) === 'PROJECT'"><span class="tag tag--info">项目</span> <span class="t-sm">{{ row.projectName }}</span></template>
              <template v-else>
                <span class="tag tag--signal">岗位</span> <span class="t-sm">{{ row.jobTitle }}</span>
                <div class="t-xs">{{ row.projectName }}</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="更新" width="150">
            <template #default="{ row }">
              <div class="t-sm">{{ memberName(row.updatedBy) }}</div>
              <div class="mono t-xs">{{ fmtDateTime(row.updatedAt) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" align="right">
            <template #default="{ row }">
              <template v-if="writable(row)">
                <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button size="small" link type="danger" @click="remove(row)">删除</el-button>
              </template>
              <span v-else class="t-xs">仅老板可改</span>
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无问答条目'" /></template>
        </el-table>
      </template>

      <template v-else>
        <el-alert v-if="pendingError" type="error" :title="pendingError" show-icon :closable="false">
          <el-button size="small" @click="loadPending">重试</el-button>
        </el-alert>
        <el-table v-loading="pendingLoading" :data="pending" row-key="id">
          <el-table-column label="求职者提问" min-width="280">
            <template #default="{ row }"><b class="q">{{ row.question }}</b></template>
          </el-table-column>
          <el-table-column label="岗位" min-width="170">
            <template #default="{ row }">
              <div class="t-sm">{{ row.jobTitle }}</div>
              <div class="t-xs">{{ projectName(row.projectId) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="提问次数" width="150">
            <template #default="{ row }">
              <div class="row" style="gap: 8px">
                <div class="bar" style="flex: 1"><i class="warn" :style="{ width: `${Math.round((row.askedTimes / pendingMax) * 100)}%` }" /></div>
                <b class="num">{{ row.askedTimes }}</b>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="最近提问" width="140">
            <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.lastAskedAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" @click="openAnswer(row)">补充答案</el-button>
              <el-button size="small" @click="ignore(row)">忽略</el-button>
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="80" :description="pendingError ? '加载失败' : '没有待补充的问题'" /></template>
        </el-table>
        <div class="card__ft t-xs">同一岗位的相同问题合并显示；补充答案后写入该岗位的知识库条目，并以站内信通知所有提过此问题的求职者。</div>
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
          <div v-if="!isOwner" class="t-xs" style="width: 100%">公司通用条目仅老板可创建，项目经理请选择项目或岗位。</div>
        </el-form-item>
        <el-form-item v-else label="适用范围"><span class="t-sm">{{ dlg.scopeText }}</span></el-form-item>
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
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 补充答案 -->
    <el-dialog v-model="ans.visible" title="补充答案" width="580px" :close-on-click-modal="false">
      <template v-if="ans.item">
        <div class="note note--info" style="margin-bottom: 14px">
          岗位 <b>{{ ans.item.jobTitle }}</b> · 被问 {{ ans.item.askedTimes }} 次。答案将写入该岗位的知识库条目，并通知提问的求职者。
        </div>
        <el-form label-width="80px" @submit.prevent>
          <el-form-item label="问题" required>
            <el-input v-model="ans.question" maxlength="200" show-word-limit />
            <div class="t-xs">可规范措辞后再入库（如去掉口语、错别字）</div>
          </el-form-item>
          <el-form-item label="答案" required>
            <el-input v-model="ans.answer" type="textarea" :rows="5" maxlength="2000" show-word-limit />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="ans.visible = false">取消</el-button>
        <el-button type="primary" :loading="ans.saving" @click="submitAnswer">保存并通知</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.q { color: var(--ink-900); font-size: 13px; }
.a { margin-top: 3px; line-height: 1.6; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
