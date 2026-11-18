<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type SiteApplication, type SiteApplicationAction, type SiteWorkbench } from '@shitu/api-client'
import {
  IconBanknote,
  IconBell,
  IconCalendar,
  IconChevronRight,
  IconCircleExclamationPoint,
  IconClipboardList,
  IconMapPin,
  IconQrCode,
  IconShieldCheck,
  IconUsers,
} from '@shitu/ui-icons'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { advanceWording, canReview } from '@/utils/advance'
import { fetchInterviewBuckets, type InterviewBuckets } from '@/utils/status'
import { fmtDuration, parseLocal } from '@/utils/time'

/**
 * M-01 驻场工作台：白色身份头、4 个待办数字（待知悉 / 待面试 / 待确权 / 私域待匹配）、24h 超时提示条、待知悉报名卡片、更多事项。
 * 待知悉 / 待面试 / 已到厂三个数字与待办页签同源（utils/status 的分桶，互斥不重复计数）。
 */
const auth = useAuthStore()
const inbox = useInboxStore()
const router = useRouter()
const now = useNow(30_000)
const { label } = useDict()
const me = computed(() => auth.me)
const loading = ref(false)
const loadError = ref('')

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    const m = await auth.loadMe()
    if (!m.operational) await router.replace('/notice')
    else void loadData()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const roleText = computed(() => (me.value?.roles ?? []).map((r) => label('ActorRole', r)).join(' / '))
const companyName = computed(() => me.value?.company.shortName || me.value?.company.name || '')
const canMyCode = computed(() => auth.can('CHANNEL_MINE'))
/** 报名列表接口只对驻场 / 项目经理开放 */
const canApps = computed(() => (me.value?.roles ?? []).some((r) => r === 'SITE' || r === 'PM'))

// ---------- 数据 ----------
const wb = ref<SiteWorkbench | null>(null)
const wbError = ref('')
const todayList = shallowRef<SiteApplication[]>([])
const todayLoaded = ref(false)
const todayError = ref('')
const refreshing = ref(false)
/** 24h 窗口的截止时间（待面试、待确权、私域待匹配三个阶段各取最早一条还没到期的），算「最短还剩」 */
const deadlines = shallowRef<number[]>([])

/** 待知悉 / 待面试 / 已到厂分桶（仅驻场 / 项目经理可拉取） */
const buckets = shallowRef<InterviewBuckets | null>(null)
const adv = computed(() => advanceWording(me.value?.roles))

/** 待我审批的预支：驻场 = 待初审，项目经理 = 待终审（按 allowedActions） */
const advTodo = ref<number | null>(null)

const ts = (v?: string) => parseLocal(v)?.getTime() ?? null
/**
 * 三个来源都按截止时间升序（报名列表 sort=DEADLINE 按用户最早的打开窗口排；私域待匹配接口 ORDER BY deadline），
 * 所以每个来源里第一条还没到期的就是这一阶段最近的截止时间。已到期但还没被扫描任务关掉的窗口最多滞留 1 分钟，
 * 多取几条（DEADLINE_PEEK）跳过它们。
 */
const DEADLINE_PEEK = 5
const firstAhead = (list: (number | null)[]) => list.find((d): d is number => d != null && d > now.value) ?? null

