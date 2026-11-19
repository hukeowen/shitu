<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type TableInstance } from 'element-plus'
import { errorMessage, tenantApi, type ApplicationBatchResult, type ApplicationStatus, type SiteApplication, type SiteWorkbench } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInbox } from '@shitu/ui-icons'
import AppActionButtons, { appActionsColWidth } from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import ApplicantInsightDrawer from '@/components/site/ApplicantInsightDrawer.vue'
import CancelRequestsTable from '@/components/site/CancelRequestsTable.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useNow } from '@/composables/useNow'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtDateTime, fmtPhone } from '@/utils/format'
import { enumLabel } from '@/utils/labels'
import { remainMs } from '@/utils/time'

/** A-02 待办清单（T-101）：待知悉 / 待面试 / 今日到厂 / 待确权。行操作严格按 allowedActions */
type AppTab = 'ack' | 'interview' | 'arrived' | 'confirm'
/** cancel = 求职者的取消报名申请（另一张表，只对驻场 / 项目经理显示；站内信链接 /cancel-requests 跳到这里） */
type Tab = AppTab | 'cancel'
const TABS: { key: AppTab; label: string; status: ApplicationStatus; unack?: boolean; arrivedToday?: boolean; count: keyof SiteWorkbench }[] = [
  { key: 'ack', label: '待知悉', status: 'PENDING_INTERVIEW', unack: true, count: 'pendingAck' },
  { key: 'interview', label: '待面试', status: 'PENDING_INTERVIEW', count: 'pendingInterview' },
  { key: 'arrived', label: '今日到厂', status: 'PENDING_INTERVIEW', arrivedToday: true, count: 'arrivedToday' },
  { key: 'confirm', label: '待确权', status: 'PENDING_CONFIRM', count: 'pendingConfirm' },
]

const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
const now = useNow()
const { projects } = useProjects()
const isSite = computed(() => meStore.hasRole('SITE'))
/** 取消申请接口只对驻场 / 项目经理开放；老板在本页只读，不显示这个页签 */
const canCancelReq = computed(() => meStore.hasRole('SITE', 'PM'))

function tabOf(q: unknown): Tab {
  if (q === 'cancel') return canCancelReq.value ? 'cancel' : 'ack'
  return TABS.some((t) => t.key === q) ? (q as Tab) : 'ack'
}
const tab = ref<Tab>(tabOf(route.query.tab))
const projectId = ref<string>(typeof route.query.projectId === 'string' ? route.query.projectId : '')
const page = reactive({ page: 1, pageSize: 20, total: 0 })
const list = ref<SiteApplication[]>([])
const loading = ref(false)
const loadError = ref('')
/** 列表拿到过数据（没拿到时页签不显示计数） */
const ready = ref(false)
const wb = ref<SiteWorkbench | null>(null)
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)
const cancelTable = ref<InstanceType<typeof CancelRequestsTable> | null>(null)
/** 待处理的取消申请数（没拿到时页签不显示计数） */
const cancelCount = ref<number | null>(null)

/** 只读角色（老板）对列表里的报名都没有可用操作时，不显示操作列 */
const hasOps = computed(() => list.value.some((a) => a.allowedActions.length > 0))
const current = computed(() => TABS.find((t) => t.key === tab.value) ?? TABS[0])
const opsWidth = computed(() => appActionsColWidth(list.value))

