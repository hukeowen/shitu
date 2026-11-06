import { defineStore } from 'pinia'
import { logout as apiLogout, seekerApi, type SeekerLoginResponse, type SeekerProfile, type UserStatus } from '@shitu/api-client'

/** access token 只放内存；refresh token 由后端写 HttpOnly Cookie（docs/02 §10） */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
    profile: null as SeekerProfile | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    status: (s): UserStatus => s.profile?.status ?? 'GUEST',
    isGuest(): boolean {
      return !this.isLoggedIn
    },
  },
  actions: {
    setSession(resp: SeekerLoginResponse) {
      this.accessToken = resp.accessToken
      this.profile = resp.profile
    },
    async loadProfile() {
      this.profile = await seekerApi.me()
      return this.profile
    },
    clear() {
      this.accessToken = null
      this.profile = null
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
