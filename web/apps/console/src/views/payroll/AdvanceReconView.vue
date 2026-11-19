<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessage, tenantApi, type AdvanceRecon } from '@shitu/api-client'
import { IconBanknote, IconCircleCheck, IconCircleExclamationPoint, IconReceipt, IconUserMinus, IconWallet } from '@shitu/ui-icons'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtDate, fmtDateTime, fmtYuan } from '@/utils/format'

/** 预支抵扣对账（T-505，只读）：某个工资月份抵扣了谁、抵扣后还欠多少；截至现在谁还有欠款 */
const month = ref('')
const months = ref<string[]>([])
const data = ref<AdvanceRecon | null>(null)
const loading = ref(false)
const loadError = ref('')
/** 两张表都是一次返回全部，前端分页 */
const PAGE = 20
const pg = reactive({ deduct: 1, owe: 1 })
/** 加载中（含切换月份）不显示上一次的数字和结论，标题的月份也跟着数据走（规范 Page States） */
const shown = computed(() => (loading.value ? null : data.value))
const deductRows = computed(() => (shown.value?.deductions ?? []).slice((pg.deduct - 1) * PAGE, pg.deduct * PAGE))
const oweRows = computed(() => (shown.value?.outstanding ?? []).slice((pg.owe - 1) * PAGE, pg.owe * PAGE))

