import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'

/** 报名操作按钮文案（按钮只按后端 allowedActions 显示） */
export const ACTION_TEXT: Record<SiteApplicationAction, string> = {
  ACKNOWLEDGE: '知悉并推送面试信息',
  REPUSH: '修改面试信息',
  ARRIVE: '到厂确认',
  PASS: '面试通过',
  FAIL: '面试未通过',
  NO_SHOW: '标记爽约',
  CANCEL: '取消报名',
  CONFIRM: '入职确权 + 电子签',
  RESEND_CONTRACT: '查看签署码 / 重发',
}

const DANGER: SiteApplicationAction[] = ['FAIL', 'NO_SHOW', 'CANCEL']

export function has(app: SiteApplication, a: SiteApplicationAction): boolean {
  return app.allowedActions.includes(a)
}

export interface ActionBtn {
  key: SiteApplicationAction
  text: string
  type: 'primary' | 'default' | 'danger'
}

/**
 * 卡片主按钮（最多 2 个）与「更多」里的次要操作：
 * 已到厂 → 未通过 / 面试通过；未知悉 → 知悉推送；已知悉未到厂 → 到厂确认；待确权 → 确权签约 或 查看签署码。
 */
export function splitActions(app: SiteApplication): { main: ActionBtn[]; more: ActionBtn[] } {
  const allowed = app.allowedActions.filter((a): a is SiteApplicationAction => a in ACTION_TEXT)
  let main: SiteApplicationAction[] = []
  const result = has(app, 'PASS') || has(app, 'FAIL')
  // 已到厂：先录面试结果（即便还没推送面试信息）
  if (app.arrivedAt && result) main = (['FAIL', 'PASS'] as SiteApplicationAction[]).filter((a) => has(app, a))
  else if (has(app, 'ACKNOWLEDGE')) main = ['ACKNOWLEDGE']
  else if (has(app, 'ARRIVE')) main = ['ARRIVE']
  else if (result) main = (['FAIL', 'PASS'] as SiteApplicationAction[]).filter((a) => has(app, a))
  else if (has(app, 'CONFIRM')) main = ['CONFIRM']
  else if (has(app, 'RESEND_CONTRACT')) main = ['RESEND_CONTRACT']
  const btn = (k: SiteApplicationAction, inMain: boolean): ActionBtn => ({
    key: k,
    text: inMain && k === 'FAIL' ? '未通过' : ACTION_TEXT[k],
    type: inMain ? (k === 'FAIL' ? 'default' : 'primary') : DANGER.includes(k) ? 'danger' : 'default',
  })
  return {
    main: main.map((k) => btn(k, true)),
    more: allowed.filter((a) => !main.includes(a)).map((k) => btn(k, false)),
  }
}

/** 合同状态徽标配色：统一定义在 utils/status */
export { CONTRACT_TAG } from '@/utils/status'
