<script setup lang="ts">
import { shNowMs } from '@/utils/time'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type CompanyPayee, type MonthlyBill } from '@shitu/api-client'
import { IconArrowLeftRight, IconBanknote, IconCircleExclamationPoint, IconInfo, IconReceipt, IconTriangleExclamationPoint, IconWallet } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { boxSubmit } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtDate, fmtSigned, toNum } from '@/utils/format'
import { enumLabel } from '@/utils/labels'
import { parseLocal } from '@/utils/time'
import BillDetailDrawer from './BillDetailDrawer.vue'
import BillPayDialog from './BillPayDialog.vue'
import PayeeDialog from './PayeeDialog.vue'
import { canPay, payLabel, payState, receivableState } from './billPayment'

/**
 * A-16 费用账单（T-403，老板）：增长技术服务费 + 人才流转费应付 / 应收分开展示（不轧差）。
 * 账单下发后 5 个工作日内可提出异议（D-23，按节假日日历，截止日以后端 disputeDeadline 为准）。
 * 付款：老板线下对公转账后在账单上提交付款凭证，平台核对到账后账单结清；逾期天数以后端 overdueDays 为准。
 * 收款：应收流转费（流转分成）由平台对公转账到本公司登记的收款账户，平台登记付款后账单上显示「已到账」。
 */
const router = useRouter()
const page = reactive({ page: 1, pageSize: 12, total: 0 })
const list = ref<MonthlyBill[]>([])
const loading = ref(false)
const loadError = ref('')
const selectedId = ref<string>('')
/** 后端拒绝过异议的账单：只置灰这张账单的「提出异议」，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, string>>({})

const selected = computed(() => list.value.find((b) => b.billId === selectedId.value) ?? list.value[0] ?? null)

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    const r = await tenantApi.bills(page.page, page.pageSize)
    list.value = [...r.records].sort((a, b) => b.billMonth.localeCompare(a.billMonth))
    page.total = r.total
    if (!list.value.some((b) => b.billId === selectedId.value)) selectedId.value = list.value[0]?.billId ?? ''
  } catch (e) {
    loadError.value = errorMessage(e, '账单加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---------- 收款账户：平台把流转分成付到这里；没登记时平台付不了
const payee = ref<CompanyPayee | null>(null)
const payeeLoading = ref(false)
/** 拿到过一次结果才判断「没登记」，加载中、失败都不出提醒 */
const payeeReady = ref(false)
const payeeError = ref('')
const payeeDlg = ref(false)
async function loadPayee() {
  payeeLoading.value = true
  payeeError.value = ''
  try {
    payee.value = (await tenantApi.payee()) ?? null
    payeeReady.value = true
  } catch (e) {
    payeeError.value = errorMessage(e, '收款账户加载失败')
  } finally {
    payeeLoading.value = false
  }
}
onMounted(loadPayee)
function onPayeeSaved(p: CompanyPayee) {
  payee.value = p
  payeeReady.value = true
}
/** 这一页账单里有平台还没付的流转分成 */
const hasUnpaidReceivable = computed(() => list.value.some((b) => toNum(b.transferReceivable) > 0 && !b.receivablePaidDate))
const payeeMissing = computed(() => payeeReady.value && !payee.value)

/** 已下发且未过异议截止日（截止日当天仍可提） */
function canDispute(b: MonthlyBill | null): boolean {
  if (!b || b.status !== 'ISSUED' || !b.disputeDeadline) return false
  const end = parseLocal(b.disputeDeadline.slice(0, 10))
  if (!end) return false
  end.setHours(23, 59, 59, 999)
  return shNowMs() <= end.getTime()
}

/** 结算截止已过且账单还没结清才标红（以后端算的逾期天数为准）；异议截止过了只是不能再提异议，置灰即可 */
const settleOverdue = (b: MonthlyBill) => b.overdueDays > 0

