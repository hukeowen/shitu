/** 身份证号前端校验（GB 11643：18 位 + 校验码）。后端会再次校验并做二要素核验。 */
const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const C = '10X98765432'

export const ID_RE = /^\d{17}[\dX]$/
/** 2–20 个汉字，允许少数民族姓名中的间隔号 */
export const NAME_RE = /^[一-龥][一-龥·]{0,18}[一-龥]$/

export function normalizeId(v: string): string {
  return v.replace(/\s/g, '').toUpperCase().replace(/[^\dX]/g, '').slice(0, 18)
}

export function idChecksumOk(id: string): boolean {
  if (!ID_RE.test(id)) return false
  let s = 0
  for (let i = 0; i < 17; i++) s += W[i] * Number(id[i])
  if (C[s % 11] !== id[17]) return false
  const m = Number(id.slice(10, 12))
  const d = Number(id.slice(12, 14))
  return m >= 1 && m <= 12 && d >= 1 && d <= 31
}

/** 两次输入不一致的位置（从 1 开始），用于 S-22 提示「第 17、18 位不一致」 */
export function diffPositions(a: string, b: string): number[] {
  const out: number[] = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i + 1)
  return out
}
