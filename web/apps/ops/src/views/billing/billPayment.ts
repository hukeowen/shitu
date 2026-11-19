import type { BillPaymentStatus, BillStatus, MonthlyBill } from '@shitu/api-client'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

/** 付款凭证状态（后端字典没有这个枚举，本地常量；同 console views/owner/billPayment.ts） */
export const PAYMENT_STATUS_LABEL: Record<BillPaymentStatus, string> = { PENDING: '待确认', CONFIRMED: '已到账', REJECTED: '已退回' }
export const PAYMENT_STATUS_TONE: Record<BillPaymentStatus, Tone> = { PENDING: 'warning', CONFIRMED: 'success', REJECTED: 'danger' }

/** 账单的付款进度：待付款 / 凭证待确认 / 凭证已退回 / 已结清；还不到付款这一步（未下发、异议中、应付为 0）返回 null */
export function payState(b: MonthlyBill): { label: string; tone: Tone } | null {
  if (b.status === 'SETTLED') return { label: '已结清', tone: 'success' }
  if (b.paymentStatus === 'PENDING') return { label: '凭证待确认', tone: 'warning' }
  if (b.paymentStatus === 'REJECTED') return { label: '凭证已退回', tone: 'danger' }
  if ((b.status === 'ISSUED' || b.status === 'CONFIRMED') && Number(b.payable) > 0) return { label: '待付款', tone: 'neutral' }
  return null
}

/** 流转分成（应收流转费）能登记付款的账单状态：已下发 / 已确认 / 已结算（同后端规则；已生成、异议中不行） */
export const PAYOUT_STATUSES: readonly BillStatus[] = ['ISSUED', 'CONFIRMED', 'SETTLED']

/** 应收这一边（平台付给企业的流转分成）的进度：待付分成 / 分成已付 · 日期；没有应收、账单还没下发返回 null。和上面应付的付款进度互不相干 */
export function receivableState(b: MonthlyBill): { label: string; tone: Tone } | null {
  if (Number(b.transferReceivable) <= 0) return null
  if (b.receivablePaidDate) return { label: `分成已付 · ${b.receivablePaidDate.slice(0, 10)}`, tone: 'success' }
  return b.status === 'GENERATED' ? null : { label: '待付分成', tone: 'warning' }
}
