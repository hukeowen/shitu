import { dictLabel, type QuizOption, type QuizQuestion } from '@shitu/api-client'

/**
 * 题库画像字段（与后端 QuizService.KNOWN_FIELDS / ProfileBuilder 一致）。
 * 字典接口暂无这些枚举，先在此维护；后端新增字段时需同步。
 */
export type ProfileField =
  | 'accept_factory'
  | 'locked_region'
  | 'expect_job_type'
  | 'expect_salary'
  | 'shift_pref'
  | 'dorm_req'
  | 'work_years'

export interface ValueOption {
  value: string
  label: string
}

export interface FieldMeta {
  field: ProfileField
  label: string
  desc: string
  /** 选项取值方式：枚举 value / 薪资区间 min-max / 年限数字 */
  kind: 'enum' | 'range' | 'number'
  /** 必须为硬过滤题 */
  hardOnly?: boolean
  values?: () => ValueOption[]
}

const fromDict = (type: string, values: string[], extra: ValueOption[] = []) => () => [
  ...values.map((v) => ({ value: v, label: dictLabel(type, v) })),
  ...extra,
]

export const FIELDS: FieldMeta[] = [
  {
    field: 'accept_factory',
    label: '进厂意愿',
    desc: '硬过滤：不接受进厂的用户只匹配厂外岗位',
    kind: 'enum',
    hardOnly: true,
    values: () => [
      { value: 'YES', label: '接受' },
      { value: 'MAYBE', label: '可以试试' },
      { value: 'NO', label: '不接受' },
    ],
  },
  {
    field: 'locked_region',
    label: '地域锁定',
    desc: '硬过滤：选「锁定」的选项须勾选「需选城市」',
    kind: 'enum',
    hardOnly: true,
    values: () => [
      { value: 'LOCKED', label: '锁定城市' },
      { value: 'ANY', label: '不限' },
    ],
  },
  { field: 'expect_job_type', label: '期望工种', desc: '软打分：工种匹配因子', kind: 'enum', values: fromDict('JobType', ['ELECTRONICS', 'GENERAL', 'WAREHOUSE', 'MACHINING', 'QC'], [{ value: 'ANY', label: '都可以' }]) },
  { field: 'expect_salary', label: '期望薪资', desc: '软打分：薪资区间重叠度，选项填 min / max（元/月）', kind: 'range' },
  { field: 'shift_pref', label: '班次', desc: '软打分：班次匹配因子', kind: 'enum', values: fromDict('ShiftType', ['DAY', 'TWO_SHIFT', 'NIGHT', 'LONG_DAY']) },
  {
    field: 'dorm_req',
    label: '住宿',
    desc: '软打分：住宿匹配因子',
    kind: 'enum',
    values: () => [
      { value: 'REQUIRED', label: '必须包住' },
      { value: 'SMALL_ROOM', label: '4 人间以内' },
      { value: 'AIRCON', label: '要有空调' },
      { value: 'NONE', label: '不需要住宿' },
    ],
  },
  { field: 'work_years', label: '经验', desc: '软打分：从业年限，value 填整数年限', kind: 'number' },
]

export const REQUIRED_FIELDS: ProfileField[] = ['accept_factory', 'locked_region']

export function fieldMeta(f: string): FieldMeta | undefined {
  return FIELDS.find((m) => m.field === f)
}
export function fieldLabel(f: string): string {
  return fieldMeta(f)?.label ?? f
}

export const QUESTION_TYPES: ValueOption[] = [
  { value: 'JUDGE', label: '判断题' },
  { value: 'CHOICE', label: '选择题' },
]
export const MATCH_ROLES: ValueOption[] = [
  { value: 'HARD_FILTER', label: '硬过滤' },
  { value: 'SOFT_WEIGHT', label: '软打分' },
]
export const QUIZ_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: '生效中', cls: 'tag--ok' },
  DRAFT: { label: '草稿', cls: 'tag--warn' },
  ARCHIVED: { label: '已归档', cls: '' },
}

export const MAX_QUESTIONS = 7
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 8
export const STEM_MAX = 100

// ---------- 编辑模型 ----------

/** 编辑中的选项：数字字段用字符串承载输入，提交时再转换 */
export interface EditOption {
  key: number
  code: string
  label: string
  sub: string
  value: string
  min: number | undefined
  max: number | undefined
  needRegion: boolean
}
export interface EditQuestion {
  key: number
  questionType: 'JUDGE' | 'CHOICE'
  stem: string
  hint: string
  profileField: string
  matchRole: 'HARD_FILTER' | 'SOFT_WEIGHT'
  options: EditOption[]
}

let seq = 0
export const nextKey = () => ++seq

export function toEditOption(o: QuizOption): EditOption {
  return {
    key: nextKey(),
    code: o.code ?? '',
    label: o.label ?? '',
    sub: o.sub ?? '',
    value: o.value == null ? '' : String(o.value),
    min: o.min ?? undefined,
    max: o.max ?? undefined,
    needRegion: o.needRegion === true,
  }
}
export function toEditQuestion(q: QuizQuestion): EditQuestion {
  return {
    key: nextKey(),
    questionType: q.questionType === 'JUDGE' ? 'JUDGE' : 'CHOICE',
    stem: q.stem ?? '',
    hint: q.hint ?? '',
    profileField: q.profileField,
    matchRole: q.matchRole === 'HARD_FILTER' ? 'HARD_FILTER' : 'SOFT_WEIGHT',
    options: (q.options ?? []).map(toEditOption),
  }
}

/** 下一个未使用的选项编码 A–H */
export function nextCode(opts: EditOption[]): string {
  const used = new Set(opts.map((o) => o.code.trim().toUpperCase()))
  for (const c of 'ABCDEFGH') if (!used.has(c)) return c
  return ''
}

