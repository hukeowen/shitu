import { request } from './http'
import type {
  AdminView,
  ApplyCompanyRequest,
  AuditLogEntry,
  Captcha,
  ChannelInfo,
  ChannelItem,
  ClientContractStatus,
  ClientView,
  CompanyDetail,
  CompanyStatus,
  CompanyView,
  ContractView,
  Dict,
  JobAuditRecord,
  JobRequest,
  JobStatus,
  JobView,
  MemberRequest,
  MemberStatus,
  MemberView,
  OpsJobDetail,
  OpsLoginResponse,
  OpsPending,
  OpsRole,
  PageResult,
  ProjectRequest,
  ProjectStatus,
  ProjectView,
  QuizAnswer,
  QuizQuestion,
  QuizView,
  MatchOutcome,
  SeekerJobDetail,
  Disclaimer,
  KycView,
  ApplyResult,
  MyApplication,
  ApplicationStatus,
  InboxItem,
  SiteApplication,
  SiteWorkbench,
  AcknowledgeRequest,
  MatchSnapshot,
  SeekerLoginResponse,
  SeekerProfile,
  SmsSendResult,
  TenantLoginResponse,
  TenantMe,
  TenantRole,
  TokenResponse,
  UploadedFile,
} from './types'

/**
 * Sprint 1 手写接口层（与后端 Controller 一一对应，接口文档见 http://localhost:8080/swagger-ui.html）。
 * 后续可用 orval 从 OpenAPI 生成替换；调用方只依赖这里的函数签名。
 */

type Q = Record<string, string | number | boolean | undefined | null>

const get = <T>(url: string, params?: Q) => request<T>({ method: 'GET', url, params })
const post = <T>(url: string, data?: unknown, headers?: Record<string, string>) =>
  request<T>({ method: 'POST', url, data, headers })
const put = <T>(url: string, data?: unknown) => request<T>({ method: 'PUT', url, data })
const upload = <T>(url: string, file: File, params?: Q, headers?: Record<string, string>) => {
  const fd = new FormData()
  fd.append('file', file)
  return request<T>({ method: 'POST', url, data: fd, params, headers })
}

export interface SmsCodeRequest {
  phone: string
  /** 后端返回 AUTH_4004 时，先取图形验证码再带上重发 */
  captchaId?: string
  captchaCode?: string
}

export const dictApi = {
  all: () => get<Dict>('/dict'),
}

// ------------------------------------------------------------------ C 端

export const seekerApi = {
  captcha: () => get<Captcha>('/seeker/auth/captcha'),
  sendSms: (req: SmsCodeRequest) => post<SmsSendResult>('/seeker/auth/sms-code', req),
  /** channelCode 不传时后端读 7 天渠道 Cookie */
  login: (phone: string, code: string, channelCode?: string | null) =>
    post<SeekerLoginResponse>('/seeker/auth/sms-login', { phone, code, channelCode: channelCode ?? undefined }),
  me: () => get<SeekerProfile>('/seeker/me'),
  channelInfo: (code: string) => get<ChannelInfo>(`/seeker/public/channel/${encodeURIComponent(code)}`),

  /** 当前生效题库（C-302） */
  quiz: () => get<QuizView>('/seeker/quiz'),
  /** 提交答案匹配；报名锁定期抛 LC_4003（C-301） */
  match: (answers: QuizAnswer[], location?: { lng: number; lat: number }) =>
    post<MatchOutcome>('/seeker/match', { answers, lng: location?.lng, lat: location?.lat }),
  /** 最近一次匹配结果，没有返回 null */
  latestMatch: () => get<MatchOutcome | null>('/seeker/match/latest'),
  /** 岗位详情，只能看最近一次匹配结果里的岗位（否则 APP_4004） */
  job: (jobId: string) => get<SeekerJobDetail>(`/seeker/jobs/${jobId}`),
  disclaimer: () => get<Disclaimer>('/seeker/disclaimer'),
  agreeDisclaimer: (version: string) => post<Disclaimer>('/seeker/disclaimer/agree', { version }),
  kyc: () => get<KycView>('/seeker/kyc'),
  /** 实名：APP_4003 两次不一致 / 4005 号码错误 / 4006 未满 16 / 4007 已被占用 / 4008 黑名单 / 4009 二要素不符 / 4013 已实名 */
  submitKyc: (realName: string, idCard: string, idCardConfirm: string) =>
    post<KycView>('/seeker/kyc', { realName, idCard, idCardConfirm }),
  /** 报名：APP_4012 未同意告知书 / 4010 未实名 / 4011 未满 18 / 4001 名额已满 / 4002 已有报名 / 4004 不在匹配结果中 */
  apply: (jobId: string) => post<ApplyResult>('/seeker/applications', { jobId }),
  myApplications: (status?: ApplicationStatus) => get<MyApplication[]>('/seeker/applications', { status }),
  messages: (params?: { unreadOnly?: boolean; page?: number; pageSize?: number }) =>
    get<PageResult<InboxItem>>('/seeker/messages', params),
  unreadCount: () => get<number>('/seeker/messages/unread-count'),
  /** ids 不传 = 全部已读 */
  markRead: (ids?: number[]) => post<number>('/seeker/messages/read', { ids }),
}

