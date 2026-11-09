/**
 * 与后端 DTO 一一对应的类型（Sprint 1）。枚举值为英文常量，中文名统一从 /api/v1/dict 取（useDict）。
 * 时间字段为 ISO 字符串（北京时间，不带时区）：LocalDateTime → "2026-11-06T10:19:04.887"，LocalDate → "2026-11-06"。
 * 后端省略 null 字段（Jackson non_null），可选字段用 ?: 表示。
 */

export interface PageResult<T> {
  records: T[]
  total: number
  page: number
  pageSize: number
}

export interface Captcha {
  captchaId: string
  /** data:image/png;base64,... 可直接作为 <img src> */
  imageBase64: string
}

export interface SmsSendResult {
  retryAfterSeconds: number
  /** 仅本地开发（Mock 短信通道）返回 */
  devCode?: string
}

export interface TokenResponse {
  accessToken: string
  expiresIn: number
}

// ------------------------------------------------------------------ 枚举

export type UserStatus = 'GUEST' | 'PUBLIC_SEEKING' | 'PRIVATE_PENDING' | 'PENDING_INTERVIEW' | 'PENDING_CONFIRM' | 'EMPLOYED'
export type DomainTag = 'PUBLIC' | 'PRIVATE' | 'TEMP_PRIVATE'
export type MatchScope = 'NONE' | 'ALL_PLATFORM' | 'OWN_COMPANY' | 'INTERNAL_TRANSFER_ONLY' | 'LOCKED'
export type ChannelType = 'COMPANY_QR' | 'EMPLOYEE_SHARE' | 'ORGANIC' | 'BRAND_AD' | 'ROSTER_IMPORT'
export type TenantRole = 'SITE' | 'BROKER' | 'PM' | 'OWNER'
export type OpsRole = 'SUPER' | 'OPERATOR' | 'FINANCE' | 'RISK'
export type CompanyStatus = 'PENDING_AUDIT' | 'REJECTED' | 'NORMAL' | 'THROTTLED' | 'BANNED' | 'DEREGISTERED' | 'BANKRUPT'
export type MemberStatus = 'NORMAL' | 'DISABLED'
export type ProjectStatus = 'ACTIVE' | 'CLOSED'
export type ClientContractStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type JobStatus = 'PENDING_AUDIT' | 'REJECTED' | 'RECRUITING' | 'PAUSED' | 'OFFLINE' | 'FORCE_OFFLINE'
export type JobType = 'ELECTRONICS' | 'GENERAL' | 'WAREHOUSE' | 'MACHINING' | 'QC'
export type ShiftType = 'DAY' | 'NIGHT' | 'TWO_SHIFT' | 'LONG_DAY'
/** 公司后台岗位按钮 */
export type JobTenantAction = 'EDIT' | 'QUOTA' | 'PAUSE' | 'RESUME' | 'OFFLINE'
/** 平台岗位审核按钮 */
export type JobOpsAction = 'APPROVE' | 'REJECT' | 'FORCE_OFFLINE'

export interface DictItem {
  value: string
  label: string
}
export type Dict = Record<string, DictItem[]>

// ------------------------------------------------------------------ C 端

export interface SeekerProfile {
  userId: string
  phoneMasked: string
  status: UserStatus
  domainTag: DomainTag
  matchScope: MatchScope
  canStartMatching: boolean
  /** 当前归属公司（私域时） */
  boundCompanyName?: string
  sourceIsPlatform: boolean
  kycStatus: string
  registeredAt: string
  /** 私域 24h 响应窗口截止时间 */
  responseDeadline?: string
}

export interface SeekerLoginResponse extends TokenResponse {
  newUser: boolean
  profile: SeekerProfile
}

export interface ChannelInfo {
  valid: boolean
  channelType?: ChannelType
  /** 邀请方公司简称（公司码时） */
  companyName?: string
}

// ------------------------------------------------------------------ 公司后台

