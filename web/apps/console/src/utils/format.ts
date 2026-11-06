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
