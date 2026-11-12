<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  errorMessage,
  isApiError,
  tenantApi,
  type ApplicationStatus,
  type ProjectView,
  type SiteApplication,
  type SiteApplicationAction,
  type SiteWorkbench,
} from '@shitu/api-client'
import { IconCircleExclamationPoint, IconClipboardList, IconLock } from '@shitu/ui-icons'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'

/**
 * M-02 / M-03 待办清单：待知悉 / 待面试 / 今日到厂 / 待确权（含签约状态），按项目筛选，按 24h 截止时间排序；
 * 卡片按钮完全由 allowedActions 决定（知悉推送、到厂、面试结果、爽约、取消、确权签约 / 重发）。
 */
type TabKey = 'ack' | 'interview' | 'arrived' | 'confirm'
interface TabDef {
  key: TabKey
  title: string
  status: ApplicationStatus
  unacknowledged?: boolean
  count?: (w: SiteWorkbench) => number
  /** 今日到厂（按北京日历日，后端筛选） */
  arrivedToday?: boolean
  empty: string
}
const TABS: TabDef[] = [
  { key: 'ack', title: '待知悉', status: 'PENDING_INTERVIEW', unacknowledged: true, count: (w) => w.pendingAck, empty: '新报名都已知悉，暂无待办' },
  { key: 'interview', title: '待面试', status: 'PENDING_INTERVIEW', count: (w) => w.pendingInterview, empty: '暂无待面试的求职者' },
  { key: 'arrived', title: '今日到厂', status: 'PENDING_INTERVIEW', arrivedToday: true, count: (w) => w.arrivedToday, empty: '今天还没有确认到厂的求职者' },
  { key: 'confirm', title: '待确权', status: 'PENDING_CONFIRM', count: (w) => w.pendingConfirm, empty: '暂无待确权的求职者' },
]
const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const now = useNow()

const asTab = (v: unknown): TabKey => (TABS.some((t) => t.key === v) ? (v as TabKey) : 'ack')
const tab = ref<TabKey>(asTab(route.query.tab))
const projectId = ref<string>(typeof route.query.projectId === 'string' ? route.query.projectId : '')
const current = computed(() => TABS.find((t) => t.key === tab.value) ?? TABS[0])

// ---------- 项目筛选 / 角标 ----------
const projects = shallowRef<ProjectView[]>([])
const counts = ref<SiteWorkbench | null>(null)
tenantApi
  .projects()
  .then((ps) => (projects.value = ps))
  .catch(() => undefined)
const projectOptions = computed(() => [{ text: '全部项目', value: '' }, ...projects.value.map((p) => ({ text: p.name, value: p.projectId }))])
function loadCounts() {
  tenantApi
    .siteWorkbench()
    .then((w) => (counts.value = w))
    .catch(() => undefined)
}
loadCounts()

// ---------- 分页列表 ----------
/** 后端拒绝过的操作：这一条的按钮置灰、原因留在卡片上，刷新后重新判断 */
const blocked = ref<Record<string, { action: SiteApplicationAction; reason: string }>>({})
const rows = shallowRef<SiteApplication[]>([])
const loading = ref(false)
const finished = ref(false)
const error = ref(false)
const errorText = ref('')
const forbidden = ref(false)
const refreshing = ref(false)
const total = ref(0)
let page = 0
let fetched = 0
let seq = 0

async function loadMore() {
  const my = seq
  const def = current.value
  try {
    const size = PAGE_SIZE
    const r = await tenantApi.applications({
      status: def.status,
      unacknowledged: def.unacknowledged,
      arrivedToday: def.arrivedToday,
      projectId: projectId.value || undefined,
      page: page + 1,
      pageSize: size,
      sort: 'DEADLINE',
    })
    if (my !== seq) return
    page += 1
    fetched += r.records.length
    rows.value = [...rows.value, ...r.records]
    total.value = r.total
    finished.value = fetched >= r.total || r.records.length < size
  } catch (e) {
    if (my !== seq) return
    if (isApiError(e) && e.status === 403) {
      forbidden.value = true
      finished.value = true
    } else {
      error.value = true
      errorText.value = errorMessage(e, '加载失败')
    }
  } finally {
    if (my === seq) loading.value = false
  }
}

