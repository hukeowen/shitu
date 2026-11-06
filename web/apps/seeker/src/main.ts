import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@shitu/ui-tokens/tokens.css'
import 'vant/es/toast/style'
import 'vant/es/dialog/style'
import '@shitu/ui-tokens/vant-theme.css'
import './styles/app.css'
import { configureAuth } from '@shitu/api-client'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())

const auth = useAuthStore()
configureAuth({
  domain: 'seeker',
  getToken: () => auth.accessToken,
  setToken: (t) => {
    auth.accessToken = t
    if (!t) auth.profile = null
  },
  // 刷新也失败（登录已失效）：清空登录态；当前页需要登录时去登录页
  onUnauthorized: () => {
    auth.clear()
    const cur = router.currentRoute.value
    if (cur.meta.auth) void router.replace({ path: '/login', query: { redirect: cur.fullPath } })
  },
})

app.use(router)
app.mount('#app')
