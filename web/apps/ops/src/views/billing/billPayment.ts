import type { BillPaymentStatus, MonthlyBill } from '@shitu/api-client'

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
