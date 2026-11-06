import { createRouter, createWebHistory } from 'vue-router'
import { bootstrap } from '@/boot'
import { useAuthStore } from '@/stores/auth'

const placeholder = () => import('@/views/PlaceholderView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('@/views/WorkbenchView.vue'), meta: { tabbar: true, title: '驻场工作台', proto: 'M-01' } },
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
    { path: '/notice', component: () => import('@/views/NoticeView.vue'), meta: { title: '公司状态', allowInactive: true } },
    { path: '/my-code', component: () => import('@/views/MyCodeView.vue'), meta: { title: '我的专属码', proto: 'T-501' } },
    { path: '/todo/interview', component: placeholder, meta: { title: '待面试', proto: 'M-02' } },
    { path: '/todo/confirm', component: placeholder, meta: { title: '待确权', proto: 'M-03' } },
    { path: '/todo/onboard', component: placeholder, meta: { title: '待入职', proto: 'M-03' } },
    { path: '/todo', component: placeholder, meta: { tabbar: true, title: '待办', proto: 'M-02' } },
    { path: '/reminders', component: placeholder, meta: { tabbar: true, title: '24h 提醒', proto: 'M-12' } },
    { path: '/advance', component: placeholder, meta: { title: '预支初审', proto: 'M-11' } },
    { path: '/me', component: () => import('@/views/MeView.vue'), meta: { tabbar: true, title: '我的', allowInactive: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

export function safeRedirect(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/'
}

router.beforeEach(async (to) => {
  await bootstrap()
  const auth = useAuthStore()
  if (to.meta.public) return auth.isLoggedIn ? { path: '/', replace: true } : true
  if (!auth.isLoggedIn) return { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath }, replace: true }
  // 公司审核中 / 驳回 / 封禁等：只显示状态提示页（TenantMe.operational = false）
  if (auth.me && !auth.operational && !to.meta.allowInactive) return { path: '/notice', replace: true }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ?? '仕兔驻场'
})

export default router