async function load() {
  // 取消申请页签有自己的表格和加载
  if (tab.value === 'cancel') return
  loading.value = true
  loadError.value = ''
  try {
    const r = await tenantApi.applications({
      status: current.value.status,
      unacknowledged: current.value.unack || undefined,
      arrivedToday: current.value.arrivedToday || undefined,
      projectId: projectId.value || undefined,
      page: page.page,
      pageSize: page.pageSize,
      // 响应窗口最紧的在前（公域用户无窗口，按报名时间排在后面）
      sort: 'DEADLINE',
    })
    list.value = r.records
    page.total = r.total
    ready.value = true
    await restoreSelection()
  } catch (e) {
    loadError.value = errorMessage(e, '待办加载失败')
    ready.value = false
    list.value = []
    page.total = 0
  } finally {
    loading.value = false
  }
}
async function loadCounts() {
  try {
    wb.value = await tenantApi.siteWorkbench()
  } catch {
    wb.value = null
  }
}
async function loadCancelCount() {
  if (!canCancelReq.value) return
  try {
    cancelCount.value = await tenantApi.cancelRequestPendingCount()
  } catch {
    cancelCount.value = null
  }
}
function refresh() {
  if (tab.value === 'cancel') cancelTable.value?.load()
  else load()
  loadCounts()
  loadCancelCount()
}
function setTab(t: Tab) {
  tab.value = t
  page.page = 1
}
watch([tab, projectId], () => {
  clearSelection()
  page.page = 1
  router.replace({ query: { ...route.query, tab: tab.value, projectId: projectId.value || undefined } })
  load()
})
// 已经在本页时点消息里的链接（/cancel-requests → ?tab=cancel）：跟着地址切页签
watch(
  () => route.query.tab,
  (q) => {
    if (typeof q === 'string' && tabOf(q) === q && q !== tab.value) tab.value = q as Tab
  },
)
onMounted(refresh)

// ---------- 批量知悉 / 批量到厂确认 ----------
/** 一次最多处理的人数（后端同口径） */
const BATCH_MAX = 50
type BatchAction = 'ACKNOWLEDGE' | 'ARRIVE'
const BATCH: Partial<Record<Tab, { action: BatchAction; label: string }>> = {
  ack: { action: 'ACKNOWLEDGE', label: '批量知悉' },
  interview: { action: 'ARRIVE', label: '批量到厂确认' },
}
const batch = computed(() => BATCH[tab.value] ?? null)
const table = ref<TableInstance | null>(null)
const selected = ref<SiteApplication[]>([])
/** 批量操作后没成功的报名：列表刷新后重新勾上 */
let keepIds: string[] = []

/** 这一行能不能勾选：严格按后端 allowedActions；到厂确认还要没到过厂 */
function selectable(row: SiteApplication): boolean {
  const b = batch.value
  if (!b || !row.allowedActions.includes(b.action)) return false
  return b.action !== 'ARRIVE' || !row.arrivedAt
}
/** 这一页有能勾选的行才显示勾选列（只读角色看不到） */
const showSelect = computed(() => !!batch.value && !loadError.value && list.value.some(selectable))

let trimming = false
function onSelectionChange(rows: SiteApplication[]) {
  // 下面取消勾选时表格会逐行再触发本函数
  if (trimming) return
  if (rows.length > BATCH_MAX) {
    const keep = rows.slice(0, BATCH_MAX)
    trimming = true
    try {
      for (const r of rows.slice(BATCH_MAX)) table.value?.toggleRowSelection(r, false)
    } finally {
      trimming = false
    }
    selected.value = keep
    ElMessage.warning(`一次最多选择 ${BATCH_MAX} 人，已保留前 ${BATCH_MAX} 人`)
    return
  }
  selected.value = rows
}
function clearSelection() {
  keepIds = []
  selected.value = []
  table.value?.clearSelection()
}
/** 换页 / 改每页条数：选择不跨页 */
function onPage() {
  clearSelection()
  load()
}
/** 列表换了数据后表格会清空勾选；批量操作后没成功的要保持选中 */
async function restoreSelection() {
  const ids = keepIds
  keepIds = []
  selected.value = []
  if (!ids.length) return
  await nextTick()
  for (const row of list.value) if (ids.includes(row.applicationId) && selectable(row)) table.value?.toggleRowSelection(row, true)
}
function runBatch() {
  const b = batch.value
  const rows = selected.value.filter(selectable)
  if (!b || !rows.length) return
  dialogs.value?.runBatch(b.action, rows)
}
function onBatchDone(_action: BatchAction, r: ApplicationBatchResult) {
  keepIds = r.items.filter((i) => !i.ok).map((i) => i.applicationId)
  load()
  loadCounts()
  loadCancelCount()
}

function rowClass({ row }: { row: SiteApplication }) {
  const ms = remainMs(row.responseDeadline, now.value)
  return ms != null && ms < 3600_000 ? 'row-danger' : ''
}

/** 状态下面的小字：没到厂时报名走到哪一步 */
function progressText(a: SiteApplication): string {
  if (a.status === 'PENDING_INTERVIEW') return a.acknowledgedAt ? '已推送面试信息' : '未知悉'
  if (a.contract?.status === 'PENDING_SIGN' || a.allowedActions.includes('RESEND_CONTRACT')) return '待求职者签署'
  return a.status === 'PENDING_CONFIRM' ? '待发起签约' : ''
}

