import { tenantApi, type AdvanceStatus, type SiteApplication } from '@shitu/api-client'

/**
 * 状态 → 徽标配色的唯一出处（待办 / 提醒 / 详情 / 预支各页共用，避免同一状态在不同页面颜色不同）。
 * 语义：warn = 等你处理；info = 流程进行中；ok = 已完成的节点；danger = 失败 / 驳回；muted = 已结束。
 */

/** 「待面试」报名的子阶段（互斥）：已到厂 > 未知悉 > 已知悉待到厂 */
export type InterviewStage = 'ack' | 'interview' | 'arrived'
/** 进行中报名的阶段：待面试的三个子阶段 + 待确权 */
export type AppStage = InterviewStage | 'confirm'

export function interviewStage(a: Pick<SiteApplication, 'arrivedAt' | 'acknowledgedAt'>): InterviewStage {
  if (a.arrivedAt) return 'arrived'
  return a.acknowledgedAt ? 'interview' : 'ack'
}

export function appStage(a: SiteApplication): AppStage | null {
  if (a.status === 'PENDING_INTERVIEW') return interviewStage(a)
  if (a.status === 'PENDING_CONFIRM') return 'confirm'
  return null
}

export const STAGE_TEXT: Record<AppStage, string> = { ack: '待知悉', interview: '待面试', arrived: '已到厂', confirm: '待确权' }
export const STAGE_TAG: Record<AppStage, string> = { ack: 'tag-warn', interview: 'tag-info', arrived: 'tag-ok', confirm: 'tag-info' }

/** 私域待匹配（提醒页） */
export const PRIVATE_PENDING_TAG = 'tag-private'

/** 已结束的报名状态配色（历史报名等，中文名取字典 ApplicationStatus） */
export const APPLICATION_TAG: Record<string, string> = {
  PENDING_INTERVIEW: 'tag-info',
  PENDING_CONFIRM: 'tag-info',
  EMPLOYED: 'tag-ok',
  CANCELLED: 'tag-muted',
  TIMEOUT: 'tag-muted',
  INTERVIEW_FAILED: 'tag-danger',
  NO_SHOW: 'tag-danger',
}

/** 预支状态徽标配色（中文名取字典 AdvanceStatus） */
export const ADVANCE_TAG: Record<AdvanceStatus, string> = {
  SUBMITTED: 'tag-warn',
  SITE_APPROVED: 'tag-info',
  PM_APPROVED: 'tag-info',
  PAID: 'tag-ok',
  PARTIALLY_REPAID: 'tag-ok',
  REPAID: 'tag-muted',
  REJECTED: 'tag-danger',
}

/** 合同状态徽标配色（中文名取字典 ContractStatus） */
export const CONTRACT_TAG: Record<string, string> = {
  PENDING_SIGN: 'tag-warn',
  EFFECTIVE: 'tag-ok',
  EXPIRED: 'tag-muted',
  DISSOLVED: 'tag-muted',
  TERMINATED: 'tag-muted',
  VOIDED: 'tag-muted',
}

/** 24h 倒计时徽标：超时 / 不足 4 小时标红 */
export const URGENT_MS = 4 * 3600_000
export const countdownTag = (remainMs: number) => (remainMs < URGENT_MS ? 'tag-danger' : 'tag-warn')

const STAGE_PAGE = 100
const STAGE_MAX_PAGES = 5

export interface InterviewBuckets {
  ack: SiteApplication[]
  interview: SiteApplication[]
  arrived: SiteApplication[]
  /** 超过 500 条时只取了最紧急的一部分 */
  truncated: boolean
}

/**
 * 拉取全部「待面试」报名并按子阶段分桶（按 24h 截止时间排序）。
 * 后端列表只有「未知悉」「今日到厂」两个筛选，工作台数字里 pendingInterview 又包含未知悉与已到厂，
 * 直接用会重复计数；待办页签与工作台数字统一从这里的分桶得出，保证互斥且一致。
 */
export async function fetchInterviewBuckets(projectId?: string): Promise<InterviewBuckets> {
  const all: SiteApplication[] = []
  let truncated = false
  for (let page = 1; ; page += 1) {
    const r = await tenantApi.applications({ status: 'PENDING_INTERVIEW', projectId: projectId || undefined, page, pageSize: STAGE_PAGE, sort: 'DEADLINE' })
    all.push(...r.records)
    if (all.length >= r.total || r.records.length < STAGE_PAGE) break
    if (page >= STAGE_MAX_PAGES) {
      truncated = true
      break
    }
  }
  const out: InterviewBuckets = { ack: [], interview: [], arrived: [], truncated }
  const seen = new Set<string>()
  for (const a of all) {
    if (seen.has(a.applicationId)) continue
    seen.add(a.applicationId)
    out[interviewStage(a)].push(a)
  }
  return out
}
