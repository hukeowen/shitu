<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, useDict, type JobStatus, type JobTenantAction, type JobView, type ProjectView } from '@shitu/api-client'
import {
  IconBriefcase,
  IconChevronDown,
  IconCircleExclamationPoint,
  IconCircleX,
  IconClock,
  IconInbox,
  IconInfo,
  IconPlus,
  IconTriangleExclamationPoint,
} from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { boxSubmit, isBlocked } from '@/composables/boxSubmit'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime, salaryRange } from '@/utils/format'
import JobDetailDrawer from './JobDetailDrawer.vue'

/** T-302 / T-303 岗位管理（原型 v-jobs）。按钮严格按后端 allowedActions 显示 */
const router = useRouter()
const meStore = useMeStore()
const { label, options } = useDict()
const canManage = computed(() => meStore.can('JOB_MANAGE'))

const filter = reactive<{ status: JobStatus | ''; projectId: string; keyword: string }>({ status: '', projectId: '', keyword: '' })
const page = reactive({ page: 1, pageSize: 20, total: 0 })
const list = ref<JobView[]>([])
const loading = ref(false)
const loadError = ref('')
const counts = ref<Record<string, number>>({})
/** 各状态数量拿到过（没拿到时统计卡和页签不显示数字） */
const countsReady = ref(false)
const projects = ref<ProjectView[]>([])
/** 后端拒绝过的行操作：只置灰这一行的这个操作，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, { title: string; act: RowAct; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    const r = await tenantApi.jobs({
      status: filter.status || undefined,
      projectId: filter.projectId || undefined,
      keyword: filter.keyword.trim() || undefined,
      page: page.page,
      pageSize: page.pageSize,
    })
    list.value = r.records
    page.total = r.total
  } catch (e) {
    loadError.value = errorMessage(e, '岗位加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}

/** 各状态数量（用于筛选标签与统计卡） */
async function loadCounts() {
  countsReady.value = false
  try {
    const s = await tenantApi.jobStats(filter.projectId || undefined)
    const c: Record<string, number> = { ...s }
    c[''] = Object.values(s).reduce((a, b) => a + b, 0)
    counts.value = c
    countsReady.value = true
  } catch {
    counts.value = {}
  }
}
const stat = (k: JobStatus) => (countsReady.value ? (counts.value[k] ?? 0) : '—')
const badCount = computed(() => (counts.value.REJECTED ?? 0) + (counts.value.FORCE_OFFLINE ?? 0))

function search() {
  page.page = 1
  load()
}
/** 重置：筛选条件清回默认值后重新查询（项目变了，统计也重新取） */
function reset() {
  const projectChanged = !!filter.projectId
  Object.assign(filter, { status: '', projectId: '', keyword: '' })
  search()
  if (projectChanged) loadCounts()
}
function setStatus(s: JobStatus | '') {
  filter.status = s
  search()
}
function onProject() {
  search()
  loadCounts()
}
function refresh() {
  load()
  loadCounts()
}

onMounted(async () => {
  load()
  loadCounts()
  try {
    projects.value = await tenantApi.projects()
  } catch {
    projects.value = []
  }
})

// ---------------------------------------------------------------- 行操作
const has = (j: JobView, a: JobTenantAction) => canManage.value && j.allowedActions.includes(a)
const rejected = (j: JobView) => j.status === 'REJECTED' || j.status === 'FORCE_OFFLINE'

type RowAct = 'EDIT' | 'QUOTA' | 'PAUSE' | 'RESUME' | 'OFFLINE' | 'DETAIL'
interface Op {
  act: RowAct
  text: string
  danger?: boolean
}
/** 操作列：按后端 allowedActions 出，前 3 个平铺成文字按钮，其余（含「下架」）收进「更多」（规范第 2 类） */
function ops(j: JobView): { tiled: Op[]; more: Op[] } {
  const all: Op[] = []
  if (has(j, 'EDIT')) all.push({ act: 'EDIT', text: rejected(j) ? '修改重提' : '编辑' })
  if (has(j, 'QUOTA')) all.push({ act: 'QUOTA', text: '名额' })
  if (has(j, 'PAUSE')) all.push({ act: 'PAUSE', text: '暂停' })
  if (has(j, 'RESUME')) all.push({ act: 'RESUME', text: '恢复招聘' })
  all.push({ act: 'DETAIL', text: '详情' })
  const more = all.slice(3)
  if (has(j, 'OFFLINE')) more.push({ act: 'OFFLINE', text: '下架', danger: true })
  return { tiled: all.slice(0, 3), more }
}
const opsWidth = computed(() => actionsColWidth(list.value.map((j) => ({ labels: ops(j).tiled.map((o) => o.text), more: ops(j).more.length > 0 }))))
const isOff = (j: JobView, a: RowAct) => blocked[j.jobId]?.act === a

