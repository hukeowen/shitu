import { defineStore } from 'pinia'
import { errorMessage, isApiError, opsApi, type OpsPending } from '@shitu/api-client'
import { useAuthStore } from './auth'
import { PENDING_ROLES } from '@/router/menu'

/** 待办数量（入驻审核 / 合同备案 / 岗位审核）：侧边栏角标 + 工作台卡片共用，审核操作后调用 refresh() */
export const usePendingStore = defineStore('pending', {
  state: () => ({
    counts: null as OpsPending | null,
    loading: false,
    error: '' as string,
    /** 失败是断网、超时（提示检查网络），还是后端给了原因 */
    offline: false,
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
      this.offline = false
      try {
        this.counts = await opsApi.pending()
      } catch (e) {
        this.error = errorMessage(e, '加载失败')
        this.offline = isApiError(e) && e.code === 'NETWORK'
      } finally {
        this.loading = false
      }
    },
  },
})