async function loadData() {
  void inbox.refresh()
  void tenantApi
    .advances()
    .then((r) => (advTodo.value = r.filter(canReview).length))
    .catch(() => (advTodo.value = null))
  const found: (number | null)[] = []
  const tasks: Promise<unknown>[] = [
    tenantApi
      .siteWorkbench()
      .then((w) => {
        wb.value = w
        wbError.value = ''
      })
      .catch((e: unknown) => {
        wbError.value = isApiError(e) && e.status === 403 ? '' : errorMessage(e, '待办数字加载失败')
      }),
    tenantApi
      .privatePending()
      .then((r) => found.push(firstAhead(r.map((p) => ts(p.deadline)))))
      .catch(() => undefined),
  ]
  if (canApps.value) {
    todayError.value = ''
    // 重试期间先回到加载中，不闪一下空状态
    if (!todayList.value.length) todayLoaded.value = false
    tasks.push(
      fetchInterviewBuckets()
        .then((b) => {
          buckets.value = b
          todayList.value = b.ack.slice(0, 3)
        })
        .catch((e: unknown) => {
          buckets.value = null
          todayList.value = []
          todayError.value = errorMessage(e, '待知悉报名加载失败')
        })
        .finally(() => (todayLoaded.value = true)),
      tenantApi
        .applications({ status: 'PENDING_INTERVIEW', page: 1, pageSize: DEADLINE_PEEK, sort: 'DEADLINE' })
        .then((r) => found.push(firstAhead(r.records.map((a) => ts(a.responseDeadline)))))
        .catch(() => undefined),
      tenantApi
        .applications({ status: 'PENDING_CONFIRM', page: 1, pageSize: DEADLINE_PEEK, sort: 'DEADLINE' })
        .then((r) => found.push(firstAhead(r.records.map((a) => ts(a.responseDeadline)))))
        .catch(() => undefined),
    )
  }
  await Promise.all(tasks)
  deadlines.value = found.filter((d): d is number => d != null)
}

async function onRefresh() {
  try {
    if (!auth.me) await reload()
    else await loadData()
  } finally {
    refreshing.value = false
  }
}

if (!auth.me) void reload()
else if (auth.operational) void loadData()

const n = (v: number | undefined) => (wb.value ? String(v ?? 0) : '—')
/** 分桶可用时以分桶为准；否则退回工作台接口（pendingInterview 含未知悉，需扣除） */
const ackCount = computed(() => buckets.value?.ack.length ?? wb.value?.pendingAck)
const interviewCount = computed(() => buckets.value?.interview.length ?? (wb.value ? Math.max(0, wb.value.pendingInterview - wb.value.pendingAck) : undefined))
const arrivedCount = computed(() => buckets.value?.arrived.length)
const nb = (v: number | undefined) => (buckets.value ? String(v ?? 0) : n(v))

interface Kpi {
  key: string
  title: string
  value: string
  to: string
  /** 不限驻场 / 项目经理（私域待匹配接口对其他角色返回脱敏数据） */
  open?: boolean
}
const kpis = computed<Kpi[]>(() => [
  { key: 'ack', title: '待知悉', value: nb(ackCount.value), to: '/todo?tab=ack' },
  { key: 'interview', title: '待面试', value: nb(interviewCount.value), to: '/todo?tab=interview' },
  { key: 'confirm', title: '待确权', value: n(wb.value?.pendingConfirm), to: '/todo?tab=confirm' },
  { key: 'private', title: '私域待匹配', value: n(wb.value?.privatePending), to: '/reminders?f=private', open: true },
])

function go(to: string, open?: boolean) {
  if (!canApps.value && !open) {
    showToast('报名待办仅对驻场 / 项目经理开放')
    return
  }
  void router.push(to)
}

const due = computed(() => wb.value?.windowsDueIn4h ?? 0)
/** 还没超时的窗口里最短的剩余时间；都已超时或拿不到截止时间时不写 */
const shortest = computed(() => {
  const left = deadlines.value.map((d) => d - now.value).filter((ms) => ms > 0)
  return left.length ? fmtDuration(Math.min(...left)) : null
})

