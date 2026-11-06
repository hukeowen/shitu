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
  domain: 'tenant',
  getToken: () => auth.accessToken,
  setToken: (t) => {
    auth.accessToken = t
    if (!t) auth.me = null
  },
  onUnauthorized: () => {
    auth.clear()
    const cur = router.currentRoute.value
    if (!cur.meta.public) void router.replace({ path: '/login', query: { redirect: cur.fullPath } })
  },
})

// 在注入登录态之后再安装路由，首次导航的 bootstrap 才能用 refresh Cookie 恢复登录
app.use(router)
app.mount('#app')
