import type { OpsRole } from '@shitu/api-client'

/** 平台运营中台菜单：沿用原型 platform.html 左侧导航。部署在内网域名 + IP 白名单（docs/02 §3）。 */
export interface MenuItem {
  path: string
  title: string
  proto: string
  /** 可见角色；不填 = 所有平台账号可见（Sprint 1 未实现的占位页） */
  roles?: OpsRole[]
  /** 侧边栏待办角标 */
  badge?: 'companies' | 'jobAudit'
  /** Sprint 1 已实现 */
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
      { path: '/ops/overview', title: '运营总览', proto: 'P-01' },
      { path: '/ops/attribution', title: '归属治理', proto: 'P-08' },
    ],
  },
  {
    key: 'engine',
    title: '匹配引擎',
    en: 'ENGINE',
    items: [
      { path: '/engine/quiz', title: 'AI 问薪题库', proto: 'P-12' },
      { path: '/engine/params', title: '匹配引擎参数', proto: 'P-13' },
    ],
  },
  {
    key: 'companies',
    title: '企业',
    en: 'COMPANIES',
    items: [
      { path: '/companies/list', title: '公司管理', proto: 'P-02', roles: PENDING_ROLES, badge: 'companies', ready: true },
      { path: '/companies/stock', title: '花名册与存量锁定', proto: 'P-03' },
    ],
  },
  {
    key: 'governance',
    title: '治理',
    en: 'GOVERNANCE',
    items: [
      { path: '/governance/job-audit', title: '岗位审核', proto: 'P-04', roles: PENDING_ROLES, badge: 'jobAudit', ready: true },
      { path: '/governance/throttle', title: '降权与限流', proto: 'P-05' },
      { path: '/governance/compliance', title: '实名与合规', proto: 'P-14' },
      { path: '/governance/complaints', title: '投诉管理', proto: 'P-06' },
      { path: '/governance/credit', title: '诚信与处罚', proto: 'P-07' },
    ],
  },
  {
    key: 'settlement',
    title: '结算',
    en: 'SETTLEMENT',
    items: [
      { path: '/settlement/rules', title: '计费规则', proto: 'P-09' },
      { path: '/settlement/bills', title: '对账管理', proto: 'P-10' },
      { path: '/settlement/audit', title: '审计日志', proto: 'P-11', roles: AUDIT_LOG_ROLES, ready: true },
    ],
  },
  {
    key: 'system',
    title: '系统',
    en: 'SYSTEM',
    items: [{ path: '/system/admins', title: '平台账号', proto: 'P-15', roles: ADMIN_ROLES, ready: true }],
  },
]
