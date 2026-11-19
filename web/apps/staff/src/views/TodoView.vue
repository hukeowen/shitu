<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import {
  errorMessage,
  isApiError,
  tenantApi,
  type ApplicationBatchResult,
  type ProjectView,
  type SiteApplication,
  type SiteApplicationAction,
  type SiteWorkbench,
} from '@shitu/api-client'
import { IconCircleExclamationPoint, IconClipboardList, IconLock } from '@shitu/ui-icons'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'
import { has } from '@/utils/actions'
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

watch([tab, projectId], ([, p], [, prev]) => {
  exitBatch()
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
function onRejected(a: SiteApplication, action: SiteApplicationAction, reason: string) {
  blocked.value = { ...blocked.value, [a.applicationId]: { action, reason } }
}
function onDone() {
  loadCounts()
  reset()
}

// ---------- 批量知悉 / 批量到厂确认 ----------
/** 一次最多处理的人数（后端同口径） */
const BATCH_MAX = 50
type BatchAction = 'ACKNOWLEDGE' | 'ARRIVE'
const BATCH: Partial<Record<TabKey, { action: BatchAction; label: string }>> = {
  ack: { action: 'ACKNOWLEDGE', label: '批量知悉' },
  interview: { action: 'ARRIVE', label: '批量到厂确认' },
}
const batch = computed(() => BATCH[tab.value] ?? null)
/** 选择模式：卡片出勾选框，点卡片是勾选而不是进详情 */
const selecting = ref(false)
const picked = ref<string[]>([])

/** 这张卡片能不能勾选：严格按后端 allowedActions；到厂确认还要没到过厂；后端刚拒绝过的不算 */
function eligible(a: SiteApplication): boolean {
  const b = batch.value
  if (!b || !has(a, b.action) || blocked.value[a.applicationId]) return false
  return b.action !== 'ARRIVE' || !a.arrivedAt
}
const eligibleRows = computed(() => rows.value.filter(eligible))
function exitBatch() {
  selecting.value = false
  picked.value = []
}
function toggleBatch() {
  if (selecting.value) exitBatch()
  else selecting.value = true
}
function onToggle(a: SiteApplication) {
  const b = batch.value
  if (!b) return
  const id = a.applicationId
  if (picked.value.includes(id)) picked.value = picked.value.filter((x) => x !== id)
  else if (!eligible(a)) showToast(`${a.seekerName} 当前不能${b.action === 'ARRIVE' ? '到厂确认' : '知悉推送'}`)
  else if (picked.value.length >= BATCH_MAX) showToast(`一次最多选择 ${BATCH_MAX} 人`)
  else picked.value = [...picked.value, id]
}
/** 全选已加载的可选卡片（最多 50 人）；已经全选时再点一次清空 */
function pickAll() {
  const all = eligibleRows.value.slice(0, BATCH_MAX).map((a) => a.applicationId)
  if (all.length && all.length === picked.value.length && all.every((id) => picked.value.includes(id))) {
    picked.value = []
    return
  }
  picked.value = all
  if (eligibleRows.value.length > BATCH_MAX) showToast(`一次最多选择 ${BATCH_MAX} 人，已选前 ${BATCH_MAX} 人`)
}
function runBatch() {
  const b = batch.value
  if (!b) return
  const apps = eligibleRows.value.filter((a) => picked.value.includes(a.applicationId))
  if (!apps.length) {
    showToast('请先选择求职者')
    return
  }
  void actions.value?.runBatch(b.action, apps)
}
function onBatchDone(_action: BatchAction, r: ApplicationBatchResult) {
  const bad = r.items.filter((i) => !i.ok).map((i) => i.applicationId)
  // 全部成功就退出选择模式；有没成功的保持选中
  if (bad.length) picked.value = bad
  else exitBatch()
  onDone()
}
// 列表重新加载完：选中的只留还在列表里、还能选的；没有可选的了就退出选择模式
watch(loading, (v) => {
  if (v || !selecting.value) return
  if (!eligibleRows.value.length) exitBatch()
  else picked.value = picked.value.filter((id) => eligibleRows.value.some((a) => a.applicationId === id))
})

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
const showBack = computed(() => route.meta.tabbar !== true)
</script>

<template>
  <div class="todo">
    <van-nav-bar title="待办清单" :left-arrow="showBack" safe-area-inset-top fixed placeholder z-index="30" @click-left="back">
      <template v-if="batch && (selecting || eligibleRows.length)" #right>
        <button type="button" class="batch-toggle" :aria-pressed="selecting" @click.stop="toggleBatch">{{ selecting ? '退出批量' : '批量' }}</button>
      </template>
    </van-nav-bar>
    <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab v-for="t in TABS" :key="t.key" :name="t.key">
        <template #title>{{ t.title }}<span v-if="tabCount(t.key) != null" class="n">{{ tabCount(t.key) }}</span></template>
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
        :class="{ 'list--batch': selecting }"
        @load="loadMore"
      >
        <p v-if="tab === 'ack' && rows.length" class="note">
          新报名需在 <b>24 小时</b>内知悉并推送面试信息，超时将被动释放至公域。
        </p>
        <p v-else-if="tab === 'confirm' && rows.length" class="note">
          面试通过后须在 <b>24 小时</b>内完成入职确权并发起电子签约；求职者签署完成即「已入职在岗」。
        </p>
        <p v-if="tab !== 'confirm' && buckets?.truncated" class="list-end">待面试报名超过 500 人，仅显示最紧急的一部分，可按项目筛选查看</p>
        <ApplicationCard
          v-for="a in rows"
          :key="a.applicationId"
          :app="a"
          :now="now"
          :blocked="blocked[a.applicationId]"
          detail-link
          :selecting="selecting"
          :checked="picked.includes(a.applicationId)"
          :select-disabled="selecting && !eligible(a)"
          @toggle="onToggle"
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

    <!-- 放在下拉刷新外面：下拉容器带 transform，里面的 fixed 会跟着它定位 -->
    <div v-if="selecting && batch" class="bottom-bar batch-bar" role="region" aria-label="批量操作">
      <span class="batch-n">已选 {{ picked.length }} 人</span>
      <button type="button" class="batch-all" @click="pickAll">全选</button>
      <span class="flex1" />
      <van-button class="batch-cancel" @click="exitBatch">取消</van-button>
      <van-button type="primary" class="batch-go" :disabled="!picked.length" @click="runBatch">{{ batch.label }}</van-button>
    </div>

    <AppActions ref="actions" @done="onDone" @batch-done="onBatchDone" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.todo { min-height: calc(100vh - var(--tabbar-h, 0px)); }
.n { margin-left: var(--space-1); }
.filter :deep(.van-dropdown-menu__bar) { height: 44px; box-shadow: none; border-bottom: 1px solid var(--divider); }
.pr { min-height: calc(100vh - 140px - var(--tabbar-h, 0px)); }
/* 有标签栏时底部安全区已由标签栏留出 */
.list { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
:root.has-tabbar .list { padding-bottom: 16px; }
/* 批量选择：底部通栏贴在标签栏上面（没有标签栏时贴底并留安全区），列表底部多留出通栏的高度 */
.batch-toggle { min-height: 44px; padding: 0 var(--space-1); border: 0; background: none; font: inherit; font-size: var(--font-size-body); color: var(--primary-text); white-space: nowrap; }
.batch-bar { bottom: var(--tabbar-h, 0px); display: flex; align-items: center; gap: var(--space-2); }
:root.has-tabbar .batch-bar { padding-bottom: var(--space-2); }
.batch-n { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); white-space: nowrap; }
.batch-all { flex: none; min-height: 44px; padding: 0 var(--space-2); border: 0; background: none; font: inherit; font-size: var(--font-size-body); color: var(--primary-text); white-space: nowrap; }
.batch-cancel, .batch-go { flex: none; padding: 0 var(--space-3); white-space: nowrap; }
.list.list--batch { padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
:root.has-tabbar .list.list--batch { padding-bottom: 76px; }
</style>
