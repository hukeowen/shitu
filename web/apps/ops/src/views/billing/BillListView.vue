<script setup lang="ts">
import { IconInbox, IconCircleExclamationPoint } from '@shitu/ui-icons'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { opsApi, useDict, type BillFlag, type BillsSummary, type BillStatus, type DailyBillingResult, type MonthlyBill, type ReceivablesSummary } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { useCompanyNames } from '@/composables/useCompanyNames'
import { confirmInBox } from '@/composables/boxSubmit'
import { usePagedList } from '@/composables/usePagedList'
import { BILLING_SUPER_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtDate, fmtMoney, todayStr } from '@/utils/format'
import BillDrawer from './BillDrawer.vue'
import { payState, receivableState } from './billPayment'

/** P-10 对账管理：月账单列表、详情（每日明细 / 付款凭证确认 / 流转分成付款登记 / 异议复核 / 直接登记结算）、重算日计费、生成并下发月账单 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canIssue = computed(() => auth.hasAnyRole(BILLING_SUPER_ROLES))
const { label, options } = useDict()
const { companyName } = useCompanyNames()

const status = ref<BillStatus | ''>('')
const month = ref('')
const companyId = ref('')
/** 汇总条的筛选：有凭证待确认 / 逾期未结清 / 流转分成待付；工作台「待确认付款」「待付流转分成」带 ?flag= 进来 */
const FLAGS: BillFlag[] = ['PAYMENT_PENDING', 'OVERDUE', 'RECEIVABLE_UNPAID']
const flag = ref<BillFlag | ''>(FLAGS.includes(route.query.flag as BillFlag) ? (route.query.flag as BillFlag) : '')
const list = usePagedList<MonthlyBill>((p) =>
  opsApi.bills({ ...p, status: status.value || undefined, month: month.value || undefined, companyId: companyId.value.trim() || undefined, flag: flag.value || undefined }),
)
void list.load()

/** 汇总条：待确认付款、逾期未结清；拿不到时数字显示「—」 */
const summary = ref<BillsSummary | null>(null)
async function loadSummary() {
  try {
    summary.value = await opsApi.billsSummary()
  } catch {
    summary.value = null
  }
}
void loadSummary()
/** 汇总条第三格：待付流转分成（平台该付给企业的应收流转费），单独一个接口；拿不到时显示「—」 */
const receivables = ref<ReceivablesSummary | null>(null)
async function loadReceivables() {
  try {
    receivables.value = await opsApi.receivablesSummary()
  } catch {
    receivables.value = null
  }
}
void loadReceivables()
/** 点汇总条筛选，再点一次取消 */
function setFlag(v: BillFlag | '') {
  flag.value = flag.value === v ? '' : v
  const rest = { ...route.query }
  delete rest.flag
  void router.replace({ query: flag.value ? { ...rest, flag: flag.value } : rest })
  void list.search()
}
function onChanged() {
  void list.load()
  void loadSummary()
  void loadReceivables()
}

const tabs = computed(() => [{ value: '', label: '全部' }, ...options('BillStatus')])
function setStatus(v: string) {
  status.value = v as BillStatus | ''
  void list.search()
}

const pageTotals = computed(() => ({
  serviceFee: list.rows.value.reduce((sum, row) => sum + Number(row.serviceFee), 0),
  transferPayable: list.rows.value.reduce((sum, row) => sum + Number(row.transferPayable), 0),
  payable: list.rows.value.reduce((sum, row) => sum + Number(row.payable), 0),
  transferReceivable: list.rows.value.reduce((sum, row) => sum + Number(row.transferReceivable), 0),
}))
/** 导出：按当前状态、月份、公司、汇总条筛选把所有页取完；字段同表格 */
const exporting = ref(false)
const EXPORT_COLUMNS: CsvColumn<MonthlyBill>[] = [
  { header: '账单号', value: (b) => b.billId, kind: 'text' },
  { header: '账单月份', value: (b) => b.billMonth, kind: 'text' },
  { header: '公司', value: (b) => companyName(b.companyId) },
  { header: '公司 ID', value: (b) => b.companyId, kind: 'text' },
  { header: '服务费', value: (b) => b.serviceFee, kind: 'money' },
  { header: '应付流转费', value: (b) => b.transferPayable, kind: 'money' },
  { header: '应付合计', value: (b) => b.payable, kind: 'money' },
  { header: '应收流转费', value: (b) => b.transferReceivable, kind: 'money' },
  { header: '状态', value: (b) => label('BillStatus', b.status) },
  { header: '付款进度', value: (b) => payState(b)?.label },
  { header: '异议截止', value: (b) => b.disputeDeadline, kind: 'date' },
  { header: '结算截止', value: (b) => b.settleDeadline, kind: 'date' },
  { header: '逾期天数', value: (b) => b.overdueDays },
  { header: '分成付款日期', value: (b) => b.receivablePaidDate, kind: 'date' },
]
function doExport() {
  const q = { status: status.value || undefined, month: month.value || undefined, companyId: companyId.value.trim() || undefined, flag: flag.value || undefined }
  return exportList({ name: month.value ? `月账单-${month.value}` : '月账单', columns: EXPORT_COLUMNS, rows: (page, pageSize) => opsApi.bills({ ...q, page, pageSize }), loading: exporting })
}