export interface TenantLoginResponse {
  status: 'OK' | 'NOT_MEMBER'
  accessToken?: string
  expiresIn?: number
  /** NOT_MEMBER 时返回，30 分钟内凭此上传执照、提交入驻申请（请求头 X-Onboarding-Ticket） */
  onboardingTicket?: string
  phoneMasked?: string
}

export interface CompanyView {
  companyId: string
  name: string
  shortName?: string
  unifiedCreditCode: string
  dispatchLicenseNo?: string
  /** 文件 key，查看用 fetchFileUrl */
  licenseFiles?: string[]
  contactName: string
  /** 老板 / 平台看到完整号码，其他角色脱敏 */
  contactPhone?: string
  status: CompanyStatus
  statusRemark?: string
  auditRemark?: string
  submittedAt?: string
  auditedAt?: string
  onboardDate?: string
  freePeriodEnd?: string
  creditScore?: number
  penaltyLevel?: number
  createdAt: string
}

export interface ApplyCompanyRequest {
  name: string
  shortName?: string
  unifiedCreditCode: string
  dispatchLicenseNo?: string
  licenseFiles: string[]
  contactName: string
}

export interface TenantMe {
  memberId: string
  name: string
  phoneMasked: string
  roles: TenantRole[]
  /** 权限点，控制菜单 / 按钮显示（与后端角色校验一致） */
  permissions: string[]
  company: CompanyView
  /** 公司是否可正常使用业务功能（正常 / 限流）；false 时只显示入驻进度页 */
  operational: boolean
}

export interface ProjectRef {
  projectId: string
  name: string
}

export interface MemberView {
  memberId: string
  name: string
  phoneMasked: string
  roles: TenantRole[]
  projects: ProjectRef[]
  status: MemberStatus
  lastLoginAt?: string
  createdAt: string
}

export interface MemberRequest {
  name: string
  /** 仅新增时必填，创建后不可修改 */
  phone?: string
  roles: TenantRole[]
  projectIds: string[]
}

export interface ProjectView {
  projectId: string
  name: string
  clientId: string
  clientName?: string
  contractId?: string
  province?: string
  city: string
  district?: string
  address: string
  lng?: number
  lat?: number
  status: ProjectStatus
  /** 该甲方是否有审核通过且在有效期内的合同（false 时不能发岗位） */
  contractEffective: boolean
  createdAt: string
}

export interface ProjectRequest {
  name: string
  clientId: string
  contractId?: string
  province?: string
  city: string
  district?: string
  address: string
  lng?: number
  lat?: number
}

export interface ClientView {
  clientId: string
  name: string
  unifiedCreditCode?: string
  city?: string
}

export interface ContractView {
  contractId: string
  companyId: string
  companyName?: string
  clientId: string
  clientName?: string
  fileKey: string
  validFrom: string
  validTo: string
  auditStatus: ClientContractStatus
  auditRemark?: string
  auditedAt?: string
  createdAt: string
  /** 审核通过且今天在有效期内 */
  effective: boolean
}

export interface ChannelItem {
  code: string
  /** 二维码内容，前端用它生成二维码图片 */
  url: string
  /** 公司码 / 成员码 / 项目码 */
  kind: 'COMPANY' | 'MEMBER' | 'PROJECT'
  name: string
  memberId?: string
  memberName?: string
  projectId?: string
  projectName?: string
  status: 'ACTIVE' | 'DISABLED'
  createdAt: string
  visits: number
  registrations: number
}

export interface UploadedFile {
  key: string
  name: string
  size: number
}

export interface JobView {
  jobId: string
  companyId: string
  /** 仅平台中台返回 */
  companyName?: string
  projectId: string
  projectName?: string
  city?: string
  clientId: string
  clientName?: string
  title: string
  jobType: JobType
  factoryJob: boolean
  salaryMin: number
  salaryMax: number
  shiftType: ShiftType
  dormProvided: boolean
  dormRoomSize?: number
  dormAircon?: boolean
  dormPrivateBath?: boolean
  mealProvided: boolean
  minWorkYears: number
  ageMin: number
  ageMax: number
  duties: string
  benefits?: string
  requiredDocuments?: string[]
  notes?: string
  interviewAddress: string
  interviewTimeDesc?: string
  quotaTotal: number
  quotaRemaining: number
  quotaOccupied: number
  status: JobStatus
  /** 驳回 / 强制下架说明 */
  auditRemark?: string
  submittedAt?: string
  postedAt?: string
  lastInfoUpdateAt?: string
  createdAt: string
  /** 后端给出的可用操作，前端据此显示按钮（公司后台为 JobTenantAction，平台为 JobOpsAction） */
  allowedActions: string[]
}

