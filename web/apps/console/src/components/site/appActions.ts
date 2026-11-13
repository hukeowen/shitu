import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'
import { opsColWidth, type RowAction } from '@/utils/rowActions'

/** 报名行操作：严格按后端 allowedActions；未通过 / 爽约 / 取消固定收进「更多」 */
const LABEL: Record<SiteApplicationAction, string> = {
  ACKNOWLEDGE: '知悉推送',
  REPUSH: '修改面试信息',
  ARRIVE: '到厂确认',
  PASS: '面试通过',
  FAIL: '未通过',
  NO_SHOW: '爽约',
  CANCEL: '取消报名',
  CONFIRM: '确权签约',
  RESEND_CONTRACT: '重发签约',
}
/** 平铺顺序 = 当前最该做的在前：先知悉，再到厂 / 通过，修改面试信息靠后 */
const PRIMARY: SiteApplicationAction[] = ['ACKNOWLEDGE', 'CONFIRM', 'RESEND_CONTRACT', 'ARRIVE', 'PASS', 'REPUSH']
const MORE: SiteApplicationAction[] = ['FAIL', 'NO_SHOW', 'CANCEL']

export function appRowActions(app: SiteApplication): RowAction[] {
  const allowed = new Set(app.allowedActions as SiteApplicationAction[])
  return [
    ...PRIMARY.filter((a) => allowed.has(a)).map<RowAction>((a) => ({
      key: a,
      label: LABEL[a],
      type: a === 'ACKNOWLEDGE' || a === 'CONFIRM' || a === 'PASS' ? 'primary' : 'default',
      plain: a === 'PASS',
    })),
    ...MORE.filter((a) => allowed.has(a)).map<RowAction>((a) => ({ key: a, label: LABEL[a], more: true, type: a === 'CANCEL' ? 'default' : 'danger' })),
  ]
}

/** 操作列宽度；当前角色对列表里的报名都没有可用操作（如老板只读）时为 0，不渲染操作列 */
export function appOpsWidth(list: SiteApplication[]): number {
  return opsColWidth(list.map(appRowActions))
}
