import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, type AdvanceApprovalStep, type AdvanceRow, type AdvanceStatus, type DebtLogEntry, type TenantRole } from '@shitu/api-client'
import type ReasonDialog from '@/components/ReasonDialog.vue'

/** 预支状态的标签色调（tokens.css 的 .status-tag--*；中文名取字典 AdvanceStatus）；和求职者端 utils/advance.ts 同一组色调 */
export const ADVANCE_TONE: Record<AdvanceStatus, string> = {
  SUBMITTED: 'status-tag--warning',
  SITE_APPROVED: 'status-tag--warning',
  PM_APPROVED: 'status-tag--warning',
  PAID: 'status-tag--success',
  PARTIALLY_REPAID: 'status-tag--pending',
  REPAID: 'status-tag--neutral',
  REJECTED: 'status-tag--danger',
}

/** 审批节点 / 结论 / 流水类型：后端字典暂未提供，先在前端兜底 */
export const STEP_TEXT: Record<AdvanceApprovalStep['step'], string> = { SITE: '驻场初审', PM: '项目经理终审', PAYOUT: '登记拨款' }
export const DECISION_TEXT: Record<AdvanceApprovalStep['decision'], string> = { APPROVE: '通过', REJECT: '驳回' }
export const LEDGER_TEXT: Record<DebtLogEntry['changeType'], string> = { PAYOUT: '拨款到账', DEDUCT: '工资抵扣', WRITE_OFF: '核销' }

/** 当前登录人能处理的审批环节（完全按后端 allowedActions）：驻场初审 / 项目经理终审 */
export type ReviewStep = 'SITE' | 'PM'
export function reviewStep(a: AdvanceRow): ReviewStep | null {
  if (a.allowedActions.includes('SITE_APPROVE') || a.allowedActions.includes('SITE_REJECT')) return 'SITE'
  if (a.allowedActions.includes('PM_APPROVE') || a.allowedActions.includes('PM_REJECT')) return 'PM'
  return null
}
export const canReview = (a: AdvanceRow) => reviewStep(a) !== null
export const canApprove = (a: AdvanceRow) => a.allowedActions.includes('SITE_APPROVE') || a.allowedActions.includes('PM_APPROVE')
export const canReject = (a: AdvanceRow) => a.allowedActions.includes('SITE_REJECT') || a.allowedActions.includes('PM_REJECT')
/** 登记拨款（终审通过后，公司线下转账完再登记）：后端只给项目经理 / 老板，驻场拿不到这个操作 */
export const canPayout = (a: AdvanceRow) => a.allowedActions.includes('PAYOUT')
/** 当前登录人对这一笔有事要办：审核或登记拨款 */
export const canAct = (a: AdvanceRow) => canReview(a) || canPayout(a)
/**
 * 在岗核对不过关（已不在岗 / 已提交离职 / 离职已批）：后端不让通过、不让拨款，前端提前把按钮置灰并写明原因。
 * 返回原因文字，没问题返回空串
 */
export function checkBlockText(a: AdvanceRow): string {
  if (!a.check?.blocking) return ''
  return canPayout(a) ? '这个人已离职或正在办离职，不能登记拨款，请先不要转账' : '这个人已离职或正在办离职，不能通过，请驳回'
}
/** 确认框里附上的提醒（旷工、离职、欠款等），让审批人在点通过的那一刻也看得到；没有提醒返回空串 */
function warnText(a: AdvanceRow): string {
  const w = a.check?.warnings ?? []
  return w.length ? `\n\n请注意：\n${w.map((x) => `· ${x}`).join('\n')}` : ''
}
/** 通过按钮文案：初审通过 / 终审通过 */
export const approveText = (a: AdvanceRow) => (reviewStep(a) === 'PM' ? '终审通过' : '初审通过')

/** 预支入口 / 页面文案随角色变化：驻场 = 初审，项目经理 = 终审，其余（或兼任）= 审批 */
export interface AdvanceWording {
  /** 页面标题、入口名 */
  title: string
  /** 待办页签 */
  todoTab: string
  /** 工作台宫格副标题 */
  tileDesc: string
  /** 「我的」入口说明 */
  entryDesc: string
  /** 待办为空 */
  empty: string
  /** 流程说明里加粗的环节 */
  step: ReviewStep | null
}
export function advanceWording(roles: readonly TenantRole[] | undefined): AdvanceWording {
  const site = !!roles?.includes('SITE')
  const pm = !!roles?.includes('PM')
  if (site && !pm) {
    return { title: '预支初审', todoTab: '待初审', tileDesc: '待你初审', entryDesc: '求职者薪资预支的驻场初审', empty: '暂无待你初审的预支申请', step: 'SITE' }
  }
  if (pm && !site) {
    // 项目经理除了终审，还要在线下转账后登记拨款，待办里两种都有
    return { title: '预支终审', todoTab: '待我处理', tileDesc: '待你终审、登记拨款', entryDesc: '项目经理终审，转账后登记拨款', empty: '暂无待你终审或登记拨款的预支申请', step: 'PM' }
  }
  if (pm) {
    return { title: '预支审批', todoTab: '待我处理', tileDesc: '待你审批、登记拨款', entryDesc: '求职者薪资预支的审批与登记拨款', empty: '暂无待你处理的预支申请', step: null }
  }
  return { title: '预支审批', todoTab: '待我审批', tileDesc: '待你审批', entryDesc: '求职者薪资预支的审批记录', empty: '暂无待你审批的预支申请', step: null }
}