export interface JobRequest {
  projectId: string
  title: string
  jobType: JobType
  factoryJob?: boolean
  salaryMin: number
  salaryMax: number
  shiftType: ShiftType
  dormProvided?: boolean
  dormRoomSize?: number
  dormAircon?: boolean
  dormPrivateBath?: boolean
  mealProvided?: boolean
  minWorkYears?: number
  ageMin?: number
  ageMax?: number
  duties: string
  benefits?: string
  requiredDocuments?: string[]
  notes?: string
  interviewAddress: string
  interviewTimeDesc?: string
  quotaTotal: number
}

export interface JobAuditRecord {
  action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'FORCE_OFFLINE'
  remark?: string
  operatorId: string
  createdAt: string
}

// ------------------------------------------------------------------ 平台中台

export interface OpsLoginResponse extends TokenResponse {
  mustChangePassword: boolean
}

export interface AdminView {
  adminId: string
  username: string
  displayName: string
  roles: OpsRole[]
  status: MemberStatus
  mustChangePassword: boolean
  lastLoginAt?: string
  createdAt: string
}

export interface OpsPending {
  companies: number
  contracts: number
  jobs: number
}

export interface CompanyDetail {
  company: CompanyView
  members: MemberView[]
  contracts: ContractView[]
}

export interface OpsJobDetail {
  job: JobView
  /** 平台真实权重（R-14，仅平台可见） */
  matchWeight: number
  audits: JobAuditRecord[]
  /** 该公司与该甲方的合作合同 */
  contracts: ContractView[]
}

export interface AuditLogEntry {
  id: number
  actorDomain: 'SEEKER' | 'TENANT' | 'OPS' | 'SYSTEM'
  actorId?: string
  companyId?: string
  action: string
  targetType?: string
  targetId?: string
  /** JSON 字符串 */
  detail?: string
  ip?: string
  traceId?: string
  createdAt: string
}

// ------------------------------------------------------------------ Sprint 2：问薪、实名、报名、消息

export type ApplicationStatus = 'PENDING_INTERVIEW' | 'PENDING_CONFIRM' | 'EMPLOYED' | 'CANCELLED' | 'TIMEOUT' | 'INTERVIEW_FAILED' | 'NO_SHOW'

export interface QuizOption {
  code: string
  label: string
  /** 选项副标题，如「正常加班」 */
  sub?: string
  value?: string
  min?: number
  max?: number
  /** 选中后需要选择城市（地域锁定题） */
  needRegion?: boolean
}

export interface QuizQuestion {
  seq: number
  /** JUDGE 判断题 / CHOICE 选择题 */
  questionType: 'JUDGE' | 'CHOICE'
  stem: string
  hint?: string
  profileField: string
  /** HARD_FILTER 硬过滤 / SOFT_WEIGHT 软打分 */
  matchRole: 'HARD_FILTER' | 'SOFT_WEIGHT'
  options: QuizOption[]
}

export interface QuizView {
  versionId: number
  name: string
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  publishedAt?: string
  questions: QuizQuestion[]
}

export interface QuizAnswer {
  seq: number
  code: string
  /** 地域锁定题选「是」时的城市 */
  region?: string
}

export interface MatchResultCard {
  rank: number
  jobId: string
  title: string
  companyName?: string
  city?: string
  address?: string
  /** 匹配度 0–100（只返回 ≥ 80 的） */
  matchScore: number
  salaryMin: number
  salaryMax: number
  shiftType: ShiftType
  dormProvided: boolean
  dormRoomSize?: number
  dormAircon?: boolean
  mealProvided: boolean
  quotaRemaining: number
  /** 推荐理由，如「工种对口 · 月薪 5500–6800 元 · 包吃住 4 人间有空调」 */
  reason: string
}

