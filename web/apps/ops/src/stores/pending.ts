import { defineStore } from 'pinia'
import { opsApi, type OpsPending } from '@shitu/api-client'
import { useAuthStore } from './auth'
import { PENDING_ROLES } from '@/router/menu'

/** 待办数量（入驻审核 / 合同备案 / 岗位审核）：侧边栏角标 + 工作台卡片共用，审核操作后调用 refresh() */
export const usePendingStore = defineStore('pending', {
  state: () => ({
    counts: null as OpsPending | null,
    loading: false,
    error: '' as string,
  }),
  actions: {
    async refresh() {
      const auth = useAuthStore()
      if (!auth.hasAnyRole(PENDING_ROLES)) {
        this.counts = null
        return
      }
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        this.counts = await opsApi.pending()
      } catch (e) {
        this.error = e instanceof Error ? e.message : '加载失败'
      } finally {
        this.loading = false
      }
    },
  },
})
