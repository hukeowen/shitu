import { defineStore } from 'pinia'

/** 入驻申请票据（sms-login 返回 NOT_MEMBER 时下发，30 分钟有效）。只放内存 */
export const useOnboardingStore = defineStore('onboarding', {
  state: () => ({
    ticket: null as string | null,
    phoneMasked: '' as string,
    expiresAt: 0,
  }),
  getters: {
    valid: (s) => !!s.ticket && Date.now() < s.expiresAt,
  },
  actions: {
    set(ticket: string, phoneMasked?: string) {
      this.ticket = ticket
      this.phoneMasked = phoneMasked ?? ''
      this.expiresAt = Date.now() + 30 * 60 * 1000
    },
    clear() {
      this.ticket = null
      this.phoneMasked = ''
      this.expiresAt = 0
    },
  },
})
