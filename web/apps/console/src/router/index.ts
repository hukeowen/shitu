import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'
import { APP_TITLE, MENU } from './menu'

const children: RouteRecordRaw[] = MENU.flatMap((g) =>
  g.items.map((it) => ({
    path: it.path,
    component: () => import('@/views/PlaceholderView.vue'),
    meta: { title: it.title, proto: it.proto, group: g.title },
  })),
)

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录' } },
    {
      path: '/',
      component: AppLayout,
      redirect: MENU[0].items[0].path,
      children,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
})

export default router
