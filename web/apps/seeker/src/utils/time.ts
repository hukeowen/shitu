/**
 * 后端时间为北京时间、不带时区的 ISO 串（如 "2026-11-06T10:35:06.7606872"，小数位数不定）。
 * 不直接 new Date(str)：iOS Safari 对超过 3 位小数会解析失败，且设备时区不一定是东八区。
 */
const RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/

export function parseServerTime(s: string | null | undefined): number | null {
  if (!s) return null
  const m = RE.exec(s.trim())
  if (!m) {
    const t = Date.parse(s)
    return Number.isNaN(t) ? null : t
  }
  const [, y, mo, d, h = '0', mi = '0', sec = '0', frac = '0'] = m
  const ms = Number((frac + '00').slice(0, 3))
  return Date.UTC(+y, +mo - 1, +d, +h - 8, +mi, +sec, ms)
}

/** 按北京时间格式化：YYYY-MM-DD HH:mm */
export function formatServerTime(s: string | null | undefined, withTime = true): string {
  const t = parseServerTime(s)
  if (t == null) return '—'
  const d = new Date(t + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  return withTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date
}
