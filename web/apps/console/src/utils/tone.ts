/** 共享状态标签的色调（tokens.css 的 .status-tag--*）。同一状态和 seeker、staff 用同一色调 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'private' | 'public' | 'pending'

/** 枚举值 → 色调。中文名一律取字典，这里只管颜色 */
const TONES: Record<string, Record<string, Tone>> = {
  CompanyStatus: {
    PENDING_AUDIT: 'warning',
    REJECTED: 'danger',
    NORMAL: 'success',
    THROTTLED: 'warning',
    BANNED: 'danger',
    DEREGISTERED: 'neutral',
    BANKRUPT: 'neutral',
  },
  MemberStatus: { NORMAL: 'success', DISABLED: 'neutral' },
  ProjectStatus: { ACTIVE: 'success', CLOSED: 'neutral' },
  ClientContractStatus: { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' },
  JobStatus: {
    PENDING_AUDIT: 'warning',
    REJECTED: 'danger',
    RECRUITING: 'success',
    PAUSED: 'neutral',
    OFFLINE: 'neutral',
    FORCE_OFFLINE: 'danger',
  },
  // 角色：staff「我的」页四种角色都是信息色
  ActorRole: { SITE: 'info', BROKER: 'info', PM: 'info', OWNER: 'info' },
  // 报名状态：以 seeker utils/status.ts 的 APPLICATION_TONE 为准
  ApplicationStatus: {
    PENDING_INTERVIEW: 'pending',
    PENDING_CONFIRM: 'pending',
    EMPLOYED: 'success',
    CANCELLED: 'neutral',
    TIMEOUT: 'danger',
    INTERVIEW_FAILED: 'neutral',
    NO_SHOW: 'warning',
  },
  // 合同状态：以 staff utils/actions.ts 的 CONTRACT_TONE 为准
  ContractStatus: { PENDING_SIGN: 'warning', EFFECTIVE: 'success', EXPIRED: 'neutral', DISSOLVED: 'neutral', TERMINATED: 'neutral', VOIDED: 'neutral' },
  BillStatus: { GENERATED: 'neutral', ISSUED: 'info', DISPUTED: 'warning', CONFIRMED: 'success', SETTLED: 'success' },
  BrokerCaseStatus: { OPEN: 'warning', CONTACTED: 'info', RECOMMENDED: 'info', APPLIED: 'success', RELEASED: 'neutral', CLOSED: 'neutral' },
  BrokerTriggerType: { LOW_MATCH: 'warning', REMATCH_LIMIT: 'pending', SITE_TRANSFER: 'info', JOB_CHANGE: 'info' },
  ResignStatus: { PENDING: 'warning', SCHEDULED: 'info', APPROVED: 'success', REJECTED: 'danger' },
  // 人员来源：平台和转入的人在 staff 在岗人员页标成公域色
  StaffSource: { OWN: 'success', PLATFORM: 'public', TRANSFER: 'public' },
  // 请假 / 旷工：以 staff 请假弹层为准
  AbsenceType: { LEAVE: 'warning', ABSENT: 'danger' },
  // 工伤：以 staff 工伤上报页的 SEV_TONE 为准
  IncidentSeverity: { MINOR: 'info', SERIOUS: 'warning', CRITICAL: 'danger' },
  IncidentStatus: { OPEN: 'warning', CLOSED: 'success' },
  DisputeStatus: { OPEN: 'warning', ACCEPTED: 'success', REJECTED: 'danger' },
  LedgerDirection: { PAYABLE: 'danger', RECEIVABLE: 'success' },
  // 预支状态：以 seeker utils/advance.ts 的 ADVANCE_TONE 为准
  AdvanceStatus: {
    SUBMITTED: 'warning',
    SITE_APPROVED: 'warning',
    PM_APPROVED: 'warning',
    PAID: 'success',
    PARTIALLY_REPAID: 'pending',
    REPAID: 'neutral',
    REJECTED: 'danger',
  },
}

export function toneOf(type: string, value: string | null | undefined): Tone {
  if (!value) return 'neutral'
  return TONES[type]?.[value] ?? 'neutral'
}
