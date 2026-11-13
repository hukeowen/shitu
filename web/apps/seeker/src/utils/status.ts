import type { ApplicationStatus, DomainTag, UserStatus } from '@shitu/api-client'

/** 报名状态徽标配色（我的报备 / 报名详情 / 我的台账共用，保证同一状态同一颜色） */
export const APP_TAG_CLASS: Record<ApplicationStatus, string> = {
  PENDING_INTERVIEW: 'tag-temp',
  PENDING_CONFIRM: 'tag-temp',
  EMPLOYED: 'tag-ok',
  CANCELLED: 'tag-muted',
  INTERVIEW_FAILED: 'tag-muted',
  NO_SHOW: 'tag-warn',
  TIMEOUT: 'tag-danger',
}

/** 状态徽标配色（仅展示样式；中文名一律从字典取） */
export const STATUS_TAG_CLASS: Record<UserStatus, string> = {
  GUEST: 'tag-muted',
  PUBLIC_SEEKING: 'tag-public',
  PRIVATE_PENDING: 'tag-private',
  PENDING_INTERVIEW: 'tag-temp',
  PENDING_CONFIRM: 'tag-temp',
  EMPLOYED: 'tag-ok',
}

/** 首页状态头配色：私域 / 临时私域用橙棕，公域用青色 */
export function heroClass(domain: DomainTag | undefined): string {
  if (domain === 'PUBLIC') return 'pub'
  if (domain === 'PRIVATE' || domain === 'TEMP_PRIVATE') return 'pri'
  return ''
}
