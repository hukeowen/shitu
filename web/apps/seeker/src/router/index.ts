import { createRouter, createWebHistory } from 'vue-router'
import { saveChannel } from '@/stores/channel'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('@/views/HomeView.vue'), meta: { tabbar: true, title: '仕兔求职' } },
    {
      path: '/r/:code',
      component: { render: () => null },
      beforeEnter: (to) => {
        saveChannel(String(to.params.code))
        return { path: '/', replace: true }
      },
    },
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录 / 注册' } },
    { path: '/reports', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, title: '我的报备', proto: 'S-25' } },
    { path: '/me', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, title: '我的', proto: 'S-26' } },
    { path: '/feedback', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, title: '问题反馈', proto: 'S-39' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  document.title = (to.meta.title as string) ?? '仕兔求职'
})

export default router
