import { createRouter, createWebHistory, type LocationQuery } from 'vue-router'
import { bootstrap } from '@/boot'
import { useAuthStore } from '@/stores/auth'
import { useChannelStore } from '@/stores/channel'
import { useGuideStore } from '@/stores/guide'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { tabbar: true, title: '仕兔求职' } },
    {
      // 前端兜底：正常情况下 /r/{code} 由后端处理（记访问、写 7 天 Cookie、302 回 /?ch=）
      path: '/r/:code',
      component: { render: () => null },
      beforeEnter: (to) => {
        useChannelStore().capture(String(to.params.code))
        return { path: '/', replace: true }
      },
    },
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录 / 注册', guestOnly: true } },
    { path: '/reports', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, auth: true, title: '我的报备', proto: 'S-25' } },
    { path: '/me', component: () => import('@/views/MeView.vue'), meta: { tabbar: true, auth: true, title: '我的', proto: 'S-26' } },
    { path: '/feedback', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, auth: true, title: '问题反馈', proto: 'S-39' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

function withoutCh(q: LocationQuery): LocationQuery {
  const rest: LocationQuery = { ...q }
  delete rest.ch
  return rest
}

/** 只允许站内相对路径回跳，防止开放重定向 */
export function safeRedirect(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/'
}

router.beforeEach(async (to, from) => {
  // C-101：后端 302 回 /?ch={code}，暂存渠道码并从地址栏去掉
  if (to.query.ch !== undefined) {
    const ch = Array.isArray(to.query.ch) ? to.query.ch[0] : to.query.ch
    if (ch) useChannelStore().capture(ch)
    return { path: to.path, query: withoutCh(to.query), hash: to.hash, replace: true }
  }

  await bootstrap()
  const auth = useAuthStore()

  if (to.meta.guestOnly && auth.isLoggedIn) return { path: '/', replace: true }

  if (to.meta.auth && !auth.isLoggedIn) {
    // 站内点击 → 弹 S-03 引导弹窗并停留当前页；直接打开链接 → 去登录页
    if (from.matched.length > 0) {
      useGuideStore().open(to.fullPath)
      return false
    }
    return { path: '/login', query: { redirect: to.fullPath }, replace: true }
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ?? '仕兔求职'
})

export default router
