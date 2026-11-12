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

/** 报名状态的标签色调（我的报备、面试详情、我的台账共用） */
export const APPLICATION_TONE: Record<ApplicationStatus, string> = {
  PENDING_INTERVIEW: 'status-tag--pending',
  PENDING_CONFIRM: 'status-tag--pending',
  EMPLOYED: 'status-tag--success',
  CANCELLED: 'status-tag--neutral',
  INTERVIEW_FAILED: 'status-tag--neutral',
  NO_SHOW: 'status-tag--warning',
  TIMEOUT: 'status-tag--danger',
}