// ------------------------------------------------------------------ 公司后台 / 驻场端

export const tenantApi = {
  captcha: () => get<Captcha>('/tenant/auth/captcha'),
  sendSms: (req: SmsCodeRequest) => post<SmsSendResult>('/tenant/auth/sms-code', req),
  login: (phone: string, code: string) => post<TenantLoginResponse>('/tenant/auth/sms-login', { phone, code }),

  /** 入驻申请：凭 sms-login 返回的 onboardingTicket */
  onboardingUpload: (ticket: string, file: File) =>
    upload<UploadedFile>('/tenant/onboarding/files', file, undefined, { 'X-Onboarding-Ticket': ticket }),
  onboardingApply: (ticket: string, req: ApplyCompanyRequest) =>
    post<TokenResponse>('/tenant/onboarding/apply', req, { 'X-Onboarding-Ticket': ticket }),

  me: () => get<TenantMe>('/tenant/me'),
  company: () => get<CompanyView>('/tenant/company'),
  /** 审核中 / 被驳回时修改资料重新提交（老板） */
  resubmit: (req: ApplyCompanyRequest) => put<CompanyView>('/tenant/company/application', req),
  /** category：license 营业执照 / 许可证；contract 合作合同 */
  upload: (file: File, category: 'license' | 'contract') => upload<UploadedFile>('/tenant/files', file, { category }),
  /** 查看文件用 fetchFileUrl(tenantApi.filePath, key) */
  filePath: '/tenant/files',

  members: (params?: { keyword?: string; role?: TenantRole }) => get<MemberView[]>('/tenant/members', params),
  createMember: (req: MemberRequest) => post<MemberView>('/tenant/members', req),
  updateMember: (memberId: string, req: MemberRequest) => put<MemberView>(`/tenant/members/${memberId}`, req),
  setMemberStatus: (memberId: string, status: MemberStatus) => post<MemberView>(`/tenant/members/${memberId}/status`, { status }),

  projects: (params?: { status?: ProjectStatus; keyword?: string }) => get<ProjectView[]>('/tenant/projects', params),
  project: (projectId: string) => get<ProjectView>(`/tenant/projects/${projectId}`),
  createProject: (req: ProjectRequest) => post<ProjectView>('/tenant/projects', req),
  updateProject: (projectId: string, req: ProjectRequest) => put<ProjectView>(`/tenant/projects/${projectId}`, req),
  closeProject: (projectId: string) => post<ProjectView>(`/tenant/projects/${projectId}/close`),

  clients: (keyword?: string) => get<ClientView[]>('/tenant/clients', { keyword }),
  createClient: (req: { name: string; unifiedCreditCode?: string; city?: string }) => post<ClientView>('/tenant/clients', req),
  contracts: (clientId?: string) => get<ContractView[]>('/tenant/client-contracts', { clientId }),
  submitContract: (req: { clientId: string; fileKey: string; validFrom: string; validTo: string }) =>
    post<ContractView>('/tenant/client-contracts', req),

  channelCodes: () => get<ChannelItem[]>('/tenant/channel-codes'),
  myChannelCode: () => get<ChannelItem>('/tenant/channel-codes/mine'),
  createChannelCode: (req: { name: string; memberId?: string; projectId?: string }) =>
    post<ChannelItem>('/tenant/channel-codes', req),
  disableChannelCode: (code: string) => post<ChannelItem>(`/tenant/channel-codes/${code}/disable`),
  enableChannelCode: (code: string) => post<ChannelItem>(`/tenant/channel-codes/${code}/enable`),

  jobs: (params?: { status?: JobStatus; projectId?: string; keyword?: string; page?: number; pageSize?: number }) =>
    get<PageResult<JobView>>('/tenant/jobs', params),
  jobStats: (projectId?: string) => get<Record<JobStatus, number>>('/tenant/jobs/stats', { projectId }),
  job: (jobId: string) => get<JobView>(`/tenant/jobs/${jobId}`),
  jobAudits: (jobId: string) => get<JobAuditRecord[]>(`/tenant/jobs/${jobId}/audits`),
  createJob: (req: JobRequest) => post<JobView>('/tenant/jobs', req),
  /** 编辑会重新进入平台审核 */
  updateJob: (jobId: string, req: JobRequest) => put<JobView>(`/tenant/jobs/${jobId}`, req),
  /** 只改名额，不需要审核 */
  adjustQuota: (jobId: string, quotaTotal: number) => put<JobView>(`/tenant/jobs/${jobId}/quota`, { quotaTotal }),
  pauseJob: (jobId: string) => post<JobView>(`/tenant/jobs/${jobId}/pause`),
  resumeJob: (jobId: string) => post<JobView>(`/tenant/jobs/${jobId}/resume`),
  offlineJob: (jobId: string) => post<JobView>(`/tenant/jobs/${jobId}/offline`),

  /** 驻场工作台数字（M-01） */
  siteWorkbench: () => get<SiteWorkbench>('/tenant/site/workbench'),
  /** 报名列表（M-02）：unacknowledged=true 只看待知悉 */
  applications: (params?: { status?: ApplicationStatus; unacknowledged?: boolean; projectId?: string; page?: number; pageSize?: number }) =>
    get<PageResult<SiteApplication>>('/tenant/applications', params),
  application: (applicationId: string) => get<SiteApplication>(`/tenant/applications/${applicationId}`),
  /** 知悉并推送面试信息（可重复推送） */
  acknowledge: (applicationId: string, req: AcknowledgeRequest) =>
    post<SiteApplication>(`/tenant/applications/${applicationId}/acknowledge`, req),
  messages: (params?: { unreadOnly?: boolean; page?: number; pageSize?: number }) =>
    get<PageResult<InboxItem>>('/tenant/messages', params),
  unreadCount: () => get<number>('/tenant/messages/unread-count'),
  markRead: (ids?: number[]) => post<number>('/tenant/messages/read', { ids }),
}

