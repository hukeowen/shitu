import { defineStore } from 'pinia'

/** S-03 游客引导弹窗：游客点击任何交互功能时打开，记住意图路由，登录后回跳 */
export const useGuideStore = defineStore('guide', {
  state: () => ({
    visible: false,
    redirect: '/',
  }),
  actions: {
    open(redirect = '/') {
      this.redirect = redirect
      this.visible = true
    },
    close() {
      this.visible = false
    },
  },
})
