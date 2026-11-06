import { defineStore } from 'pinia'
import { seekerApi } from '@shitu/api-client'

/** 站内信未读数（首页铃铛 / 我的 · 消息中心角标） */
export const useInboxStore = defineStore('inbox', {
  state: () => ({ unread: 0 }),
  actions: {
    async refresh() {
      try {
        this.unread = await seekerApi.unreadCount()
      } catch {
        /* 角标失败不影响页面 */
      }
    },
    decrement(n = 1) {
      this.unread = Math.max(0, this.unread - n)
    },
  },
})