export interface MatchOutcome {
  sessionId: string
  scope: MatchScope
  /** false = 没有匹配度 ≥ 80% 的岗位：私域已转人才经纪人；公域提示调整条件重新匹配 */
  matched: boolean
  results: MatchResultCard[]
  engineVersion: number
  quizVersion: number
}

export interface SeekerJobDetail {
  jobId: string
  title: string
  companyName?: string
  projectName?: string
  city?: string
  address?: string
  jobType: JobType
  shiftType: ShiftType
  salaryMin: number
  salaryMax: number
  dormProvided: boolean
  dormRoomSize?: number
  dormAircon?: boolean
  dormPrivateBath?: boolean
  mealProvided: boolean
  minWorkYears: number
  ageMin: number
  ageMax: number
  duties: string
  benefits?: string
  requiredDocuments?: string[]
  notes?: string
  interviewAddress: string
  interviewTimeDesc?: string
  quotaRemaining: number
  lng?: number
  lat?: number
  /** 报名按钮是否可用（实名 / 告知书在点报名后按错误码引导） */
  canApply: boolean
  cannotApplyReason?: string
}

export interface Disclaimer {
  version: string
  title: string
  paragraphs: string[]
  agreed: boolean
}

export interface KycView {
  kycStatus: 'NONE' | 'VERIFIED' | 'REVIEWING' | 'REJECTED'
  realNameMasked?: string
  idCardMasked?: string
  age?: number
  canApply: boolean
}

export interface ApplyResult {
  applicationId: string
  jobTitle: string
  companyName?: string
  interviewAddress?: string
  /** 24h 响应窗口截止（驻场需在此前联系） */
  responseDeadline?: string
}

export interface InterviewNoticeView {
  interviewAt: string
  address: string
  routeTips?: string
  documents?: string[]
  contactName?: string
  contactPhone?: string
  pushedAt: string
}

export interface MyApplication {
  applicationId: string
  jobId: string
  jobTitle?: string
  companyName?: string
  projectName?: string
  city?: string
  address?: string
  status: ApplicationStatus
  createdAt: string
  endedAt?: string
  endReason?: string
  /** 驻场推送的面试信息（C-408） */
  notice?: InterviewNoticeView
}

export interface InboxItem {
  id: number
  templateCode: string
  title: string
  content: string
  /** 应用内跳转路径 */
  link?: string
  /** 2 = 最高（工伤异常） */
  priority: number
  read: boolean
  createdAt: string
}

/** 驻场 / 项目经理看到的报名（phone 仅驻场返回） */
export interface SiteApplication {
  applicationId: string
  userId: string
  /** 脱敏姓名，未实名显示「未实名」 */
  seekerName: string
  phone?: string
  jobId: string
  jobTitle?: string
  projectId: string
  projectName?: string
  status: ApplicationStatus
  /** 报名前是公域用户 */
  fromPublic: boolean
  createdAt: string
  acknowledgedAt?: string
  interviewAt?: string
  /** 24h 响应截止 */
  responseDeadline?: string
  /** ACKNOWLEDGE 首次知悉 / REPUSH 重新推送 */
  allowedActions: string[]
  arrivedAt?: string
  /** 最近一次推送的面试信息（重新推送时预填） */
  notice?: InterviewNoticeView
  /** 待确权 / 已入职时的最近一份劳动合同；signUrl 仅待签署且驻场 / 项目经理可见 */
  contract?: ContractBrief
}

export interface ContractBrief {
  contractId: string
  status: string
  signUrl?: string
  createdAt: string
  signedAt?: string
}

export type SiteApplicationSort = 'CREATED_ASC' | 'CREATED_DESC' | 'DEADLINE'

export interface SiteWorkbench {
  /** 待知悉（新报名） */
  pendingAck: number
  pendingInterview: number
  pendingConfirm: number
  /** 4 小时内即将超时的 24h 窗口 */
  windowsDueIn4h: number
  /** 私域待匹配人数 */
  privatePending: number
}