type Dialog = InstanceType<typeof ReasonDialog>

/** 后端业务拒绝（不是网络失败）时回调：页面把这一单的审批按钮置灰、原因留在卡片或底部通栏上 */
export type OnReviewRejected = (reason: string) => void

async function submitReview(step: ReviewStep, id: string, approve: boolean, opinion: string, onRejected?: OnReviewRejected) {
  try {
    if (step === 'PM') await tenantApi.pmReviewAdvance(id, approve, opinion || undefined)
    else await tenantApi.siteReviewAdvance(id, approve, opinion || undefined)
    showSuccessToast(!approve ? '已驳回，机会已退回' : step === 'PM' ? '终审已通过，待登记拨款' : '初审已通过，已推送项目经理终审')
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
    if (isApiError(e) && e.code !== 'NETWORK') onRejected?.(errorMessage(e))
    throw e
  }
}

/**
 * M-11 驻场初审 / T-309 项目经理终审：通过（意见选填）/ 驳回（意见必填，驳回退回本次机会）。
 * 走哪个环节由该笔的 allowedActions 决定。返回是否已提交
 */
export async function reviewAdvance(dialog: Dialog | null, a: AdvanceRow, approve: boolean, amountText: string, onRejected?: OnReviewRejected): Promise<boolean> {
  const step = reviewStep(a)
  if (!dialog || !step) return false
  const who = `${a.seekerName ?? '—'} · ${amountText}`
  const submit = (opinion: string) => submitReview(step, a.advanceId, approve, opinion, onRejected)
  const pm = step === 'PM'
  const r = await dialog.open(
    approve
      ? {
          title: pm ? '终审通过' : '初审通过',
          message: (pm ? `${who}。驻场已初审通过；终审通过后进入待拨款，公司线下转账后登记拨款。` : `${who}。通过后推送项目经理终审。`) + warnText(a),
          presets: ['同意预支'],
          placeholder: pm ? '终审意见（选填）' : '初审意见（选填）',
          confirmText: pm ? '终审通过' : '初审通过',
          submit,
        }
      : {
          title: '驳回预支申请',
          message: `${who}。驳回后本次机会退回给求职者。`,
          presets: ['近期出勤异常', '在岗信息待核实', '本人已撤回申请'],
          required: true,
          placeholder: '请填写驳回意见（必填）',
          confirmText: '确认驳回',
          danger: true,
          submit,
        },
  )
  return r !== null
}

/**
 * 登记拨款（项目经理）：线下转账完成后登记，计入员工欠款，发薪导入工资表时自动抵扣；不用填内容，只做二次确认。
 * 在确认框里提交：网络失败时框不关、可重试；后端业务拒绝时关框并回调 onRejected，原因留在页面上。返回是否已登记
 */
export async function payoutAdvance(a: AdvanceRow, amountText: string, onRejected?: OnReviewRejected): Promise<boolean> {
  if (!canPayout(a)) return false
  const who = `${a.seekerName ?? '员工'}${a.projectName ? `（${a.projectName}）` : ''}${amountText}`
  let done = false
  try {
    await showConfirmDialog({
      title: '登记拨款',
      message: `确认已线下向 ${who} 完成转账？登记后计入员工欠款，次月发薪时工资表导入自动抵扣，此操作不可撤销。${warnText(a)}`,
      confirmButtonText: '已转账，登记拨款',
      beforeClose: async (action) => {
        if (action !== 'confirm') return true
        try {
          await tenantApi.payoutAdvance(a.advanceId)
          done = true
          return true
        } catch (e) {
          showToast(errorMessage(e, '登记失败，请稍后重试'))
          if (isApiError(e) && e.code !== 'NETWORK') {
            onRejected?.(errorMessage(e))
            return true
          }
          return false
        }
      },
    })
  } catch {
    return false
  }
  if (done) showSuccessToast('已登记拨款')
  return done
}
