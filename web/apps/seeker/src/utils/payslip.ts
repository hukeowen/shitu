import type { Payslip } from '@shitu/api-client'

/** 扣款合计 = 社保 + 个税 + 其他扣款 + 预支抵扣（应发 − 实发） */
export function totalDeduct(p: Pick<Payslip, 'socialInsurance' | 'incomeTax' | 'otherDeduct' | 'advanceDeduct'>): number {
  return [p.socialInsurance, p.incomeTax, p.otherDeduct, p.advanceDeduct].reduce((s, v) => s + (Number(v) || 0), 0)
}
