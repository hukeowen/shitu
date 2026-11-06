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
}

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
