<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessage, tenantApi, type StaffRow } from '@shitu/api-client'
import { IconArrowLeftRight, IconCircleExclamationPoint, IconIdCard, IconInfo, IconUserMinus, IconUsers } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtPhone } from '@/utils/format'
import { enumLabel } from '@/utils/labels'
import AbsenceDialog from './staff/AbsenceDialog.vue'
import ResignDialog from './staff/ResignDialog.vue'
import TransferDialog from './staff/TransferDialog.vue'

/** A-12 人员管理（T-307）：在岗 / 离职、来源归属；内部调岗（项目经理）、请假旷工、发起离职（驻场 / 项目经理） */
type ActiveTab = 'active' | 'left' | 'all'
const meStore = useMeStore()
const { projects } = useProjects()
const isPm = computed(() => meStore.hasRole('PM'))
const isSite = computed(() => meStore.hasRole('SITE'))

const filter = reactive<{ tab: ActiveTab; projectId: string; keyword: string }>({ tab: 'active', projectId: '', keyword: '' })
const page = reactive({ page: 1, pageSize: 20, total: 0 })
const list = ref<StaffRow[]>([])
const loading = ref(false)
const loadError = ref('')
/** 本页拿到过数据（没拿到时「本页流转流入」不显示数字） */
const ready = ref(false)
const totals = ref<{ active: number | null; left: number | null }>({ active: null, left: null })

async function load() {
  loading.value = true
  loadError.value = ''
  ready.value = false
  try {
    const r = await tenantApi.employments({
      active: filter.tab === 'all' ? undefined : filter.tab === 'active',
      projectId: filter.projectId || undefined,
      keyword: filter.keyword.trim() || undefined,
      page: page.page,
      pageSize: page.pageSize,
    })
    list.value = r.records
    page.total = r.total
    ready.value = true
  } catch (e) {
    loadError.value = errorMessage(e, '人员加载失败')
    list.value = []
    page.total = 0
  } finally {
    loading.value = false
  }
}
/** 在岗 / 离职人数（标签数字），只按项目筛选 */
async function loadTotals() {
  const pid = filter.projectId || undefined
  totals.value = { active: null, left: null }
  const [a, b] = await Promise.allSettled([
    tenantApi.employments({ active: true, projectId: pid, page: 1, pageSize: 1 }),
    tenantApi.employments({ active: false, projectId: pid, page: 1, pageSize: 1 }),
  ])
  totals.value = { active: a.status === 'fulfilled' ? a.value.total : null, left: b.status === 'fulfilled' ? b.value.total : null }
}
function search() {
  page.page = 1
  load()
}
function setTab(t: ActiveTab) {
  filter.tab = t
  search()
}
function onProject() {
  search()
  loadTotals()
}
/** 重置：项目和关键词清回默认值后重新查询（页签不动） */
function reset() {
  const projectChanged = !!filter.projectId
  filter.projectId = ''
  filter.keyword = ''
  if (projectChanged) onProject()
  else search()
}
function refresh() {
  load()
  loadTotals()
}
onMounted(refresh)

/** 导出：按当前页签、项目、关键词把所有页取完；字段同表格，手机号只有驻场拿得到（其他角色接口不返回，这一列为空） */
const exporting = ref(false)
const EXPORT_COLUMNS: CsvColumn<StaffRow>[] = [
  { header: '姓名', value: (r) => r.name },
  { header: '手机号', value: (r) => r.phone, kind: 'text' },
  { header: '工号', value: (r) => r.employeeNo, kind: 'text' },
  { header: '岗位', value: (r) => r.jobTitle },
  { header: '项目', value: (r) => r.projectName },
  { header: '状态', value: (r) => (r.endDate ? '已离职' : '在岗') },
  { header: '来源归属', value: (r) => enumLabel('StaffSource', r.source) },
  { header: '流转来源公司', value: (r) => (r.source === 'TRANSFER' ? (r.sourceCompanyName ?? '其他公司') : '') },
  { header: '入职日期', value: (r) => r.startDate, kind: 'date' },
  { header: '离职日期', value: (r) => r.endDate, kind: 'date' },
  { header: '在岗天数', value: (r) => r.dutyDays },
  { header: '本月缺勤', value: (r) => r.absenceDaysThisMonth },
]
function doExport() {
  const q = { active: filter.tab === 'all' ? undefined : filter.tab === 'active', projectId: filter.projectId || undefined, keyword: filter.keyword.trim() || undefined }
  return exportList({
    name: filter.tab === 'active' ? '在岗人员' : filter.tab === 'left' ? '离职人员' : '人员名单',
    columns: EXPORT_COLUMNS,
    rows: (page, pageSize) => tenantApi.employments({ ...q, page, pageSize }),
    loading: exporting,
  })
}

