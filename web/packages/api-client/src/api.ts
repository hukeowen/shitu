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
  BillDispute,
  AdvanceStatus,
  LaborContractView,
  ConfirmOnboardRequest,
  StaffRow,
  DutyAbsenceView,
  MyWork,
  BrokerCaseRow,
  BrokerReport,
  MyRecommendation,
  ResignRow,
  RosterBatchResult,
  RosterBatch,
  MonthlyBill,
  BillDetail,
  LedgerLine,
  DailyBillingResult,
  BillingRuleRow,
  CompanyCloseResult,
  BillStatus,
  AdvanceQuota,
  AdvanceRow,
  DebtLogEntry,
  Payslip,
  PayrollBatchResult,
  ComplaintCategory,
  SeekerLoginResponse,
  SeekerProfile,
  SmsSendResult,
  TenantLoginResponse,
  TenantMe,
  TenantRole,
  TokenResponse,
  UploadedFile,
  PmBoard,
  OwnerOverview,
  ChannelFunnelRow,
  OpsOverview,
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

  /** 我的工作（C-505），没有任职返回 null */
  work: () => get<MyWork | null>('/seeker/work'),
  /** 我的合同（C-503） */
  contracts: () => get<LaborContractView[]>('/seeker/contracts'),
  /** 待签署合同（含 signUrl），没有返回 null */
  pendingContract: () => get<LaborContractView | null>('/seeker/contracts/pending'),
  /** 【仅开发环境】模拟签署（Mock 电子签） */
  mockSign: (flowId: string) => post<void>(`/seeker/esign/mock/${flowId}/sign`),

  /** 专属顾问推荐的岗位（T-203）；推荐的岗位可以打开详情并报名 */
  recommendations: () => get<MyRecommendation[]>('/seeker/recommendations'),
  decideRecommendation: (id: number, accept: boolean) => post<void>(`/seeker/recommendations/${id}/decision`, { accept }),

  /** 预支额度（C-601） */
  advanceQuota: () => get<AdvanceQuota>('/seeker/advance/quota'),
  /** 发起预支（C-602）；不满足条件抛 ADV_4001，message 为原因 */
  applyAdvance: () => post<string>('/seeker/advance'),
  /** 预支记录与审批进度（C-603 / C-604） */
  myAdvances: () => get<AdvanceRow[]>('/seeker/advance'),
  debtLog: () => get<DebtLogEntry[]>('/seeker/advance/debt-log'),
  /** 工资条（C-701） */
  payslips: () => get<Payslip[]>('/seeker/payslips'),
  /** 岗位投诉（C-402）：只能投诉匹配到或报名过的岗位 */
  complain: (jobId: string, category: ComplaintCategory, content?: string) =>
    post<number>('/seeker/complaints', { jobId, category, content }),
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

  reportBoard: () => get<PmBoard>('/tenant/reports/board'),
  reportOverview: () => get<OwnerOverview>('/tenant/reports/overview'),
  reportChannels: () => get<ChannelFunnelRow[]>('/tenant/reports/channels'),

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

  /** 到厂确认 */
  arrive: (applicationId: string) => post<SiteApplication>(`/tenant/applications/${applicationId}/arrive`),
  /** 面试结果：未通过必须填 remark（LC_4004） */
  interviewResult: (applicationId: string, pass: boolean, remark?: string) =>
    post<void>(`/tenant/applications/${applicationId}/result`, { pass, remark }),
  /** 爽约（仅驻场） */
  noShow: (applicationId: string, remark?: string) => post<void>(`/tenant/applications/${applicationId}/no-show`, { remark }),
  /** 后台取消（必填原因） */
  cancelApplication: (applicationId: string, reason: string) =>
    post<void>(`/tenant/applications/${applicationId}/cancel`, { reason }),
  /** 入职确权并发起电子签（RESEND_CONTRACT 时同样调用：作废旧流程重发） */
  confirmOnboard: (applicationId: string, req?: ConfirmOnboardRequest) =>
    post<LaborContractView>(`/tenant/applications/${applicationId}/confirm`, req ?? {}),
  /** 人员管理（T-307）：keyword 支持工号或完整手机号 */
  employments: (params?: { active?: boolean; projectId?: string; keyword?: string; page?: number; pageSize?: number }) =>
    get<PageResult<StaffRow>>('/tenant/employments', params),
  /** 内部调岗（仅项目经理） */
  transfer: (employmentId: string, projectId: string, jobId?: string) =>
    post<void>(`/tenant/employments/${employmentId}/transfer`, { projectId, jobId }),
  /** 请假 / 旷工标记，type 不传 = 撤销 */
  markAbsence: (employmentId: string, date: string, type?: 'LEAVE' | 'ABSENT', remark?: string) =>
    put<void>(`/tenant/employments/${employmentId}/absences`, { date, type, remark }),
  absences: (employmentId: string, from: string, to: string) =>
    get<DutyAbsenceView[]>(`/tenant/employments/${employmentId}/absences`, { from, to }),

  /** 流转池（T-201）：status 不传 = 未结工单 */
  brokerCases: (status?: string) => get<BrokerCaseRow[]>('/tenant/broker/cases', { status }),
  brokerContact: (id: number) => post<BrokerCaseRow>(`/tenant/broker/cases/${id}/contact`),
  brokerReport: (id: number) => post<BrokerReport>(`/tenant/broker/cases/${id}/report`),
  brokerLatestReport: (id: number) => get<BrokerReport | null>(`/tenant/broker/cases/${id}/report`),
  brokerRecommend: (id: number, jobId: string, note?: string) =>
    post<BrokerCaseRow>(`/tenant/broker/cases/${id}/recommend`, { jobId, note }),
  /** 释放至公域（必填原因，T-204） */
  brokerRelease: (id: number, reason: string) => post<void>(`/tenant/broker/cases/${id}/release`, { reason }),
  /** 驻场 / 项目经理一键流转（M-09，私域待匹配用户） */
  transferToBroker: (userId: string) => post<number>(`/tenant/seekers/${userId}/transfer-to-broker`),

  /** 离职（T-308）：驻场 / 项目经理发起，项目经理审核 */
  requestResign: (employmentId: string, resignDate: string, reason?: string) =>
    post<number>(`/tenant/employments/${employmentId}/resign`, { resignDate, reason }),
  resignRequests: (status?: 'PENDING' | 'APPROVED' | 'REJECTED') => get<ResignRow[]>('/tenant/resign-requests', { status }),
  decideResign: (id: number, approve: boolean, remark?: string) =>
    post<void>(`/tenant/resign-requests/${id}/decide`, { approve, remark }),

  /** 花名册（T-503，项目经理）。模板 / 失败行用 fetchFileUrl 风格的 blob 下载：http.get(path, { responseType: 'blob' }) */
  rosterTemplatePath: '/tenant/roster/template',
  rosterImport: (file: File) => upload<RosterBatchResult>('/tenant/roster/import', file),
  rosterBatches: () => get<RosterBatch[]>('/tenant/roster/batches'),
  rosterFailedPath: (batchId: string) => `/tenant/roster/batches/${batchId}/failed`,

  /** 费用账单 T-403 / 流转账本 T-404（老板） */
  bills: (page = 1, pageSize = 12) => get<PageResult<MonthlyBill>>('/tenant/bills', { page, pageSize }),
  bill: (billId: string) => get<BillDetail>(`/tenant/bills/${billId}`),
  disputeBill: (billId: string, content: string) => post<BillDispute>(`/tenant/bills/${billId}/disputes`, { content }),
  /** month：YYYY-MM */
  ledger: (month: string) => get<LedgerLine[]>('/tenant/ledger', { month }),

  /** 预支审批（驻场初审 M-11 / 项目经理终审 T-309 / 登记拨款） */
  advances: (status?: AdvanceStatus) => get<AdvanceRow[]>('/tenant/advances', { status }),
  siteReviewAdvance: (id: string, approve: boolean, opinion?: string) =>
    post<void>(`/tenant/advances/${id}/site-review`, { approve, opinion }),
  pmReviewAdvance: (id: string, approve: boolean, opinion?: string) =>
    post<void>(`/tenant/advances/${id}/pm-review`, { approve, opinion }),
  payoutAdvance: (id: string) => post<void>(`/tenant/advances/${id}/payout`),
  /** 工资表导入（.xlsx：手机号、工号、应发、社保、个税、其他扣款），month：YYYY-MM */
  importPayroll: (file: File, month: string) => upload<PayrollBatchResult>('/tenant/payroll/import', file, { month }),
  payrollBatches: () => get<Record<string, unknown>[]>('/tenant/payroll/batches'),
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

  /** 对账 P-10（超管 / 财务） */
  bills: (params?: { companyId?: string; status?: BillStatus; month?: string; page?: number; pageSize?: number }) =>
    get<PageResult<MonthlyBill>>('/ops/bills', params),
  bill: (billId: string) => get<BillDetail>(`/ops/bills/${billId}`),
  replyDispute: (disputeId: number, accept: boolean, reply: string) =>
    post<void>(`/ops/disputes/${disputeId}/reply`, { accept, reply }),
  settleBill: (billId: string) => post<void>(`/ops/bills/${billId}/settle`),
  /** 重算某天计费（date：yyyy-MM-dd） */
  rerunDaily: (date: string) => request<DailyBillingResult>({ method: 'POST', url: '/ops/billing/daily', params: { date } }),
  /** 生成并下发某月账单（仅超管） */
  issueMonthly: (month: string) => request<number>({ method: 'POST', url: '/ops/billing/monthly', params: { month } }),
  /** 计费规则 P-09 */
  billingRules: () => get<BillingRuleRow[]>('/ops/billing/rules'),
  addBillingRule: (req: { effectiveFrom: string; serviceUnitPrice: number; transferUnitPrice: number; supplyShare: number; freeMonths: number }) =>
    post<number>('/ops/billing/rules', req),
  /** 存量基数与免费期 P-03 */
  stockBases: (companyId?: string) => get<Record<string, unknown>[]>('/ops/stock-bases', { companyId }),
  /** 归属治理 P-08 */
  attribution: (params: { phone?: string; userId?: string }) => get<Record<string, unknown>>('/ops/attribution', params),
  /** 风控（超管 / 风控） */
  complaints: (status?: 'PENDING' | 'VERIFIED' | 'REJECTED') => get<Record<string, unknown>[]>('/ops/complaints', { status }),
  handleComplaint: (id: number, verified: boolean, remark: string) =>
    post<void>(`/ops/complaints/${id}/handle`, { verified, remark }),
  companyCredit: (companyId: string) => get<Record<string, unknown>>(`/ops/companies/${companyId}/credit`),
  adjustCredit: (companyId: string, delta: number, remark: string) =>
    post<number>(`/ops/companies/${companyId}/credit`, { delta, remark }),
  penalize: (companyId: string, level: 1 | 2 | 3, reason: string) =>
    post<void>(`/ops/companies/${companyId}/penalty`, { level, reason }),
  penalties: () => get<Record<string, unknown>[]>('/ops/penalties'),
  /** 岗位真实权重（P-05，仅平台可见） */
  jobWeights: (companyId?: string) => get<Record<string, unknown>[]>('/ops/job-weights', { companyId }),
  /** 公司注销 / 倒闭（不可逆，仅超管） */
  closeCompany: (companyId: string, status: 'DEREGISTERED' | 'BANKRUPT', remark: string) =>
    post<CompanyCloseResult>(`/ops/companies/${companyId}/close`, { status, remark }),

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

  overview: () => get<OpsOverview>('/ops/reports/overview'),
}
