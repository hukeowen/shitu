import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('@/views/WorkbenchView.vue'), meta: { tabbar: true, title: '驻场工作台', proto: 'M-01' } },
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录' } },
    { path: '/todo/interview', component: () => import('@/views/PlaceholderView.vue'), meta: { title: '待面试', proto: 'M-02' } },
    { path: '/todo/confirm', component: () => import('@/views/PlaceholderView.vue'), meta: { title: '待确权', proto: 'M-03' } },
    { path: '/todo/onboard', component: () => import('@/views/PlaceholderView.vue'), meta: { title: '待入职', proto: 'M-03' } },
    { path: '/todo', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, title: '待办', proto: 'M-02' } },
    { path: '/reminders', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, title: '24h 提醒', proto: 'M-12' } },
    { path: '/advance', component: () => import('@/views/PlaceholderView.vue'), meta: { title: '预支初审', proto: 'M-11' } },
    { path: '/me', component: () => import('@/views/PlaceholderView.vue'), meta: { tabbar: true, title: '我的' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  document.title = to.meta.title ?? '仕兔驻场'
})

export default router
