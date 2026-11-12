import { createRouter, createWebHistory } from 'vue-router'
import { bootstrap } from '@/boot'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('@/views/WorkbenchView.vue'), meta: { tabbar: true, title: '驻场工作台', proto: 'M-01' } },
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
    { path: '/notice', component: () => import('@/views/NoticeView.vue'), meta: { title: '公司状态', allowInactive: true } },
    { path: '/my-code', component: () => import('@/views/MyCodeView.vue'), meta: { title: '我的专属码', proto: 'T-501' } },
    { path: '/todo/interview', redirect: { path: '/todo', query: { tab: 'interview' } } },
    { path: '/todo/confirm', redirect: { path: '/todo', query: { tab: 'confirm' } } },
    { path: '/todo/onboard', redirect: { path: '/todo', query: { tab: 'confirm' } } },
    { path: '/todo/arrived', redirect: { path: '/todo', query: { tab: 'arrived' } } },
    { path: '/todo', component: () => import('@/views/TodoView.vue'), meta: { tabbar: true, title: '待办清单', proto: 'M-02' } },
    { path: '/applications/:id', component: () => import('@/views/ApplicationDetailView.vue'), meta: { title: '报名详情', proto: 'M-04' } },
    { path: '/messages', component: () => import('@/views/MessagesView.vue'), meta: { title: '消息通知' } },
    { path: '/reminders', component: () => import('@/views/RemindersView.vue'), meta: { tabbar: true, title: '24h 提醒', proto: 'M-12' } },
    { path: '/private-pending', redirect: { path: '/reminders', query: { f: 'private' } } },
    { path: '/advance', component: () => import('@/views/AdvanceReviewView.vue'), meta: { title: '预支初审', proto: 'M-11' } },
    { path: '/advance/:id', component: () => import('@/views/AdvanceDetailView.vue'), meta: { title: '预支详情', proto: 'M-11' } },
    { path: '/employees', component: () => import('@/views/EmployeesView.vue'), meta: { title: '在岗人员', proto: 'M-15' } },
    { path: '/incidents', component: () => import('@/views/IncidentsView.vue'), meta: { title: '工伤上报', proto: 'T-405' } },
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
