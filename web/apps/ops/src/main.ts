import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import '@shitu/ui-tokens/tokens.css'
import '@shitu/ui-tokens/element-theme.css'
import './styles/ops.css'
import '@shitu/ui-tokens/desktop.css'
import { configureAuth } from '@shitu/api-client'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())
app.use(router)

const auth = useAuthStore()
configureAuth({
  domain: 'ops',
  getToken: () => auth.accessToken,
  setToken: (t) => {
    auth.accessToken = t
  },
  onUnauthorized: () => {
    // 刷新也失败：会话已失效（被吊销 / 过期 / 角色变更）
    auth.clear()
    const cur = router.currentRoute.value
    if (!cur.meta.public) {
      router.push({ path: '/login', query: { redirect: cur.fullPath, expired: '1' } })
    }
  },
})

app.mount('#app')
