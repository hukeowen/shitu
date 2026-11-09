/** 公司后台菜单：沿用原型 admin.html 左侧导航。
 *  每个菜单项带 access：无权限的菜单项隐藏，组内无可见项则整组隐藏。
 *  Sprint 3/4：驻场组项目经理可查看；人才经纪人组驻场 / 项目经理只读；人员管理与离职申请驻场也可用（后端 SITE/PM 均放行）；
 *  流转账本后端仅老板可查（BILL_VIEW）；花名册导入（T-503）原型无独立页面，放在「项目经理」组。
 *  决策 D-25：薪酬预支审批（A-17）为「驻场初审 + 项目经理终审」双级，菜单从「劳务公司老板」移至「项目经理」；
 *  老板可登记拨款（后端 payout 放行 OWNER），所以老板也可见。
 *  Sprint 5：数据看板（T-306）驻场 / 项目经理；知识库（T-305）老板 + 项目经理；渠道转化（T-402）老板 + 项目经理；
 *  老板可只读查看报名（/tenant/applications）：待办清单 / 24h 监控对老板开放，行操作按 allowedActions（老板为空）。
 *  工资表导入（D-28 精简版，核算与代发放到 V1.5）占用「薪资核算与发放」菜单位置。 */
import type { TenantRole } from '@shitu/api-client'

/** 访问条件：拥有任一权限点 或 任一角色即可（与后端 TenantPermissions 口径一致） */
export interface Access {
  perms?: string[]
  roles?: TenantRole[]
}
export interface MenuItem {
  path: string
  title: string
  proto: string
  access?: Access
}
export interface MenuGroup {
  key: string
  title: string
  en: string
  items: MenuItem[]
}

export const APP_TITLE = '仕兔劳务工作台'

export const MENU: MenuGroup[] = [
  {
    key: 'site',
    title: '驻场',
    en: 'SITE REP',
    items: [
      { path: '/site/home', title: '驻场工作台', proto: 'A-01', access: { perms: ['SITE_WORKBENCH'], roles: ['PM'] } },
      { path: '/site/todo', title: '待办清单', proto: 'A-02', access: { perms: ['SITE_WORKBENCH'], roles: ['PM', 'OWNER'] } },
      { path: '/site/follow', title: '24h 响应监控', proto: 'A-03', access: { perms: ['SITE_WORKBENCH'], roles: ['PM', 'OWNER'] } },
      { path: '/site/onboard', title: '确权与签约', proto: 'A-04', access: { perms: ['ONBOARD_CONFIRM'] } },
    ],
  },
  {
    key: 'broker',
    title: '人才经纪人',
    en: 'BROKER',
    items: [
      { path: '/broker/pool', title: '流转池', proto: 'A-05', access: { perms: ['BROKER_WORKBENCH'], roles: ['SITE', 'PM'] } },
      { path: '/broker/report', title: 'AI 分析报告', proto: 'A-06', access: { perms: ['BROKER_WORKBENCH'], roles: ['SITE', 'PM'] } },
      { path: '/broker/rematch', title: '二次匹配 / 释放', proto: 'A-07', access: { perms: ['BROKER_WORKBENCH'], roles: ['SITE', 'PM'] } },
    ],
  },
  {
    key: 'payroll',
    title: '薪资发放',
    en: 'PAYROLL',
    items: [
      { path: '/payroll/batches', title: '工资表导入', proto: 'A-08', access: { roles: ['PM', 'OWNER'] } },
      { path: '/payroll/recon', title: '预支抵扣对账', proto: 'A-09', access: { roles: ['PM', 'OWNER'] } },
    ],
  },
  {
    key: 'circulation',
    title: '人才流转',
    en: 'CIRCULATION',
    items: [
      { path: '/circulation/ledger', title: '流转账本', proto: 'A-10', access: { perms: ['BILL_VIEW'] } },
      { path: '/circulation/people', title: '流转人员台账', proto: 'v-circulation-list', access: { roles: ['BROKER', 'PM', 'OWNER'] } },
    ],
  },
  {
    key: 'pm',
    title: '项目经理',
    en: 'PROJECT MGR',
    items: [
      { path: '/pm/board', title: '数据看板', proto: 'T-306', access: { perms: ['PM_WORKBENCH'], roles: ['SITE'] } },
      { path: '/pm/jobs', title: '岗位管理', proto: 'v-jobs', access: { perms: ['JOB_MANAGE', 'JOB_VIEW'] } },
      { path: '/pm/jobs/edit', title: '创建 / 编辑岗位', proto: 'v-job-edit', access: { perms: ['JOB_MANAGE'] } },
      { path: '/pm/kb', title: '知识库管理', proto: 'A-11', access: { perms: ['KB_MANAGE'], roles: ['OWNER'] } },
      { path: '/pm/staff', title: '人员管理', proto: 'A-12', access: { perms: ['STAFF_MANAGE', 'SITE_WORKBENCH'] } },
      { path: '/pm/resign', title: '离职审核', proto: 'A-13', access: { perms: ['RESIGN_AUDIT', 'SITE_WORKBENCH'] } },
      { path: '/pm/roster', title: '花名册导入', proto: 'T-503', access: { perms: ['ROSTER_IMPORT'] } },
      { path: '/pm/advance', title: '薪酬预支审批', proto: 'A-17', access: { perms: ['ADVANCE_FINAL_REVIEW', 'ADVANCE_FIRST_REVIEW'], roles: ['OWNER'] } },
    ],
  },
  {
    key: 'owner',
    title: '劳务公司老板',
    en: 'OWNER',
    items: [
      { path: '/owner/overview', title: '数据总览', proto: 'A-14', access: { perms: ['OWNER_DASHBOARD'] } },
      { path: '/owner/channel-report', title: '渠道转化报表', proto: 'A-15', access: { perms: ['OWNER_DASHBOARD'], roles: ['PM'] } },
      { path: '/owner/bills', title: '费用账单', proto: 'A-16', access: { perms: ['BILL_VIEW'] } },
    ],
  },
  {
    key: 'settings',
    title: '公司设置',
    en: 'SETTINGS',
    items: [
      { path: '/settings/projects', title: '项目与甲方', proto: 'T-301', access: { perms: ['PROJECT_MANAGE', 'PROJECT_VIEW'] } },
      { path: '/settings/channels', title: '渠道二维码', proto: 'A-18', access: { perms: ['CHANNEL_MANAGE', 'CHANNEL_MINE'] } },
      { path: '/settings/org', title: '组织与权限', proto: 'A-19', access: { perms: ['ORG_MANAGE'], roles: ['PM'] } },
    ],
  },
]
