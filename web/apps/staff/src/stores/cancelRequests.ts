import { defineStore } from 'pinia'
import { tenantApi } from '@shitu/api-client'

/**
 * 求职者「申请取消报名」的待处理数（工作台入口角标 / 我的 → 取消申请角标）。
 * 接口只对驻场 / 项目经理开放，其他角色不查；处理完一条后由取消申请页调 refresh。
 */
export const useCancelRequestsStore = defineStore('cancelRequests', {
  state: () => ({ pending: 0 }),
  actions: {
    async refresh() {
      try {
        this.pending = await tenantApi.cancelRequestPendingCount()
      } catch {
        /* 角标失败不打扰用户 */
      }
    },
  },
})
