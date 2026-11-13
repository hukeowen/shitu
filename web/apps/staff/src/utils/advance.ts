import { showSuccessToast, showToast } from 'vant'
import { errorMessage, tenantApi, type AdvanceApprovalStep, type AdvanceRow, type DebtLogEntry, type TenantRole } from '@shitu/api-client'
import type ReasonDialog from '@/components/ReasonDialog.vue'

/** 预支状态徽标配色：统一定义在 utils/status */
export { ADVANCE_TAG } from '@/utils/status'

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
    return { title: '预支终审', todoTab: '待终审', tileDesc: '待你终审', entryDesc: '驻场初审通过后的项目经理终审', empty: '暂无待你终审的预支申请', step: 'PM' }
  }
  return { title: '预支审批', todoTab: '待我审批', tileDesc: '待你审批', entryDesc: '求职者薪资预支的审批记录', empty: '暂无待你审批的预支申请', step: null }
}

type Dialog = InstanceType<typeof ReasonDialog>

async function submitReview(step: ReviewStep, id: string, approve: boolean, opinion: string) {
  try {
    if (step === 'PM') await tenantApi.pmReviewAdvance(id, approve, opinion || undefined)
    else await tenantApi.siteReviewAdvance(id, approve, opinion || undefined)
    showSuccessToast(!approve ? '已驳回，机会已退回' : step === 'PM' ? '终审已通过，待登记拨款' : '初审已通过，已推送项目经理终审')
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
    throw e
  }
}

/**
 * M-11 驻场初审 / T-309 项目经理终审：通过（意见选填）/ 驳回（意见必填，驳回退回本次机会）。
 * 走哪个环节由该笔的 allowedActions 决定。返回是否已提交
 */
export async function reviewAdvance(dialog: Dialog | null, a: AdvanceRow, approve: boolean, amountText: string): Promise<boolean> {
  const step = reviewStep(a)
  if (!dialog || !step) return false
  const who = `${a.seekerName ?? '—'} · ${amountText}`
  const submit = (opinion: string) => submitReview(step, a.advanceId, approve, opinion)
  const pm = step === 'PM'
  const r = await dialog.open(
    approve
      ? {
          title: pm ? '终审通过' : '初审通过',
          message: pm ? `${who}。驻场已初审通过；终审通过后进入待拨款，公司线下转账后登记拨款。` : `${who}。通过后推送项目经理终审。`,
          presets: pm ? ['情况属实，同意预支'] : ['在岗正常，出勤稳定，同意'],
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