/** 导出：按当前页签、项目把所有页取完；姓名、手机号按接口返回（姓名脱敏，手机号只有驻场拿得到，其他角色这一列为空） */
const exporting = ref(false)
const EXPORT_COLUMNS: CsvColumn<SiteApplication>[] = [
  { header: '求职者', value: (a) => a.seekerName },
  { header: '来源', value: (a) => (a.fromPublic ? '公域' : '私域') },
  { header: '手机号', value: (a) => a.phone, kind: 'text' },
  { header: '报名编号', value: (a) => a.applicationId, kind: 'text' },
  { header: '应聘岗位', value: (a) => a.jobTitle },
  { header: '项目', value: (a) => a.projectName },
  { header: '报名时间', value: (a) => a.createdAt, kind: 'datetime' },
  { header: '面试时间', value: (a) => a.interviewAt, kind: 'datetime' },
  { header: '状态', value: (a) => enumLabel('ApplicationStatus', a.status) },
  { header: '进度', value: (a) => (a.arrivedAt ? '已到厂' : progressText(a)) },
  { header: '到厂时间', value: (a) => a.arrivedAt, kind: 'datetime' },
  { header: '响应截止', value: (a) => a.responseDeadline, kind: 'datetime' },
]
function doExport() {
  const t = current.value
  const q = { status: t.status, unacknowledged: t.unack || undefined, arrivedToday: t.arrivedToday || undefined, projectId: projectId.value || undefined, sort: 'DEADLINE' as const }
  return exportList({ name: `待办清单-${t.label}`, columns: EXPORT_COLUMNS, rows: (p, pageSize) => tenantApi.applications({ ...q, page: p, pageSize }), loading: exporting })
}

