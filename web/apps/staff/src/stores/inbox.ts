import { defineStore } from 'pinia'
import { tenantApi } from '@shitu/api-client'

/** 站内信未读数（工作台铃铛 / 我的 → 消息通知角标） */
export const useInboxStore = defineStore('inbox', {
  state: () => ({ unread: 0 }),
  actions: {
    async refresh() {
      try {
        this.unread = await tenantApi.unreadCount()
      } catch {
        /* 角标失败不打扰用户 */
      }
    },
  },
})
