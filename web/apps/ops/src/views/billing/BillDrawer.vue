<script setup lang="ts">
import { IconInbox, IconCircleExclamationPoint, IconInfo } from '@shitu/ui-icons'
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type BillDayLine, type BillDispute, type BillPayment, type OpsBillDetail } from '@shitu/api-client'
import FileThumbs from '@/components/FileThumbs.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useCompanyNames } from '@/composables/useCompanyNames'
import { confirmInBox, isBlocked, remarkInBox } from '@/composables/boxSubmit'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { copyText, fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtOperator, todayStr } from '@/utils/format'
import ReceivablePayoutDialog from './ReceivablePayoutDialog.vue'
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, PAYOUT_STATUSES } from './billPayment'

const props = defineProps<{ billId: string | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { companyName } = useCompanyNames()

const visible = computed({
  get: () => props.billId != null,
  set: (v) => {
    if (!v) emit('close')
  },
})

const detail = ref<OpsBillDetail | null>(null)
const loading = ref(false)
const error = ref('')
const acting = ref(false)

async function load() {
  if (!props.billId) return
  loading.value = true
  error.value = ''
  try {
    detail.value = await opsApi.bill(props.billId)
  } catch (e) {
    error.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(
  () => props.billId,
  (id) => {
    detail.value = null
    if (id) void load()
  },
  { immediate: true },
)

const b = computed(() => loading.value || error.value ? undefined : detail.value?.bill)
const payments = computed(() => detail.value?.payments ?? [])
/** 有凭证待确认：应当确认到账或退回，不再给「直接登记结算」 */
const hasPending = computed(() => payments.value.some((p) => p.status === 'PENDING'))
const canSettle = computed(() => (b.value?.status === 'ISSUED' || b.value?.status === 'CONFIRMED') && !hasPending.value)
const totals = computed(() => {
  const days = detail.value?.days ?? []
  return {
    service: days.reduce((a, d) => a + Number(d.serviceFee), 0),
    increment: days.reduce((a, d) => a + d.incrementCount, 0),
    freeDays: days.filter((d) => d.inFreePeriod).length,
  }
})

/** 导出每日明细（抽屉里已经拿到的整月数据）；免费期单独一列，服务费按接口返回的数字写 */
const DAY_COLUMNS: CsvColumn<BillDayLine>[] = [
  { header: '日期', value: (d) => d.bizDate, kind: 'date' },
  { header: '在岗', value: (d) => d.employedCount },
  { header: '存量基数', value: (d) => d.stockBase },
  { header: '增量', value: (d) => d.incrementCount },
  { header: '免费期', value: (d) => (d.inFreePeriod ? '是' : '') },
  { header: '服务费', value: (d) => d.serviceFee, kind: 'money' },
  { header: '应付流转', value: (d) => d.transferPayable, kind: 'money' },
  { header: '应收流转', value: (d) => d.transferReceivable, kind: 'money' },
]
function exportDays() {
  if (!b.value || !detail.value) return
  void exportList({ name: `账单每日明细-${b.value.billMonth}-${companyName(b.value.companyId) || b.value.companyId}`, columns: DAY_COLUMNS, rows: detail.value.days })
}

async function settle() {
  if (!b.value || acting.value) return
  const bill = b.value
  acting.value = true
  try {
    const ok = await confirmInBox({ title: '直接登记结算', action: '登记结算', danger: true,
      text: `企业没有提交付款凭证时才用直接登记。确认已收到 ${companyName(bill.companyId) || bill.companyId} ${bill.billMonth} 账单款项 ${fmtMoney(bill.payable)} 元？登记后账单状态变为「已结算」，不可撤销。`,
      api: () => opsApi.settleBill(bill.billId),
    })
    if (!ok) return
    ElMessage.success('已登记结算')
    emit('changed')
    await load()
  } finally { acting.value = false }
}

// ---------- 付款凭证：确认到账 / 退回
async function confirmPayment(p: BillPayment) {
  if (!b.value || acting.value) return
  const bill = b.value
  acting.value = true
  try {
    const ok = await remarkInBox({ title: '确认到账', action: '确认到账', placeholder: '备注（选填）',
      text: `确认已收到 ${companyName(bill.companyId) || bill.companyId} ${bill.billMonth} 账单款项 ${fmtMoney(p.amount)} 元？确认后账单状态变为「已结算」，不可撤销。`,
      api: (remark) => opsApi.confirmBillPayment(p.id, remark || undefined),
    })
    if (!ok) return
    ElMessage.success('已确认到账，账单已结算')
    emit('changed')
    await load()
  } finally { acting.value = false }
}
async function rejectPayment(p: BillPayment) {
  if (!b.value || acting.value) return
  const bill = b.value
  acting.value = true
  try {
    const ok = await remarkInBox({ title: '退回付款凭证', action: '退回', required: true, danger: true, placeholder: '请填写退回原因（必填，将通知企业）',
      text: `退回 ${companyName(bill.companyId) || bill.companyId} ${bill.billMonth} 账单的付款凭证（${fmtMoney(p.amount)} 元）。退回后账单保持未结清，企业可以重新提交。`,
      api: (remark) => opsApi.rejectBillPayment(p.id, remark),
    })
    if (!ok) return
    ElMessage.success('已退回付款凭证')
    emit('changed')
    await load()
  } finally { acting.value = false }
}

// ---------- 流转分成付款：平台把应收流转费付给企业（和企业付平台的应付互不相干），线下转账后在这里登记
const hasReceivable = computed(() => Number(b.value?.transferReceivable) > 0)
const payout = computed(() => detail.value?.receivablePayout ?? null)
const companyPayee = computed(() => detail.value?.companyPayee ?? null)
const payeeRows = computed(() => {
  const p = companyPayee.value
  return p ? [{ label: '户名', value: p.accountName }, { label: '开户行', value: p.bankName }, { label: '账号', value: p.accountNo }] : []
})
/** 现在不能登记付款的原因（同后端规则）；空串 = 可以登记 */
const payoutBlocked = computed(() => {
  if (!b.value) return ''
  if (b.value.status === 'GENERATED') return '账单还没有下发，下发后才能登记付款'
  if (b.value.status === 'DISPUTED') return '账单在异议中，异议处理完后才能登记付款'
  if (!PAYOUT_STATUSES.includes(b.value.status)) return '账单当前状态不能登记付款'
  if (b.value.status === 'ISSUED' && b.value.disputeDeadline && b.value.disputeDeadline.slice(0, 10) >= todayStr())
    return `账单还在异议期内（到 ${b.value.disputeDeadline.slice(0, 10)}），金额可能调整，异议期结束后才能登记付款`
  if (!companyPayee.value) return '企业登记收款账户后才能登记付款'
  return ''
})
const payoutDlg = ref(false)
async function copy(label: string, value: string) {
  if (await copyText(value)) ElMessage.success(`${label}已复制`)
  else ElMessage.error('复制失败，请手动复制')
}
async function onPayoutDone() {
  emit('changed')
  await load()
}

// ---------- 异议复核
const reply = reactive({ visible: false, dispute: null as BillDispute | null, accept: false, text: '', error: '', blocked: false, loading: false })
function openReply(d: BillDispute, accept: boolean) {
  Object.assign(reply, { visible: true, dispute: d, accept, text: '', error: '', blocked: false })
}
async function submitReply() {
  if (!reply.dispute || reply.loading || reply.blocked) return
  const text = reply.text.trim()
  if (!text) {
    reply.error = '请填写处理说明（将回复给企业）'
    return
  }
  reply.loading = true
  try {
    await opsApi.replyDispute(reply.dispute.id, reply.accept, text)
    ElMessage.success(reply.accept ? '已采纳异议，账单退回「已生成」待修正后重新下发' : '已驳回异议，账单恢复「已下发」')
    reply.visible = false
    emit('changed')
    await load()
  } catch (e) {
    reply.blocked = isBlocked(e)
    reply.error = errorMessage(e)
  } finally {
    reply.loading = false
  }
}
</script>

<template>
  <el-drawer v-model="visible" size="720px" destroy-on-close class="ops-drawer rv-drawer">
    <template #header>
      <div class="dh">
        <h3>账单 <span class="mono">{{ billId }}</span></h3>
        <StatusTag v-if="b" type="BillStatus" :value="b.status" />
      </div>
    </template>

    <div v-loading="loading" class="body">
      <el-empty v-if="!loading && error" :image-size="48" :description="error"><template #image><IconCircleExclamationPoint :size="48" /></template><el-button size="small" @click="load">重新加载</el-button></el-empty>
      <template v-else-if="!loading && detail && b">
        <div v-if="b.status === 'DISPUTED'" class="notice notice--danger top-tip">企业对该账单提出了异议，请在下方「异议记录」中复核处理。</div>
        <div v-else-if="hasPending" class="notice-bar notice-bar--warn top-tip"><IconInfo :size="16" class="notice-bar-i" />企业已提交付款凭证：请核对银行流水后，在下方「付款凭证」中确认到账或退回。</div>
        <div v-else-if="b.overdueDays > 0" class="notice-bar notice-bar--danger top-tip"><IconInfo :size="16" class="notice-bar-i" />该账单已逾期 {{ b.overdueDays }} 天未结清。</div>

        <div class="grid g-2 sum">
          <div class="stat"><div class="stat-l">增长技术服务费</div><div class="stat-v sm money">{{ fmtMoney(b.serviceFee) }}</div></div>
          <div class="stat"><div class="stat-l">应付流转费</div><div class="stat-v sm money">{{ fmtMoney(b.transferPayable) }}</div></div>
          <div class="stat"><div class="stat-l">应付合计</div><div class="stat-v sm money">{{ fmtMoney(b.payable) }}</div></div>
          <div class="stat"><div class="stat-l">应收流转费</div><div class="stat-v sm money">{{ fmtMoney(b.transferReceivable) }}</div><div class="stat-d">不与应付轧差</div></div>
        </div>

        <section class="blk"><h3 class="blk-t">账单信息</h3><dl class="desc-list">
          <div><dt>公司</dt><dd>{{ companyName(b.companyId) }} <span class="mono dim">{{ b.companyId }}</span></dd></div>
          <div><dt>账单月份</dt><dd class="tnum">{{ b.billMonth }}</dd></div>
          <div><dt>下发时间</dt><dd class="tnum">{{ fmtDateTime(b.issuedAt) }}</dd></div>
          <div><dt>异议截止</dt><dd class="tnum">{{ fmtDate(b.disputeDeadline) }}</dd></div>
          <div><dt>结算截止</dt><dd class="tnum">{{ fmtDate(b.settleDeadline) }}</dd></div>
          <div><dt>结算时间</dt><dd class="tnum">{{ fmtDateTime(b.settledAt) }}</dd></div>
        </dl></section>

        <section class="blk"><h3 class="blk-t">付款凭证 <small>{{ payments.length }} 笔</small></h3>
        <p v-if="payments.length === 0" class="t-sm dim">企业还没有提交付款凭证。已通过其他方式确认收款的，可以用下方「直接登记结算」。</p>
        <div v-for="p in payments" :key="p.id" class="pay">
          <div class="pay-hd">
            <span class="status-tag" :class="`status-tag--${PAYMENT_STATUS_TONE[p.status]}`">{{ PAYMENT_STATUS_LABEL[p.status] }}</span>
            <span class="t-xs">{{ p.submittedBy }} 提交 · {{ fmtDateTime(p.createdAt) }}</span>
          </div>
          <div class="pay-bd">
            <dl class="desc-list">
              <div><dt>付款金额</dt><dd class="money">{{ fmtMoney(p.amount) }} 元<span v-if="Number(p.amount) !== Number(b.payable)" class="diff">与应付合计 {{ fmtMoney(b.payable) }} 不一致</span></dd></div>
              <div><dt>付款日期</dt><dd class="tnum">{{ fmtDate(p.paidDate) }}</dd></div>
              <div><dt>付款户名</dt><dd>{{ p.payerName }}</dd></div>
              <div><dt>银行流水号</dt><dd class="mono">{{ p.bankRef || '—' }}</dd></div>
              <div v-if="p.remark" class="full"><dt>企业备注</dt><dd class="pre">{{ p.remark }}</dd></div>
              <div v-if="p.status !== 'PENDING'" class="full">
                <dt>{{ p.status === 'REJECTED' ? '退回原因' : '确认备注' }}</dt>
                <dd class="pre">{{ p.reviewRemark || '—' }}<span class="t-xs rv-by">{{ fmtOperator(p.reviewedBy, '—') }} · {{ fmtDateTime(p.reviewedAt) }}</span></dd>
              </div>
            </dl>
            <FileThumbs :keys="[p.voucherKey]" label="付款凭证" />
          </div>
          <div v-if="p.status === 'PENDING'" class="d-acts">
            <el-button size="small" type="danger" class="btn-reject" :disabled="acting" @click="rejectPayment(p)">退回</el-button>
            <el-button size="small" type="primary" :disabled="acting" @click="confirmPayment(p)">确认到账</el-button>
          </div>
        </div>
        </section>

        <section v-if="hasReceivable" class="blk"><h3 class="blk-t">
          流转分成付款
          <span class="status-tag" :class="payout ? 'status-tag--success' : 'status-tag--warning'">{{ payout ? `分成已付 · ${fmtDate(payout.paidDate)}` : '待付分成' }}</span>
        </h3>
        <div v-if="payout" class="pay">
          <div class="pay-bd">
            <dl class="desc-list">
              <div><dt>付款金额</dt><dd class="money">{{ fmtMoney(payout.amount) }} 元</dd></div>
              <div><dt>付款日期</dt><dd class="tnum">{{ fmtDate(payout.paidDate) }}</dd></div>
              <div class="full"><dt>收款账户</dt><dd>{{ payout.accountName }} · {{ payout.bankName }} · 尾号 <span class="mono">{{ payout.accountTail }}</span></dd></div>
              <div><dt>银行流水号</dt><dd class="mono">{{ payout.bankRef || '—' }}</dd></div>
              <div><dt>登记人</dt><dd>{{ fmtOperator(payout.paidBy, '—') }}<span class="t-xs rv-by">{{ fmtDateTime(payout.createdAt) }}</span></dd></div>
              <div v-if="payout.remark" class="full"><dt>备注</dt><dd class="pre">{{ payout.remark }}</dd></div>
            </dl>
            <FileThumbs v-if="payout.voucherKey" :keys="[payout.voucherKey]" label="付款回单" />
          </div>
        </div>
        <template v-else>
          <p class="t-sm due">应付给 {{ companyName(b.companyId) || b.companyId }} 的流转分成：<b class="money">{{ fmtMoney(b.transferReceivable) }} 元</b><span class="dim">（一次付清，和企业的应付合计互不抵扣）</span></p>
          <div v-if="companyPayee" class="pay">
            <dl class="kv-grid one payee">
              <div v-for="it in payeeRows" :key="it.label" class="kv">
                <dt>{{ it.label }}</dt>
                <dd><span :class="{ mono: it.label === '账号' }">{{ it.value }}</span><el-button link type="primary" size="small" class="cp" :aria-label="`复制${it.label}`" @click="copy(it.label, it.value)">复制</el-button></dd>
              </div>
            </dl>
            <p class="t-xs payee-at">企业登记的收款账户 · {{ fmtDateTime(companyPayee.updatedAt) }} 更新</p>
          </div>
          <div v-else class="notice-bar notice-bar--warn" role="status"><IconInfo :size="16" class="notice-bar-i" />这家公司还没有登记收款账户，暂时无法付款。请联系对方在公司后台「费用账单」页登记收款账户。</div>
          <div class="d-acts payout-acts">
            <el-button size="small" type="primary" :disabled="!!payoutBlocked" @click="payoutDlg = true">登记已付款</el-button>
            <span v-if="payoutBlocked" class="t-xs">{{ payoutBlocked }}</span>
          </div>
        </template>
        </section>

        <section class="blk"><h3 class="blk-t">异议记录<small>{{ detail.disputes.length }} 条</small></h3>
        <el-empty v-if="detail.disputes.length === 0" :image-size="48"><template #image><IconInbox :size="48" /></template><template #description><h3>无异议</h3><p>这张账单暂无异议记录，可刷新查看最新情况。</p></template><el-button type="primary" @click="load">刷新</el-button></el-empty>
        <ul v-else class="tl">
          <li v-for="d in detail.disputes" :key="d.id" :class="d.status === 'OPEN' ? 'now' : d.status === 'ACCEPTED' ? 'done' : 'fail'">
            <div class="tl-t">
              <StatusTag type="DisputeStatus" :value="d.status" variant="tag" />
              <span class="t-sm"> 企业异议 · {{ d.raisedBy }}</span>
            </div>
            <div class="tl-m">{{ fmtDateTime(d.createdAt) }}</div>
            <div class="tl-r">{{ d.content }}</div>
            <div v-if="d.reply" class="reply">
              <span class="t-xs">平台回复 · {{ fmtDateTime(d.repliedAt) }}</span>
              <div class="tl-r">{{ d.reply }}</div>
            </div>
            <div v-if="d.status === 'OPEN'" class="d-acts">
              <el-button size="small" type="danger" class="btn-reject" @click="openReply(d, false)">驳回异议</el-button>
              <el-button size="small" type="primary" @click="openReply(d, true)">采纳异议</el-button>
            </div>
          </li>
        </ul>

        </section><section class="blk"><h3 class="blk-t">
          每日明细 <small>{{ detail.days.length }} 天 · 增量合计 {{ fmtNum(totals.increment) }} 人·天 · 免费期 {{ totals.freeDays }} 天</small>
        </h3>
        <el-table :data="detail.days" class="tbl-48" size="small" max-height="360" row-key="bizDate">
          <el-table-column label="日期" width="110"><template #default="{ row }"><span class="tnum">{{ fmtDate(row.bizDate) }}</span></template></el-table-column>
          <el-table-column label="在岗" width="80" align="right"><template #default="{ row }"><span class="tnum">{{ fmtNum(row.employedCount) }}</span></template></el-table-column>
          <el-table-column label="存量基数" width="90" align="right"><template #default="{ row }"><span class="tnum dim">{{ fmtNum(row.stockBase) }}</span></template></el-table-column>
          <el-table-column label="增量" width="80" align="right"><template #default="{ row }"><span class="tnum strong">{{ fmtNum(row.incrementCount) }}</span></template></el-table-column>
          <el-table-column label="服务费" min-width="100" align="right">
            <template #default="{ row }">
              <span v-if="row.inFreePeriod" class="status-tag status-tag--success">免费期</span>
              <span v-else class="money">{{ fmtMoney(row.serviceFee) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="应付流转" min-width="100" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.transferPayable) }}</span></template></el-table-column>
          <el-table-column label="应收流转" min-width="100" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.transferReceivable) }}</span></template></el-table-column>
          <template #empty><el-empty :image-size="48"><template #image><IconInbox :size="48" /></template><template #description><h3>无每日明细</h3><p>这张账单暂无每日明细，可刷新后查看。</p></template><el-button type="primary" @click="load">刷新</el-button></el-empty></template>
        </el-table></section>
      </template>
      <el-empty v-else-if="!loading"><template #image><IconInbox :size="48" /></template><template #description><h3>账单不存在</h3><p>未找到这张账单，可关闭后重新选择。</p></template><el-button type="primary" @click="visible = false">关闭</el-button></el-empty>
    </div>

    <template #footer>
      <div class="drawer-actions">
        <el-button @click="visible = false">关闭</el-button>
        <el-button v-if="b" :disabled="!detail?.days.length" @click="exportDays">导出明细</el-button>
        <el-button v-if="canSettle" :loading="acting" @click="settle">直接登记结算</el-button>
      </div>
    </template>

    <el-dialog class="dlg-16" v-model="reply.visible" :title="reply.accept ? '采纳异议' : '驳回异议'" width="480px" append-to-body :close-on-click-modal="false">
      <div class="notice gap" :class="reply.accept ? 'notice--warn' : 'notice--info'">
        {{ reply.accept ? '采纳后账单退回「已生成」，需重算相关日计费后重新下发。' : '驳回后账单恢复「已下发」，企业需按原账单结算。' }}
      </div>
      <div v-if="reply.dispute" class="quote t-sm">{{ reply.dispute.content }}</div>
      <el-input v-model="reply.text" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="处理说明（必填，将回复给企业）" @input="!reply.blocked && (reply.error = '')" />
      <div v-if="reply.error" class="blocked-why err">{{ reply.error }}</div>
      <template #footer>
        <el-button @click="reply.visible = false">取消</el-button>
        <el-button :type="reply.accept ? 'primary' : 'danger'" :class="{ 'btn-reject': !reply.accept }" :loading="reply.loading" :disabled="reply.blocked" @click="submitReply">{{ reply.accept ? '采纳' : '驳回' }}</el-button>
      </template>
    </el-dialog>

    <ReceivablePayoutDialog v-model="payoutDlg" :bill="b ?? null" :company-name="b ? companyName(b.companyId) : ''" :payee="companyPayee" @done="onPayoutDone" />
  </el-drawer>
