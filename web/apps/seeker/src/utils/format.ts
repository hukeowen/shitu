/** 金额千分位（后端金额为 BigDecimal，如 5500.00） */
export function fmtMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function fmtSalary(min: number, max: number): string {
  if (min && max && Math.round(min) !== Math.round(max)) return `${fmtMoney(min)} – ${fmtMoney(max)}`
  return fmtMoney(max || min)
}

/** 匹配度取整（后端为 0–100 的小数） */
export function fmtScore(score: number): number {
  return Math.round(Number(score))
}

/** 匹配度徽标配色：≥85 绿色，80–84 橙色（原型 .match / .match.mid） */
export function scoreClass(score: number): string {
  return fmtScore(score) >= 85 ? '' : 'mid'
}

/** 吃住标签：包吃 / 包住 N 人间 / 空调 / 独卫 */
export function dormChips(j: {
  mealProvided: boolean
  dormProvided: boolean
  dormRoomSize?: number
  dormAircon?: boolean
  dormPrivateBath?: boolean
}): string[] {
  const out: string[] = []
  if (j.mealProvided && j.dormProvided) out.push('包吃包住')
  else if (j.mealProvided) out.push('包吃')
  else if (j.dormProvided) out.push('包住')
  if (j.dormProvided) {
    if (j.dormRoomSize) out.push(`${j.dormRoomSize} 人间`)
    if (j.dormAircon) out.push('空调')
    if (j.dormPrivateBath) out.push('独立卫浴')
  } else {
    out.push('不包住')
  }
  return out
}

/** 后端的自由文本（职责 / 福利）按换行或中文分号拆成多条 */
export function splitLines(s: string | null | undefined, extra = false): string[] {
  if (!s) return []
  const re = extra ? /[\n；;、，,]+/ : /[\n；;]+/
  return s
    .split(re)
    .map((x) => x.replace(/^[\s·•\-\d.、]+/, '').trim())
    .filter(Boolean)
}

/** 手机号可点击拨打：只保留数字；脱敏号码（含 *）不可拨 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone || phone.includes('*')) return null
  const d = phone.replace(/[^\d+]/g, '')
  return d.length >= 7 ? `tel:${d}` : null
}
