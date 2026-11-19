import { defineStore } from 'pinia'
import { tenantApi } from '@shitu/api-client'

/**
 * 站内信未读数（工作台铃铛 / 我的 → 消息通知角标 / 浏览器标签标题）。
 * 页面开着时每分钟查一次，切回前台时立刻查一次：驻场不用手动刷新就能看到新报名。
 */
export const useInboxStore = defineStore('inbox', {
  state: () => ({ unread: 0, timer: 0 as number }),
  actions: {
    async refresh() {
      try {
        this.unread = await tenantApi.unreadCount()
      } catch {
        /* 角标失败不打扰用户 */
      }
    },
    onVisible() {
      if (document.visibilityState === 'visible') void this.refresh()
    },
    start() {
      if (this.timer) return
      void this.refresh()
      this.timer = window.setInterval(() => this.onVisible(), 60_000)
      document.addEventListener('visibilitychange', this.onVisible)
    },
    stop() {
      if (!this.timer) return
      window.clearInterval(this.timer)
      document.removeEventListener('visibilitychange', this.onVisible)
      this.timer = 0
      this.unread = 0
    },
  },
})
