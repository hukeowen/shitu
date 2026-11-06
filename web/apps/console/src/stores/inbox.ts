import { defineStore } from 'pinia'
import { tenantApi } from '@shitu/api-client'

/** 成员站内信未读数：顶栏铃铛轮询（60s），抽屉里标记已读后即时刷新 */
export const useInboxStore = defineStore('inbox', {
  state: () => ({
    unread: 0,
    timer: 0 as number,
  }),
  actions: {
    async refresh() {
      try {
        this.unread = await tenantApi.unreadCount()
      } catch {
        /* 网络抖动忽略，下一轮再取 */
      }
    },
    start() {
      if (this.timer) return
      this.refresh()
      this.timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') this.refresh()
      }, 60_000)
    },
    stop() {
      window.clearInterval(this.timer)
      this.timer = 0
      this.unread = 0
    },
  },
})
