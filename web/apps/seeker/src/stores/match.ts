import { defineStore } from 'pinia'
import {
  seekerApi,
  type ApplyResult,
  type MatchOutcome,
  type MatchPreviewOutcome,
  type QuizAnswer,
  type QuizView,
} from '@shitu/api-client'
import { isAnswered, type PickedAnswer } from '@/utils/quiz'

export type { PickedAnswer } from '@/utils/quiz'

/**
 * AI 问薪会话：题库、作答（内存 + sessionStorage，刷新不丢）、最近一次匹配结果、报名成功结果。
 * 按用户 ID 隔离，换号登录时丢弃上一个用户的暂存；游客的 owner 为 {@link GUEST}。
 * <p>D-62 先答题后登录：游客答完看预览，点「看完整岗位 / 报名」时把答案存进 localStorage（{@link PENDING_KEY}），
 * 登录后 /match/continue 用这份答案跑正式匹配，用完即删。
 */
const KEY = 'shitu.match'
const PENDING_KEY = 'shitu.match.pending'
/** 待登录后使用的答案保留 1 天（短信收得慢、切出去再回来都还在） */
const PENDING_TTL_MS = 24 * 3600 * 1000
export const GUEST = 'guest'

interface Persisted {
  owner: string
  quizVersion: number | null
  answers: Record<number, PickedAnswer>
  step: number
  applyResult: ApplyResult | null
}

export interface PendingAnswers {
  quizVersion: number | null
  answers: Record<number, PickedAnswer>
  location: { lng: number; lat: number } | null
  ts: number
}

function readPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch {
    return null
  }
}

/** 游客的答案（登录后用一次） */
export function readPending(): PendingAnswers | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingAnswers
    if (!p || Date.now() - p.ts > PENDING_TTL_MS || !p.answers) {
      localStorage.removeItem(PENDING_KEY)
      return null
    }
    return p
  } catch {
    return null
  }
}

export function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

/** 内存兜底：localStorage 不可用（隐私模式）时，同一页面会话里登录完仍能接上 */
let pendingMemory: PendingAnswers | null = null

export function toAnswerList(answers: Record<number, PickedAnswer>): QuizAnswer[] {
  return Object.entries(answers)
    .map(([seq, a]) => {
      const out: QuizAnswer = { seq: Number(seq) }
      if (a.code) out.code = a.code
      if (a.region) out.region = a.region
      if (a.number != null) out.number = a.number
      if (a.matrix) out.matrix = a.matrix
      if (a.notes) {
        const notes = Object.fromEntries(Object.entries(a.notes).filter(([k, v]) => v.trim() && a.matrix?.[k] === 'DEPENDS'))
        if (Object.keys(notes).length) out.notes = notes
      }
      return out
    })
    .sort((a, b) => a.seq - b.seq)
}

export const useMatchStore = defineStore('match', {
  state: () => ({
    owner: '',
    quiz: null as QuizView | null,
    quizVersion: null as number | null,
    answers: {} as Record<number, PickedAnswer>,
    step: 0,
    location: null as { lng: number; lat: number } | null,
    outcome: null as MatchOutcome | null,
    /** 已经向后端查询过最近一次结果（null 也算） */
    outcomeLoaded: false,
    applyResult: null as ApplyResult | null,
    /** 游客预览结果（只在内存里，刷新后重新答题或重新预览） */
    preview: null as MatchPreviewOutcome | null,
  }),
  getters: {
    answerList(s): QuizAnswer[] {
      return toAnswerList(s.answers)
    },
    isGuest(s): boolean {
      return s.owner === GUEST
    },
  },
  actions: {
    /** 进入问薪相关页面时调用：恢复本用户（或游客）的暂存 */
    bind(userId: string) {
      if (this.owner === userId) return
      this.$reset()
      this.owner = userId
      const p = readPersisted()
      if (p && p.owner === userId) {
        this.quizVersion = p.quizVersion
        this.answers = p.answers ?? {}
        this.step = p.step ?? 0
        this.applyResult = p.applyResult ?? null
      }
    },
    persist() {
      try {
        const p: Persisted = {
          owner: this.owner,
          quizVersion: this.quizVersion,
          answers: this.answers,
          step: this.step,
          applyResult: this.applyResult,
        }
        sessionStorage.setItem(KEY, JSON.stringify(p))
      } catch {
        /* 隐私模式不可用时仅保存在内存 */
      }
    },
    async loadQuiz(): Promise<QuizView> {
      if (this.quiz) return this.quiz
      // 游客读公开题库（不进答题漏斗）；登录用户读正常题库（记「打开答题页」）
      const q = this.owner === GUEST ? await seekerApi.publicQuiz() : await seekerApi.quiz()
      this.quiz = q
      // 题库版本变了：旧答案作废
      if (this.quizVersion !== q.versionId) {
        this.quizVersion = q.versionId
        this.answers = {}
        this.step = 0
      }
      // 清掉已不存在的题 / 选项 / 不合法的答案
      for (const k of Object.keys(this.answers)) {
        const seq = Number(k)
        const qq = q.questions.find((x) => x.seq === seq)
        if (!qq || !isAnswered(qq, this.answers[seq])) delete this.answers[seq]
      }
      this.step = Math.min(Math.max(0, this.step), Math.max(0, q.questions.length - 1))
      this.persist()
      return q
    },
    setAnswer(seq: number, code: string, region?: string) {
      this.answers = { ...this.answers, [seq]: region ? { code, region } : { code } }
      this.persist()
    },
    /** 数字题 / 矩阵题：整份替换；传 null 清掉这题的答案 */
    putAnswer(seq: number, a: PickedAnswer | null) {
      const next = { ...this.answers }
      if (a) next[seq] = a
      else delete next[seq]
      this.answers = next
      this.persist()
    },
    setStep(step: number) {
      this.step = step
      this.persist()
    },
    async runMatch(): Promise<MatchOutcome> {
      const o = await seekerApi.match(this.answerList, this.location ?? undefined)
      this.outcome = o
      this.outcomeLoaded = true
      this.step = 0
      this.persist()
      return o
    },
    /** 游客预览：不落库；渠道码决定只看邀请公司的岗位还是全平台 */
    async runPreview(channelCode: string | null): Promise<MatchPreviewOutcome> {
      const o = await seekerApi.matchPreview(this.answerList, channelCode, this.location ?? undefined)
      this.preview = o
      return o
    },
    /** 游客点「看完整岗位 / 报名」：把答案留到登录以后用 */
    keepForLogin() {
      const p: PendingAnswers = { quizVersion: this.quizVersion, answers: this.answers, location: this.location, ts: Date.now() }
      pendingMemory = p
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(p))
      } catch {
        /* 隐私模式：用内存兜底 */
      }
    },
    /** 登录后取出游客的答案（取出即删，只用一次） */
    takePending(): PendingAnswers | null {
      const p = readPending() ?? pendingMemory
      clearPending()
      pendingMemory = null
      if (!p) return null
      this.quizVersion = p.quizVersion
      this.answers = p.answers
      if (p.location) this.location = p.location
      this.persist()
      return p
    },
    async loadLatest(force = false): Promise<MatchOutcome | null> {
      if (this.outcomeLoaded && !force) return this.outcome
      this.outcome = (await seekerApi.latestMatch()) ?? null
      this.outcomeLoaded = true
      return this.outcome
    },
    setApplyResult(r: ApplyResult) {
      this.applyResult = r
      this.persist()
    },
  },
})