/** 导出：两张表各导一个文件，都是接口一次返回的整份数据（不只是表格这一页） */
const followUp = (endDate?: string) => (endDate ? '工资已无法抵扣，需线下追收；系统已标记平台失信' : '下次导入工资表时自动抵扣')
const DEDUCT_COLUMNS: CsvColumn<AdvanceRecon['deductions'][number]>[] = [
  { header: '员工', value: (r) => r.seekerName },
  { header: '工号', value: (r) => r.employeeNo, kind: 'text' },
  { header: '项目', value: (r) => r.projectName },
  { header: '应发', value: (r) => r.grossPay, kind: 'money' },
  { header: '预支抵扣', value: (r) => r.advanceDeduct, kind: 'money' },
  { header: '实发', value: (r) => r.netPay, kind: 'money' },
  { header: '抵扣后欠款', value: (r) => r.debtAfter, kind: 'money' },
  { header: '工资条', value: (r) => r.payslipId, kind: 'text' },
]
const OWE_COLUMNS: CsvColumn<AdvanceRecon['outstanding'][number]>[] = [
  { header: '员工', value: (r) => r.seekerName },
  { header: '工号', value: (r) => r.employeeNo, kind: 'text' },
  { header: '项目', value: (r) => r.projectName },
  { header: '在职情况', value: (r) => (r.endDate ? '已离职' : '在职') },
  { header: '离职日期', value: (r) => r.endDate, kind: 'date' },
  { header: '未还欠款', value: (r) => r.debt, kind: 'money' },
  { header: '最近变动', value: (r) => r.lastChangeAt, kind: 'datetime' },
  { header: '后续处理', value: (r) => followUp(r.endDate) },
]
function exportDeductions() {
  if (shown.value) exportList({ name: `预支抵扣明细-${shown.value.month}`, columns: DEDUCT_COLUMNS, rows: shown.value.deductions })
}
function exportOutstanding() {
  if (shown.value) exportList({ name: '预支未还欠款', columns: OWE_COLUMNS, rows: shown.value.outstanding })
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const d = await tenantApi.advanceRecon(month.value || undefined)
    data.value = d
    month.value = d.month
    months.value = d.months
    pg.deduct = 1
    pg.owe = 1
  } catch (e) {
    // 没拿到这个月的数据时不显示上个月的数字（规范 Page States）
    data.value = null
    loadError.value = errorMessage(e, '对账数据加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>预支抵扣对账</h2>
        <p>工资表导入时系统自动从实发里抵扣预支欠款 · 这里核对每个月扣了谁、还欠多少</p>
      </div>
      <span class="spacer" />
      <el-select v-model="month" placeholder="工资月份" style="width: 140px" :disabled="loading" aria-label="工资月份" @change="load">
        <el-option v-for="m in months" :key="m" :label="m" :value="m" />
        <el-option v-if="month && !months.includes(month)" :label="month" :value="month" />
      </el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 第 9 类：顶部汇总（本期金额加关键分项）→ 明细表；金额等宽、右对齐。一个请求，整块一个加载遮罩、一个「重新加载」 -->
    <div v-loading="loading" class="body">
      <div class="kpis">
        <div class="stat stat--icon stat--signal">
          <IconReceipt :size="20" class="stat-i" />
          <div class="stat-l">{{ shown ? `${shown.month} 工资抵扣` : '工资抵扣' }}</div>
          <div class="stat-v money">{{ shown ? fmtYuan(shown.summary.deductTotal) : '—' }}</div>
          <div class="stat-d">{{ shown ? `${shown.summary.deductCount} 人 · 导入工资表时自动扣除` : '—' }}</div>
        </div>
        <div class="stat stat--icon">
          <IconBanknote :size="20" class="stat-i" />
          <div class="stat-l">{{ shown ? `${shown.month} 新拨款` : '新拨款' }}</div>
          <div class="stat-v money">{{ shown ? fmtYuan(shown.summary.payoutTotal) : '—' }}</div>
          <div class="stat-d">{{ shown ? `${shown.summary.payoutCount} 笔` : '—' }}</div>
        </div>
        <div class="stat stat--icon">
          <IconWallet :size="20" class="stat-i" />
          <div class="stat-l">当前未还欠款</div>
          <div class="stat-v money">{{ shown ? fmtYuan(shown.summary.outstandingTotal) : '—' }}</div>
          <div class="stat-d">{{ shown ? `${shown.summary.outstandingCount} 人 · 截至现在` : '—' }}</div>
        </div>
        <div class="stat stat--icon" :class="{ 'stat--danger': (shown?.summary.outstandingLeftCount ?? 0) > 0 }">
          <IconUserMinus :size="20" class="stat-i" />
          <div class="stat-l">其中已离职</div>
          <div class="stat-v">{{ shown ? shown.summary.outstandingLeftCount : '—' }}<small v-if="shown">人</small></div>
          <div class="stat-d">{{ shown ? '需线下追收' : '—' }}</div>
        </div>
      </div>

      <div v-if="loadError" class="card tbl-card">
        <div class="state-box">
          <IconCircleExclamationPoint :size="48" />
          <h4>{{ loadError }}</h4>
          <p>请检查网络后重新加载</p>
          <el-button @click="load">重新加载</el-button>
        </div>
      </div>

      <template v-else>
        <div class="card tbl-card">
          <div class="card__hd"><h3>{{ shown ? `${shown.month} 工资抵扣明细` : '工资抵扣明细' }}</h3><span class="hint hd-hint">按抵扣金额从高到低</span><el-button size="small" :disabled="!shown?.deductions.length" @click="exportDeductions">导出抵扣明细</el-button></div>
          <el-table :data="deductRows" row-key="payslipId">
            <el-table-column label="员工" min-width="170">
              <template #default="{ row }">
                <div><span class="strong-t">{{ row.seekerName }}</span><span v-if="row.employeeNo" class="sub tnum"> · {{ row.employeeNo }}</span></div>
                <div class="sub">{{ row.projectName || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="应发" width="130" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.grossPay) }}</span></template></el-table-column>
            <el-table-column label="预支抵扣" width="130" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.advanceDeduct) }}</span></template></el-table-column>
            <el-table-column label="实发" width="130" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.netPay) }}</span></template></el-table-column>
            <el-table-column label="抵扣后欠款" width="130" align="right">
              <template #default="{ row }">
                <span v-if="row.debtAfter == null" class="sub">—</span>
                <span v-else-if="Number(row.debtAfter) === 0" class="status-tag status-tag--success">已还清</span>
                <span v-else class="money">{{ fmtYuan(row.debtAfter) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="工资条" width="180"><template #default="{ row }"><span class="code">{{ row.payslipId }}</span></template></el-table-column>
            <template #empty>
              <div v-if="!loading" class="state-box">
                <IconCircleCheck :size="48" />
                <h4>这个月没有工资抵扣</h4>
                <p>{{ shown?.month }} 导入的工资表里没有人有预支欠款；换个月份看看</p>
              </div>
              <span v-else />
            </template>
          </el-table>
          <div v-if="(shown?.deductions.length ?? 0) > 0" class="pager">
            <el-pagination v-model:current-page="pg.deduct" :page-size="PAGE" :total="shown?.deductions.length ?? 0" layout="total, prev, pager, next" background size="small" />
          </div>
        </div>

        <div class="card tbl-card">
          <div class="card__hd"><h3>当前仍有欠款的人员</h3><span class="hint hd-hint">截至现在，不随月份切换 · 已离职的排在前面</span><el-button size="small" :disabled="!shown?.outstanding.length" @click="exportOutstanding">导出欠款人员</el-button></div>
          <el-table :data="oweRows" row-key="userId">
            <el-table-column label="员工" min-width="170">
              <template #default="{ row }">
                <div><span class="strong-t">{{ row.seekerName }}</span><span v-if="row.employeeNo" class="sub tnum"> · {{ row.employeeNo }}</span></div>
                <div class="sub">{{ row.projectName || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="在职情况" width="170">
              <template #default="{ row }">
                <span v-if="row.endDate" class="status-tag status-tag--danger">已离职 {{ fmtDate(row.endDate) }}</span>
                <span v-else class="status-tag status-tag--success">在职</span>
              </template>
            </el-table-column>
            <el-table-column label="未还欠款" width="130" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.debt) }}</span></template></el-table-column>
            <el-table-column label="最近变动" width="150"><template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.lastChangeAt) }}</span></template></el-table-column>
            <el-table-column label="后续处理" min-width="240">
              <template #default="{ row }"><span :class="row.endDate ? 'why-t' : 'sub'">{{ followUp(row.endDate) }}</span></template>
            </el-table-column>
            <template #empty>
              <div v-if="!loading" class="state-box">
                <IconCircleCheck :size="48" />
                <h4>没有未还清的预支</h4>
                <p>登记拨款后的欠款会出现在这里，导入工资表抵扣还清后自动移出</p>
              </div>
              <span v-else />
            </template>
          </el-table>
          <div v-if="(shown?.outstanding.length ?? 0) > 0" class="pager">
            <el-pagination v-model:current-page="pg.owe" :page-size="PAGE" :total="shown?.outstanding.length ?? 0" layout="total, prev, pager, next" background size="small" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.body { min-height: 200px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.hint { font-size: var(--font-size-min); color: var(--text-3); }
/* 表头说明靠右，导出按钮排在最右 */
.hd-hint { flex: 1; text-align: right; }
.strong-t { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.sub { font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-2); white-space: nowrap; }
.why-t { font-size: var(--font-size-aux); color: var(--warning-text); }
/* 表格行高约 48（规范 Key Components 表格） */
.tbl-card :deep(.el-table__body .el-table__cell) { height: 48px; }
</style>
