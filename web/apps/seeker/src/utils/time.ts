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

/** MM-DD HH:mm（北京时间） */
export function formatShort(s: string | null | undefined): string {
  const t = parseServerTime(s)
  if (t == null) return '—'
  const d = new Date(t + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** 消息时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD */
export function formatRelative(s: string | null | undefined, now = Date.now()): string {
  const t = parseServerTime(s)
  if (t == null) return ''
  const diff = now - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const day = (x: number) => Math.floor((x + 8 * 3600_000) / 86400_000)
  const dd = day(now) - day(t)
  if (dd === 0) return `${Math.floor(diff / 3600_000)} 小时前`
  if (dd === 1) return '昨天'
  return formatShort(s).slice(0, 5)
}

/** 距某时间还有多久：X 天 Y 小时 / X 小时 Y 分 / Y 分钟；已过返回空串 */
export function untilText(s: string | null | undefined, now = Date.now()): string {
  const t = parseServerTime(s)
  if (t == null || t <= now) return ''
  const m = Math.floor((t - now) / 60_000)
  const h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 小时`
  if (h > 0) return `${h} 小时 ${m % 60} 分`
  return `${m} 分钟`
}
