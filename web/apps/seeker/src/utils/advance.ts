import type { AdvanceApprovalStep, AdvanceDetail, AdvanceQuota, AdvanceRow, AdvanceStatus, DebtLogEntry } from '@shitu/api-client'

/** 预支状态徽标配色（中文名从字典 AdvanceStatus 取） */
export const ADVANCE_TAG_CLASS: Record<AdvanceStatus, string> = {
  SUBMITTED: 'tag-warn',
  SITE_APPROVED: 'tag-warn',
  PM_APPROVED: 'tag-info',
  PAID: 'tag-ok',
  PARTIALLY_REPAID: 'tag-temp',
  REPAID: 'tag-muted',
  REJECTED: 'tag-danger',
}

/** 审批中（占用「同一时间只有一笔在审批」的名额） */
export const IN_REVIEW: AdvanceStatus[] = ['SUBMITTED', 'SITE_APPROVED', 'PM_APPROVED']
/** 已到账未还清（发薪日自动抵扣） */
export const OUTSTANDING: AdvanceStatus[] = ['PAID', 'PARTIALLY_REPAID']

export function inReview(a: Pick<AdvanceRow, 'status'>): boolean {
  return IN_REVIEW.includes(a.status)
}

/** 本笔未还金额 */
export function unpaid(a: Pick<AdvanceRow, 'amount' | 'repaidAmount' | 'status'>): number {
  if (!OUTSTANDING.includes(a.status)) return 0
  return Math.max(0, Number(a.amount) - Number(a.repaidAmount || 0))
}

/** 已还比例 0–1 */
export function repaidRatio(a: Pick<AdvanceRow, 'amount' | 'repaidAmount'>): number {
  const amt = Number(a.amount)
  if (!amt) return 0
  return Math.min(1, Math.max(0, Number(a.repaidAmount || 0) / amt))
}

/** 当前节点文案（列表卡片 / 进度页标题） */
export function stageText(s: AdvanceStatus): string {
  switch (s) {
    case 'SUBMITTED': return '等待驻场初审'
    case 'SITE_APPROVED': return '等待项目经理终审'
    case 'PM_APPROVED': return '终审通过 · 等待拨款'
    case 'PAID': return '已到账 · 待发薪日抵扣'
    case 'PARTIALLY_REPAID': return '部分抵扣 · 余额结转下月'
    case 'REPAID': return '已还清'
    case 'REJECTED': return '已驳回 · 已退回本次机会'
  }
}

export interface FlowStep {
  t: string
  m: string
  /** 审批意见 */
  o?: string
  cls: '' | 'done' | 'now' | 'fail'
}

/**
 * 审批流转（C-603 / D-25）：已提交 → 驻场初审 → 项目经理终审 → 已拨款 → 抵扣中 / 已还清。
 * 后端只返回当前状态（无逐级审批时间与意见），被驳回时无法区分驳回节点。
 */
export function flowSteps(a: AdvanceRow, fmt: (s?: string) => string): FlowStep[] {
  const order: AdvanceStatus[] = ['SUBMITTED', 'SITE_APPROVED', 'PM_APPROVED', 'PAID', 'PARTIALLY_REPAID', 'REPAID']
  if (a.status === 'REJECTED') {
    return [
      { t: '本人发起申请', m: fmt(a.createdAt), cls: 'done' },
      { t: '审批未通过', m: '驻场或项目经理驳回了本次申请，本次机会已退回', cls: 'fail' },
    ]
  }
  const idx = order.indexOf(a.status)
  const repaying = a.status === 'PARTIALLY_REPAID'
  const settled = a.status === 'REPAID'
  return [
    { t: '本人发起申请', m: fmt(a.createdAt), cls: 'done' },
    idx >= 1
      ? { t: '驻场初审通过', m: '在岗核验通过', cls: 'done' }
      : { t: '驻场初审中', m: '已推送驻场老师审核', cls: 'now' },
    idx >= 2
      ? { t: '项目经理终审通过', m: '双级审批完成', cls: 'done' }
      : { t: '项目经理终审', m: idx === 1 ? '已推送项目经理审核' : '待流转', cls: idx === 1 ? 'now' : '' },
    idx >= 3
      ? { t: '已拨款到账', m: a.paidAt ? fmt(a.paidAt) : '已到账', cls: 'done' }
      : { t: '拨款到账', m: idx === 2 ? '等待财务拨款' : '待流转', cls: idx === 2 ? 'now' : '' },
    settled
      ? { t: '已还清', m: '发薪日工资自动抵扣完成', cls: 'done' }
      : { t: repaying ? '抵扣中' : '发薪日自动抵扣', m: repaying ? '本月工资不足抵扣，剩余欠款结转下月' : idx >= 3 ? '下一个发薪日从工资中自动扣除' : '到账后于发薪日自动抵扣', cls: idx >= 3 ? 'now' : '' },
  ]
}

export interface AdmissionRule {
  t: string
  ok: boolean
}

