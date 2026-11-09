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
    { path: '/reports', component: () => import('@/views/ReportsView.vue'), meta: { tabbar: true, auth: true, title: '我的报备', proto: 'S-25' } },
    { path: '/reports/:applicationId', component: () => import('@/views/InterviewView.vue'), meta: { auth: true, title: '面试确认信息', proto: 'S-24' } },
    // AI 问薪（C-301~C-306）：匹配是岗位的唯一入口（R-01）
    { path: '/match', component: () => import('@/views/match/MatchIntroView.vue'), meta: { auth: true, title: 'AI 问薪', proto: 'S-11' } },
    { path: '/match/quiz', component: () => import('@/views/match/QuizView.vue'), meta: { auth: true, title: 'AI 问薪', proto: 'S-12' } },
    { path: '/match/result', component: () => import('@/views/match/MatchResultView.vue'), meta: { auth: true, title: '匹配结果', proto: 'S-16' } },
    // 岗位与报名（C-401~C-408）
    { path: '/jobs/:jobId', component: () => import('@/views/JobDetailView.vue'), meta: { auth: true, title: '岗位详情', proto: 'S-18' } },
    { path: '/kyc/appeals', component: () => import('@/views/AppealsView.vue'), meta: { auth: true, title: '我的申诉', proto: 'S-46' } },
    { path: '/kyc', component: () => import('@/views/KycView.vue'), meta: { auth: true, title: '身份验证', proto: 'S-21' } },
    { path: '/apply/success', component: () => import('@/views/ApplySuccessView.vue'), meta: { auth: true, title: '报名成功', proto: 'S-23' } },
    { path: '/messages', component: () => import('@/views/MessagesView.vue'), meta: { auth: true, title: '消息中心', proto: 'S-40' } },
    // 入职闭环（Sprint 3）：电子签约 → 在岗；我的合同 / 我的工作
    { path: '/contracts/sign', component: () => import('@/views/contract/ContractSignView.vue'), meta: { auth: true, title: '签署劳动合同', proto: 'S-09' } },
    // 【仅开发环境】Mock 电子签的签署页（生产环境签署页在 e签宝）
    { path: '/esign/mock/:flowId', component: () => import('@/views/contract/MockESignView.vue'), meta: { auth: true, title: '电子签署' } },
    { path: '/contracts', component: () => import('@/views/contract/ContractsView.vue'), meta: { auth: true, title: '我的合同', proto: 'S-27' } },
    { path: '/contracts/:id', component: () => import('@/views/contract/ContractDetailView.vue'), meta: { auth: true, title: '合同详情', proto: 'S-28' } },
    { path: '/work', component: () => import('@/views/WorkView.vue'), meta: { auth: true, title: '我的工作', proto: 'S-30' } },
    // 薪资预支（Sprint 5，C-601~C-604）与工资条（C-701）
    { path: '/advance', component: () => import('@/views/advance/AdvanceView.vue'), meta: { auth: true, title: '薪资预支', proto: 'S-33' } },
    { path: '/advance/records', component: () => import('@/views/advance/AdvanceRecordsView.vue'), meta: { auth: true, title: '预支记录', proto: 'S-36' } },
    { path: '/advance/:id', component: () => import('@/views/advance/AdvanceProgressView.vue'), meta: { auth: true, title: '审批进度', proto: 'S-35' } },
    { path: '/payslips', component: () => import('@/views/payslip/PayslipsView.vue'), meta: { auth: true, title: '我的工资', proto: 'S-41' } },
    { path: '/payslips/:id', component: () => import('@/views/payslip/PayslipDetailView.vue'), meta: { auth: true, title: '工资条明细', proto: 'S-42' } },
    // 专属顾问（人才经纪人）推荐（T-203）
    { path: '/recommendations', component: () => import('@/views/RecommendationsView.vue'), meta: { auth: true, title: '专属顾问推荐' } },
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