export interface AcknowledgeRequest {
  /** ISO 本地时间，如 2026-11-08T09:00:00 */
  interviewAt: string
  address: string
  routeTips?: string
  documents?: string[]
  contactName?: string
  contactPhone?: string
}

export interface MatchSnapshot {
  session: {
    sessionId: string
    userId: string
    quizVersionId: number
    engineVersionId: number
    scope: string
    scopeCompanyId?: string
    answers: string
    profile: string
    status: 'MATCHED' | 'NO_MATCH'
    startedAt: string
  }
  results: {
    rankNo: number
    jobId: string
    matchScore: number
    jobWeight: number
    sortScore: number
    factorScores: string
    reasonText?: string
    displayed: boolean
  }[]
}

// ------------------------------------------------------------------ Sprint 3：入职闭环

export type ContractStatus = 'PENDING_SIGN' | 'EFFECTIVE' | 'EXPIRED' | 'DISSOLVED' | 'TERMINATED' | 'VOIDED'

/** 后台报名操作（allowedActions）：待面试 ACKNOWLEDGE/REPUSH、ARRIVE、PASS、FAIL、NO_SHOW（仅驻场）、CANCEL；待确权 CONFIRM 或 RESEND_CONTRACT、CANCEL */
export type SiteApplicationAction = 'ACKNOWLEDGE' | 'REPUSH' | 'ARRIVE' | 'PASS' | 'FAIL' | 'NO_SHOW' | 'CANCEL' | 'CONFIRM' | 'RESEND_CONTRACT'

export interface LaborContractView {
  contractId: string
  contractNo: string
  title: string
  companyName?: string
  jobTitle?: string
  projectName?: string
  termStart: string
  termEnd?: string
  status: ContractStatus
  /** 仅待签署时返回 */
  signUrl?: string
  signedAt?: string
  createdAt: string
}

export interface ConfirmOnboardRequest {
  /** 入职日期 yyyy-MM-dd，默认今天（近 3 天到未来 30 天） */
  startDate?: string
  employeeNo?: string
  /** 合同截止日，默认入职起 1 年 */
  termEnd?: string
}

export type StaffSource = 'OWN' | 'PLATFORM' | 'TRANSFER'

export interface StaffRow {
  employmentId: string
  userId: string
  /** 驻场看全名，其他角色脱敏 */
  name: string
  /** 仅驻场返回 */
  phone?: string
  projectId: string
  projectName?: string
  jobId?: string
  jobTitle?: string
  employeeNo?: string
  startDate: string
  endDate?: string
  /** 在岗天数（含入职当天） */
  dutyDays: number
  absenceDaysThisMonth: number
  /** 来源归属：本公司 / 平台自主 / 流转自其他公司（产生流转费） */
  source: StaffSource
  sourceCompanyName?: string
}

export interface DutyAbsenceView {
  id: number
  employmentId: string
  absenceDate: string
  absenceType: 'LEAVE' | 'ABSENT'
  markedBy: string
  remark?: string
  createdAt: string
}

export interface MyWork {
  employmentId: string
  companyName?: string
  projectName?: string
  city?: string
  address?: string
  jobTitle?: string
  startDate: string
  /** 有值 = 已离职 */
  endDate?: string
  dutyDays: number
  employeeNo?: string
}

// ------------------------------------------------------------------ Sprint 4：流转、离职、花名册、计费

export interface BrokerCaseRow {
  id: number
  userId: string
  seekerName: string
  phoneMasked?: string
  /** LOW_MATCH 匹配度不足 / REMATCH_LIMIT 多次匹配未报名 / SITE_TRANSFER 驻场流转 */
  triggerType: 'LOW_MATCH' | 'REMATCH_LIMIT' | 'SITE_TRANSFER' | 'JOB_CHANGE'
  status: 'OPEN' | 'CONTACTED' | 'RECOMMENDED' | 'APPLIED' | 'RELEASED' | 'CLOSED'
  fromMemberId?: string
  /** 2 小时联系时限 */
  contactDueAt: string
  /** 24 小时出结果时限，超时自动释放 */
  resolveDueAt: string
  contactedAt?: string
  createdAt: string
  matchCount: number
  profileSummary: string
  /** CONTACT / REPORT / RECOMMEND / RELEASE */
  allowedActions: string[]
}

