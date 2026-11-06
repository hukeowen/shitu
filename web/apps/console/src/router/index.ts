import { createRouter, createWebHistory, type RouteComponent, type RouteRecordRaw } from 'vue-router'
import { refreshSession } from '@shitu/api-client'
import AppLayout from '@/layout/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useMeStore } from '@/stores/me'
import { canAccess, homePath } from './access'
import { APP_TITLE, MENU } from './menu'

type Lazy = () => Promise<RouteComponent>

/** Sprint 1 已实现的页面；其余菜单项仍为占位页 */
const VIEWS: Record<string, Lazy> = {
  '/pm/jobs': () => import('@/views/jobs/JobListView.vue'),
  '/pm/jobs/edit': () => import('@/views/jobs/JobEditView.vue'),
  '/settings/org': () => import('@/views/settings/OrgView.vue'),
  '/settings/projects': () => import('@/views/settings/ProjectsView.vue'),
  '/settings/channels': () => import('@/views/settings/ChannelsView.vue'),
}

const children: RouteRecordRaw[] = MENU.flatMap((g) =>
  g.items.map((it) => ({
    path: it.path,
    component: VIEWS[it.path] ?? (() => import('@/views/PlaceholderView.vue')),
    meta: { title: it.title, proto: it.proto, group: g.title, access: it.access },
  })),
)

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
    {
      path: '/onboarding/apply',
      component: () => import('@/views/onboarding/OnboardingApplyView.vue'),
      meta: { title: '入驻申请', public: true },
    },
    {
      path: '/onboarding/status',
      component: () => import('@/views/onboarding/OnboardingStatusView.vue'),
      meta: { title: '入驻进度' },
    },
    { path: '/', component: AppLayout, children },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/** 页面刷新后内存 token 丢失：首次导航用 refresh Cookie 恢复一次 */
let restored = false

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const meStore = useMeStore()

  if (!auth.accessToken && !restored) {
    restored = true
    await refreshSession()
  }
  restored = true

  if (to.meta.public) {
    // 已登录再访问登录页 → 回首页
    if (to.path === '/login' && auth.accessToken) {
      if (!meStore.me) await meStore.load().catch(() => undefined)
      if (meStore.me) return meStore.me.operational ? homePath(meStore.me) : '/onboarding/status'
    }
    return true
  }

  if (!auth.accessToken) {
    meStore.clear()
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined }
  }

  if (!meStore.me) {
    try {
      await meStore.load()
    } catch {
      auth.accessToken = null
      return '/login'
    }
  }
  const me = meStore.me
  if (!me) return '/login'

  if (!me.operational) return to.path === '/onboarding/status' ? true : '/onboarding/status'
  if (to.path === '/onboarding/status' || to.path === '/') return homePath(me)
  if (!canAccess(me, to.meta.access)) return homePath(me)
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
})

export default router
