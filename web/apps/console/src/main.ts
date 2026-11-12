import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import '@shitu/ui-tokens/tokens.css'
import '@shitu/ui-tokens/element-theme.css'
import './styles/console.css'
import '@shitu/ui-tokens/desktop.css'
import { configureAuth, useDict } from '@shitu/api-client'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useMeStore } from './stores/me'

const app = createApp(App)
app.use(createPinia())
app.use(router)

const auth = useAuthStore()
const meStore = useMeStore()
configureAuth({
  domain: 'tenant',
  getToken: () => auth.accessToken,
  setToken: (t) => {
    auth.accessToken = t
  },
  // 会话失效（被停用 / 角色变更 / 过期）：清掉成员信息回登录页
  onUnauthorized: () => {
    meStore.clear()
    const cur = router.currentRoute.value
    if (!cur.meta.public) router.push({ path: '/login', query: { redirect: cur.fullPath } })
  },
})

// 预加载枚举字典
useDict()

app.mount('#app')
