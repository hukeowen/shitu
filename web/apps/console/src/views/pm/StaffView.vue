<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessage, tenantApi, type StaffRow } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { fmtPhone } from '@/utils/format'
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
const totals = ref<{ active: number | null; left: number | null }>({ active: null, left: null })

async function load() {
  loading.value = true
  loadError.value = ''
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
function refresh() {
  load()
  loadTotals()
}
onMounted(refresh)

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
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>人员管理</h2>
        <p>姓名、岗位、在岗状态、来源归属、入职时间 · {{ isSite ? '驻场可见完整手机号' : '项目经理端自动隐藏手机号与证件号' }}</p>
      </div>
      <span class="spacer" />
      <span class="ref">功能 <b>T-307</b></span>
      <el-button @click="refresh">刷新</el-button>
    </div>

    <div class="grid g-3">
      <div class="stat"><div class="stat-l">在岗人数</div><div class="stat-v">{{ totals.active ?? '—' }}</div><div class="stat-d">{{ filter.projectId ? '当前项目' : '我负责的项目' }}</div></div>
      <div class="stat"><div class="stat-l">已离职</div><div class="stat-v">{{ totals.left ?? '—' }}</div><div class="stat-d">历史累计</div></div>
      <div class="stat stat--signal"><div class="stat-l">本页流转流入</div><div class="stat-v">{{ transferCount }}</div><div class="stat-d">来源为其他公司 · 产生流转费</div></div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="toolbar">
        <div class="filter-tabs">
          <button :class="{ on: filter.tab === 'active' }" @click="setTab('active')">在岗<span class="n">{{ totals.active ?? '' }}</span></button>
          <button :class="{ on: filter.tab === 'left' }" @click="setTab('left')">已离职<span class="n">{{ totals.left ?? '' }}</span></button>
          <button :class="{ on: filter.tab === 'all' }" @click="setTab('all')">全部</button>
        </div>
        <span class="spacer" />
        <el-select v-model="filter.projectId" placeholder="全部项目" clearable filterable style="width: 190px" @change="onProject">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
        <el-input v-model="filter.keyword" placeholder="工号或完整手机号" clearable style="width: 180px" @keyup.enter="search" @clear="search" />
        <el-button @click="search">查询</el-button>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="list" row-key="employmentId" :row-class-name="rowClass">
        <el-table-column label="姓名" min-width="130">
          <template #default="{ row }"><PersonCell :name="row.name" :sub="row.phone ? fmtPhone(row.phone) : undefined" :accent="row.source === 'OWN'" /></template>
        </el-table-column>
        <el-table-column label="工号" width="120">
          <template #default="{ row }"><span class="mono t-sm">{{ row.employeeNo || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="岗位 / 项目" min-width="180">
          <template #default="{ row }">
            <div class="t-sm strong">{{ row.jobTitle ?? '—' }}</div>
            <div class="t-xs">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <span class="st-pill" :style="{ color: row.endDate ? 'var(--ink-400)' : 'var(--ok)' }"><i />{{ row.endDate ? '已离职' : '在岗' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="来源归属" min-width="140">
          <template #default="{ row }">
            <span v-if="row.source === 'TRANSFER'" class="t-sm"><b style="color: var(--signal)">流转自 {{ row.sourceCompanyName ?? '其他公司' }}</b></span>
            <DictTag v-else type="StaffSource" :value="row.source" />
          </template>
        </el-table-column>
        <el-table-column label="入职 / 离职" width="120">
          <template #default="{ row }">
            <div class="mono t-sm">{{ row.startDate }}</div>
            <div v-if="row.endDate" class="mono t-xs">离 {{ row.endDate }}</div>
          </template>
        </el-table-column>
        <el-table-column label="在岗天数" width="86" align="center">
          <template #default="{ row }"><span class="num">{{ row.dutyDays }}</span></template>
        </el-table-column>
        <el-table-column label="本月缺勤" width="86" align="center">
          <template #default="{ row }"><span class="num" :style="{ color: row.absenceDaysThisMonth ? 'var(--warn)' : undefined }">{{ row.absenceDaysThisMonth }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="230" align="right" fixed="right">
          <template #default="{ row }">
            <template v-if="!row.endDate">
              <el-button v-if="isPm" size="small" @click="openDlg(transfer, row)">调岗</el-button>
              <el-button size="small" @click="openDlg(absence, row)">请假/旷工</el-button>
              <el-button size="small" type="danger" plain @click="openDlg(resign, row)">离职</el-button>
            </template>
            <el-button v-else size="small" link @click="openDlg(absence, row)">缺勤记录</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无人员'" /></template>
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

    <div class="note note--info" style="margin-top: 14px">
      <b>权限隔离：</b>项目经理端可见用工档案，系统自动隐藏手机号与身份证号；驻场端可见完整手机号；老板端仅可查看聚合统计。来源「流转自其他公司」的员工在岗期间按 10 元/人/天支付人才流转费。
    </div>

    <TransferDialog v-model="transfer.visible" :row="transfer.row" @done="load" />
    <AbsenceDialog v-model="absence.visible" :row="absence.row" @done="load" />
    <ResignDialog v-model="resign.visible" :row="resign.row" @done="load" />
  </div>
</template>
