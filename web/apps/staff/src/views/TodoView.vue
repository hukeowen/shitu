<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  errorMessage,
  isApiError,
  tenantApi,
  type ProjectView,
  type SiteApplication,
  type SiteApplicationAction,
  type SiteWorkbench,
} from '@shitu/api-client'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'
import { STAGE_TEXT, fetchInterviewBuckets, type InterviewBuckets, type InterviewStage } from '@/utils/status'

/**
 * M-02 / M-03 待办清单：待知悉 / 待面试 / 已到厂 / 待确权（含签约状态），按项目筛选，按 24h 截止时间排序；
 * 卡片按钮完全由 allowedActions 决定（知悉推送、到厂、面试结果、爽约、取消、确权签约 / 重发）。
 *
 * 前三个页签是「待面试」报名的互斥子阶段（utils/status.interviewStage）：
 * 待知悉 = 未知悉；待面试 = 已知悉未到厂；已到厂 = 已到厂未录结果。一个人只出现在一个页签，角标之和 = 待面试总数。
 * 后端列表没有按子阶段筛选，这里一次取回全部待面试报名后在前端分桶；待确权仍走后端分页。
 */
type TabKey = InterviewStage | 'confirm'
interface TabDef {
  key: TabKey
  title: string
  empty: string
}
const TABS: TabDef[] = [
  { key: 'ack', title: STAGE_TEXT.ack, empty: '新报名都已知悉，暂无待办' },
  { key: 'interview', title: STAGE_TEXT.interview, empty: '暂无已知悉、待到厂面试的求职者' },
  { key: 'arrived', title: STAGE_TEXT.arrived, empty: '暂无已到厂、待录入面试结果的求职者' },
  { key: 'confirm', title: STAGE_TEXT.confirm, empty: '暂无待确权的求职者' },
]
const isStageTab = (k: TabKey): k is InterviewStage => k !== 'confirm'
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
/** 待面试三个子阶段的分桶（当前项目筛选下） */
const buckets = shallowRef<InterviewBuckets | null>(null)
/** 待确权总数（当前项目筛选下，列表加载后才有） */
const confirmTotal = ref<number | null>(null)
let bucketSeq = 0
async function loadBuckets() {
  const my = ++bucketSeq
  const b = await fetchInterviewBuckets(projectId.value)
  if (my === bucketSeq) buckets.value = b
}
function loadCounts() {
  tenantApi
    .siteWorkbench()
    .then((w) => (counts.value = w))
    .catch(() => undefined)
  // 停在「待确权」时列表不会顺带拉分桶，这里补拉以显示其余页签的角标
  if (tab.value === 'confirm') loadBuckets().catch(() => undefined)
  // 不在「待确权」时它的总数可能已过期（例如刚标记面试通过），退回工作台数字
  else confirmTotal.value = null
}
loadCounts()

function tabCount(k: TabKey): number | null {
  if (isStageTab(k)) return buckets.value ? buckets.value[k].length : null
  if (confirmTotal.value != null) return confirmTotal.value
  return counts.value && !projectId.value ? counts.value.pendingConfirm : null
}

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
  const key = tab.value
  try {
    if (isStageTab(key)) {
      await loadBuckets()
      if (my !== seq) return
      rows.value = buckets.value?.[key] ?? []
      total.value = rows.value.length
      finished.value = true
      return
    }
    const size = PAGE_SIZE
    const r = await tenantApi.applications({
      status: 'PENDING_CONFIRM',
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
    confirmTotal.value = r.total
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

watch([tab, projectId], ([, p], [, prev]) => {
  void router.replace({ query: { ...route.query, tab: tab.value, projectId: projectId.value || undefined } })
  if (p !== prev) {
    // 换项目后角标按新项目重算
    buckets.value = null
    confirmTotal.value = null
    loadCounts()
  }
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
          {{ t.title }}<span v-if="tabCount(t.key) != null" class="mono n">{{ tabCount(t.key) }}</span>
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
        <p v-if="tab !== 'confirm' && buckets?.truncated" class="t-xs" style="text-align: center">待面试报名超过 500 人，仅显示最紧急的一部分，可按项目筛选查看</p>
        <ApplicationCard v-for="a in rows" :key="a.applicationId" :app="a" :now="now" detail-link @action="onAction" @more="(a) => actions?.more(a)" />
        <van-empty v-if="finished && !rows.length && !error" image="search" :description="current.empty" />
      </van-list>
    </van-pull-refresh>

    <AppActions ref="actions" @done="onDone" />
  </div>
</template>

<style scoped>
.todo { min-height: calc(100vh - var(--tabbar-h, 0px)); }
.sticky { position: sticky; top: calc(46px + env(safe-area-inset-top)); z-index: 20; }
.atabs { display: flex; gap: 6px; overflow-x: auto; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.atabs::-webkit-scrollbar { height: 0; }
.atabs button { flex: none; padding: 5px 12px; border-radius: 20px; border: 0; font-size: 12.5px; color: var(--ink-500); background: var(--surface-3); font-weight: 500; }
.atabs button.on { background: var(--ink-900); color: #fff; font-weight: 600; }
.atabs .n { margin-left: 4px; font-size: 11px; opacity: .8; }
.filter :deep(.van-dropdown-menu__bar) { height: 40px; box-shadow: none; border-bottom: 1px solid var(--line); }
.pr { min-height: calc(100vh - 140px - var(--tabbar-h, 0px)); }
.list { padding-bottom: 16px; }
.state { padding-top: 40px; }
</style>