function reset() {
  seq += 1
  blocked.value = {}
  page = 0
  fetched = 0
  rows.value = []
  total.value = 0
  error.value = false
  forbidden.value = false
  finished.value = false
  loading.value = true
  void loadMore()
}
reset()

async function onRefresh() {
  loadCounts()
  reset()
  // 等首页加载完成再收起下拉
  const stop = watch(loading, (v) => {
    if (!v) {
      refreshing.value = false
      stop()
    }
  })
}

watch([tab, projectId], () => {
  void router.replace({ query: { ...route.query, tab: tab.value, projectId: projectId.value || undefined } })
  reset()
})
watch(
  () => route.query.tab,
  (v) => {
    if (v !== undefined && asTab(v) !== tab.value) tab.value = asTab(v)
  },
)

// ---------- 报名操作 ----------
const actions = ref<InstanceType<typeof AppActions> | null>(null)
function onAction(app: SiteApplication, action: SiteApplicationAction) {
  void actions.value?.run(action, app)
}
function onRejected(a: SiteApplication, action: SiteApplicationAction, reason: string) {
  blocked.value = { ...blocked.value, [a.applicationId]: { action, reason } }
}
function onDone() {
  loadCounts()
  reset()
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
const showBack = computed(() => route.meta.tabbar !== true)
</script>

<template>
  <div class="todo">
    <van-nav-bar title="待办清单" :left-arrow="showBack" safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab v-for="t in TABS" :key="t.key" :name="t.key">
        <template #title>{{ t.title }}<span v-if="t.count && counts && !projectId" class="n">{{ t.count(counts) }}</span></template>
      </van-tab>
    </van-tabs>
    <van-dropdown-menu v-if="projects.length > 1" class="filter" active-color="var(--primary-text)">
      <van-dropdown-item v-model="projectId" :options="projectOptions" />
    </van-dropdown-menu>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="forbidden" class="state-block">
        <IconLock :size="48" />
        <p class="state-block-t">暂无报名待办权限</p>
        <p class="state-block-d">你的角色暂无报名待办权限（仅驻场 / 项目经理）</p>
      </div>
      <div v-else-if="error && !rows.length" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ errorText || '加载失败' }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reset">重新加载</van-button>
      </div>
      <div v-else-if="loading && !rows.length" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <van-list
        v-else
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :immediate-check="false"
        :error-text="`${errorText || '加载失败'}，点击重试`"
        :finished-text="rows.length ? '没有更多了' : ''"
        class="pad stack list"
        @load="loadMore"
      >
        <p v-if="tab === 'ack' && rows.length" class="note">
          新报名需在 <b>24 小时</b>内知悉并推送面试信息，超时将被动释放至公域。
        </p>
        <p v-else-if="tab === 'confirm' && rows.length" class="note">
          面试通过后须在 <b>24 小时</b>内完成入职确权并发起电子签约；求职者签署完成即「已入职在岗」。
        </p>
        <ApplicationCard
          v-for="a in rows"
          :key="a.applicationId"
          :app="a"
          :now="now"
          :blocked="blocked[a.applicationId]"
          detail-link
          @action="onAction"
          @more="(a) => actions?.more(a)"
        />
        <div v-if="finished && !rows.length && !error" class="state-block">
          <IconClipboardList :size="48" />
          <p class="state-block-t">{{ current.empty }}</p>
          <p class="state-block-d">下拉可刷新</p>
        </div>
      </van-list>
    </van-pull-refresh>

    <AppActions ref="actions" @done="onDone" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.todo { min-height: 100vh; }
.n { margin-left: var(--space-1); }
.filter :deep(.van-dropdown-menu__bar) { height: 44px; box-shadow: none; border-bottom: 1px solid var(--divider); }
.pr { min-height: calc(100vh - 140px); }
.list { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
</style>
