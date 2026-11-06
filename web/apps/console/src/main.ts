import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import '@shitu/ui-tokens/tokens.css'
import '@shitu/ui-tokens/element-theme.css'
import { configureAuth } from '@shitu/api-client'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())
app.use(router)

const auth = useAuthStore()
configureAuth({
  domain: 'tenant',
  getToken: () => auth.accessToken,
  setToken: (t) => {
    auth.accessToken = t
  },
  onUnauthorized: () => router.push('/login'),
})

app.mount('#app')