const transfer = reactive({ visible: false, row: null as StaffRow | null })
const absence = reactive({ visible: false, row: null as StaffRow | null })
const resign = reactive({ visible: false, row: null as StaffRow | null })
function openDlg(d: { visible: boolean; row: StaffRow | null }, row: StaffRow) {
  d.row = row
  d.visible = true
}
function rowClass({ row }: { row: StaffRow }) {
  return row.endDate ? 'row-dim' : ''
}
const transferCount = computed(() => list.value.filter((r) => r.source === 'TRANSFER').length)
/** 操作列宽按本页实际出现的按钮算（规范 Page States「console 表格操作列宽」） */
const opsWidth = computed(() =>
  actionsColWidth(list.value.map((r) => ({ labels: r.endDate ? ['缺勤记录'] : [...(isPm.value ? ['调岗'] : []), '请假/旷工', '离职'] }))),
)
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>人员管理</h2>
        <p>姓名、岗位、在岗状态、来源归属、入职时间 · {{ isSite ? '驻场可见完整手机号' : '项目经理端自动隐藏手机号与证件号' }}</p>
      </div>
      <span class="spacer" />
      <el-button :loading="exporting" :disabled="!page.total" @click="doExport">导出</el-button>
      <el-button @click="refresh">刷新</el-button>
    </div>

    <div class="kpis">
      <div class="stat stat--icon">
        <IconUsers :size="20" class="stat-i" />
        <div class="stat-l">在岗人数</div><div class="stat-v">{{ totals.active ?? '—' }}</div><div class="stat-d">{{ filter.projectId ? '当前项目' : '我负责的项目' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconUserMinus :size="20" class="stat-i" />
        <div class="stat-l">已离职</div><div class="stat-v">{{ totals.left ?? '—' }}</div><div class="stat-d">历史累计</div>
      </div>
      <div class="stat stat--icon">
        <IconArrowLeftRight :size="20" class="stat-i" />
        <div class="stat-l">流转流入（本页）</div><div class="stat-v">{{ ready ? transferCount : '—' }}</div><div class="stat-d">来源为其他公司 · 产生流转费</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="filter.tab === 'active'" :class="{ on: filter.tab === 'active' }" @click="setTab('active')">
            在岗<span v-if="totals.active != null" class="n">{{ totals.active }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="filter.tab === 'left'" :class="{ on: filter.tab === 'left' }" @click="setTab('left')">
            已离职<span v-if="totals.left != null" class="n">{{ totals.left }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="filter.tab === 'all'" :class="{ on: filter.tab === 'all' }" @click="setTab('all')">全部</button>
        </div>
        <span class="spacer" />
        <el-select v-model="filter.projectId" placeholder="全部项目" clearable filterable style="width: 190px" @change="onProject">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
        <el-input v-model="filter.keyword" :placeholder="isSite ? '工号 / 手机号后四位 / 完整手机号' : '工号或完整手机号'" clearable style="width: 240px" @keyup.enter="search" @clear="search" />
        <el-button @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <el-table v-loading="loading" :data="list" row-key="employmentId" :row-class-name="rowClass">
        <el-table-column label="姓名" min-width="120">
          <template #default="{ row }"><PersonCell :name="row.name" :sub="row.phone ? fmtPhone(row.phone) : undefined" :accent="row.source === 'OWN'" /></template>
        </el-table-column>
        <el-table-column label="工号" width="116">
          <template #default="{ row }"><span class="tnum">{{ row.employeeNo || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="岗位 / 项目" min-width="150">
          <template #default="{ row }">
            <div class="strong-t">{{ row.jobTitle ?? '—' }}</div>
            <div class="sub">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="78">
          <template #default="{ row }">
            <span class="status-tag" :class="row.endDate ? 'status-tag--neutral' : 'status-tag--success'">{{ row.endDate ? '已离职' : '在岗' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="来源归属" min-width="110">
          <template #default="{ row }">
            <DictTag type="StaffSource" :value="row.source" />
            <div v-if="row.source === 'TRANSFER'" class="sub">流转自 {{ row.sourceCompanyName ?? '其他公司' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="入职 / 离职" width="114">
          <template #default="{ row }">
            <div class="tnum">{{ row.startDate }}</div>
            <div v-if="row.endDate" class="sub tnum">离 {{ row.endDate }}</div>
          </template>
        </el-table-column>
        <el-table-column label="在岗天数" width="80" align="right">
          <template #default="{ row }"><span class="tnum strong-t">{{ row.dutyDays }}</span></template>
        </el-table-column>
        <el-table-column label="本月缺勤" width="80" align="right">
          <template #default="{ row }"><span class="tnum" :class="row.absenceDaysThisMonth ? 'warn-n' : 'strong-t'">{{ row.absenceDaysThisMonth }}</span></template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <template v-if="!row.endDate">
                <el-button v-if="isPm" size="small" link type="primary" @click="openDlg(transfer, row)">调岗</el-button>
                <el-button size="small" link type="primary" @click="openDlg(absence, row)">请假/旷工</el-button>
                <el-button size="small" link type="danger" @click="openDlg(resign, row)">离职</el-button>
              </template>
              <el-button v-else size="small" link type="primary" @click="openDlg(absence, row)">缺勤记录</el-button>
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
            <IconIdCard :size="48" />
            <h4>暂无人员</h4>
            <p>{{ filter.projectId || filter.keyword.trim() ? '当前筛选范围内没有人员，换个条件或点「重置」' : '员工入职或花名册导入后会出现在这里' }}</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="page.total > 0" class="pager">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          :total="page.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </div>

    <div class="notice-bar foot-tip">
      <IconInfo :size="16" class="notice-bar-i" />
      <span><b>权限隔离：</b>项目经理端可见用工档案，系统自动隐藏手机号与身份证号；驻场端可见完整手机号；老板端仅可查看聚合统计。来源「流转自其他公司」的员工在岗期间按 10 元/人/天支付人才流转费。</span>
    </div>

    <TransferDialog v-model="transfer.visible" :row="transfer.row" @done="load" />
    <AbsenceDialog v-model="absence.visible" :row="absence.row" @done="load" />
    <ResignDialog v-model="resign.visible" :row="resign.row" @done="load" />
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.toolbar .el-button + .el-button { margin-left: 0; }
.strong-t { color: var(--text-1); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 本月有缺勤：数字用提醒文字色，列名已经写明含义 */
.warn-n { color: var(--warning-text); font-weight: var(--font-weight-semibold); }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.foot-tip { margin-top: var(--space-gap); }
</style>
