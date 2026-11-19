import type { BillPaymentStatus, MonthlyBill } from '@shitu/api-client'
import type { Tone } from '@/utils/tone'
import { toNum } from '@/utils/format'

/** 付款凭证状态（后端字典没有这个枚举，本地常量） */
export const PAYMENT_STATUS_LABEL: Record<BillPaymentStatus, string> = { PENDING: '待确认', CONFIRMED: '已到账', REJECTED: '已退回' }
export const PAYMENT_STATUS_TONE: Record<BillPaymentStatus, Tone> = { PENDING: 'warning', CONFIRMED: 'success', REJECTED: 'danger' }

/** 账单的付款进度：待付款 / 凭证待确认 / 凭证被退回 / 已结清；还不到付款这一步（未下发、异议中、应付为 0）返回 null */
export function payState(b: MonthlyBill): { label: string; tone: Tone } | null {
  if (b.status === 'SETTLED') return { label: '已结清', tone: 'success' }
  if (b.paymentStatus === 'PENDING') return { label: '凭证待确认', tone: 'warning' }
  if (b.paymentStatus === 'REJECTED') return { label: '凭证被退回', tone: 'danger' }
  if ((b.status === 'ISSUED' || b.status === 'CONFIRMED') && toNum(b.payable) > 0) return { label: '待付款', tone: 'neutral' }
  return null
}

/** 应收这一边（流转分成，平台付给本公司）的进度：平台待付款 / 已到账 · 日期；账单没有应收流转费返回 null。和上面应付的付款进度互不相干 */
export function receivableState(b: MonthlyBill): { label: string; tone: Tone } | null {
  if (toNum(b.transferReceivable) <= 0) return null
  if (b.receivablePaidDate) return { label: `已到账 · ${b.receivablePaidDate.slice(0, 10)}`, tone: 'success' }
  return { label: '平台待付款', tone: 'neutral' }
}

/** 可以提交付款凭证：已下发 / 已确认、应付大于 0、没有待确认的凭证（同后端规则） */
export function canPay(b: MonthlyBill | null): b is MonthlyBill {
  return !!b && (b.status === 'ISSUED' || b.status === 'CONFIRMED') && toNum(b.payable) > 0 && b.paymentStatus !== 'PENDING'
}

/** 上一笔凭证被退回时按钮写「重新提交凭证」 */
export function payLabel(b: MonthlyBill | null): string {
  return b?.paymentStatus === 'REJECTED' ? '重新提交凭证' : '提交付款凭证'
}