interface Entry {
  key: string
  title: string
  desc: string
  icon: typeof IconCalendar
  to: string
  count?: number
  open?: boolean
}
const entries = computed<Entry[]>(() => [
  { key: 'interview', title: '待面试', desc: '已知悉待到厂', icon: IconCalendar, to: '/todo?tab=interview', count: interviewCount.value },
  { key: 'confirm', title: '待确权', desc: '面试通过待确权', icon: IconShieldCheck, to: '/todo?tab=confirm', count: wb.value?.pendingConfirm },
  { key: 'arrive', title: '已到厂', desc: '待录面试结果', icon: IconMapPin, to: '/todo?tab=arrived', count: arrivedCount.value },
  { key: 'advance', title: adv.value.title, desc: adv.value.tileDesc, icon: IconBanknote, to: '/advance', count: advTodo.value ?? undefined, open: true },
  { key: 'private', title: '私域待匹配', desc: '24h 内跟进', icon: IconUsers, to: '/reminders?f=private', count: wb.value?.privatePending, open: true },
  { key: 'absence', title: '请假 / 旷工', desc: '按人按日标记', icon: IconClipboardList, to: '/employees', open: true },
])

// ---------- 报名操作 ----------
const actions = ref<InstanceType<typeof AppActions> | null>(null)
const blocked = ref<Record<string, { action: SiteApplicationAction; reason: string }>>({})
function onAction(a: SiteApplication, action: SiteApplicationAction) {
  void actions.value?.run(action, a)
}
function onRejected(a: SiteApplication, action: SiteApplicationAction, reason: string) {
  blocked.value = { ...blocked.value, [a.applicationId]: { action, reason } }
}
function onDone() {
  blocked.value = {}
  void loadData()
}
async function onPull() {
  blocked.value = {}
  await onRefresh()
}
</script>

<template>
  <div class="wb">
    <van-pull-refresh v-if="me" v-model="refreshing" @refresh="onPull">
      <header class="id-head">
        <div class="avatar avatar--lg" aria-hidden="true">{{ me.name.slice(0, 1) }}</div>
        <div class="flex1">
          <h1>{{ me.name }}<template v-if="roleText"> · {{ roleText }}</template></h1>
          <p>{{ companyName }}</p>
        </div>
        <router-link to="/messages" class="bell" :aria-label="inbox.unread > 0 ? `消息通知，${inbox.unread} 条未读` : '消息通知'">
          <van-badge :content="inbox.unread > 0 ? inbox.unread : undefined" :max="99">
            <IconBell :size="24" />
          </van-badge>
        </router-link>
      </header>

      <div class="pad stack">
        <section class="acard metrics-card" aria-label="待办数字">
          <div class="metrics">
            <button v-for="k in kpis" :key="k.key" type="button" class="metric" @click="go(k.to, k.open)">
              <b>{{ k.value }}</b><span>{{ k.title }}</span>
            </button>
          </div>
        </section>

        <p v-if="wbError && !todayError" class="tipbar tipbar--danger" role="alert">
          <IconCircleExclamationPoint :size="18" />
          <span class="flex1 tipbar-d wb-err">{{ wbError }}，下拉可重试</span>
        </p>

        <section v-if="due > 0" class="tipbar tipbar--danger alarm" role="status">
          <IconCircleExclamationPoint :size="18" />
          <div class="flex1">
            <p class="tipbar-t">
              {{ due }} 人即将超时<template v-if="shortest">，最短还剩 <b class="alarm-left">{{ shortest }}</b></template>
            </p>
            <p class="tipbar-d">24 小时响应窗口剩余不足 4 小时，超时后系统将被动释放至公域。</p>
            <router-link to="/reminders" class="tipbar-act alarm-act">立即跟进<IconChevronRight :size="16" /></router-link>
          </div>
        </section>
        <section v-else-if="wb" class="tipbar">
          <IconBell :size="18" />
          <div class="flex1">
            <p class="tipbar-t">24 小时响应窗口</p>
            <p class="tipbar-d">私域用户每个阶段完成后 24 小时内必须跟进，超时系统将被动释放至公域。当前没有 4 小时内即将超时的用户。</p>
          </div>
        </section>

        <section v-if="canApps" class="todo-sec">
          <div class="sec-hd">
            <h2>待知悉报名</h2>
            <span class="sec-sub">按剩余时间</span>
            <router-link to="/todo?tab=ack" class="link">全部<IconChevronRight :size="16" /></router-link>
          </div>
          <div v-if="todayList.length" class="stack">
            <ApplicationCard
              v-for="a in todayList"
              :key="a.applicationId"
              :app="a"
              :now="now"
              :blocked="blocked[a.applicationId]"
              detail-link
              @action="onAction"
              @more="(x) => actions?.more(x)"
            />
          </div>
          <div v-else-if="todayError" class="acard state-block state-block--sm">
            <IconCircleExclamationPoint :size="32" />
            <p class="state-block-t">{{ todayError }}</p>
            <van-button size="small" @click="onRefresh">重新加载</van-button>
          </div>
          <div v-else-if="todayLoaded" class="acard state-block state-block--sm">
            <IconClipboardList :size="32" />
            <p class="state-block-t">暂无待知悉的报名</p>
            <p class="state-block-d">求职者报名后会在此提醒你，请在 24 小时内推送面试信息</p>
          </div>
          <div v-else class="acard page-state small"><van-loading size="24" /></div>
        </section>

        <section class="acard more" aria-label="更多事项">
          <div class="acard-hd"><h4>更多事项</h4></div>
          <div class="entries">
            <button v-for="e in entries" :key="e.key" type="button" class="entry" @click="go(e.to, e.open)">
              <component :is="e.icon" :size="22" class="entry-ic" />
              <b>{{ e.title }}</b>
              <i v-if="e.count" class="cnt">{{ e.count > 99 ? '99+' : e.count }}</i>
              <span>{{ e.desc }}</span>
            </button>
          </div>
          <router-link v-if="canMyCode" to="/my-code" class="lrow mycode">
            <IconQrCode :size="22" class="entry-ic" />
            <div class="lt"><b>我的专属码</b><span>求职者扫码注册即成为本公司私域用户</span></div>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
        </section>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>

    <div v-else-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else class="state-block page-err">
      <IconCircleExclamationPoint :size="48" />
      <p class="state-block-t">{{ loadError || '加载失败' }}</p>
      <p class="state-block-d">请检查网络后重新加载</p>
      <van-button type="primary" @click="reload">重新加载</van-button>
    </div>

    <AppActions ref="actions" @done="onDone" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.bell { display: grid; place-items: center; width: 44px; height: 44px; flex: none; margin-right: calc(var(--space-2) * -1); color: var(--text-1); }
