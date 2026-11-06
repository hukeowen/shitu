export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'signal' | 'muted' | 'temp' | 'ink'

/** 枚举值 → 颜色语义。中文名一律取字典，这里只管颜色 */
const TONES: Record<string, Record<string, Tone>> = {
  CompanyStatus: {
    PENDING_AUDIT: 'warn',
    REJECTED: 'danger',
    NORMAL: 'ok',
    THROTTLED: 'warn',
    BANNED: 'danger',
    DEREGISTERED: 'muted',
    BANKRUPT: 'muted',
  },
  MemberStatus: { NORMAL: 'ok', DISABLED: 'muted' },
  ProjectStatus: { ACTIVE: 'ok', CLOSED: 'muted' },
  ClientContractStatus: { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger' },
  JobStatus: {
    PENDING_AUDIT: 'warn',
    REJECTED: 'danger',
    RECRUITING: 'ok',
    PAUSED: 'muted',
    OFFLINE: 'muted',
    FORCE_OFFLINE: 'danger',
  },
  ActorRole: { SITE: 'signal', BROKER: 'temp', PM: 'info', OWNER: 'ink' },
  ApplicationStatus: {
    PENDING_INTERVIEW: 'temp',
    PENDING_CONFIRM: 'signal',
    EMPLOYED: 'ok',
    CANCELLED: 'muted',
    TIMEOUT: 'muted',
    INTERVIEW_FAILED: 'danger',
    NO_SHOW: 'danger',
  },
  ContractStatus: { PENDING_SIGN: 'warn', EFFECTIVE: 'ok', EXPIRED: 'muted', DISSOLVED: 'muted', TERMINATED: 'muted', VOIDED: 'muted' },
  BillStatus: { GENERATED: 'muted', ISSUED: 'info', DISPUTED: 'warn', CONFIRMED: 'ok', SETTLED: 'ok' },
  BrokerCaseStatus: { OPEN: 'warn', CONTACTED: 'info', RECOMMENDED: 'signal', APPLIED: 'ok', RELEASED: 'muted', CLOSED: 'muted' },
  BrokerTriggerType: { LOW_MATCH: 'warn', REMATCH_LIMIT: 'temp', SITE_TRANSFER: 'signal', JOB_CHANGE: 'info' },
  ResignStatus: { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger' },
  StaffSource: { OWN: 'ok', PLATFORM: 'info', TRANSFER: 'signal' },
  AbsenceType: { LEAVE: 'info', ABSENT: 'danger' },
  DisputeStatus: { OPEN: 'warn', ACCEPTED: 'ok', REJECTED: 'danger' },
  LedgerDirection: { PAYABLE: 'danger', RECEIVABLE: 'ok' },
}

export function toneOf(type: string, value: string | null | undefined): Tone {
  if (!value) return 'muted'
  return TONES[type]?.[value] ?? 'muted'
}

/** 状态点（st-pill）用的颜色变量 */
export function toneColor(t: Tone): string {
  switch (t) {
    case 'ok':
      return 'var(--ok)'
    case 'warn':
      return 'var(--warn)'
    case 'danger':
      return 'var(--danger)'
    case 'info':
      return 'var(--info)'
    case 'signal':
      return 'var(--signal)'
    case 'temp':
      return 'var(--temp)'
    case 'ink':
      return 'var(--ink-900)'
    default:
      return 'var(--ink-500)'
  }
}
