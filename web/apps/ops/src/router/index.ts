import { createRouter, createWebHistory, type RouteComponent, type RouteRecordRaw } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { APP_TITLE, HOME_PATH, MENU, QUIZ_ROLES } from './menu'

type Lazy = () => Promise<RouteComponent>

/** 已实现页面；其余菜单项使用占位页 */
const VIEWS: Record<string, Lazy> = {
  [HOME_PATH]: () => import('@/views/WorkbenchView.vue'),
  '/companies/list': () => import('@/views/companies/CompanyListView.vue'),
  '/governance/job-audit': () => import('@/views/jobs/JobAuditView.vue'),
  '/settlement/audit': () => import('@/views/audit/AuditLogView.vue'),
  '/system/admins': () => import('@/views/admins/AdminListView.vue'),
  '/engine/quiz': () => import('@/views/quiz/QuizVersionsView.vue'),
  '/engine/match-snapshot': () => import('@/views/quiz/MatchSnapshotView.vue'),
  '/ops/overview': () => import('@/views/overview/OverviewView.vue'),
  '/ops/attribution': () => import('@/views/attribution/AttributionView.vue'),
  '/engine/params': () => import('@/views/engine/EngineParamsView.vue'),
  '/companies/stock': () => import('@/views/billing/StockBaseView.vue'),
  '/governance/throttle': () => import('@/views/risk/JobWeightsView.vue'),
  '/governance/compliance': () => import('@/views/compliance/ComplianceView.vue'),
  '/governance/complaints': () => import('@/views/risk/ComplaintsView.vue'),
  '/governance/credit': () => import('@/views/risk/CreditView.vue'),
  '/settlement/rules': () => import('@/views/billing/BillingRulesView.vue'),
  '/settlement/bills': () => import('@/views/billing/BillListView.vue'),
  '/system/templates': () => import('@/views/notify/TemplatesView.vue'),
}

const children: RouteRecordRaw[] = MENU.flatMap((g) =>
  g.items.map((it) => ({
    path: it.path,
    component: VIEWS[it.path] ?? (() => import('@/views/PlaceholderView.vue')),
    meta: { title: it.title, proto: it.proto, group: g.title, roles: it.roles },
  })),
)
children.push({
  path: '/engine/quiz/:versionId(\\d+)',
  component: () => import('@/views/quiz/QuizEditorView.vue'),
  meta: { title: '题库版本', proto: 'P-12', group: '匹配引擎', roles: QUIZ_ROLES, activeMenu: '/engine/quiz' },
})
children.push({ path: '/forbidden', component: () => import('@/views/ForbiddenView.vue'), meta: { title: '无权限' } })

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
    {
      path: '/',
      component: AppLayout,
      redirect: HOME_PATH,
      children,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  const ok = await auth.ensureSession()
  if (!ok || !auth.me) {
    return { path: '/login', query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  // 首次登录 / 被重置密码：必须先改密，不能进入业务页面
  if (auth.me.mustChangePassword) return { path: '/login' }
  if (!auth.hasAnyRole(to.meta.roles)) {
    return { path: '/forbidden', query: { from: to.fullPath } }
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
})

export default router
