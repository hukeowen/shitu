/** 后端时间为北京时间 ISO 字符串（不带时区）：LocalDateTime "2026-11-06T10:19:04.887"，LocalDate "2026-11-06"。直接切字符串，避免时区换算。 */
export function fmtDateTime(v?: string | null): string {
  if (!v) return '—'
  const s = v.replace('T', ' ')
  return s.length >= 16 ? s.slice(0, 16) : s
}

export function fmtDateTimeSec(v?: string | null): string {
  if (!v) return '—'
  const s = v.replace('T', ' ')
  return s.length >= 19 ? s.slice(0, 19) : s
}

export function fmtDate(v?: string | null): string {
  if (!v) return '—'
  return v.slice(0, 10)
}

export function fmtNum(n?: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('zh-CN')
}

export function fmtSalary(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return '—'
  if (min === max || max == null) return fmtNum(min)
  return `${fmtNum(min)}–${fmtNum(max)}`
}

export function yesNo(v?: boolean | null): string {
  if (v == null) return '—'
  return v ? '是' : '否'
}

/** 今天（本地时区）yyyy-MM-dd */
export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 距离某日期还有几天（负数表示已过） */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const t = new Date(`${date.slice(0, 10)}T00:00:00`).getTime()
  const now = new Date(`${todayStr()}T00:00:00`).getTime()
  return Math.round((t - now) / 86400000)
}

/** 审计日志 detail 为 JSON 字符串，美化输出；非 JSON 原样返回 */
export function prettyJson(s?: string | null): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

/** 金额（元）：千分位 + 两位小数。后端 BigDecimal 可能序列化为数字或字符串 */
export function fmtMoney(v?: number | string | null): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 操作人展示：系统动作（定时任务、种子数据）后端记为 SYSTEM，界面统一显示「系统」 */
export function fmtOperator(v?: string | null, fallback = '系统'): string {
  if (!v) return fallback
  return v.toUpperCase() === 'SYSTEM' ? '系统' : v
}

/** 处罚等级：0 无 / 1–3 级 */
export function fmtPenaltyLevel(lv?: number | string | null): string {
  if (lv == null || lv === '') return '—'
  return ['无', '一级', '二级', '三级'][Number(lv)] ?? `${lv} 级`
}

/** 比例（0–1 小数）→ 百分比文本，如 0.8 → 80% */
export function fmtPct(v?: number | string | null): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `${Math.round(n * 10000) / 100}%` : String(v)
}