export interface BrokerReport {
  id: number
  caseId: number
  summary: string
  recommendations: { jobId: string; title: string; matchScore: number; reason: string }[]
  generator: 'TEMPLATE' | 'LLM'
  createdAt: string
}

export interface MyRecommendation {
  id: number
  jobId: string
  jobTitle?: string
  companyName?: string
  note?: string
  decision: 'PENDING' | 'ACCEPTED' | 'DECLINED'
  createdAt: string
}

export interface ResignRow {
  id: number
  employmentId: string
  userId: string
  name: string
  projectId: string
  resignDate: string
  reason?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedBy: string
  approvedBy?: string
  createdAt: string
}

export interface RosterRowResult {
  rowNo: number
  success: boolean
  error?: string
  userId?: string
}

export interface RosterBatchResult {
  batchId: string
  total: number
  success: number
  failed: number
  /** 导入时在免费期内 → 计入存量 */
  inFreePeriod: boolean
  rows: RosterRowResult[]
}

export interface RosterBatch {
  batchId: string
  totalRows: number
  successRows: number
  failedRows: number
  inFreePeriod: boolean
  status: string
  operatorId: string
  createdAt: string
}

export type BillStatus = 'GENERATED' | 'ISSUED' | 'DISPUTED' | 'CONFIRMED' | 'SETTLED'

export interface MonthlyBill {
  billId: string
  companyId: string
  /** YYYY-MM */
  billMonth: string
  /** 增长技术服务费 */
  serviceFee: number
  /** 作为接收方应付的流转费 */
  transferPayable: number
  /** 作为来源方应收（不与应付轧差） */
  transferReceivable: number
  /** 应付合计 = 服务费 + 应付流转费 */
  payable: number
  status: BillStatus
  issuedAt?: string
  disputeDeadline?: string
  settleDeadline?: string
  settledAt?: string
}

export interface BillDayLine {
  bizDate: string
  inFreePeriod: boolean
  employedCount: number
  stockBase: number
  incrementCount: number
  serviceFee: number
  transferPayable: number
  transferReceivable: number
}

export interface BillDispute {
  id: number
  billId: string
  content: string
  status: 'OPEN' | 'ACCEPTED' | 'REJECTED'
  raisedBy: string
  reply?: string
  createdAt: string
  repliedAt?: string
}

export interface BillDetail {
  bill: MonthlyBill
  days: BillDayLine[]
  disputes: BillDispute[]
}

export interface LedgerLine {
  /** PAYABLE 流入（我付）/ RECEIVABLE 流出（我收） */
  direction: 'PAYABLE' | 'RECEIVABLE'
  userId: string
  counterpartCompanyId?: string
  days: number
  amount: number
}

export interface DailyBillingResult {
  bizDate: string
  ruleVersion: number
  companies: number
  transferLines: number
  serviceFee: number
  transferFee: number
}

export interface BillingRuleRow {
  version: number
  effectiveFrom: string
  serviceUnitPrice: number
  transferUnitPrice: number
  supplyShare: number
  freeMonths: number
  createdBy?: string
  createdAt: string
}

export interface CompanyCloseResult {
  unboundUsers: number
  offlineJobs: number
  disabledMembers: number
}

// ------------------------------------------------------------------ Sprint 5：预支、工资、风控

export interface AdvanceQuota {
  /** 5 项准入全部满足 */
  eligible: boolean
  /** 不满足的原因（直接展示） */
  reasons: string[]
  /** 有效在岗日（扣除请假旷工） */
  dutyDays: number
  /** 当前 7 天周期内已累计天数（进度条 x/7） */
  progressInCycle: number
  daysPerChance: number
  grantedThisMonth: number
  usedThisMonth: number
  remainingThisMonth: number
  monthlyLimit: number
  /** 单次固定金额 */
  amount: number
  debt: number
}