.metrics-card { padding: var(--space-3) var(--space-2); }
.alarm-act { margin: var(--space-1) 0 calc(var(--space-3) * -1); }
.alarm-left { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
.wb-err { margin-top: 0; }
.todo-sec { display: grid; gap: var(--space-1); }
.small { padding: var(--space-6) 0; }
.entries { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.entry { position: relative; display: flex; flex-direction: column; align-items: flex-start; min-width: 0; min-height: 44px; padding: var(--space-3) var(--space-2); border: 0; border-radius: var(--radius-control); background: var(--bg-page); text-align: left; }
.entry:active { background: var(--bg-fill); }
.entry-ic { flex: none; color: var(--primary); }
.entry b { display: block; margin-top: var(--space-2); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.entry span { font-size: var(--font-size-min); line-height: 18px; color: var(--text-3); }
/* 主色底白字 4.52，够 12px 正文 */
.cnt { position: absolute; top: var(--space-2); right: var(--space-2); min-width: 18px; height: 18px; padding: 0 var(--space-1); border-radius: 9px; background: var(--primary); color: var(--text-on-primary); font-size: var(--font-size-min); font-style: normal; font-weight: var(--font-weight-medium); line-height: 18px; text-align: center; }
.mycode { margin-top: var(--space-3); padding: var(--space-3) 0 0; border-top: 1px solid var(--divider); text-decoration: none; color: inherit; }
.page-err { padding-top: calc(80px + env(safe-area-inset-top)); }
</style>
