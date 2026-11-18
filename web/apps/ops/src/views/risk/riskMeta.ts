/**
 * 风控页面的本地文案：处罚等级需要带说明与样式，诚信规则作为字典（CreditRule）缺失时的兜底。
 * 未知取值原样显示。
 */
export const CREDIT_RULES: Record<string, string> = {
  MANUAL: '人工调分',
  COMPLAINT_3X: '岗位投诉属实 3 次',
  STALE_JOB: '岗位长期未更新',
  FRAUD_REGISTER: '刷单注册',
}
export const creditRuleLabel = (code?: string | null) => (code ? CREDIT_RULES[code] ?? code : '—')

/** tone 是共享状态标签的色调（status-tag--{tone}），降权与限流、诚信与处罚两页共用 */
export const PENALTY_LEVELS: Record<number, { label: string; desc: string; tone: 'success' | 'warning' | 'danger' }> = {
  0: { label: '无处罚', desc: '', tone: 'success' },
  1: { label: '一级 · 警告', desc: '仅记录警告并通知企业，不影响曝光', tone: 'warning' },
  2: { label: '二级 · 限流 30 天', desc: '30 天内岗位匹配权重按引擎参数中的二级处罚系数下调，到期自动解除', tone: 'warning' },
  3: { label: '三级 · 封禁', desc: '公司状态改为封禁，并永久取消收费服务权限（不可自动恢复）', tone: 'danger' },
}
/** 处罚等级的共享状态标签类 */
export const penaltyTone = (lv?: number | null) => `status-tag--${PENALTY_LEVELS[lv ?? 0]?.tone ?? 'neutral'}`
export const penaltyLabel = (lv?: number | null) => PENALTY_LEVELS[lv ?? 0]?.label ?? `等级 ${lv}`

/** MySQL tinyint / boolean 统一判断 */
export const truthy = (v: unknown) => v === true || v === 1 || v === '1'
