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
  type SiteWorkbench,
} from '@shitu/api-client'
import AcknowledgePopup from '@/components/AcknowledgePopup.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'

/** M-02 待办清单：待知悉 / 待面试 / 待确权，按项目筛选，知悉 → 推送面试信息 */
type TabKey = 'ack' | 'interview' | 'confirm'
interface TabDef {
  key: TabKey
  title: string
  status: ApplicationStatus
  unacknowledged?: boolean
  count: (w: SiteWorkbench) => number
  empty: string
}
const TABS: TabDef[] = [
  { key: 'ack', title: '待知悉', status: 'PENDING_INTERVIEW', unacknowledged: true, count: (w) => w.pendingAck, empty: '新报名都已知悉，暂无待办' },
  { key: 'interview', title: '待面试', status: 'PENDING_INTERVIEW', count: (w) => w.pendingInterview, empty: '暂无待面试的求职者' },
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
const rows = shallowRef<SiteApplication[]>([])
const loading = ref(false)
const finished = ref(false)
const error = ref(false)
const errorText = ref('')
const forbidden = ref(false)
const refreshing = ref(false)
const total = ref(0)
let page = 0
let seq = 0

async function loadMore() {
  const my = seq
  const def = current.value
  try {
    const r = await tenantApi.applications({
      status: def.status,
      unacknowledged: def.unacknowledged,
      projectId: projectId.value || undefined,
      page: page + 1,
      pageSize: PAGE_SIZE,
    })
    if (my !== seq) return
    page += 1
    rows.value = [...rows.value, ...r.records]
    total.value = r.total
    finished.value = rows.value.length >= r.total || r.records.length < PAGE_SIZE
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

// ---------- 知悉 / 修改面试信息 ----------
const ackShow = ref(false)
const ackApp = shallowRef<SiteApplication | null>(null)
function openAck(app: SiteApplication) {
  ackApp.value = app
  ackShow.value = true
}
function onAcked() {
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
          {{ t.title }}<span v-if="counts && !projectId" class="mono n">{{ t.count(counts) }}</span>
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
        <ApplicationCard v-for="a in rows" :key="a.applicationId" :app="a" :now="now" detail-link @action="openAck" />
        <van-empty v-if="finished && !rows.length && !error" image="search" :description="current.empty" />
      </van-list>
    </van-pull-refresh>

    <AcknowledgePopup v-model:show="ackShow" :application="ackApp" @done="onAcked" />
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
