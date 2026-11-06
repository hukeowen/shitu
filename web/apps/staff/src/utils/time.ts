/**
 * 后端时间为北京时间 ISO 字符串（不带时区）："2026-11-06T10:19:04.887"。
 * 手动解析成本地时间，避免老 WebView 把无时区 ISO 当成 UTC。
 */
export function parseLocal(v?: string | null): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** yyyy-MM-ddTHH:mm:ss（提交给后端的 LocalDateTime） */
export function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00`
}

/** 列表展示：今天 → 「今天 09:30」，今年 → 「11-06 09:30」，否则 yyyy-MM-dd HH:mm */
export function fmtTime(v?: string | null, now = new Date()): string {
  const d = parseLocal(v)
  if (!d) return '—'
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${hm}`
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${hm}`
}

/** 带星期的完整时间：2026-11-09（周一）09:00 */
export function fmtFull(d: Date): string {
  const w = '日一二三四五六'[d.getDay()]
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}（周${w}）${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** 剩余时间 → 「03:42」（时:分）；已过返回 null */
export function fmtRemain(ms: number): string | null {
  if (ms <= 0) return null
  const totalMin = Math.floor(ms / 60000)
  return `${p2(Math.floor(totalMin / 60))}:${p2(totalMin % 60)}`
}

/** 下一个工作日（周一至周五）09:00 */
export function nextWorkday9(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d
}

/** 手机号分段显示：13800138000 → 138 0013 8000 */
export function fmtPhone(v?: string | null): string {
  if (!v) return ''
  const s = v.replace(/\s/g, '')
  return /^\d{11}$/.test(s) ? `${s.slice(0, 3)} ${s.slice(3, 7)} ${s.slice(7)}` : s
}
