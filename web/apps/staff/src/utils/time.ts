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
export function fmtTime(v?: string | null, now = shNow()): string {
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

/** 时长 → 「19 小时 21 分」/「42 分」（向下取整到分钟，不足 1 分钟显示「不足 1 分」） */
export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(Math.abs(ms) / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return m === 0 ? '不足 1 分' : `${m} 分`
  return `${h} 小时 ${m} 分`
}

/** 倒计时文案（全端统一）：「剩 19 小时 21 分」/「已超时 1 小时 5 分」 */
export function fmtCountdown(remainMs: number): string {
  return remainMs > 0 ? `剩 ${fmtDuration(remainMs)}` : `已超时 ${fmtDuration(remainMs)}`
}

/** 下一个工作日（周一至周五）09:00 */
export function nextWorkday9(now = shNow()): Date {
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

/** yyyy-MM-dd（本地日期） */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** 本地日期 0 点 + n 天 */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** 当天 0 点 */
export function startOfDay(d = shNow()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** yyyy-MM-dd（周一） */
export function fmtDay(v?: string | Date | null): string {
  const d = v instanceof Date ? v : parseLocal(v)
  if (!d) return '—'
  return `${ymd(d)}（周${'日一二三四五六'[d.getDay()]}）`
}

/** 某个时间是否在今天 */
export function isToday(v?: string | null, now = shNow()): boolean {
  const d = parseLocal(v)
  return !!d && d.toDateString() === now.toDateString()
}

/** 金额：1234.5 → ¥1,234.50 */
export function fmtYuan(v?: number | string | null): string {
  const n = Number(v ?? 0)
  return `¥${(Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * 「北京墙上时间」的当前时刻。parseLocal 把后端的北京时间按本机日期字段解析，
 * 与之比较 / 计算倒计时 / 生成默认值时必须用这里的 now，不能用 Date.now()——
 * 否则设备不在东八区（出差、海外测试机）时倒计时和「必须晚于现在」的校验会错开时差。
 */
export function shNowMs(): number {
  return Date.now() + (480 + new Date().getTimezoneOffset()) * 60_000
}

export function shNow(): Date {
  return new Date(shNowMs())
}
