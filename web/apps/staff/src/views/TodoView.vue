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
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'
import { isToday } from '@/utils/time'

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
  /** 前端过滤（今日到厂：后端暂无 arrivedAt 筛选） */
  filter?: (a: SiteApplication) => boolean
  empty: string
}
const TABS: TabDef[] = [
  { key: 'ack', title: '待知悉', status: 'PENDING_INTERVIEW', unacknowledged: true, count: (w) => w.pendingAck, empty: '新报名都已知悉，暂无待办' },
  { key: 'interview', title: '待面试', status: 'PENDING_INTERVIEW', count: (w) => w.pendingInterview, empty: '暂无待面试的求职者' },
  { key: 'arrived', title: '今日到厂', status: 'PENDING_INTERVIEW', filter: (a) => isToday(a.arrivedAt), empty: '今天还没有确认到厂的求职者' },
  { key: 'confirm', title: '待确权', status: 'PENDING_CONFIRM', count: (w) => w.pendingConfirm, empty: '暂无待确权的求职者' },
]
const PAGE_SIZE = 20
/** 前端过滤的标签页一次多取一些 */
const FILTER_PAGE_SIZE = 100

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
    const size = def.filter ? FILTER_PAGE_SIZE : PAGE_SIZE
    const r = await tenantApi.applications({
      status: def.status,
      unacknowledged: def.unacknowledged,
      projectId: projectId.value || undefined,
      page: page + 1,
      pageSize: size,
      sort: 'DEADLINE',
    })
    if (my !== seq) return
    page += 1
    fetched += r.records.length
    rows.value = [...rows.value, ...(def.filter ? r.records.filter(def.filter) : r.records)]
    total.value = def.filter ? rows.value.length : r.total
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
    <div class="sticky">
      <div class="atabs" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          :class="{ on: tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.title }}<span v-if="t.count && counts && !projectId" class="mono n">{{ t.count(counts) }}</span><span v-else-if="t.filter && tab === t.key && finished && !error" class="mono n">{{ total }}</span>
        </button>
      </div>
      <van-dropdown-menu v-if="projects.length > 1" class="filter" active-color="var(--signal)">
        <van-dropdown-item v-model="projectId" :options="projectOptions" />
      </van-dropdown-menu>
    </div>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="forbidden" class="state">
        <van-empty description="你的角色暂无报名待办权限（仅驻场 / 项目经理）" />
      </div>
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
        <ApplicationCard v-for="a in rows" :key="a.applicationId" :app="a" :now="now" detail-link @action="onAction" @more="(a) => actions?.more(a)" />
        <van-empty v-if="finished && !rows.length && !error" image="search" :description="current.empty" />
      </van-list>
    </van-pull-refresh>

    <AppActions ref="actions" @done="onDone" />
  </div>
</template>

<style scoped>
.todo { min-height: 100vh; }
.sticky { position: sticky; top: calc(46px + env(safe-area-inset-top)); z-index: 20; }
.atabs { display: flex; gap: 6px; overflow-x: auto; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.atabs::-webkit-scrollbar { height: 0; }
.atabs button { flex: none; padding: 5px 12px; border-radius: 20px; border: 0; font-size: 12.5px; color: var(--ink-500); background: var(--surface-3); font-weight: 500; }
.atabs button.on { background: var(--ink-900); color: #fff; font-weight: 600; }
.atabs .n { margin-left: 4px; font-size: 11px; opacity: .8; }
.filter :deep(.van-dropdown-menu__bar) { height: 40px; box-shadow: none; border-bottom: 1px solid var(--line); }
.pr { min-height: calc(100vh - 140px); }
.list { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
.state { padding-top: 40px; }
</style>