// ------------------------------------------------------------------ 平台中台

export const opsApi = {
  captcha: () => get<Captcha>('/ops/auth/captcha'),
  login: (req: { username: string; password: string; captchaId: string; captchaCode: string }) =>
    post<OpsLoginResponse>('/ops/auth/login', req),
  me: () => get<AdminView>('/ops/me'),
  /** 成功后服务端会吊销全部会话，需重新登录 */
  changePassword: (oldPassword: string, newPassword: string) => put<void>('/ops/me/password', { oldPassword, newPassword }),

  pending: () => get<OpsPending>('/ops/pending'),

  companies: (params?: { status?: CompanyStatus; keyword?: string; page?: number; pageSize?: number }) =>
    get<PageResult<CompanyView>>('/ops/companies', params),
  company: (companyId: string) => get<CompanyDetail>(`/ops/companies/${companyId}`),
  approveCompany: (companyId: string, remark?: string) => post<CompanyView>(`/ops/companies/${companyId}/approve`, { remark }),
  rejectCompany: (companyId: string, remark: string) => post<CompanyView>(`/ops/companies/${companyId}/reject`, { remark }),
  /** NORMAL / THROTTLED / BANNED；限流、封禁必须填原因 */
  setCompanyStatus: (companyId: string, status: CompanyStatus, remark?: string) =>
    post<CompanyView>(`/ops/companies/${companyId}/status`, { status, remark }),

  contracts: (params?: { status?: ClientContractStatus; companyId?: string; page?: number; pageSize?: number }) =>
    get<PageResult<ContractView>>('/ops/client-contracts', params),
  approveContract: (contractId: string, remark?: string) => post<ContractView>(`/ops/client-contracts/${contractId}/approve`, { remark }),
  rejectContract: (contractId: string, remark: string) => post<ContractView>(`/ops/client-contracts/${contractId}/reject`, { remark }),

  jobs: (params?: { status?: JobStatus; companyId?: string; keyword?: string; page?: number; pageSize?: number }) =>
    get<PageResult<JobView>>('/ops/jobs', params),
  job: (jobId: string) => get<OpsJobDetail>(`/ops/jobs/${jobId}`),
  approveJob: (jobId: string, remark?: string) => post<JobView>(`/ops/jobs/${jobId}/approve`, { remark }),
  rejectJob: (jobId: string, remark: string) => post<JobView>(`/ops/jobs/${jobId}/reject`, { remark }),
  forceOfflineJob: (jobId: string, remark: string) => post<JobView>(`/ops/jobs/${jobId}/force-offline`, { remark }),

  /** 查看文件用 fetchFileUrl(opsApi.filePath, key) */
  filePath: '/ops/files',

  /** 题库 P-12 */
  quizVersions: () => get<QuizView[]>('/ops/quiz/versions'),
  quizVersion: (versionId: number) => get<QuizView>(`/ops/quiz/versions/${versionId}`),
  /** 从生效版本复制草稿（已有草稿时返回该草稿） */
  createQuizDraft: (name?: string) => post<QuizView>('/ops/quiz/drafts', { name }),
  /** 整体替换草稿题目（≤7 题、硬过滤题在前、必须含 accept_factory 与 locked_region） */
  saveQuizDraft: (versionId: number, name: string | undefined, questions: QuizQuestion[]) =>
    put<QuizView>(`/ops/quiz/versions/${versionId}`, { name, questions }),
  /** 发布草稿 / 回滚到归档版本（仅超管） */
  publishQuiz: (versionId: number) => post<QuizView>(`/ops/quiz/versions/${versionId}/publish`),
  matchSnapshot: (sessionId: string) => get<MatchSnapshot>(`/ops/match-sessions/${sessionId}`),

  admins: (params?: { keyword?: string; page?: number; pageSize?: number }) => get<PageResult<AdminView>>('/ops/admins', params),
  createAdmin: (req: { username: string; displayName: string; roles: OpsRole[] }) =>
    post<{ admin: AdminView; initialPassword: string }>('/ops/admins', req),
  updateAdmin: (adminId: string, req: { displayName: string; roles: OpsRole[] }) => put<AdminView>(`/ops/admins/${adminId}`, req),
  setAdminStatus: (adminId: string, status: MemberStatus) => post<AdminView>(`/ops/admins/${adminId}/status`, { status }),
  resetAdminPassword: (adminId: string) => post<{ initialPassword: string }>(`/ops/admins/${adminId}/reset-password`),

  auditLogs: (params?: {
    actorDomain?: string
    actorId?: string
    companyId?: string
    action?: string
    targetType?: string
    targetId?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }) => get<PageResult<AuditLogEntry>>('/ops/audit-logs', params),
}