</template>

<style scoped>
.dh { display: flex; align-items: center; gap: 10px; }
.dh h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-1); }
.body { min-height: 200px; }
.top-tip { margin-bottom: 14px; }
.sum { margin-bottom: 12px; }
.stat-v.sm { font-size: 18px; }
.money { text-align: right; }
.reply { margin-top: 6px; padding: 6px 10px; background: var(--bg-fill); border-radius: var(--radius-tag); }
.d-acts { margin-top: 8px; display: flex; gap: 6px; }
.d-acts .el-button + .el-button { margin-left: 0; }
.pay { border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-3) var(--space-4); }
.pay + .pay { margin-top: var(--space-2); }
.pay-hd { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.pay-bd { display: flex; align-items: flex-start; gap: var(--space-4); }
.pay-bd .desc-list { flex: 1; min-width: 0; }
.pay-bd .money { text-align: left; }
.diff { margin-left: var(--space-2); font-size: var(--font-size-min); font-weight: var(--font-weight-regular); color: var(--danger-text); white-space: normal; }
.rv-by { margin-left: var(--space-2); }
.due { margin: 0 0 var(--space-3); color: var(--text-1); }
.due .money { text-align: left; }
.due .dim { margin-left: var(--space-2); }
.payee .kv:last-child { border-bottom: 0; }
.payee dd { display: inline-flex; align-items: center; gap: var(--space-2); }
.cp { flex: none; }
.payee-at { margin: var(--space-2) 0 0; }
.payout-acts { align-items: center; margin-top: var(--space-3); }
.gap { margin-bottom: 12px; }
.quote { padding: 8px 10px; border-left: 3px solid var(--border); background: var(--bg-fill); margin-bottom: 10px; color: var(--text-2); white-space: pre-wrap; }
.err { margin-top: 10px; }
</style>
