import { defineStore } from 'pinia'
import type { UserStatus } from '@shitu/ui-mobile'

/** access token 只放内存；refresh token 由后端写 HttpOnly Cookie（docs/02 §10） */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
    status: 'GUEST' as UserStatus,
  }),
  getters: {
    isGuest: (s) => s.status === 'GUEST',
  },
})
