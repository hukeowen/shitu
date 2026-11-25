import { dictLabel, type QuizOption, type QuizQuestion, type QuizQuestionConfig, type QuizQuestionType } from '@shitu/api-client'

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
  | 'age'
  | 'shift_matrix'

export interface ValueOption {
  value: string
  label: string
}

export interface FieldMeta {
  field: ProfileField
  label: string
  desc: string
  /** 选项取值方式：枚举 value / 薪资区间 min-max / 年限数字 / 数字输入题（年龄）/ 矩阵题（班次三态） */
  kind: 'enum' | 'range' | 'number' | 'input' | 'matrix'
  /** 必须为硬过滤题 */
  hardOnly?: boolean
  /** 只能用这个题型（年龄 = 数字题，班次接受度 = 矩阵题，D-62） */
  fixedType?: QuizQuestionType
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
  { field: 'expect_salary', label: '期望薪资（旧）', desc: '题库 v2 起不再问（D-62）：不选这道题时，薪资按候选岗位的到手工资排位打分', kind: 'range' },
  { field: 'shift_pref', label: '班次（单选，旧）', desc: '软打分：班次匹配因子；新题库用「班次接受度」矩阵题', kind: 'enum', values: fromDict('ShiftType', ['DAY', 'TWO_SHIFT', 'NIGHT', 'LONG_DAY']) },
  {
    field: 'age',
    label: '年龄',
    desc: '数字题：没实名时按填的年龄避开年龄要求不符的岗位（实名后以证件为准），范围只能在 16–65 岁之间',
    kind: 'input',
    fixedType: 'NUMBER',
  },
  {
    field: 'shift_matrix',
    label: '班次接受度',
    desc: '矩阵题：每行一种班次，求职者选 接受 / 不接受 / 看情况（固定三列）；接受 100 分、看情况 60 分、不接受 0 分且该岗位不展示给他',
    kind: 'matrix',
    fixedType: 'MATRIX',
    values: fromDict('ShiftType', ['DAY', 'TWO_SHIFT', 'NIGHT', 'LONG_DAY']),
  },
  {
    field: 'dorm_req',
    label: '住宿',
    desc: '软打分：住宿匹配因子',
    kind: 'enum',
    values: () => [
      { value: 'NEEDED', label: '需要住宿' },
      { value: 'NOT_NEEDED', label: '不需要住宿（新）' },
      { value: 'REQUIRED', label: '必须包住' },
      { value: 'SMALL_ROOM', label: '4 人间以内' },
      { value: 'AIRCON', label: '要有空调' },
      { value: 'NONE', label: '不需要住宿' },
    ],
  },
  { field: 'work_years', label: '经验', desc: '软打分：从业年限，每个选项填整数年限', kind: 'number' },
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
  { value: 'NUMBER', label: '数字题' },
  { value: 'MATRIX', label: '矩阵题' },
]
/** 某个画像字段能选的题型：固定题型的字段只有一个，其余只能是判断 / 选择 */
export function typesFor(field: string): ValueOption[] {
  const fixed = fieldMeta(field)?.fixedType
  return QUESTION_TYPES.filter((t) => (fixed ? t.value === fixed : t.value === 'JUDGE' || t.value === 'CHOICE'))
}
/** 矩阵题固定三列（求职者端按钮文字） */
export const MATRIX_COLUMNS = ['接受', '不接受', '看情况']
export const AGE_MIN = 16
export const AGE_MAX = 65
export const FOLLOW_UP_MAX = 30
export const MATCH_ROLES: ValueOption[] = [
  { value: 'HARD_FILTER', label: '硬过滤' },
  { value: 'SOFT_WEIGHT', label: '软打分' },
]
/** 题库版本状态：色调同引擎参数的 VersionStatus（components/StatusTag.vue），共享状态标签 .status-tag--* */
export const QUIZ_STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  ACTIVE: { label: '生效中', tone: 'success' },
  DRAFT: { label: '草稿', tone: 'info' },
  ARCHIVED: { label: '已归档', tone: 'neutral' },
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
  questionType: QuizQuestionType
  stem: string
  hint: string
  profileField: string
  matchRole: 'HARD_FILTER' | 'SOFT_WEIGHT'
  /** 单选题的选项 / 矩阵题的行 */
  options: EditOption[]
  /** 数字题 */
  min: number | undefined
  max: number | undefined
  unit: string
  /** 矩阵题选「看情况」时的追问 */
  followUp: string
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
  const t = q.questionType
  return {
    key: nextKey(),
    questionType: t === 'JUDGE' || t === 'NUMBER' || t === 'MATRIX' ? t : 'CHOICE',
    stem: q.stem ?? '',
    hint: q.hint ?? '',
    profileField: q.profileField,
    matchRole: q.matchRole === 'HARD_FILTER' ? 'HARD_FILTER' : 'SOFT_WEIGHT',
    options: (q.options ?? []).map(toEditOption),
    min: q.config?.min ?? undefined,
    max: q.config?.max ?? undefined,
    unit: q.config?.unit ?? '',
    followUp: q.config?.followUp ?? '',
  }
}

