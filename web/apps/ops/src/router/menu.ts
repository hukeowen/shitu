import type { OpsRole } from '@shitu/api-client'

/** 平台运营中台菜单：沿用原型 platform.html 左侧导航。部署在内网域名 + IP 白名单（docs/02 §3）。 */
export interface MenuItem {
  path: string
  title: string
  proto: string
  /** 可见角色；不填 = 所有平台账号可见（未实现的占位页） */
  roles?: OpsRole[]
  /** 侧边栏待办角标 */
  badge?: 'companies' | 'jobAudit'
  /** 已实现（未实现的显示「待建」占位页） */
  ready?: boolean
}
export interface MenuGroup {
  key: string
  title: string
  en: string
  items: MenuItem[]
}

export const APP_TITLE = '仕兔运营中台'

/** 待办 / 公司 / 岗位 / 合同接口的角色（后端 OpsTenantController：SUPER、OPERATOR） */
export const PENDING_ROLES: OpsRole[] = ['SUPER', 'OPERATOR']
export const AUDIT_LOG_ROLES: OpsRole[] = ['SUPER', 'RISK']
export const ADMIN_ROLES: OpsRole[] = ['SUPER']
/** 题库 P-12（后端 OpsMatchingController）：查看 / 编辑草稿 SUPER、OPERATOR；发布 / 回滚仅 SUPER */
export const QUIZ_ROLES: OpsRole[] = ['SUPER', 'OPERATOR']
export const QUIZ_PUBLISH_ROLES: OpsRole[] = ['SUPER']
/** 匹配快照（解释 / 回放） */
export const SNAPSHOT_ROLES: OpsRole[] = ['SUPER', 'RISK', 'OPERATOR']
/** 运营总览 P-01（ReportController）：全部平台角色 */
export const OVERVIEW_ROLES: OpsRole[] = ['SUPER', 'OPERATOR', 'FINANCE', 'RISK']
/** 归属治理 P-08（OpsGovernanceController） */
export const ATTRIBUTION_ROLES: OpsRole[] = ['SUPER', 'OPERATOR', 'RISK']
/** 存量基数与免费期 P-03 */
export const STOCK_ROLES: OpsRole[] = ['SUPER', 'FINANCE', 'OPERATOR']
/** 对账 P-10 / 计费规则查看 P-09 / 重算日计费（OpsBillingController、OpsGovernanceController） */
export const BILLING_ROLES: OpsRole[] = ['SUPER', 'FINANCE']
/** 新增计费规则、生成并下发月账单：仅超管 */
export const BILLING_SUPER_ROLES: OpsRole[] = ['SUPER']
/** 风控 P-05/06/07（OpsRiskController）与实名合规 P-14（OpsConfigController） */
export const RISK_ROLES: OpsRole[] = ['SUPER', 'RISK']
/** 匹配引擎参数 P-13：查看 / 编辑草稿 SUPER、OPERATOR；发布 / 回滚仅 SUPER */
export const ENGINE_ROLES: OpsRole[] = ['SUPER', 'OPERATOR']
export const ENGINE_PUBLISH_ROLES: OpsRole[] = ['SUPER']
/** 通知模板 P-16 */
export const TEMPLATE_ROLES: OpsRole[] = ['SUPER', 'OPERATOR']

export const HOME_PATH = '/workbench'

export const MENU: MenuGroup[] = [
  {
    key: 'home',
    title: '工作台',
    en: 'WORKBENCH',
    items: [{ path: HOME_PATH, title: '工作台', proto: '待办', ready: true }],
  },
  {
    key: 'ops',
    title: '运营',
    en: 'OPERATIONS',
    items: [
      { path: '/ops/overview', title: '运营总览', proto: 'P-01', roles: OVERVIEW_ROLES, ready: true },
      { path: '/ops/attribution', title: '归属治理', proto: 'P-08', roles: ATTRIBUTION_ROLES, ready: true },
    ],
  },
  {
    key: 'engine',
    title: '匹配引擎',
    en: 'ENGINE',
    items: [
      { path: '/engine/quiz', title: 'AI 问薪题库', proto: 'P-12', roles: QUIZ_ROLES, ready: true },
      { path: '/engine/match-snapshot', title: '匹配快照查询', proto: 'P-12', roles: SNAPSHOT_ROLES, ready: true },
      { path: '/engine/params', title: '匹配引擎参数', proto: 'P-13', roles: ENGINE_ROLES, ready: true },
    ],
  },
  {
    key: 'companies',
    title: '企业',
    en: 'COMPANIES',
    items: [
      { path: '/companies/list', title: '公司管理', proto: 'P-02', roles: PENDING_ROLES, badge: 'companies', ready: true },
      { path: '/companies/stock', title: '花名册与存量锁定', proto: 'P-03', roles: STOCK_ROLES, ready: true },
    ],
  },
  {
    key: 'governance',
    title: '治理',
    en: 'GOVERNANCE',
    items: [
      { path: '/governance/job-audit', title: '岗位审核', proto: 'P-04', roles: PENDING_ROLES, badge: 'jobAudit', ready: true },
      { path: '/governance/throttle', title: '降权与限流', proto: 'P-05', roles: RISK_ROLES, ready: true },
      { path: '/governance/compliance', title: '实名与合规', proto: 'P-14', roles: RISK_ROLES, ready: true },
      { path: '/governance/complaints', title: '投诉管理', proto: 'P-06', roles: RISK_ROLES, ready: true },
      { path: '/governance/feedback', title: '问题反馈', proto: 'C-508', roles: ['SUPER', 'OPERATOR'], ready: true },
      { path: '/governance/credit', title: '诚信与处罚', proto: 'P-07', roles: RISK_ROLES, ready: true },
    ],
  },
  {
    key: 'settlement',
    title: '结算',
    en: 'SETTLEMENT',
    items: [
      { path: '/settlement/rules', title: '计费规则', proto: 'P-09', roles: BILLING_ROLES, ready: true },
      { path: '/settlement/bills', title: '对账管理', proto: 'P-10', roles: BILLING_ROLES, ready: true },
      { path: '/settlement/audit', title: '审计日志', proto: 'P-11', roles: AUDIT_LOG_ROLES, ready: true },
    ],
  },
  {
    key: 'system',
    title: '系统',
    en: 'SYSTEM',
    items: [
      { path: '/system/admins', title: '平台账号', proto: 'P-15', roles: ADMIN_ROLES, ready: true },
      { path: '/system/templates', title: '通知模板', proto: 'P-16', roles: TEMPLATE_ROLES, ready: true },
    ],
  },
]
