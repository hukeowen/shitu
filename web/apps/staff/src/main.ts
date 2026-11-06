import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@shitu/ui-tokens/tokens.css'
import 'vant/es/toast/style'
import 'vant/es/dialog/style'
import '@shitu/ui-tokens/vant-theme.css'
import { configureAuth } from '@shitu/api-client'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())
app.use(router)

const auth = useAuthStore()
configureAuth({ getToken: () => auth.accessToken, onUnauthorized: () => router.push('/login') })

app.mount('#app')
