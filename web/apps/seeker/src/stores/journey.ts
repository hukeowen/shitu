import { defineStore } from 'pinia'
import { seekerApi, type LaborContractView, type MyRecommendation } from '@shitu/api-client'

/**
 * 入职相关的跨页数据：待签署合同（首页 / 我的工作 / 签署页）、专属顾问推荐（首页横幅 / 我的 / 匹配结果页）。
 * 按用户隔离：换号登录后丢弃上一个用户的数据。
 */
export const useJourneyStore = defineStore('journey', {
  state: () => ({
    owner: '',
    pending: null as LaborContractView | null,
    pendingLoaded: false,
    recs: [] as MyRecommendation[],
    recsLoaded: false,
  }),
  getters: {
    pendingRecs: (s) => s.recs.filter((r) => r.decision === 'PENDING'),
  },
  actions: {
    bind(userId: string | undefined) {
      if (!userId || this.owner === userId) return
      this.$reset()
      this.owner = userId
    },
    /** 失败时抛出，调用方决定是否展示错误 */
    async loadPending(): Promise<LaborContractView | null> {
      this.pending = (await seekerApi.pendingContract()) ?? null
      this.pendingLoaded = true
      return this.pending
    },
    async loadRecs(): Promise<MyRecommendation[]> {
      this.recs = (await seekerApi.recommendations()) ?? []
      this.recsLoaded = true
      return this.recs
    },
    setDecision(id: number, decision: MyRecommendation['decision']) {
      const r = this.recs.find((x) => x.id === id)
      if (r) r.decision = decision
    },
  },
})