/** 5 项准入（C-602）：由额度接口字段 + 原因文案推导；原因文案与后端 AdvancePolicy 保持一致 */
export function admissionRules(q: AdvanceQuota, companyName?: string): { rules: AdmissionRule[]; extra: string[] } {
  const has = (k: string) => q.reasons.some((r) => r.includes(k))
  const rules: AdmissionRule[] = [
    { t: '用户状态为「已入职在岗」', ok: !has('已入职在岗') },
    { t: `身份已绑定劳务公司${companyName ? `（${companyName}）` : ''}`, ok: !has('绑定劳务公司') },
    { t: `入职满 ${q.daysPerChance} 个在岗日（当前 ${q.dutyDays} 天）`, ok: q.dutyDays >= q.daysPerChance },
    { t: `本月预支少于 ${q.monthlyLimit} 次（已用 ${q.usedThisMonth} 次）`, ok: q.usedThisMonth < q.monthlyLimit },
    { t: `本月剩余机会大于 0（剩余 ${q.remainingThisMonth} 次）`, ok: q.remainingThisMonth > 0 },
  ]
  const known = ['已入职在岗', '绑定劳务公司', '入职满', '已达上限', '暂无可用机会']
  const extra = q.reasons.filter((r) => !known.some((k) => r.includes(k)))
  return { rules, extra }
}

/** 审批节点名称（后端字典暂无，前端兜底） */
export const STEP_NAME: Record<AdvanceApprovalStep['step'], string> = { SITE: '驻场初审', PM: '项目经理终审', PAYOUT: '拨款' }

/** 本笔流水类型 */
export const LEDGER_NAME: Record<DebtLogEntry['changeType'], { t: string; sign: 1 | -1 }> = {
  PAYOUT: { t: '预支拨款到账', sign: 1 },
  DEDUCT: { t: '发薪日工资抵扣', sign: -1 },
  WRITE_OFF: { t: '离职结清 / 核销', sign: -1 },
}

/** 被驳回的节点（没有驳回返回 null） */
export function rejectedStep(d: AdvanceDetail): AdvanceApprovalStep | null {
  return d.approvals.find((s) => s.decision === 'REJECT') ?? null
}

/**
 * 审批流转（C-603）：按后端逐级审批记录（节点 / 结论 / 意见 / 时间）生成时间线；
 * 已提交 → 驻场初审 → 项目经理终审 → 拨款 → 发薪日抵扣 / 已还清，被驳回时停在驳回节点。
 */
export function detailSteps(d: AdvanceDetail, fmt: (s?: string) => string): FlowStep[] {
  const a = d.advance
  const out: FlowStep[] = [{ t: '本人发起申请', m: fmt(a.createdAt), cls: 'done' }]
  const order: AdvanceApprovalStep['step'][] = ['SITE', 'PM', 'PAYOUT']
  const doneTitle: Record<AdvanceApprovalStep['step'], string> = { SITE: '驻场初审通过', PM: '项目经理终审通过', PAYOUT: '已拨款到账' }
  const waitTitle: Record<AdvanceApprovalStep['step'], string> = { SITE: '驻场初审中', PM: '项目经理终审', PAYOUT: '拨款到账' }
  const waitMsg: Record<AdvanceApprovalStep['step'], string> = { SITE: '已推送驻场老师审核', PM: '已推送项目经理审核', PAYOUT: '等待财务拨款' }
  let waiting = false
  for (const step of order) {
    const rec = [...d.approvals].reverse().find((s) => s.step === step)
    if (rec) {
      const rejected = rec.decision === 'REJECT'
      out.push({
        t: rejected ? `${STEP_NAME[step]}驳回` : doneTitle[step],
        m: step === 'PAYOUT' && !rec.at && a.paidAt ? fmt(a.paidAt) : fmt(rec.at),
        o: rec.opinion,
        cls: rejected ? 'fail' : 'done',
      })
      if (rejected) {
        out.push({ t: '本次机会已退回', m: '本月满足准入条件时可再次申请', cls: '' })
        return out
      }
    } else if (step === 'PAYOUT' && a.paidAt) {
      out.push({ t: doneTitle.PAYOUT, m: fmt(a.paidAt), cls: 'done' })
    } else if (a.status === 'REJECTED') {
      // 驳回但没有审批记录（历史数据）
      out.push({ t: '审批未通过', m: '本次机会已退回', cls: 'fail' })
      return out
    } else {
      out.push({ t: waitTitle[step], m: waiting ? '待流转' : waitMsg[step], cls: waiting ? '' : 'now' })
      waiting = true
    }
  }
  const repaying = a.status === 'PARTIALLY_REPAID'
  const settled = a.status === 'REPAID'
  const paid = OUTSTANDING.includes(a.status) || settled
  out.push(
    settled
      ? { t: '已还清', m: '发薪日工资自动抵扣完成', cls: 'done' }
      : {
          t: repaying ? '抵扣中' : '发薪日自动抵扣',
          m: repaying ? '本月工资不足抵扣，剩余欠款结转下月' : paid ? '下一个发薪日从工资中自动扣除' : '到账后于发薪日自动抵扣',
          cls: paid ? 'now' : '',
        },
  )
  return out
}
