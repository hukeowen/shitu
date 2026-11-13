import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@shitu/ui-tokens/tokens.css'
import 'vant/es/toast/style'
import 'vant/es/dialog/style'
import '@shitu/ui-tokens/vant-theme.css'
import './styles/app.css'
import { configureAuth, setDictOverrides } from '@shitu/api-client'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

// 面向求职者的叫法：不出现「私域 / 公域 / 确权」等内部术语
setDictOverrides({
  DomainTag: { PUBLIC: '自由求职', PRIVATE: '专属服务', TEMP_PRIVATE: '报名中' },
  UserStatus: { PUBLIC_SEEKING: '求职中', PRIVATE_PENDING: '顾问跟进中', PENDING_CONFIRM: '待签约入职', EMPLOYED: '在岗' },
  // 报名状态同理：「待确权」对求职者显示为「待签约入职」（报备页签、标签、台账、我的工作等全部走字典）
  ApplicationStatus: { PENDING_CONFIRM: '待签约入职' },
  // 预支状态：徽标与状态行统一叫「已还清」（字典原文「已抵扣」易与「已抵扣金额」混淆）
  AdvanceStatus: { REPAID: '已还清' },
})

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
