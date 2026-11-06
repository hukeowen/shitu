/** 公司后台菜单：沿用原型 admin.html 左侧导航。
 *  决策 D-25：薪酬预支审批（A-17）为「驻场初审 + 项目经理终审」双级，菜单从「劳务公司老板」移至「项目经理」。 */
export interface MenuItem {
  path: string
  title: string
  proto: string
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
      { path: '/site/home', title: '驻场工作台', proto: 'A-01' },
      { path: '/site/todo', title: '待办清单', proto: 'A-02' },
      { path: '/site/follow', title: '24h 响应监控', proto: 'A-03' },
      { path: '/site/onboard', title: '确权与签约', proto: 'A-04' },
    ],
  },
  {
    key: 'broker',
    title: '人才经纪人',
    en: 'BROKER',
    items: [
      { path: '/broker/pool', title: '流转池', proto: 'A-05' },
      { path: '/broker/report', title: 'AI 分析报告', proto: 'A-06' },
      { path: '/broker/rematch', title: '二次匹配 / 释放', proto: 'A-07' },
    ],
  },
  {
    key: 'payroll',
    title: '薪资发放',
    en: 'PAYROLL',
    items: [
      { path: '/payroll/batches', title: '薪资核算与发放', proto: 'A-08' },
      { path: '/payroll/recon', title: '预支抵扣对账', proto: 'A-09' },
    ],
  },
  {
    key: 'circulation',
    title: '人才流转',
    en: 'CIRCULATION',
    items: [
      { path: '/circulation/ledger', title: '流转账本', proto: 'A-10' },
      { path: '/circulation/people', title: '流转人员台账', proto: 'v-circulation-list' },
    ],
  },
  {
    key: 'pm',
    title: '项目经理',
    en: 'PROJECT MGR',
    items: [
      { path: '/pm/board', title: '数据看板', proto: 'v-pm-board' },
      { path: '/pm/jobs', title: '岗位管理', proto: 'v-jobs' },
      { path: '/pm/jobs/edit', title: '创建 / 编辑岗位', proto: 'v-job-edit' },
      { path: '/pm/kb', title: '知识库管理', proto: 'A-11' },
      { path: '/pm/staff', title: '人员管理', proto: 'A-12' },
      { path: '/pm/resign', title: '离职审核', proto: 'A-13' },
      { path: '/pm/advance', title: '薪酬预支审批', proto: 'A-17' },
    ],
  },
  {
    key: 'owner',
    title: '劳务公司老板',
    en: 'OWNER',
    items: [
      { path: '/owner/overview', title: '数据总览', proto: 'A-14' },
      { path: '/owner/channel-report', title: '渠道转化报表', proto: 'A-15' },
      { path: '/owner/bills', title: '费用账单', proto: 'A-16' },
    ],
  },
  {
    key: 'settings',
    title: '公司设置',
    en: 'SETTINGS',
    items: [
      { path: '/settings/channels', title: '渠道二维码', proto: 'A-18' },
      { path: '/settings/org', title: '组织与权限', proto: 'A-19' },
    ],
  },
]
