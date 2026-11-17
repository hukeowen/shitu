<script setup lang="ts">
import { IconInbox, IconCircleExclamationPoint } from '@shitu/ui-icons'
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { opsApi, useDict, type BillStatus, type DailyBillingResult, type MonthlyBill } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { confirmInBox } from '@/composables/boxSubmit'
import { usePagedList } from '@/composables/usePagedList'
import { BILLING_SUPER_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDate, fmtMoney, todayStr } from '@/utils/format'
import BillDrawer from './BillDrawer.vue'

/** P-10 对账管理：月账单列表、详情（每日明细 / 异议复核 / 登记结算）、重算日计费、生成并下发月账单 */
const auth = useAuthStore()
const canIssue = computed(() => auth.hasAnyRole(BILLING_SUPER_ROLES))
const { options } = useDict()

const status = ref<BillStatus | ''>('')
const month = ref('')
const companyId = ref('')
const list = usePagedList<MonthlyBill>((p) =>
  opsApi.bills({ ...p, status: status.value || undefined, month: month.value || undefined, companyId: companyId.value.trim() || undefined }),
)
void list.load()

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
  void list.search()
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>对账管理</h2>
        <p>月账单 = 增长技术服务费 + 应付流转费（应收流转费不与应付轧差）· 下发 → 异议复核 → 确认 → 登记结算</p>
      </div>
      <div class="spacer" />
      <el-button @click="openRerun">重算日计费</el-button>
      <el-button v-if="canIssue" type="primary" @click="openIssue">生成并下发月账单</el-button>
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
        <el-table-column label="公司" width="110"><template #default="{ row }"><span class="mono t-sm">{{ row.companyId }}</span></template></el-table-column>
        <el-table-column label="服务费" min-width="110" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.serviceFee) }}</span></template></el-table-column>
        <el-table-column label="应付流转费" min-width="110" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.transferPayable) }}</span></template></el-table-column>
        <el-table-column label="应付合计" min-width="120" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.payable) }}</span></template></el-table-column>
        <el-table-column label="应收流转费" min-width="110" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.transferReceivable) }}</span></template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag type="BillStatus" :value="row.status" /></template></el-table-column>
        <el-table-column label="异议截止 / 结算截止" min-width="160">
          <template #default="{ row }">
            <span class="tnum t-sm">{{ fmtDate(row.disputeDeadline) }}</span>
            <div class="t-xs tnum">{{ fmtDate(row.settleDeadline) }}</div>
          </template>
        </el-table-column>
        <el-table-column class-name="ops-col" label="操作" width="90" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="drawerId = row.billId">
              {{ row.status === 'DISPUTED' ? '复核' : '详情' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="!list.loading.value && list.error.value" :image-size="64" :description="list.error.value"><template #image><IconCircleExclamationPoint :size="48" /></template>
            <el-button size="small" @click="list.load()">重新加载</el-button>
          </el-empty>
          <el-empty v-else-if="!list.loading.value" :image-size="64" description="暂无账单"><template #image><IconInbox :size="48" /></template></el-empty>
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

    <BillDrawer :bill-id="drawerId" @close="drawerId = null" @changed="list.load()" />

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
.bill-summary .money { text-align: right; font-size: var(--font-size-title); }
.gap { margin-bottom: 14px; }
</style>
