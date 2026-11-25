import type { ApplicationStatus, UserStatus } from '@shitu/api-client'

/** 状态标签色调（tokens.css 的 .status-tag--*）。求职者端不用私域 / 公域的专属色 */
export const STATUS_TONE: Record<UserStatus, string> = {
  GUEST: 'status-tag--neutral',
  PUBLIC_SEEKING: 'status-tag--info',
  PRIVATE_PENDING: 'status-tag--info',
  PENDING_INTERVIEW: 'status-tag--pending',
  PENDING_CONFIRM: 'status-tag--pending',
  EMPLOYED: 'status-tag--success',
}

/** 报名状态的标签色调（我的报名、面试详情、我的台账共用） */
export const APPLICATION_TONE: Record<ApplicationStatus, string> = {
  PENDING_INTERVIEW: 'status-tag--pending',
  PENDING_CONFIRM: 'status-tag--pending',
  EMPLOYED: 'status-tag--success',
  CANCELLED: 'status-tag--neutral',
  INTERVIEW_FAILED: 'status-tag--neutral',
  NO_SHOW: 'status-tag--warning',
  TIMEOUT: 'status-tag--danger',
}

/**
 * 截止时间倒计时（DeadlineBar）的说法：按报名 / 用户所处阶段。
 * 待面试且驻场还没推送面试信息 = 等驻场联系；已推送 = 等面试结果；待签约入职 = 等劳务公司办入职；私域待匹配 = 等专属顾问联系。
 */
export function deadlineCopy(status: ApplicationStatus | UserStatus | undefined, hasNotice = false): { lead: string; action: string } {
  if (status === 'PENDING_CONFIRM') return { lead: '劳务公司会在', action: '给你办好入职' }
  if (status === 'PRIVATE_PENDING') return { lead: '专属顾问会在', action: '联系你' }
  if (status === 'PENDING_INTERVIEW' && hasNotice) return { lead: '驻场老师会在', action: '给你面试结果' }
  return { lead: '驻场老师会在', action: '联系你' }
}
