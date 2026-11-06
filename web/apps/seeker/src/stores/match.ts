import { defineStore } from 'pinia'
import { seekerApi, type ApplyResult, type MatchOutcome, type QuizAnswer, type QuizView } from '@shitu/api-client'

/**
 * AI 问薪会话：题库、作答（内存 + sessionStorage，刷新不丢）、最近一次匹配结果、报名成功结果。
 * 按用户 ID 隔离，换号登录时丢弃上一个用户的暂存。
 */
const KEY = 'shitu.match'

export interface PickedAnswer {
  code: string
  region?: string
}

interface Persisted {
  owner: string
  quizVersion: number | null
  answers: Record<number, PickedAnswer>
  step: number
  applyResult: ApplyResult | null
}

function readPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch {
    return null
  }
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
  }),
  getters: {
    answerList(s): QuizAnswer[] {
      return Object.entries(s.answers)
        .map(([seq, a]) => ({ seq: Number(seq), code: a.code, ...(a.region ? { region: a.region } : {}) }))
        .sort((a, b) => a.seq - b.seq)
    },
  },
  actions: {
    /** 进入问薪相关页面时调用：恢复本用户的暂存 */
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
      const q = await seekerApi.quiz()
      this.quiz = q
      // 题库版本变了：旧答案作废
      if (this.quizVersion !== q.versionId) {
        this.quizVersion = q.versionId
        this.answers = {}
        this.step = 0
      }
      // 清掉已不存在的题 / 选项
      for (const k of Object.keys(this.answers)) {
        const seq = Number(k)
        const qq = q.questions.find((x) => x.seq === seq)
        if (!qq || !qq.options.some((o) => o.code === this.answers[seq].code)) delete this.answers[seq]
      }
      this.step = Math.min(Math.max(0, this.step), Math.max(0, q.questions.length - 1))
      this.persist()
      return q
    },
    setAnswer(seq: number, code: string, region?: string) {
      this.answers = { ...this.answers, [seq]: region ? { code, region } : { code } }
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
