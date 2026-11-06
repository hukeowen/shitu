/** 后端时间为北京时间 ISO 字符串（无时区），直接截取展示即可 */
export function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 16)
}

export function fmtDate(s?: string | null): string {
  if (!s) return '—'
  return s.slice(0, 10)
}

export function fmtMoney(n?: number | null): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

export function salaryRange(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return '—'
  if (min === max) return fmtMoney(min)
  return `${fmtMoney(min)}–${fmtMoney(max)}`
}

export const PHONE_RE = /^1[3-9]\d{9}$/
/** 统一社会信用代码（GB 32100-2015），与后端一致 */
export const CREDIT_CODE_RE = /^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

/** 金额：¥ + 千分位 + 两位小数（账单 / 流转费） */
export function fmtYuan(n?: number | null): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const s = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 ? '-' : ''}¥${s}`
}

/** 后端金额字段可能是字符串（BigDecimal），统一转 number */
export function toNum(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : 0
}

/** 手机号分段显示：138 0013 8656 */
export function fmtPhone(p?: string | null): string {
  if (!p) return '—'
  return /^\d{11}$/.test(p) ? `${p.slice(0, 3)} ${p.slice(3, 7)} ${p.slice(7)}` : p
}