const drawerId = ref<string | null>(null)
function rowClass({ row }: { row: MonthlyBill }) {
  return row.status === 'DISPUTED' ? 'is-hl' : ''
}

// ---------- 重算日计费
function yesterday(): string {
  const d = new Date(`${todayStr()}T00:00:00`)
  d.setDate(d.getDate() - 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function lastMonth(): string {
  const d = new Date(`${todayStr()}T00:00:00`)
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const rerun = reactive({ visible: false, date: '', loading: false, result: null as DailyBillingResult | null })
function openRerun() {
  rerun.date = yesterday()
  rerun.result = null
  rerun.visible = true
}
const disableFuture = (d: Date) => d.getTime() >= new Date(`${todayStr()}T00:00:00`).getTime()
async function doRerun() {
  if (!rerun.date || rerun.loading) return
  rerun.loading = true
  try {
    await confirmInBox({ title: '重算日计费', action: '重算',
      text: `将按当日生效的计费规则重算 ${rerun.date} 的增长技术服务费与流转费（幂等，所在月账单已下发时会被拒绝）。确定继续？`,
      api: async () => {
        rerun.result = await opsApi.rerunDaily(rerun.date)
        ElMessage.success(`${rerun.date} 计费已重算`)
      },
    })
  } finally { rerun.loading = false }
}

// ---------- 生成并下发月账单（仅超管）
const issue = reactive({ visible: false, month: '', loading: false })
function openIssue() {
  issue.month = lastMonth()
  issue.visible = true
}
const disableIssueMonth = (d: Date) => {
  const t = new Date(`${todayStr()}T00:00:00`)
  return d.getFullYear() * 12 + d.getMonth() >= t.getFullYear() * 12 + t.getMonth()
}
async function doIssue() {
  if (!issue.month || issue.loading) return
  issue.loading = true
  try {
    const ok = await confirmInBox({ title: '生成并下发月账单', action: '生成并下发', danger: true,
      text: `将汇总 ${issue.month} 全部企业的每日计费，生成月账单并下发给企业（企业可在异议期内提出异议）。下发后该月日计费不能再重算。确定继续？`,
      api: async () => {
        const n = await opsApi.issueMonthly(issue.month)
        ElMessage.success(`${issue.month} 账单已下发 ${n} 份`)
      },
    })
    if (!ok) return
    issue.visible = false
    month.value = issue.month
    await list.search()
  } finally { issue.loading = false }
}
function reset() {
  month.value = ''
  companyId.value = ''
  status.value = ''
  if (flag.value) return setFlag('')
  void list.search()
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>对账管理</h2>
        <p>应付 = 增长技术服务费 + 应付流转费，企业提交凭证后确认到账 · 应收流转费（流转分成）由平台另付、不轧差</p>
      </div>
      <div class="spacer" />
      <el-button :loading="exporting" :disabled="!list.total.value" @click="doExport">导出</el-button>
      <el-button @click="openRerun">重算日计费</el-button>
      <el-button v-if="canIssue" type="primary" @click="openIssue">生成并下发月账单</el-button>
    </div>

    <div class="grid g-3 flag-strip">
      <button type="button" class="stat stat--link flag-stat" :class="{ on: flag === 'PAYMENT_PENDING' }" :aria-pressed="flag === 'PAYMENT_PENDING'" @click="setFlag('PAYMENT_PENDING')">
        <div class="stat-l">待确认付款</div>
        <div class="stat-v"><template v-if="summary">{{ summary.paymentPending }}<small>笔</small></template><template v-else>—</template></div>
        <div class="stat-d">{{ flag === 'PAYMENT_PENDING' ? '已筛选，再点一次取消' : '企业已提交付款凭证，点击只看这些账单' }}</div>
      </button>
      <button type="button" class="stat stat--link flag-stat" :class="{ on: flag === 'OVERDUE' }" :aria-pressed="flag === 'OVERDUE'" @click="setFlag('OVERDUE')">
        <div class="stat-l">逾期未结清</div>
        <div class="stat-v"><template v-if="summary">{{ summary.overdueBills }}<small>张 · 金额 {{ fmtMoney(summary.overdueAmount) }} 元</small></template><template v-else>—</template></div>
        <div class="stat-d">{{ flag === 'OVERDUE' ? '已筛选，再点一次取消' : '过了结算截止日还没结清，点击只看这些账单' }}</div>
      </button>
      <button type="button" class="stat stat--link flag-stat" :class="{ on: flag === 'RECEIVABLE_UNPAID' }" :aria-pressed="flag === 'RECEIVABLE_UNPAID'" @click="setFlag('RECEIVABLE_UNPAID')">
        <div class="stat-l">待付流转分成</div>
        <div class="stat-v"><template v-if="receivables">{{ receivables.unpaidBills }}<small>张 · 金额 {{ fmtMoney(receivables.unpaidAmount) }} 元</small></template><template v-else>—</template></div>
        <div class="stat-d">{{ flag === 'RECEIVABLE_UNPAID' ? '已筛选，再点一次取消' : '平台该付给企业的应收流转费，点击只看这些账单' }}<span v-if="receivables && receivables.withoutPayee > 0" class="no-payee"> · 其中 {{ receivables.withoutPayee }} 家未登记收款账户</span></div>
      </button>
    </div>
    <div class="grid g-4 bill-summary">
      <div v-for="item in ([['serviceFee', '本页服务费'], ['transferPayable', '本页应付流转费'], ['payable', '本页应付合计'], ['transferReceivable', '本页应收流转费']] as const)" :key="item[0]" class="stat">
        <div class="stat-l">{{ item[1] }}</div>
        <div class="stat-v money">{{ list.loading.value || list.error.value ? '—' : fmtMoney(pageTotals[item[0]]) }}</div>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="setStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" placeholder="账单月份" clearable style="width: 140px" @change="list.search()" />
        <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 160px" @keyup.enter="list.search()" @clear="list.search()" />
        <el-button :loading="list.loading.value" @click="list.search()">查询</el-button><el-button @click="reset">重置</el-button>
      </div>

      <el-table v-loading="list.loading.value" :data="list.loading.value ? [] : list.rows.value" class="tbl-48" row-key="billId" :row-class-name="rowClass" @row-dblclick="(r: MonthlyBill) => (drawerId = r.billId)">
        <el-table-column label="账单" min-width="170">
          <template #default="{ row }">
            <el-button link type="primary" class="mono" @click="drawerId = row.billId">{{ row.billId }}</el-button>
            <div class="t-xs tnum">{{ row.billMonth }}</div>
          </template>
        </el-table-column>
        <el-table-column label="公司" min-width="170">
          <template #default="{ row }">
            <template v-if="companyName(row.companyId)">
              <span class="strong">{{ companyName(row.companyId) }}</span>
              <div class="t-xs mono">{{ row.companyId }}</div>
            </template>
            <span v-else class="mono t-sm">{{ row.companyId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="服务费" min-width="110" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.serviceFee) }}</span></template></el-table-column>
        <el-table-column label="应付流转费" min-width="110" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.transferPayable) }}</span></template></el-table-column>
        <el-table-column label="应付合计" min-width="120" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.payable) }}</span></template></el-table-column>
        <el-table-column label="应收流转费" min-width="140" align="right">
          <template #default="{ row }">
            <span class="money">{{ fmtMoney(row.transferReceivable) }}</span>
            <div v-if="receivableState(row)" class="t-xs pay-t" :class="`pay-t--${receivableState(row)?.tone}`">{{ receivableState(row)?.label }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <StatusTag type="BillStatus" :value="row.status" />
            <div v-if="payState(row)" class="t-xs pay-t" :class="`pay-t--${payState(row)?.tone}`">{{ payState(row)?.label }}</div>
          </template>
        </el-table-column>
        <el-table-column label="异议截止 / 结算截止" min-width="150">
          <template #default="{ row }">
            <span class="tnum t-sm">{{ fmtDate(row.disputeDeadline) }}</span>
            <div class="t-xs tnum" :class="{ overdue: row.overdueDays > 0 }">{{ fmtDate(row.settleDeadline) }}</div>
            <div v-if="row.overdueDays > 0" class="t-xs overdue">已逾期 {{ row.overdueDays }} 天</div>
          </template>
        </el-table-column>
        <el-table-column class-name="ops-col" label="操作" width="90" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="drawerId = row.billId">
              {{ row.status === 'DISPUTED' ? '复核' : row.paymentStatus === 'PENDING' && row.status !== 'SETTLED' ? '确认付款' : flag === 'RECEIVABLE_UNPAID' ? '登记付款' : '详情' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="!list.loading.value && list.error.value" :image-size="48" :description="list.error.value"><template #image><IconCircleExclamationPoint :size="48" /></template>
            <el-button size="small" @click="list.load()">重新加载</el-button>
          </el-empty>
          <el-empty v-else-if="!list.loading.value" :image-size="48"><template #image><IconInbox :size="48" /></template><template #description><h3>暂无账单</h3><p>当前条件下没有账单，可重置筛选后查看。</p></template><el-button type="primary" @click="reset">重置筛选</el-button></el-empty>
        </template>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="list.total.value"
          :current-page="list.page.value"
          :page-size="list.pageSize.value"
          :page-sizes="[20, 50, 100]"
          @current-change="list.onPageChange"
          @size-change="list.onSizeChange"
        />
      </div>
    </div>

    <BillDrawer :bill-id="drawerId" @close="drawerId = null" @changed="onChanged" />

    <el-dialog class="dlg-16" v-model="rerun.visible" title="重算日计费" width="520px" destroy-on-close :close-on-click-modal="false">
      <div class="notice notice--info gap">按该日生效的计费规则重新计算各企业当日服务费与流转费。幂等，可重复执行；所在月账单已下发则拒绝。</div>
      <el-form label-width="80px">
        <el-form-item label="计费日期">
          <el-date-picker v-model="rerun.date" type="date" value-format="YYYY-MM-DD" :disabled-date="disableFuture" :clearable="false" />
        </el-form-item>
      </el-form>
      <dl v-if="rerun.result" class="kv-grid one">
        <div class="kv"><dt>计费日期</dt><dd class="mono">{{ rerun.result.bizDate }}</dd></div>
        <div class="kv"><dt>规则版本</dt><dd class="mono">v{{ rerun.result.ruleVersion }}</dd></div>
        <div class="kv"><dt>计费企业</dt><dd class="mono">{{ rerun.result.companies }}</dd></div>
        <div class="kv"><dt>流转明细行</dt><dd class="mono">{{ rerun.result.transferLines }}</dd></div>
        <div class="kv"><dt>服务费合计</dt><dd class="money">{{ fmtMoney(rerun.result.serviceFee) }} 元</dd></div>
        <div class="kv"><dt>流转费合计</dt><dd class="money">{{ fmtMoney(rerun.result.transferFee) }} 元</dd></div>
      </dl>
      <template #footer>
        <el-button @click="rerun.visible = false">关闭</el-button>
        <el-button type="primary" :loading="rerun.loading" :disabled="!rerun.date" @click="doRerun">重算</el-button>
      </template>
    </el-dialog>

    <el-dialog class="dlg-16" v-model="issue.visible" title="生成并下发月账单" width="520px" destroy-on-close :close-on-click-modal="false">
      <div class="notice notice--warn gap">只能生成已结束月份的账单。下发后企业会收到账单通知并进入异议期，该月的日计费将不能再重算。</div>
      <el-form label-width="80px">
        <el-form-item label="账单月份">
          <el-date-picker v-model="issue.month" type="month" value-format="YYYY-MM" :disabled-date="disableIssueMonth" :clearable="false" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="issue.visible = false">取消</el-button>
        <el-button type="primary" :loading="issue.loading" :disabled="!issue.month" @click="doIssue">生成并下发</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.el-table__row.is-hl > td.el-table__cell) { background: var(--warning-soft); }
.bill-summary { margin-bottom: var(--space-4); }
.flag-strip { margin-bottom: var(--space-4); }
/* 汇总条是按钮：去掉按钮自带的样子，选中时用主色描边 */
.flag-stat { width: 100%; font: inherit; text-align: left; appearance: none; }
.flag-stat.on { border-color: var(--primary); background: var(--primary-bg); }
.pay-t { margin-top: 2px; white-space: nowrap; }
.pay-t--neutral { color: var(--text-2); }
.pay-t--success { color: var(--success-text); }
.pay-t--warning { color: var(--warning-text); }
.pay-t--danger, .overdue { color: var(--danger-text); }
.no-payee { color: var(--warning-text); }
.bill-summary .money { text-align: right; font-size: var(--font-size-title); }
.gap { margin-bottom: 14px; }
</style>
