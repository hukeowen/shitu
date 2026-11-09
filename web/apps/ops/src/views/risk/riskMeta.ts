/**
 * 风控页面的少量本地文案：后端 /dict 暂未提供诚信分规则码与处罚等级（见交付说明「建议补充字典」）。
 * 未知取值原样显示。
 */
export const CREDIT_RULES: Record<string, string> = {
  MANUAL: '人工调分',
  COMPLAINT_3X: '岗位投诉属实 3 次',
  STALE_JOB: '岗位长期未更新',
}
export const creditRuleLabel = (code?: string | null) => (code ? CREDIT_RULES[code] ?? code : '—')

export const PENALTY_LEVELS: Record<number, { label: string; desc: string; cls: string }> = {
  0: { label: '无处罚', desc: '', cls: 'tag--ok' },
  1: { label: '一级 · 警告', desc: '仅记录警告并通知企业，不影响曝光', cls: 'tag--warn' },
  2: { label: '二级 · 限流 30 天', desc: '30 天内岗位匹配权重按引擎参数中的二级处罚系数下调，到期自动解除', cls: 'tag--warn' },
  3: { label: '三级 · 封禁', desc: '公司状态改为封禁，并永久取消收费服务权限（不可自动恢复）', cls: 'tag--danger' },
}
export const penaltyLabel = (lv?: number | null) => PENALTY_LEVELS[lv ?? 0]?.label ?? `等级 ${lv}`

/** MySQL tinyint / boolean 统一判断 */
export const truthy = (v: unknown) => v === true || v === 1 || v === '1'
