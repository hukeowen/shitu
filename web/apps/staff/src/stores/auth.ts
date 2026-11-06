import { defineStore } from 'pinia'

/** access token 只放内存；refresh token 由后端写 HttpOnly Cookie（docs/02 §10） */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
  }),
})