export type AdvanceStatus = 'SUBMITTED' | 'SITE_APPROVED' | 'PM_APPROVED' | 'PAID' | 'PARTIALLY_REPAID' | 'REPAID' | 'REJECTED'

export interface AdvanceRow {
  advanceId: string
  userId: string
  /** 公司后台返回脱敏姓名 */
  seekerName?: string
  projectId: string
  amount: number
  bizMonth: string
  status: AdvanceStatus
  repaidAmount: number
  paidAt?: string
  createdAt: string
  /** SITE_APPROVE / SITE_REJECT / PM_APPROVE / PM_REJECT / PAYOUT */
  allowedActions: string[]
}

export interface DebtLogEntry {
  changeType: 'PAYOUT' | 'DEDUCT' | 'WRITE_OFF'
  amount: number
  balanceAfter: number
  advanceId?: string
  payslipId?: string
  createdAt: string
}

export interface Payslip {
  payslipId: string
  payMonth: string
  companyName?: string
  grossPay: number
  socialInsurance: number
  incomeTax: number
  otherDeduct: number
  /** 预支抵扣 */
  advanceDeduct: number
  netPay: number
}

export interface PayrollRowResult {
  rowNo: number
  success: boolean
  error?: string
  payslipId?: string
  advanceDeduct?: number
  netPay?: number
}

export interface PayrollBatchResult {
  batchId: string
  payMonth: string
  headcount: number
  grossTotal: number
  advanceDeductTotal: number
  netTotal: number
  rows: PayrollRowResult[]
}

export type ComplaintCategory = 'FULL_STILL_HIRING' | 'INFO_FALSE' | 'MISMATCH_AFTER_INTERVIEW'

// ---------------------------------------------------------------- 看板与报表（Sprint 5）
export interface PmBoard {
  pendingInterview: number
  pendingConfirm: number
  employed: number
  resignedThisMonth: number
  arrivedToday: number
  hiredThisMonth: number
  recruitingJobs: number
}

export interface OwnerProjectRow {
  projectId: string
  name: string
  city: string | null
  managers: string | null
  employed: number
  hiredThisMonth: number
  resignedThisMonth: number
}

export interface OwnerOverview {
  totalHired: number
  employed: number
  hiredThisMonth: number
  resignedThisMonth: number
  privatePool: number
  transferIn: number
  transferOut: number
  projects: OwnerProjectRow[]
}

export interface ChannelFunnelRow {
  code: string
  name: string
  memberId: string | null
  projectId: string | null
  visits: number
  registrations: number
  applied: number
  hired: number
}

export interface OpsOverview {
  companies: number
  pendingCompanies: number
  employed: number
  hiredToday: number
  registeredToday: number
  applicationsToday: number
  publicSeekers: number
  recruitingJobs: number
  yesterday: { date: string; serviceFee: number; transferFee: number; transferCount: number; platformTake: number }
  monthServiceFee: number
  trend: { d: string; registrations: number }[]
}

// ---------------------------------------------------------------- 岗位知识库（T-305 / C-409）
export interface KbEntry {
  id: number
  projectId: string | null
  projectName: string | null
  jobId: string | null
  jobTitle: string | null
  question: string
  answer: string
  updatedBy: string
  updatedAt: string
}

export interface KbPending {
  id: number
  jobId: string
  jobTitle: string
  projectId: string
  question: string
  askedTimes: number
  lastAskedAt: string
}

export interface KbAskResult {
  answered: boolean
  question: string
  answer: string
  matchedQuestion: string | null
}

export interface AdvanceApprovalStep {
  step: 'SITE' | 'PM' | 'PAYOUT'
  decision: 'APPROVE' | 'REJECT'
  opinion?: string
  at: string
}

/** 单笔预支：ledger 为本笔的拨款与分摊抵扣，balanceAfter = 本笔剩余未还 */
export interface AdvanceDetail {
  advance: AdvanceRow
  approvals: AdvanceApprovalStep[]
  ledger: DebtLogEntry[]
}
