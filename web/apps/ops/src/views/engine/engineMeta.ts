/**
 * 匹配引擎参数（P-13）：结构与后端 com.shitu.matching.domain.EngineConfig 一致。
 * 前端校验规则对齐 EngineAdminService.validated()，后端仍会再次校验（SYS_4000 + 中文提示）。
 */
export interface FactorWeights {
  jobType: number
  salary: number
  distance: number
  shift: number
  dorm: number
  experience: number
}
export interface DistanceTier {
  maxKm: number | null
  score: number
}
export interface DecayTier {
  maxDays: number | null
  factor: number
}
export interface CreditTier {
  minScore: number
  factor: number
}
export interface EngineConfig {
  factorWeights: FactorWeights
  distanceScore: DistanceTier[]
  decay: DecayTier[]
  lowConversion: { minPostedDays: number; maxConversionRate: number; factor: number } | null
  combineDecayAndConversion: 'MIN' | 'MULTIPLY'
  resetDecayOnHire: boolean
  credit: CreditTier[]
  penalty: { level2: number; level3: number } | null
  quota: { lowRemaining: number; factor: number } | null
  newJobBoost: { maxDays: number; factor: number } | null
  displayThreshold: number
  resultCount: number
  maxPerCompanyPublic: number
}

export const FACTORS: { key: keyof FactorWeights; label: string }[] = [
  { key: 'jobType', label: '工种' },
  { key: 'salary', label: '薪资' },
  { key: 'distance', label: '地域距离' },
  { key: 'shift', label: '班次' },
  { key: 'dorm', label: '住宿' },
  { key: 'experience', label: '经验' },
]

/** 可选段落启用时的默认值（与种子 v1 一致） */
export const DEFAULTS = {
  lowConversion: { minPostedDays: 15, maxConversionRate: 0.1, factor: 0.5 },
  penalty: { level2: 0.5, level3: 0 },
  quota: { lowRemaining: 2, factor: 0.6 },
  newJobBoost: { maxDays: 3, factor: 1.15 },
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : num(v))
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])

/** 后端 JSON → 表单模型（BigDecimal 可能是数字或字符串，统一转 number） */
export function normalize(raw: Record<string, unknown>): EngineConfig {
  const fw = obj(raw.factorWeights) ?? {}
  const lc = obj(raw.lowConversion)
  const pe = obj(raw.penalty)
  const qu = obj(raw.quota)
  const nb = obj(raw.newJobBoost)
  return {
    factorWeights: {
      jobType: num(fw.jobType),
      salary: num(fw.salary),
      distance: num(fw.distance),
      shift: num(fw.shift),
      dorm: num(fw.dorm),
      experience: num(fw.experience),
    },
    distanceScore: arr(raw.distanceScore).map((t) => ({ maxKm: numOrNull(t.maxKm), score: num(t.score) })),
    decay: arr(raw.decay).map((t) => ({ maxDays: numOrNull(t.maxDays), factor: num(t.factor) })),
    lowConversion: lc ? { minPostedDays: num(lc.minPostedDays), maxConversionRate: num(lc.maxConversionRate), factor: num(lc.factor) } : null,
    combineDecayAndConversion: raw.combineDecayAndConversion === 'MULTIPLY' ? 'MULTIPLY' : 'MIN',
    resetDecayOnHire: raw.resetDecayOnHire === true,
    credit: arr(raw.credit).map((t) => ({ minScore: num(t.minScore), factor: num(t.factor) })),
    penalty: pe ? { level2: num(pe.level2), level3: num(pe.level3) } : null,
    quota: qu ? { lowRemaining: num(qu.lowRemaining), factor: num(qu.factor) } : null,
    newJobBoost: nb ? { maxDays: num(nb.maxDays), factor: num(nb.factor) } : null,
    displayThreshold: num(raw.displayThreshold),
    resultCount: num(raw.resultCount, 3),
    maxPerCompanyPublic: num(raw.maxPerCompanyPublic, 1),
  }
}

/** 表单模型 → 提交体：分档最后一档强制为「以上」(null)，诚信分档按分数从高到低排序 */
export function toPayload(c: EngineConfig): Record<string, unknown> {
  const lastNull = <T extends Record<string, unknown>>(list: T[], key: keyof T) =>
    list.map((t, i) => ({ ...t, [key]: i === list.length - 1 ? null : t[key] }))
  return {
    ...c,
    factorWeights: { ...c.factorWeights },
    distanceScore: lastNull(c.distanceScore as unknown as Record<string, unknown>[], 'maxKm'),
    decay: lastNull(c.decay as unknown as Record<string, unknown>[], 'maxDays'),
    credit: [...c.credit].sort((a, b) => b.minScore - a.minScore).map((t) => ({ ...t })),
  }
}

export const weightSum = (w: FactorWeights) => FACTORS.reduce((a, f) => a + (Number(w[f.key]) || 0), 0)

function checkTiers(name: string, maxes: (number | null)[], out: string[]) {
  if (maxes.length === 0) {
    out.push(`${name}至少一档`)
    return
  }
  let prev: number | null = null
  for (let i = 0; i < maxes.length - 1; i++) {
    const m = maxes[i]
    if (m == null || !(m > 0)) {
      out.push(`${name}第 ${i + 1} 档必须填写大于 0 的上限（只有最后一档可以留空）`)
      return
    }
    if (prev != null && m <= prev) {
      out.push(`${name}的上限必须从小到大`)
      return
    }
    prev = m
  }
}
const inRange = (v: number | null | undefined, min: number, max: number) => v != null && Number.isFinite(v) && v >= min && v <= max