async function dispute(b: MonthlyBill) {
  // 确认框里提交：框不关、「提交异议」转圈；被拒时原因写在框里，页面上也留原因并置灰这张账单的「提出异议」
  const s = boxSubmit(`对 ${b.billMonth} 账单提出异议，平台将复核并回复。异议截止 ${fmtDate(b.disputeDeadline)}。`, '提出异议', (content) => tenantApi.disputeBill(b.billId, content), (why) => {
    blocked[b.billId] = why
  })
  try {
    await ElMessageBox.prompt(s.message, '提出异议', {
      confirmButtonText: '提交异议',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请说明有异议的日期、人数或金额（必填）',
      inputValidator: (v: string) => (v && v.trim().length >= 5) || '请至少填写 5 个字',
      beforeClose: s.beforeClose,
    })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('异议已提交，平台将在 5 个工作日内复核')
  load()
  drawerRef.value?.reload()
}

/** 导出：账单列表没有筛选，把所有页取完；金额写正数，应付 / 应收看列名 */
const exporting = ref(false)
const EXPORT_COLUMNS: CsvColumn<MonthlyBill>[] = [
  { header: '账单月份', value: (b) => b.billMonth, kind: 'text' },
  { header: '增长技术服务费', value: (b) => b.serviceFee, kind: 'money' },
  { header: '流转费应付', value: (b) => b.transferPayable, kind: 'money' },
  { header: '流转费应收', value: (b) => b.transferReceivable, kind: 'money' },
  { header: '应付合计', value: (b) => b.payable, kind: 'money' },
  { header: '状态', value: (b) => enumLabel('BillStatus', b.status) },
  { header: '付款进度', value: (b) => payState(b)?.label },
  { header: '异议截止', value: (b) => b.disputeDeadline, kind: 'date' },
  { header: '结算截止', value: (b) => b.settleDeadline, kind: 'date' },
  { header: '逾期天数', value: (b) => b.overdueDays },
  { header: '分成付款日期', value: (b) => b.receivablePaidDate, kind: 'date' },
]
function doExport() {
  return exportList({ name: '费用账单', columns: EXPORT_COLUMNS, rows: (p, pageSize) => tenantApi.bills(p, pageSize), loading: exporting })
}

const drawer = reactive({ visible: false, billId: null as string | null })
const drawerRef = ref<InstanceType<typeof BillDetailDrawer> | null>(null)
const drawerBill = computed(() => list.value.find((b) => b.billId === drawer.billId) ?? null)
function openDetail(b: MonthlyBill) {
  drawer.billId = b.billId
  drawer.visible = true
}
// ---------- 提交付款凭证
const pay = reactive({ visible: false, billId: null as string | null })
const payBill = computed(() => list.value.find((b) => b.billId === pay.billId) ?? null)
function openPay(b: MonthlyBill) {
  pay.billId = b.billId
  pay.visible = true
}
function onPaid() {
  load()
  drawerRef.value?.reload()
}

/** 这一行平铺的操作按钮 */
function rowActions(b: MonthlyBill): string[] {
  return ['明细', ...(canDispute(b) ? ['提出异议'] : []), ...(canPay(b) ? [payLabel(b)] : [])]
}
/** 操作列宽按这一页实际会出的按钮算（utils/actionsWidth.ts），1280 宽不横向滚动 */
const opsWidth = computed(() => actionsColWidth(list.value.map((b) => ({ labels: rowActions(b) })), 80))
function rowClass({ row }: { row: MonthlyBill }) {
  return row.billId === selected.value?.billId ? 'row-sel' : ''
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>费用账单</h2>
        <p>增长技术服务费 + 人才流转费 · 按月出账，次月 15 日前完成结算</p>
      </div>
      <span class="spacer" />
      <el-select v-if="list.length" v-model="selectedId" style="width: 140px">
        <el-option v-for="b in list" :key="b.billId" :label="b.billMonth" :value="b.billId" />
      </el-select>
      <el-button v-if="selected" @click="openDetail(selected)">账单明细</el-button>
      <el-button v-if="canDispute(selected)" :disabled="!!(selected && blocked[selected.billId])" @click="selected && dispute(selected)">提出异议</el-button>
      <el-button v-if="canPay(selected)" type="primary" @click="openPay(selected)">{{ payLabel(selected) }}</el-button>
    </div>

    <template v-if="selected">
      <div class="kpis">
        <div class="stat stat--icon">
          <IconReceipt :size="20" class="stat-i" />
          <div class="stat-l">增长技术服务费</div>
          <div class="stat-v money">{{ fmtSigned(selected.serviceFee, 'out') }}</div>
          <div class="stat-d">应付 · 按日累计 · 增量人员计费</div>
        </div>
        <div class="stat stat--icon">
          <IconWallet :size="20" class="stat-i" />
          <div class="stat-l">人才流转费（应付）</div>
          <div class="stat-v money">{{ fmtSigned(selected.transferPayable, 'out') }}</div>
          <div class="stat-d">流入人员 · 10 元/人/天</div>
        </div>
        <div class="stat stat--icon">
          <IconArrowLeftRight :size="20" class="stat-i" />
          <div class="stat-l">人才流转费（应收）</div>
          <div class="stat-v money">{{ fmtSigned(selected.transferReceivable, 'in') }}</div>
          <div class="stat-d">8 元/人/天<template v-if="receivableState(selected)"> · {{ receivableState(selected)?.label }}</template></div>
        </div>
        <div class="stat stat--icon stat--signal">
          <IconBanknote :size="20" class="stat-i" />
          <div class="stat-l">本月应付合计</div>
          <div class="stat-v money total">{{ fmtSigned(selected.payable, 'out') }}</div>
          <div class="stat-d nowrap">结算截止 {{ fmtDate(selected.settleDeadline) }}</div>
        </div>
      </div>
      <div class="notice-bar netting">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>
          <b>应收与应付不轧差：</b>本月应付合计 = 服务费 + 应付流转费；作为来源方的应收流转费（流转分成）由平台对公转账到本公司登记的收款账户，不抵扣本月应付。
          <el-button link type="primary" class="to-ledger" @click="router.push({ path: '/circulation/ledger', query: { month: selected.billMonth } })">查看流转账本 →</el-button>
        </span>
      </div>
    </template>

    <div v-if="payeeError" class="notice-bar payee-bar" role="status">
      <IconInfo :size="16" class="notice-bar-i" />
      <span class="payee-t"><b>收款账户</b>{{ payeeError }}</span>
      <el-button size="small" :loading="payeeLoading" @click="loadPayee">重新加载</el-button>
    </div>
    <div v-else-if="payeeMissing && hasUnpaidReceivable" class="notice-bar notice-bar--warn payee-bar" role="status">
      <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
      <span class="payee-t"><b>还没有登记收款账户：</b>本公司有流转费应收，平台要在登记收款账户之后才能付款。</span>
      <el-button size="small" type="primary" @click="payeeDlg = true">登记收款账户</el-button>
    </div>
    <div v-else-if="payeeReady" class="payee-line payee-bar">
      <IconWallet :size="16" class="payee-i" />
      <b class="payee-l">收款账户</b>
      <template v-if="payee">
        <span class="payee-t">{{ payee.accountName }} · {{ payee.bankName }} · 尾号 {{ payee.accountTail }}<span class="hint payee-hint">平台把流转分成付到这个账户</span></span>
        <el-button link type="primary" @click="payeeDlg = true">修改</el-button>
      </template>
      <template v-else>
        <span class="payee-t hint">尚未登记。有流转费应收时，平台把流转分成付到登记的收款账户</span>
        <el-button link type="primary" @click="payeeDlg = true">登记收款账户</el-button>
      </template>
    </div>

    <div class="card tbl-card">
      <div class="card__hd"><h3>月度账单</h3><span class="hint hd-hint">每月最后一天自动生成，平台下发后进入 5 个工作日异议期；对公转账后提交付款凭证，平台确认到账即结清</span><el-button size="small" :loading="exporting" :disabled="!page.total" @click="doExport">导出</el-button></div>
      <p v-for="(why, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ list.find((b) => b.billId === id)?.billMonth ?? id }} 账单{{ why }}。刷新后重新判断</p>
      <el-table v-loading="loading" :data="list" row-key="billId" :row-class-name="rowClass" @row-click="(r: MonthlyBill) => (selectedId = r.billId)">
        <el-table-column label="账单月份" width="96">
          <template #default="{ row }"><b class="code">{{ row.billMonth }}</b></template>
        </el-table-column>
        <el-table-column label="增长技术服务费" min-width="130" align="right">
          <template #default="{ row }"><span class="money">{{ fmtSigned(row.serviceFee, 'out') }}</span></template>
        </el-table-column>
        <el-table-column label="流转费应付" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fmtSigned(row.transferPayable, 'out') }}</span></template>
        </el-table-column>
        <el-table-column label="流转费应收" min-width="136" align="right">
          <template #default="{ row }">
            <span class="money">{{ fmtSigned(row.transferReceivable, 'in') }}</span>
            <div v-if="receivableState(row)" class="pay-t" :class="`pay-t--${receivableState(row)?.tone}`">{{ receivableState(row)?.label }}</div>
          </template>
        </el-table-column>
        <el-table-column label="应付合计" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fmtSigned(row.payable, 'out') }}</span></template>
        </el-table-column>
        <el-table-column label="状态" min-width="96">
          <template #default="{ row }">
            <DictTag type="BillStatus" :value="row.status" />
            <div v-if="payState(row)" class="pay-t" :class="`pay-t--${payState(row)?.tone}`">{{ payState(row)?.label }}</div>
          </template>
        </el-table-column>
        <el-table-column label="异议截止" width="104">
          <template #default="{ row }"><span class="code" :class="{ due: canDispute(row), past: row.disputeDeadline && !canDispute(row) }">{{ fmtDate(row.disputeDeadline) }}</span><div v-if="canDispute(row)" class="due-t">异议期内</div></template>
        </el-table-column>
        <el-table-column label="结算截止" width="104">
          <template #default="{ row }"><span class="code" :class="{ overdue: settleOverdue(row) }" :title="settleOverdue(row) ? '已过结算截止日' : undefined">{{ fmtDate(row.settleDeadline) }}</span><div v-if="settleOverdue(row)" class="overdue-t">已逾期 {{ row.overdueDays }} 天</div></template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <el-button size="small" link type="primary" @click.stop="openDetail(row)">明细</el-button>
              <el-button v-if="canDispute(row)" size="small" link type="primary" :disabled="!!blocked[row.billId]" @click.stop="dispute(row)">提出异议</el-button>
              <el-button v-if="canPay(row)" size="small" link type="primary" @click.stop="openPay(row)">{{ payLabel(row) }}</el-button>
            </div>
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
            <IconReceipt :size="48" />
            <h4>暂无账单</h4>
            <p>每月最后一天自动生成，平台下发后会出现在这里</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="page.total > page.pageSize" class="pager">
        <el-pagination v-model:current-page="page.page" :page-size="page.pageSize" :total="page.total" layout="total, prev, pager, next" background size="small" @current-change="load" />
      </div>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>计费规则</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>增长技术服务费</dt><dd>max(在岗 − 存量基数, 0) × 单价 / 天</dd></dl>
          <dl class="kv"><dt>人才流转费（应付）</dt><dd>来源为其他公司的在岗员工 10 元/人/天</dd></dl>
          <dl class="kv"><dt>人才流转费（应收）</dt><dd>本公司来源的员工在别家在岗 8 元/人/天</dd></dl>
          <p class="para">存量人员<b>永久免费且不受离职影响</b>；三个月免费期内导入的员工计入存量。</p>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>对账与结算</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>结算周期</dt><dd>按月对账</dd></dl>
          <dl class="kv"><dt>账单生成</dt><dd>每月最后一天自动生成</dd></dl>
          <dl class="kv"><dt>结算截止</dt><dd>次月 15 日前（不早于异议期结束后 3 天）</dd></dl>
          <dl class="kv"><dt>异议期</dt><dd>下发后 5 个工作日内（节假日顺延）</dd></dl>
          <dl class="kv"><dt>付款方式</dt><dd>对公转账后提交付款凭证</dd></dl>
          <dl class="kv"><dt>流转分成收款</dt><dd>平台对公转账到登记的收款账户</dd></dl>
          <p class="para">按账单上的平台收款账户<b>一次付清应付合计</b>，转账后点「提交付款凭证」填写付款信息并上传回单；平台核对到账后账单变为「已结算」，凭证被退回的可以核对后重新提交。</p>
          <p class="para">过了结算截止日还没结清的账单会收到催缴提醒；<b>长期逾期未结清，公司会被自动限流</b>，结清后自动恢复。</p>
          <p class="para">账单上的流转费应收（流转分成）由平台<b>一次付清到本公司登记的收款账户</b>，付款后账单上显示「已到账」和付款日期；它和本公司的应付互不抵扣，没有登记收款账户时平台无法付款。</p>
        </div>
      </div>
    </div>

    <BillDetailDrawer
      ref="drawerRef"
      v-model="drawer.visible"
      :bill-id="drawer.billId"
      :can-dispute="canDispute(drawerBill)"
      :blocked-why="drawer.billId ? blocked[drawer.billId] : undefined"
      :can-pay="canPay(drawerBill)"
      :pay-label="payLabel(drawerBill)"
      @dispute="drawerBill && dispute(drawerBill)"
      @pay="drawerBill && openPay(drawerBill)"
    />
    <BillPayDialog v-model="pay.visible" :bill="payBill" @done="onPaid" />
    <PayeeDialog v-model="payeeDlg" :payee="payee" @saved="onPayeeSaved" />
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.total { color: var(--primary-text); }
.netting { margin-top: var(--space-gap); }
.to-ledger { margin-left: var(--space-2); vertical-align: baseline; }
/* 收款账户：一行，已登记 / 未登记时是普通描边条，有应收又没登记时换成提醒色提示条 */
.payee-bar { margin-top: var(--space-gap); align-items: center; }
.payee-line { display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-1); }
.payee-i { flex: none; color: var(--text-2); }
.payee-l { flex: none; font-weight: var(--font-weight-semibold); }
.payee-t { flex: 1; min-width: 0; }
.payee-t b { margin-right: var(--space-2); }
.payee-hint { margin-left: var(--space-3); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
/* 表头说明靠右，「导出」排在最右 */
.hd-hint { flex: 1; text-align: right; }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); color: var(--text-1); white-space: nowrap; }
b.code { font-weight: var(--font-weight-semibold); }
.due { color: var(--warning-text); }
.code.past { color: var(--text-3); }
.code.overdue { color: var(--danger-text); }
.due-t { font-size: var(--font-size-min); color: var(--warning-text); }
.overdue-t { font-size: var(--font-size-min); color: var(--danger-text); white-space: nowrap; }
/* 付款进度：写在账单状态下面一行，色调同状态标签的文字色 */
.pay-t { margin-top: 2px; font-size: var(--font-size-min); color: var(--text-2); white-space: nowrap; }
.pay-t--success { color: var(--success-text); }
.pay-t--warning { color: var(--warning-text); }
.pay-t--danger { color: var(--danger-text); }
.acts { display: inline-flex; gap: var(--space-2); justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.para { margin: var(--space-3) 0 0; font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.para b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
/* 选中的账单用中性浅底，不和「已下发」等信息色标签融在一起 */
:deep(.row-sel) { --el-table-tr-bg-color: var(--bg-hover); }
:deep(.el-table__row) { cursor: pointer; }
/* 表格行高约 48（规范 Key Components 表格） */
.tbl-card :deep(.el-table__body .el-table__cell) { height: 48px; }
</style>
