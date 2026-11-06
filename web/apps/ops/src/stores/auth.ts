import { defineStore } from 'pinia'
import { opsApi, refreshSession, type AdminView, type OpsRole } from '@shitu/api-client'

/** access token 只放内存；refresh token 由后端写 HttpOnly Cookie（docs/02 §10） */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
    me: null as AdminView | null,
    /** 启动时是否已尝试过用 refresh Cookie 恢复会话（只尝试一次） */
    sessionChecked: false,
  }),
  getters: {
    roles: (s): OpsRole[] => s.me?.roles ?? [],
    isSuper: (s): boolean => s.me?.roles.includes('SUPER') ?? false,
  },
  actions: {
    async loadMe(): Promise<AdminView> {
      const me = await opsApi.me()
      this.me = me
      return me
    },
    /** 启动 / 刷新页面：内存无 token 时用 refresh Cookie 恢复一次，再拉取当前账号 */
    async ensureSession(): Promise<boolean> {
      if (this.me && this.accessToken) return true
      if (!this.accessToken && !this.sessionChecked) {
        this.sessionChecked = true
        await refreshSession()
      }
      if (!this.accessToken) return false
      try {
        await this.loadMe()
        return true
      } catch {
        this.clear()
        return false
      }
    },
    hasAnyRole(roles?: readonly OpsRole[]): boolean {
      if (!roles || roles.length === 0) return true
      return this.roles.some((r) => roles.includes(r))
    },
    clear() {
      this.accessToken = null
      this.me = null
      this.sessionChecked = true
    },
  },
})
