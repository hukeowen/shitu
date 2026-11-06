import { defineStore } from 'pinia'
import { logout as apiLogout, tenantApi, type TenantMe } from '@shitu/api-client'

/** access token 只放内存；refresh token 由后端写 HttpOnly Cookie（docs/02 §10）。驻场成员属于 TENANT 账号域 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
    me: null as TenantMe | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    operational: (s) => s.me?.operational !== false,
  },
  actions: {
    async loadMe() {
      this.me = await tenantApi.me()
      return this.me
    },
    can(permission: string): boolean {
      return this.me?.permissions.includes(permission) ?? false
    },
    clear() {
      this.accessToken = null
      this.me = null
    },
    async logout() {
      try {
        await apiLogout()
      } finally {
        this.clear()
      }
    },
  },
})
