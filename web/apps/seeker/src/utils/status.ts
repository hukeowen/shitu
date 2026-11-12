import type { DomainTag, UserStatus } from '@shitu/api-client'

/** 状态徽标配色（仅展示样式；中文名一律从字典取） */
export const STATUS_TAG_CLASS: Record<UserStatus, string> = {
  GUEST: 'tag-muted',
  PUBLIC_SEEKING: 'tag-public',
  PRIVATE_PENDING: 'tag-private',
  PENDING_INTERVIEW: 'tag-temp',
  PENDING_CONFIRM: 'tag-temp',
  EMPLOYED: 'tag-ok',
}

/** 状态标签色调（tokens.css 的 .status-tag--*）。求职者端不用私域 / 公域的专属色 */
export const STATUS_TONE: Record<UserStatus, string> = {
  GUEST: 'status-tag--neutral',
  PUBLIC_SEEKING: 'status-tag--info',
  PRIVATE_PENDING: 'status-tag--info',
  PENDING_INTERVIEW: 'status-tag--pending',
  PENDING_CONFIRM: 'status-tag--pending',
  EMPLOYED: 'status-tag--success',
}

/** 首页状态头配色：私域 / 临时私域用橙棕，公域用青色 */
export function heroClass(domain: DomainTag | undefined): string {
  if (domain === 'PUBLIC') return 'pub'
  if (domain === 'PRIVATE' || domain === 'TEMP_PRIVATE') return 'pri'
  return ''
}