/** 把题目换成某个题型的默认内容（切换画像字段时用） */
export function resetForType(q: EditQuestion) {
  const meta = fieldMeta(q.profileField)
  if (meta?.fixedType) q.questionType = meta.fixedType
  else if (q.questionType === 'NUMBER' || q.questionType === 'MATRIX') q.questionType = 'CHOICE'
  if (q.questionType === 'NUMBER') {
    q.options = []
    q.min ??= AGE_MIN
    q.max ??= AGE_MAX
    q.unit ||= '岁'
  } else if (q.questionType === 'MATRIX') {
    q.options = (meta?.values?.() ?? []).map((v) => ({ ...blankOption([]), code: v.value, label: v.label, value: v.value }))
    q.followUp ||= '什么情况下可以？'
  } else if (q.options.length < 2) {
    while (q.options.length < 2) q.options.push(blankOption(q.options))
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
  const q: EditQuestion = {
    key: nextKey(),
    questionType: 'CHOICE',
    stem: '',
    hint: '',
    profileField: field,
    matchRole: meta?.hardOnly ? 'HARD_FILTER' : 'SOFT_WEIGHT',
    options: opts,
    min: undefined,
    max: undefined,
    unit: '',
    followUp: '',
  }
  resetForType(q)
  return q
}

const trimOrUndef = (s: string) => (s.trim() ? s.trim() : undefined)

export function toQuizQuestions(qs: EditQuestion[]): QuizQuestion[] {
  return qs.map((q, i) => {
    const meta = fieldMeta(q.profileField)
    let config: QuizQuestionConfig | undefined
    if (q.questionType === 'NUMBER') config = { min: q.min, max: q.max, unit: trimOrUndef(q.unit) }
    else if (q.questionType === 'MATRIX' && q.followUp.trim()) config = { followUp: q.followUp.trim() }
    return {
      seq: i + 1,
      questionType: q.questionType,
      stem: q.stem.trim(),
      hint: trimOrUndef(q.hint),
      profileField: q.profileField,
      matchRole: q.matchRole,
      ...(config ? { config } : {}),
      options: q.questionType === 'NUMBER' ? [] : q.options.map((o) => {
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
    if (meta && !typesFor(q.profileField).some((t) => t.value === q.questionType))
      issues.push({ q: i, msg: `${n}「${meta.label}」只能用${typesFor(q.profileField).map((t) => t.label).join(' / ')}` })

    if (q.questionType === 'NUMBER') {
      if (q.min == null || q.max == null) issues.push({ q: i, msg: `${n} 数字题要填最小值和最大值` })
      else if (q.min > q.max) issues.push({ q: i, msg: `${n} 最小值不能大于最大值` })
      else if (q.profileField === 'age' && (q.min < AGE_MIN || q.max > AGE_MAX)) issues.push({ q: i, msg: `${n} 年龄范围只能在 ${AGE_MIN}–${AGE_MAX} 岁之间` })
      if (q.unit.trim().length > 8) issues.push({ q: i, msg: `${n} 单位不超过 8 个字` })
      return
    }
    if (q.questionType === 'MATRIX' && q.followUp.trim().length > FOLLOW_UP_MAX)
      issues.push({ q: i, msg: `${n} 追问不超过 ${FOLLOW_UP_MAX} 个字` })
    if (q.questionType === 'MATRIX') {
      const vals = q.options.map((o) => o.value.trim())
      if (new Set(vals).size !== vals.length) issues.push({ q: i, msg: `${n} 矩阵题的班次不能重复` })
    }

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
        if (o.min == null || o.max == null) issues.push({ q: i, msg: `${on} 薪资题需填写最低 / 最高金额`, warn: true })
        else if (o.min > o.max) issues.push({ q: i, msg: `${on} 最低金额不能大于最高金额` })
      } else if (meta.kind === 'number') {
        if (!o.value.trim()) issues.push({ q: i, msg: `${on} 未填年限，按 0 年计`, warn: true })
        else if (!/^\d{1,2}$/.test(o.value.trim())) issues.push({ q: i, msg: `${on} 年限需为 0–99 的整数` })
      } else {
        const allowed = meta.values?.().map((v) => v.value) ?? []
        if (!o.value.trim() && meta.kind === 'matrix') issues.push({ q: i, msg: `${on} 要选一种班次` })
        else if (!o.value.trim()) issues.push({ q: i, msg: `${on} 未填画像值，选择后不影响匹配`, warn: true })
        else if (allowed.length && !allowed.includes(o.value.trim()))
          issues.push({ q: i, msg: `${on} 画像值「${o.value}」不可识别（会导致 C 端匹配失败）` })
      }
    })
    if (q.profileField === 'locked_region' && !q.options.some((o) => o.needRegion && o.value.trim() === 'LOCKED'))
      issues.push({ q: i, msg: `${n} 地域锁定题应有一个画像值为「锁定城市」且勾选「需选城市」的选项`, warn: true })
  })
  for (const f of REQUIRED_FIELDS) {
    if (!fields.has(f)) issues.push({ q: -1, msg: `必须包含「${fieldLabel(f)}」题` })
  }
  return issues
}
