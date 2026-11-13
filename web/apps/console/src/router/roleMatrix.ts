/**
 * 「角色权限矩阵」（组织与权限页）的数据来源。
 * 不再手写一张静态表，而是和路由守卫用同一套规则推导：
 *   - 页面能不能进：menu.ts 的 access + access.ts 的 canAccess；
 *   - 能不能操作：权限点。当前登录人的角色用 /tenant/me 返回的 permissions；
 *     其余角色用 ROLE_PERMS（后端 TenantPermissions 的镜像，后端调整权限点时这里要同步）。
 *   - 少数由后端按角色直接放行、没有对应权限点的能力（老板登记拨款、老板维护公司通用知识库等）写在行的 note / byRole 里。
 */
import type { TenantMe, TenantRole } from '@shitu/api-client'
import { canAccess } from './access'
import { MENU, type Access } from './menu'

export const MATRIX_ROLES: TenantRole[] = ['SITE', 'BROKER', 'PM', 'OWNER']

/** 后端 TenantPermissions.MATRIX 的镜像 */
export const ROLE_PERMS: Record<TenantRole, string[]> = {
  SITE: ['SITE_WORKBENCH', 'PROFILE_VIEW', 'AI_PROFILE_VIEW', 'PHONE_FULL_VIEW', 'ONBOARD_CONFIRM', 'NO_SHOW_MARK', 'APPLICATION_CANCEL', 'TRANSFER_TO_BROKER', 'RELEASE', 'ADVANCE_FIRST_REVIEW', 'PROJECT_VIEW', 'CHANNEL_MINE'],
  BROKER: ['BROKER_WORKBENCH', 'PROFILE_VIEW', 'AI_PROFILE_VIEW', 'RELEASE', 'PROJECT_VIEW', 'JOB_VIEW', 'CHANNEL_MINE'],
  PM: ['PM_WORKBENCH', 'PROFILE_VIEW', 'ONBOARD_CONFIRM', 'NO_SHOW_MARK', 'APPLICATION_CANCEL', 'TRANSFER_TO_BROKER', 'JOB_MANAGE', 'JOB_VIEW', 'KB_MANAGE', 'RESIGN_AUDIT', 'ADVANCE_FINAL_REVIEW', 'PROJECT_MANAGE', 'PROJECT_VIEW', 'CLIENT_CONTRACT_MANAGE', 'CHANNEL_MANAGE', 'CHANNEL_MINE', 'ROSTER_IMPORT', 'STAFF_MANAGE'],
  OWNER: ['OWNER_DASHBOARD', 'BILL_VIEW', 'ORG_MANAGE', 'COMPANY_PROFILE', 'PROJECT_MANAGE', 'PROJECT_VIEW', 'JOB_VIEW', 'CLIENT_CONTRACT_MANAGE', 'CHANNEL_MANAGE', 'CHANNEL_MINE'],
}

/** op 可操作 / ro 只读 / no 无；text 为补充说明（如「初审」「仅公司通用」） */
export interface MatrixCell {
  level: 'op' | 'ro' | 'no'
  text?: string
}
export interface MatrixRow {
  group: string
  cap: string
  cells: MatrixCell[]
}

interface RowDef {
  group: string
  cap: string
  /** 拥有任一权限点 = 可操作 */
  op?: string[]
  /** 能进入该页面（按 menu.ts 的 access）但没有操作权限点 = 只读；没有 op 的纯查看页面，能进入即为可操作 */
  page?: string
  /** 后端按角色直接放行、没有权限点的情况 */
  byRole?: Partial<Record<TenantRole, MatrixCell>>
  /** 可操作时的补充说明 */
  note?: Partial<Record<TenantRole, string>>
}

