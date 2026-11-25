import type { MatrixChoice, QuizQuestion } from '@shitu/api-client'

/** 本地暂存的一道题的回答（单选 / 数字 / 矩阵三种都放这里） */
export interface PickedAnswer {
  code?: string
  region?: string
  number?: number
  matrix?: Record<string, MatrixChoice>
  notes?: Record<string, string>
}

/** 矩阵题固定三列（D-62：接受 / 不接受 / 看情况） */
export const MATRIX_COLUMNS: { value: MatrixChoice; label: string }[] = [
  { value: 'ACCEPT', label: '接受' },
  { value: 'REJECT', label: '不接受' },
  { value: 'DEPENDS', label: '看情况' },
]

export const NOTE_MAX = 50

export function numberRange(q: QuizQuestion): { min: number; max: number; unit: string } {
  return { min: q.config?.min ?? 16, max: q.config?.max ?? 65, unit: q.config?.unit ?? '' }
}

/** 这道题是否已经答完整（数字在范围内、矩阵每行都选了、单选选项存在） */
export function isAnswered(q: QuizQuestion, a: PickedAnswer | undefined): boolean {
  if (!a) return false
  if (q.questionType === 'NUMBER') {
    const { min, max } = numberRange(q)
    return a.number != null && Number.isInteger(a.number) && a.number >= min && a.number <= max
  }
  if (q.questionType === 'MATRIX') {
    return q.options.every((row) => !!a.matrix?.[row.code])
  }
  return !!a.code && q.options.some((o) => o.code === a.code)
}

/** 已回答的题用一句话概括（答题页「已回答」、结果页「你的找活要求」） */
export function answerText(q: QuizQuestion, a: PickedAnswer | undefined): string | null {
  if (!a || !isAnswered(q, a)) return null
  if (q.questionType === 'NUMBER') return `${a.number} ${numberRange(q).unit}`.trim()
  if (q.questionType === 'MATRIX') {
    const pick = (v: MatrixChoice) => q.options.filter((r) => a.matrix?.[r.code] === v).map((r) => r.label)
    const ok = pick('ACCEPT')
    const maybe = pick('DEPENDS')
    if (ok.length) return `能上${ok.join('、')}`
    if (maybe.length) return `${maybe.join('、')}看情况`
    return '班次都不接受'
  }
  const o = q.options.find((x) => x.code === a.code)
  if (!o) return null
  return a.region ? `锁定 ${a.region}` : o.label
}