export function blankOption(opts: EditOption[]): EditOption {
  return { key: nextKey(), code: nextCode(opts), label: '', sub: '', value: '', min: undefined, max: undefined, needRegion: false }
}

export function blankQuestion(field: string): EditQuestion {
  const meta = fieldMeta(field)
  const opts: EditOption[] = []
  opts.push(blankOption(opts))
  opts.push(blankOption(opts))
  return {
    key: nextKey(),
    questionType: 'CHOICE',
    stem: '',
    hint: '',
    profileField: field,
    matchRole: meta?.hardOnly ? 'HARD_FILTER' : 'SOFT_WEIGHT',
    options: opts,
  }
}

const trimOrUndef = (s: string) => (s.trim() ? s.trim() : undefined)

export function toQuizQuestions(qs: EditQuestion[]): QuizQuestion[] {
  return qs.map((q, i) => {
    const meta = fieldMeta(q.profileField)
    return {
      seq: i + 1,
      questionType: q.questionType,
      stem: q.stem.trim(),
      hint: trimOrUndef(q.hint),
      profileField: q.profileField,
      matchRole: q.matchRole,
      options: q.options.map((o) => {
        const out: QuizOption = { code: o.code.trim(), label: o.label.trim() }
        const sub = trimOrUndef(o.sub)
        if (sub) out.sub = sub
        if (meta?.kind === 'range') {
          if (o.min != null) out.min = o.min
          if (o.max != null) out.max = o.max
        } else {
          const v = trimOrUndef(o.value)
          if (v) out.value = v
        }
        if (q.profileField === 'locked_region' && o.needRegion) out.needRegion = true
        return out
      }),
    }
  })
}

// ---------- 校验（与后端 QuizService.validate 一致，另加画像取值的前端提示） ----------

export interface Issue {
  /** 题目下标；-1 = 整卷 */
  q: number
  msg: string
  /** 仅提示，不阻止保存 */
  warn?: boolean
}

export function validate(qs: EditQuestion[]): Issue[] {
  const issues: Issue[] = []
  if (qs.length < 1 || qs.length > MAX_QUESTIONS) issues.push({ q: -1, msg: `题目为 1–${MAX_QUESTIONS} 道（当前 ${qs.length} 道）` })
  const fields = new Set<string>()
  let softSeen = false
  qs.forEach((q, i) => {
    const n = `Q${i + 1}`
    const meta = fieldMeta(q.profileField)
    if (!q.stem.trim()) issues.push({ q: i, msg: `${n} 题干不能为空` })
    else if (q.stem.trim().length > STEM_MAX) issues.push({ q: i, msg: `${n} 题干不超过 ${STEM_MAX} 字` })
    if (!meta) issues.push({ q: i, msg: `${n} 画像字段未知：${q.profileField || '未选择'}` })
    else if (fields.has(q.profileField)) issues.push({ q: i, msg: `${n} 画像字段重复：${meta.label}` })
    fields.add(q.profileField)

    const hard = q.matchRole === 'HARD_FILTER'
    if (hard && softSeen) issues.push({ q: i, msg: `${n} 硬过滤题必须排在软打分题之前` })
    softSeen ||= !hard
    if (meta?.hardOnly && !hard) issues.push({ q: i, msg: `${n}「${meta.label}」应设为硬过滤`, warn: true })

    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS)
      issues.push({ q: i, msg: `${n} 选项为 ${MIN_OPTIONS}–${MAX_OPTIONS} 个（当前 ${q.options.length} 个）` })
    const codes = new Set<string>()
    const labels = new Set<string>()
    q.options.forEach((o, j) => {
      const on = `${n} 选项 ${j + 1}`
      const code = o.code.trim()
      const label = o.label.trim()
      if (!code) issues.push({ q: i, msg: `${on} 缺少编码` })
      else if (codes.has(code)) issues.push({ q: i, msg: `${n} 选项编码重复：${code}` })
      codes.add(code)
      if (!label) issues.push({ q: i, msg: `${on} 缺少文字` })
      else if (labels.has(label)) issues.push({ q: i, msg: `${n} 选项文字重复：${label}` })
      labels.add(label)
      if (!meta) return
      if (meta.kind === 'range') {
        if (o.min == null || o.max == null) issues.push({ q: i, msg: `${on} 薪资题需填写 min / max`, warn: true })
        else if (o.min > o.max) issues.push({ q: i, msg: `${on} min 不能大于 max` })
      } else if (meta.kind === 'number') {
        if (!o.value.trim()) issues.push({ q: i, msg: `${on} 未填年限，按 0 年计`, warn: true })
        else if (!/^\d{1,2}$/.test(o.value.trim())) issues.push({ q: i, msg: `${on} 年限需为 0–99 的整数` })
      } else {
        const allowed = meta.values?.().map((v) => v.value) ?? []
        if (!o.value.trim()) issues.push({ q: i, msg: `${on} 未填画像值，选择后不影响匹配`, warn: true })
        else if (allowed.length && !allowed.includes(o.value.trim()))
          issues.push({ q: i, msg: `${on} 画像值「${o.value}」不可识别（会导致 C 端匹配失败）` })
      }
    })
    if (q.profileField === 'locked_region' && !q.options.some((o) => o.needRegion && o.value.trim() === 'LOCKED'))
      issues.push({ q: i, msg: `${n} 地域锁定题应有一个 value=LOCKED 且勾选「需选城市」的选项`, warn: true })
  })
  for (const f of REQUIRED_FIELDS) {
    if (!fields.has(f)) issues.push({ q: -1, msg: `必须包含「${fieldLabel(f)}」题（${f}）` })
  }
  return issues
}