const DEFS: RowDef[] = [
  { group: '求职者数据', cap: '查看完整手机号', op: ['PHONE_FULL_VIEW'] },
  { group: '求职者数据', cap: '查看用工档案', op: ['PROFILE_VIEW'] },
  { group: '求职者数据', cap: '查看 AI 画像', op: ['AI_PROFILE_VIEW'] },

  { group: '招聘过程', cap: '待办清单 / 24h 响应监控', op: ['SITE_WORKBENCH', 'ONBOARD_CONFIRM'], page: '/site/todo' },
  { group: '招聘过程', cap: '到厂确认 / 入职确权', op: ['ONBOARD_CONFIRM'] },
  { group: '招聘过程', cap: '标记爽约', op: ['NO_SHOW_MARK'] },
  { group: '招聘过程', cap: '取消报名', op: ['APPLICATION_CANCEL'] },
  { group: '招聘过程', cap: '流转至经纪人', op: ['TRANSFER_TO_BROKER'] },
  { group: '招聘过程', cap: '流转池（联系 / 推荐岗位）', op: ['BROKER_WORKBENCH'], page: '/broker/pool' },
  { group: '招聘过程', cap: '释放至公域', op: ['RELEASE'] },

  { group: '项目与人员', cap: '岗位管理', op: ['JOB_MANAGE'], page: '/pm/jobs' },
  { group: '项目与人员', cap: '知识库', op: ['KB_MANAGE'], page: '/pm/kb', byRole: { OWNER: { level: 'op', text: '含公司通用条目' } } },
  { group: '项目与人员', cap: '人员管理（请假旷工 / 发起离职）', op: ['STAFF_MANAGE', 'SITE_WORKBENCH'], page: '/pm/staff', note: { PM: '含调岗' } },
  { group: '项目与人员', cap: '离职审核', op: ['RESIGN_AUDIT'], page: '/pm/resign' },
  { group: '项目与人员', cap: '花名册导入', op: ['ROSTER_IMPORT'], page: '/pm/roster' },
  { group: '项目与人员', cap: '工伤上报', page: '/pm/incidents', note: { SITE: '上报', PM: '上报 / 结案', OWNER: '结案' } },

  { group: '薪资与预支', cap: '预支审批', op: ['ADVANCE_FIRST_REVIEW', 'ADVANCE_FINAL_REVIEW'], page: '/pm/advance', note: { SITE: '初审', PM: '终审 / 登记拨款' }, byRole: { OWNER: { level: 'op', text: '查看 / 登记拨款' } } },
  { group: '薪资与预支', cap: '工资表导入 / 工资申诉 / 预支对账', page: '/payroll/batches' },

  { group: '经营数据', cap: '数据看板', page: '/pm/board' },
  { group: '经营数据', cap: '渠道转化报表', page: '/owner/channel-report' },
  { group: '经营数据', cap: '数据总览', page: '/owner/overview' },
  { group: '经营数据', cap: '费用账单 / 流转账本', page: '/owner/bills' },

  { group: '公司设置', cap: '项目 / 甲方合同管理', op: ['PROJECT_MANAGE'], page: '/settings/projects' },
  { group: '公司设置', cap: '渠道二维码', op: ['CHANNEL_MANAGE'], page: '/settings/channels', byRole: { SITE: { level: 'op', text: '仅本人的码' }, BROKER: { level: 'op', text: '仅本人的码' } } },
  { group: '公司设置', cap: '组织与权限（成员管理）', op: ['ORG_MANAGE'], page: '/settings/org' },
]

const PAGE_ACCESS = new Map<string, Access | undefined>(MENU.flatMap((g) => g.items.map((it) => [it.path, it.access] as const)))

export function buildRoleMatrix(me: TenantMe | null | undefined): MatrixRow[] {
  /** 当前登录人只有一个角色时，该角色直接用接口返回的权限点 */
  const permsOf = (r: TenantRole) => (me && me.roles.length === 1 && me.roles[0] === r ? me.permissions : ROLE_PERMS[r])
  return DEFS.map((d) => ({
    group: d.group,
    cap: d.cap,
    cells: MATRIX_ROLES.map<MatrixCell>((r) => {
      const fixed = d.byRole?.[r]
      if (fixed) return fixed
      const perms = permsOf(r)
      const pageOk = d.page ? canAccess({ roles: [r], permissions: perms } as unknown as TenantMe, PAGE_ACCESS.get(d.page)) : false
      const opOk = d.op ? d.op.some((p) => perms.includes(p)) : pageOk
      if (opOk) return { level: 'op', text: d.note?.[r] }
      return pageOk ? { level: 'ro' } : { level: 'no' }
    }),
  }))
}