function run(j: JobView, a: RowAct) {
  if (a === 'EDIT') router.push({ path: '/pm/jobs/edit', query: { id: j.jobId } })
  else if (a === 'QUOTA') openQuota(j)
  else if (a === 'DETAIL') openDetail(j)
  else confirmAction(j, a)
}

async function confirmAction(j: JobView, a: 'PAUSE' | 'RESUME' | 'OFFLINE') {
  const text = {
    PAUSE: { title: '暂停招聘', msg: `暂停后「${j.title}」移出匹配池，岗位数据全部保留，可随时恢复。确定暂停？`, ok: '暂停招聘' },
    RESUME: { title: '恢复招聘', msg: `恢复后「${j.title}」重新进入匹配池，挂岗天数从今天重新计算。确定恢复？`, ok: '恢复招聘' },
    OFFLINE: { title: '下架岗位', msg: `下架后「${j.title}」不再参与匹配，已报名的求职者不受影响。确定下架？`, ok: '下架' },
  }[a]
  const api = () => (a === 'PAUSE' ? tenantApi.pauseJob(j.jobId) : a === 'RESUME' ? tenantApi.resumeJob(j.jobId) : tenantApi.offlineJob(j.jobId))
  const s = boxSubmit(text.msg, text.ok, api, (why) => {
    blocked[j.jobId] = { title: j.title, act: a, text: why }
  })
  try {
    await ElMessageBox.confirm(s.message, text.title, { type: 'warning', confirmButtonText: text.ok, cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success(`已${text.ok}`)
  refresh()
}

const quota = reactive({ visible: false, saving: false, job: null as JobView | null, value: 1, why: '' })
function openQuota(j: JobView) {
  quota.job = j
  quota.value = j.quotaTotal
  quota.why = ''
  quota.visible = true
}
// 改了名额就可以再试
watch(
  () => quota.value,
  () => (quota.why = ''),
)
async function saveQuota() {
  const j = quota.job
  if (!j || quota.saving) return
  if (!Number.isInteger(quota.value) || quota.value < Math.max(1, j.quotaOccupied) || quota.value > 9999) {
    ElMessage.warning(`名额需为 ${Math.max(1, j.quotaOccupied)}–9999 的整数`)
    return
  }
  quota.saving = true
  try {
    await tenantApi.adjustQuota(j.jobId, quota.value)
    ElMessage.success('名额已调整')
    quota.visible = false
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) quota.why = `暂时不能调整名额：${errorMessage(e)}`
  } finally {
    quota.saving = false
  }
}

// ---------------------------------------------------------------- 详情
const detail = reactive({ visible: false, jobId: null as string | null })
function openDetail(j: JobView) {
  detail.jobId = j.jobId
  detail.visible = true
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>岗位管理</h2>
        <p>创建 / 编辑 / 下架 / 暂停招聘 · 发布与编辑均需平台审核，暂停的岗位数据保留可随时恢复</p>
      </div>
      <span class="spacer" />
      <el-button v-if="canManage" type="primary" @click="router.push('/pm/jobs/edit')"><IconPlus :size="16" class="btn-i" />创建岗位</el-button>
    </div>

    <div class="kpis">
      <div class="stat stat--icon">
        <IconBriefcase :size="20" class="stat-i" />
        <div class="stat-l">招聘中</div><div class="stat-v">{{ stat('RECRUITING') }}</div><div class="stat-d">参与匹配</div>
      </div>
      <div class="stat stat--icon">
        <IconClock :size="20" class="stat-i" />
        <div class="stat-l">待审核</div><div class="stat-v">{{ stat('PENDING_AUDIT') }}</div><div class="stat-d">平台审核中</div>
      </div>
      <div class="stat stat--icon">
        <IconInbox :size="20" class="stat-i" />
        <div class="stat-l">暂停招聘</div><div class="stat-v">{{ stat('PAUSED') }}</div><div class="stat-d">数据保留可恢复</div>
      </div>
      <!-- 只有异常卡（确有驳回 / 强制下架的）数字用危险色 -->
      <div class="stat stat--icon" :class="{ 'stat--danger': countsReady && badCount > 0 }">
        <IconCircleX :size="20" class="stat-i" />
        <div class="stat-l">驳回 / 强制下架</div><div class="stat-v">{{ countsReady ? badCount : '—' }}</div><div class="stat-d">{{ countsReady && badCount === 0 ? '暂无需要处理的岗位' : '需修改后重新提交' }}</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="filter.status === ''" :class="{ on: filter.status === '' }" @click="setStatus('')">
            全部<span v-if="countsReady" class="n">{{ counts[''] }}</span>
          </button>
          <button
            v-for="o in options('JobStatus')"
            :key="o.value"
            type="button"
            role="tab"
            :aria-selected="filter.status === o.value"
            :class="{ on: filter.status === o.value }"
            @click="setStatus(o.value as JobStatus)"
          >
            {{ o.label }}<span v-if="countsReady" class="n">{{ counts[o.value] ?? 0 }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="filter.projectId" placeholder="全部项目" clearable filterable style="width: 140px" @change="onProject">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
        <el-input v-model="filter.keyword" placeholder="岗位名称" clearable style="width: 128px" @keyup.enter="search" @clear="search" />
        <el-button @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.title }}」{{ b.text }}。刷新后重新判断</p>
      <el-table v-loading="loading" :data="list" row-key="jobId">
        <el-table-column label="岗位名称" min-width="175">
          <template #default="{ row }">
            <el-button link class="title" @click="openDetail(row)">{{ row.title }}</el-button>
            <!-- 班次并进岗位副行（1280 宽把宽度让给项目列，甲方名称不折行） -->
            <div class="sub">{{ label('JobType', row.jobType) }} · {{ label('ShiftType', row.shiftType) }}{{ row.mealProvided || row.dormProvided ? ' · ' : '' }}{{ row.mealProvided ? '包吃' : '' }}{{ row.dormProvided ? '包住' : '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="所属项目" min-width="192">
          <template #default="{ row }">
            <div class="strong-t">{{ row.projectName }}</div>
            <div class="sub">{{ row.clientName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="薪资（元/月）" width="108" align="right" class-name="salary-col">
          <template #default="{ row }"><span class="nowrap">{{ salaryRange(row.salaryMin, row.salaryMax) }}</span></template>
        </el-table-column>
        <el-table-column label="名额 占用/总数" width="92" align="right">
          <template #default="{ row }">
            <div class="nowrap">{{ row.quotaOccupied }} / {{ row.quotaTotal }}</div>
            <div class="sub">剩余 {{ row.quotaRemaining }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="110">
          <template #default="{ row }">
            <DictTag type="JobStatus" :value="row.status" />
            <div v-if="row.auditRemark && rejected(row)" class="remark">{{ row.auditRemark }}</div>
          </template>
        </el-table-column>
        <!-- 日期、时间分两行，1280 宽把宽度让给岗位名和项目 -->
        <el-table-column label="上架时间" width="104">
          <template #default="{ row }">
            <template v-if="row.postedAt">
              <div class="nowrap">{{ fmtDateTime(row.postedAt).slice(0, 10) }}</div>
              <div class="sub">{{ fmtDateTime(row.postedAt).slice(11) }}</div>
            </template>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <el-button v-for="o in ops(row).tiled" :key="o.act" size="small" link type="primary" :disabled="isOff(row, o.act)" @click="run(row, o.act)">{{ o.text }}</el-button>
              <el-dropdown v-if="ops(row).more.length" trigger="click" @command="(a: RowAct) => run(row, a)">
                <el-button size="small" link type="primary">更多<IconChevronDown :size="14" class="more-i" /></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="o in ops(row).more" :key="o.act" :command="o.act" :disabled="isOff(row, o.act)">
                      <span :class="{ danger: o.danger && !isOff(row, o.act) }">{{ o.text }}</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="refresh">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconBriefcase :size="48" />
            <h4>暂无岗位</h4>
            <p>{{ filter.status || filter.projectId || filter.keyword.trim() ? '换个筛选条件试试' : '岗位要发布在有有效合作合同的甲方项目下，创建后提交平台审核' }}</p>
            <el-button v-if="canManage" type="primary" @click="router.push('/pm/jobs/edit')">创建岗位</el-button>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="page.total > 0" class="pager">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          :total="page.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>暂停招聘的使用规范</h3></div>
        <div class="card__bd">
          <p class="para">岗位今天暂停但后续还要招，可点击「暂停」—— 岗位移出匹配池但不删除，<b>所有历史数据保留</b>；恢复后重新进入匹配池，挂岗天数重新计算。</p>
          <div class="notice-bar notice-bar--danger tip">
            <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
            <span><b>硬性要求：</b>一旦从甲方得知招聘满员，<b>24 小时内必须暂停招聘</b>，否则用户报名却无法面试将产生投诉，计入企业诚信档案。</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>审核说明</h3></div>
        <div class="card__bd">
          <p class="para">新建与编辑岗位都会提交平台审核，审核期间不参与匹配；仅调整名额无需审核。岗位必须属于有<b>审核通过且在有效期内合作合同</b>的甲方项目。</p>
          <div class="notice-bar notice-bar--warn tip">
            <IconInfo :size="16" class="notice-bar-i" />
            <span>发布虚假岗位信息，用户可在岗位详情页投诉。同一岗位累计被投诉 ≥3 次并核实属实 → 自动下架 + 扣诚信分。</span>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="quota.visible" title="调整招聘名额" width="480px" :close-on-click-modal="!quota.saving" :show-close="!quota.saving">
      <template v-if="quota.job">
        <dl class="desc-list">
          <div class="full"><dt>岗位</dt><dd>{{ quota.job.title }}</dd></div>
          <div><dt>已被报名占用</dt><dd>{{ quota.job.quotaOccupied }}</dd></div>
          <div><dt>当前总名额</dt><dd>{{ quota.job.quotaTotal }}</dd></div>
        </dl>
        <div class="q-row">
          <span class="q-l">新的总名额</span>
          <el-input-number v-model="quota.value" :min="Math.max(1, quota.job.quotaOccupied)" :max="9999" :step="1" step-strictly />
        </div>
        <p class="hint">不能少于已占用的 {{ quota.job.quotaOccupied }} 个；调整名额无需重新审核。</p>
        <p v-if="quota.why" class="blocked-why q-why" role="alert">{{ quota.why }}</p>
      </template>
      <template #footer>
        <el-button :disabled="quota.saving" @click="quota.visible = false">取消</el-button>
        <el-button type="primary" :loading="quota.saving" :disabled="!!quota.why" @click="saveQuota">保存</el-button>
      </template>
    </el-dialog>

    <JobDetailDrawer v-model="detail.visible" :job-id="detail.jobId" />
  </div>
</template>

<style scoped>
.btn-i { margin-right: var(--space-1); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.toolbar .el-button + .el-button { margin-left: 0; }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.title { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); padding: 0; height: auto; white-space: normal; text-align: left; }
/* 岗位名称太长时在格子里折行，不被截掉 */
.title { display: block; max-width: 100%; border: 0; }
.title :deep(> span) { display: inline; white-space: normal; overflow-wrap: anywhere; text-align: left; line-height: 1.5; }
.title:hover { color: var(--primary-text); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.strong-t { color: var(--text-1); }
/* 驳回 / 下架原因：最多两行，完整内容在悬停提示里 */
/* 驳回 / 下架原因整段折行显示，不截断 */
.remark { margin-top: var(--space-1); font-size: var(--font-size-min); line-height: 1.5; color: var(--danger-text); }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.more-i { margin-left: var(--space-1); }
.danger { color: var(--danger-text); }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.para { margin: 0; font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.para b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.tip { margin-top: var(--space-3); }
.desc-list .full { grid-column: 1 / -1; }
.q-row { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-5); }
.q-l { font-size: var(--font-size-body); color: var(--text-2); }
.hint { margin: var(--space-2) 0 0; font-size: var(--font-size-min); color: var(--text-3); }
.q-why { margin-top: var(--space-3); }
</style>