const insight = reactive({ open: false, app: null as SiteApplication | null })
function openInsight(row: SiteApplication) {
  insight.app = row
  insight.open = true
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>待办清单</h2>
        <p>待知悉 / 待面试 / 待确权 · 电脑端与驻场手机端同步</p>
      </div>
      <span class="spacer" />
      <el-button v-if="tab !== 'cancel'" :loading="exporting" :disabled="!page.total" @click="doExport">导出</el-button>
      <el-button @click="refresh">刷新</el-button>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="setTab(t.key)">
            {{ t.label }}<span class="n">{{ wb && (ready || tab === 'cancel') ? wb[t.count] : '' }}</span>
          </button>
          <button v-if="canCancelReq" type="button" role="tab" :aria-selected="tab === 'cancel'" :class="{ on: tab === 'cancel' }" @click="setTab('cancel')">
            取消申请<span class="n">{{ cancelCount ?? '' }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
      </div>
      <div v-if="batch && selected.length" class="batch-bar" role="region" aria-label="批量操作">
        <span class="batch-n">已选 {{ selected.length }} 人</span>
        <el-button type="primary" size="small" class="batch-go" @click="runBatch">{{ batch.label }}</el-button>
        <el-button size="small" class="batch-clear" @click="clearSelection">取消选择</el-button>
        <span class="t-xs">一次最多 {{ BATCH_MAX }} 人，只能勾选当前页可{{ batch.action === 'ARRIVE' ? '到厂确认' : '知悉' }}的求职者</span>
      </div>
      <CancelRequestsTable v-if="tab === 'cancel'" ref="cancelTable" :project-id="projectId || undefined" @changed="loadCancelCount" />
      <el-table v-else ref="table" v-loading="loading" :data="loadError ? [] : list" row-key="applicationId" :row-class-name="rowClass" @selection-change="onSelectionChange">
        <el-table-column v-if="showSelect" key="sel" type="selection" width="44" :selectable="selectable" class-name="sel-col" />
        <el-table-column label="求职者 / 来源" min-width="136">
          <template #default="{ row }">
            <button type="button" class="person-btn" title="查看画像、匹配记录与历史报名" @click="openInsight(row)">
              <PersonCell :name="row.seekerName" :accent="!row.fromPublic">
                <span class="status-tag src-tag" :class="row.fromPublic ? 'status-tag--public' : 'status-tag--private'">{{ row.fromPublic ? '公域' : '私域' }}</span>
              </PersonCell>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="手机号 / 报名编号" width="136">
          <template #default="{ row }">
            <div v-if="row.phone" class="nowrap">{{ fmtPhone(row.phone) }}</div>
            <div v-else class="t-xs">{{ isSite ? '—' : '仅驻场可见' }}</div>
            <div class="t-xs nowrap">{{ row.applicationId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="应聘岗位" min-width="120">
          <template #default="{ row }">
            <div class="strong-14">{{ row.jobTitle ?? '—' }}</div>
            <div class="t-xs">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="报名 / 面试时间" width="120">
          <template #default="{ row }">
            <div class="t-xs nowrap" :title="fmtDateTime(row.createdAt)">报 {{ fmtDateTime(row.createdAt).slice(5) }}</div>
            <div class="nowrap" :class="row.interviewAt ? 'strong-14' : 't-sm'" :title="fmtDateTime(row.interviewAt)">面 {{ row.interviewAt ? fmtDateTime(row.interviewAt).slice(5) : '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <DictTag type="ApplicationStatus" :value="row.status" />
            <div v-if="row.arrivedAt" class="t-xs ok">已到厂 {{ fmtDateTime(row.arrivedAt).slice(5) }}</div>
            <div v-else class="t-xs">{{ progressText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="响应剩余" width="112">
          <template #default="{ row }"><RemainTag :deadline="row.responseDeadline" :now="now" /></template>
        </el-table-column>
        <el-table-column v-if="hasOps" label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }"><AppActionButtons :app="row" link @action="(a, r) => dialogs?.run(a, r)" /></template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="tbl-state">
            <IconCircleExclamationPoint :size="48" class="tbl-state-i" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="tbl-state">
            <IconInbox :size="48" class="tbl-state-i" />
            <h4>暂无{{ current.label }}</h4>
            <p>新报名、面试结果和待确权会出现在这里，按响应剩余时间排序</p>
          </div>
        </template>
      </el-table>
      <ApplicantInsightDrawer v-model="insight.open" :app="insight.app" />
      <div v-if="tab !== 'cancel' && page.total > 0" class="pager">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          :total="page.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @current-change="onPage"
          @size-change="onPage"
        />
      </div>
    </div>

    <div class="rules">
      <section class="card card__bd">
        <h3>脱敏与权限</h3>
        <p>姓名默认脱敏；<b>仅驻场角色可见完整手机号</b>。项目经理端自动隐藏手机号与证件号，「爽约」由驻场或项目经理标记。</p>
      </section>
      <section class="card card__bd">
        <h3>取消权限</h3>
        <p>用户<b>无法自行取消报名</b>。误操作或需更换岗位时由驻场 / 项目经理在后台取消（必填原因），取消后用户可重新进入 AI 问薪。求职者可在手机端提交取消申请，由驻场 / 项目经理在「取消申请」页签处理。</p>
      </section>
      <section class="card card__bd">
        <h3>面试未通过</h3>
        <p>报名前为本公司私域 → 回到「私域待匹配」并重开 24h 窗口；报名前为公域 → 回公域。爽约、超时一律释放到公域。</p>
      </section>
    </div>

    <AppActionDialogs ref="dialogs" @done="refresh" @batch-done="onBatchDone" />
  </div>
</template>

<style scoped>
.batch-bar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; padding: var(--space-2) 14px; border-bottom: 1px solid var(--divider); background: var(--primary-bg); }
.batch-bar .el-button + .el-button { margin-left: 0; }
.batch-n { margin-right: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.person-btn { all: unset; cursor: pointer; display: block; border-radius: var(--radius-tag); }
.person-btn:hover { opacity: 0.8; }
.person-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.strong-14 { font-size: var(--font-size-aux); color: var(--text-1); font-weight: var(--font-weight-medium); }
.ok { color: var(--success-text); }
.src-tag { margin-left: var(--space-2); vertical-align: 1px; }
.tbl-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) 0; line-height: 1.6; }
.tbl-state-i { color: var(--text-3); }
.tbl-state h4 { margin: var(--space-2) 0 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tbl-state p { margin: 0 0 var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.rules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); }
.rules h3 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.rules p { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.rules b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
</style>
