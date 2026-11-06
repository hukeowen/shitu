/**
 * 时间工具。后端时间为北京时间、无时区的 ISO 串（2026-11-07T21:51:34.964），
 * 按浏览器本地时间解析（运营环境在东八区）。
 */
export function parseLocal(s?: string | null): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/.exec(s)
  if (!m) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** yyyy-MM-dd（本地） */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** yyyy-MM（本地） */
export function ym(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 本地时间 ISO（无时区）：2026-11-08T09:00:00 */
export function toLocalIso(d: Date): string {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** 某月第一天 / 最后一天（month: yyyy-MM） */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${pad(last)}` }
}

/** 剩余毫秒（deadline - now），无截止时间返回 null */
export function remainMs(deadline: string | null | undefined, now: number): number | null {
  const d = parseLocal(deadline)
  return d ? d.getTime() - now : null
}

/** 倒计时文本：HH:MM（超过 24h 显示 X天HH:MM；已超时显示 超时 HH:MM） */
export function fmtCountdown(ms: number | null): string {
  if (ms == null) return '—'
  const neg = ms < 0
  const total = Math.floor(Math.abs(ms) / 60000)
  const days = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  const body = `${days > 0 ? `${days}天` : ''}${pad(h)}:${pad(m)}`
  return neg ? `超时 ${body}` : body
}

/** 倒计时颜色：已超时 / <1h → danger，<6h → warn，其余 muted */
export function countdownTone(ms: number | null): 'danger' | 'warn' | 'muted' {
  if (ms == null) return 'muted'
  if (ms < 3600_000) return 'danger'
  if (ms < 6 * 3600_000) return 'warn'
  return 'muted'
}

/** 下一个工作日 9:00（面试时间默认值） */
export function nextWorkday9(from = new Date()): Date {
  const d = addDays(from, 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}
