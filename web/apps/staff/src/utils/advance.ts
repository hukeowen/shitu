import { showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, type AdvanceApprovalStep, type AdvanceRow, type AdvanceStatus, type DebtLogEntry } from '@shitu/api-client'
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

export const canSiteReview = (a: AdvanceRow) => a.allowedActions.includes('SITE_APPROVE') || a.allowedActions.includes('SITE_REJECT')

type Dialog = InstanceType<typeof ReasonDialog>

/** 后端业务拒绝（不是网络失败）时回调：页面把这一单的初审按钮置灰、原因留在卡片或底部通栏上 */
export type OnReviewRejected = (reason: string) => void

async function submitSiteReview(id: string, approve: boolean, opinion: string, onRejected?: OnReviewRejected) {
  try {
    await tenantApi.siteReviewAdvance(id, approve, opinion || undefined)
    showSuccessToast(approve ? '初审已通过，已推送项目经理终审' : '已驳回，机会已退回')
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
    if (isApiError(e)) onRejected?.(errorMessage(e))
    throw e
  }
}

/** M-11 驻场初审：通过（意见选填）/ 驳回（意见必填，驳回退回本次机会）。返回是否已提交 */
export async function siteReview(dialog: Dialog | null, a: AdvanceRow, approve: boolean, amountText: string, onRejected?: OnReviewRejected): Promise<boolean> {
  if (!dialog) return false
  const who = `${a.seekerName ?? '—'} · ${amountText}`
  const submit = (opinion: string) => submitSiteReview(a.advanceId, approve, opinion, onRejected)
  const r = await dialog.open(
    approve
      ? {
          title: '初审通过',
          message: `${who}。通过后推送项目经理终审。`,
          presets: ['在岗正常，出勤稳定，同意'],
          placeholder: '初审意见（选填）',
          confirmText: '初审通过',
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