/** 本地校验（与后端一致），返回中文错误列表 */
export function validate(c: EngineConfig): string[] {
  const out: string[] = []
  const sum = weightSum(c.factorWeights)
  if (sum !== 100) out.push(`六个因子权重之和必须等于 100（当前 ${sum}）`)
  if (FACTORS.some((f) => !(c.factorWeights[f.key] >= 0))) out.push('因子权重不能为负数')
  checkTiers('距离分档', c.distanceScore.map((t) => t.maxKm), out)
  if (c.distanceScore.some((t) => !inRange(t.score, 0, 100))) out.push('距离得分须在 0–100')
  checkTiers('挂岗衰减', c.decay.map((t) => t.maxDays), out)
  if (c.decay.some((t) => !inRange(t.factor, 0, 1))) out.push('衰减系数须在 0–1')
  if (c.credit.length === 0) out.push('诚信分档至少一档')
  if (c.credit.some((t) => !inRange(t.minScore, 0, 100))) out.push('诚信分档的分数须在 0–100')
  if (c.credit.some((t) => !inRange(t.factor, 0, 2))) out.push('诚信系数须在 0–2')
  if (c.credit.length > 0 && !c.credit.some((t) => t.minScore === 0)) out.push('诚信分档必须包含 0 分档（兜底）')
  if (new Set(c.credit.map((t) => t.minScore)).size !== c.credit.length) out.push('诚信分档的分数不能重复')
  if (c.lowConversion) {
    if (!inRange(c.lowConversion.factor, 0, 1)) out.push('低转化系数须在 0–1')
    if (!inRange(c.lowConversion.maxConversionRate, 0, 1)) out.push('低转化阈值须在 0–1')
  }
  if (c.penalty) {
    if (!inRange(c.penalty.level2, 0, 1)) out.push('二级处罚系数须在 0–1')
    if (!inRange(c.penalty.level3, 0, 1)) out.push('三级处罚系数须在 0–1')
  }
  if (c.quota && !inRange(c.quota.factor, 0, 1)) out.push('名额将满系数须在 0–1')
  if (c.newJobBoost && !inRange(c.newJobBoost.factor, 0, 2)) out.push('新岗加权须在 0–2')
  if (!inRange(c.displayThreshold, 0, 100)) out.push('展示阈值须在 0–100')
  if (!inRange(c.resultCount, 1, 20)) out.push('结果条数须在 1–20')
  if (!inRange(c.maxPerCompanyPublic, 1, c.resultCount)) out.push('同公司上限须在 1 到结果条数之间')
  return out
}

// ---------------------------------------------------------------- 与生效版本的差异（只读）

const SECTION: Record<string, string> = {
  factorWeights: '因子权重',
  distanceScore: '距离分档',
  decay: '挂岗衰减',
  lowConversion: '低转化降权',
  combineDecayAndConversion: '衰减与低转化合并方式',
  resetDecayOnHire: '入职后重置衰减',
  credit: '诚信分档',
  penalty: '处罚系数',
  quota: '名额将满',
  newJobBoost: '新岗加权',
  displayThreshold: '展示阈值',
  resultCount: '结果条数',
  maxPerCompanyPublic: '同公司上限（公域）',
}
const FIELD: Record<string, string> = {
  ...Object.fromEntries(FACTORS.map((f) => [f.key, f.label])),
  maxKm: '上限 km',
  score: '得分',
  maxDays: '上限天数',
  factor: '系数',
  minScore: '最低分',
  minPostedDays: '最少挂岗天数',
  maxConversionRate: '转化率阈值',
  level2: '二级',
  level3: '三级',
  lowRemaining: '剩余名额 ≤',
}

function flatten(v: unknown, path: string, out: Map<string, string>) {
  if (Array.isArray(v)) {
    if (v.length === 0) out.set(path, '[]')
    v.forEach((x, i) => flatten(x, `${path}[${i}]`, out))
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) flatten(x, path ? `${path}.${k}` : k, out)
  } else {
    out.set(path, v == null ? '—' : String(v))
  }
}

export function pathLabel(path: string): string {
  const m = /^([a-zA-Z]+)(?:\[(\d+)])?(?:\.([a-zA-Z0-9]+))?$/.exec(path)
  if (!m) return path
  const [, sec, idx, field] = m
  let s = SECTION[sec] ?? sec
  if (idx != null) s += ` 第 ${Number(idx) + 1} 档`
  if (field) s += ` · ${FIELD[field] ?? field}`
  return s
}

export interface DiffRow {
  path: string
  label: string
  before: string
  after: string
}
/** 比较两份配置（都先 normalize + toPayload，避免数字 / 字符串差异） */
export function diff(base: EngineConfig, next: EngineConfig): DiffRow[] {
  const a = new Map<string, string>()
  const b = new Map<string, string>()
  flatten(toPayload(base), '', a)
  flatten(toPayload(next), '', b)
  const keys = [...new Set([...a.keys(), ...b.keys()])]
  return keys
    .filter((k) => a.get(k) !== b.get(k))
    .map((k) => ({ path: k, label: pathLabel(k), before: a.get(k) ?? '（无）', after: b.get(k) ?? '（无）' }))
}
