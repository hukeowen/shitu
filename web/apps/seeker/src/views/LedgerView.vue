<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type LedgerApplication, type SeekerLedger } from '@shitu/api-client'
import { IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { fmtMonth, fmtYuan } from '@/utils/format'
import { APPLICATION_TONE } from '@/utils/status'
import { formatServerTime } from '@/utils/time'

/** S-32 我的台账（C-506）：报名、面试、入职、工资四类记录，只读；明细分别跳到我的报备、工资条 */
const { label } = useDict()
const route = useRoute()
const router = useRouter()

type Tab = 'apply' | 'interview' | 'work' | 'pay'
const TABS: { key: Tab; title: string }[] = [
  { key: 'apply', title: '报名' },
  { key: 'interview', title: '面试' },
  { key: 'work', title: '入职' },
  { key: 'pay', title: '工资' },
]
const tab = ref<Tab>(TABS.some((t) => t.key === route.query.tab) ? (route.query.tab as Tab) : 'apply')

const data = ref<SeekerLedger | null>(null)
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    data.value = await seekerApi.myLedger()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  await load()
  refreshing.value = false
}

const apps = computed(() => data.value?.applications ?? [])
const interviews = computed(() => apps.value.filter((a) => a.interviewAt))
const works = computed(() => data.value?.employments ?? [])
const pays = computed(() => data.value?.payslips ?? [])
const counts = computed<Record<Tab, number>>(() => ({
  apply: apps.value.length,
  interview: interviews.value.length,
  work: works.value.length,
  pay: pays.value.length,
}))

const ACTIVE = ['PENDING_INTERVIEW', 'PENDING_CONFIRM']
function appTone(a: LedgerApplication) {
  return (APPLICATION_TONE as Record<string, string>)[a.status] ?? (a.interviewResult === 'PASS' ? 'status-tag--success' : 'status-tag--neutral')
}
function interviewText(a: LedgerApplication) {
  if (a.interviewResult === 'PASS') return '面试通过'
  if (a.interviewResult === 'FAIL') return '面试未通过'
  if (a.arrivedAt) return '已到厂，等待结果'
  return ACTIVE.includes(a.status) ? '待面试' : '未到场'
}
function interviewTone(a: LedgerApplication) {
  if (a.interviewResult === 'PASS') return 'status-tag--success'
  if (a.interviewResult === 'FAIL') return 'status-tag--danger'
  if (a.arrivedAt) return 'status-tag--info'
  return ACTIVE.includes(a.status) ? 'status-tag--pending' : 'status-tag--neutral'
}
function openApp(a: LedgerApplication) {
  void router.push(`/reports/${a.applicationId}`)
}
</script>

<template>
  <div class="lg">
    <AppBar title="我的台账" fallback="/me" />
    <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab v-for="t in TABS" :key="t.key" :name="t.key" :title="`${t.title} ${counts[t.key]}`" />
    </van-tabs>

    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>

      <div v-else class="pad stack">
        <template v-if="tab === 'apply'">
          <article v-for="a in apps" :key="a.applicationId" class="acard tap" role="button" tabindex="0" @click="openApp(a)" @keydown.enter="openApp(a)" @keydown.space.prevent="openApp(a)">
            <div class="item-hd">
              <h3>{{ a.jobTitle }}</h3>
              <span class="status-tag" :class="appTone(a)">{{ label('ApplicationStatus', a.status) }}</span>
            </div>
            <p class="item-sub">{{ a.companyName }}</p>
            <ul class="tl">
              <li class="done">
                <div class="tl-t">报名<span class="status-tag status-tag--success">已完成</span></div>
                <div class="tl-m">{{ formatServerTime(a.createdAt) }}</div>
              </li>
              <li v-if="a.endedAt">
                <div class="tl-t">结束<span class="status-tag">已结束</span></div>
                <div class="tl-m">{{ formatServerTime(a.endedAt, false) }}<template v-if="a.endReason"> · 结束原因：{{ label('LifecycleEvent', a.endReason) }}</template></div>
              </li>
              <li v-else-if="ACTIVE.includes(a.status)" class="now">
                <div class="tl-t">{{ label('ApplicationStatus', a.status) }}<span class="status-tag status-tag--info">进行中</span></div>
              </li>
            </ul>
          </article>
          <div v-if="!apps.length" class="state-block">
            <IconInbox :size="48" :stroke-width="1.5" />
            <div class="state-block-t">还没有报名记录</div>
            <van-button type="primary" to="/match">去问薪找岗位</van-button>
          </div>
        </template>

        <template v-else-if="tab === 'interview'">
          <article v-for="a in interviews" :key="a.applicationId" class="acard tap" role="button" tabindex="0" @click="openApp(a)" @keydown.enter="openApp(a)" @keydown.space.prevent="openApp(a)">
            <div class="item-hd">
              <h3>{{ a.jobTitle }}</h3>
              <span class="status-tag" :class="interviewTone(a)">{{ interviewText(a) }}</span>
            </div>
            <p class="item-sub">{{ a.companyName }}</p>
            <p class="item-meta">面试时间 {{ formatServerTime(a.interviewAt) }}</p>
            <p v-if="a.interviewAddress" class="item-meta">地点：{{ a.interviewAddress }}</p>
            <p v-if="a.arrivedAt" class="item-meta">到厂 {{ formatServerTime(a.arrivedAt) }}</p>
          </article>
          <div v-if="!interviews.length" class="state-block">
            <IconInbox :size="48" :stroke-width="1.5" />
            <div class="state-block-t">还没有面试记录</div>
            <div class="state-block-d">报名后，驻场老师确认并发来面试时间和地点，记录会出现在这里。</div>
            <van-button type="primary" to="/match">去找活</van-button>
          </div>
        </template>

        <template v-else-if="tab === 'work'">
          <article v-for="w in works" :key="w.employmentId" class="acard">
            <div class="item-hd">
              <h3>{{ w.projectName || w.jobTitle || w.companyName }}</h3>
              <span class="status-tag" :class="w.endDate ? 'status-tag--neutral' : 'status-tag--success'">{{ w.endDate ? '已离职' : '在岗' }}</span>
            </div>
            <p class="item-sub">{{ w.companyName }}<template v-if="w.jobTitle && w.projectName"> · {{ w.jobTitle }}</template></p>
            <ul class="tl">
              <li class="done">
                <div class="tl-t">入职<span class="status-tag status-tag--success">已完成</span></div>
                <div class="tl-m">{{ w.startDate }}</div>
              </li>
              <li v-if="w.endDate">
                <div class="tl-t">离职<span class="status-tag">已结束</span></div>
                <div class="tl-m">{{ w.endDate }} · 共 {{ w.days }} 天<template v-if="w.endReason"> · 离职原因：{{ label('EmploymentEndReason', w.endReason) }}</template></div>
              </li>
              <li v-else class="now">
                <div class="tl-t">在岗<span class="status-tag status-tag--info">进行中</span></div>
                <div class="tl-m">至今 · 共 {{ w.days }} 天</div>
              </li>
            </ul>
          </article>
          <div v-if="!works.length" class="state-block">
            <IconInbox :size="48" :stroke-width="1.5" />
            <div class="state-block-t">还没有入职记录</div>
            <van-button type="primary" to="/match">去找活</van-button>
          </div>
        </template>

        <template v-else>
          <article v-for="p in pays" :key="p.payslipId" class="acard tap" role="button" tabindex="0" @click="router.push(`/payslips/${p.payslipId}`)" @keydown.enter="router.push(`/payslips/${p.payslipId}`)" @keydown.space.prevent="router.push(`/payslips/${p.payslipId}`)">
            <div class="item-hd">
              <h3>{{ fmtMonth(p.payMonth) }}工资</h3>
              <span class="pay"><span>实发</span><b>{{ fmtYuan(p.netPay) }}</b></span>
            </div>
            <p class="item-sub">{{ p.companyName }}</p>
            <p class="item-meta">应发 {{ fmtYuan(p.grossPay) }}<template v-if="Number(p.advanceDeduct) > 0"> · 抵扣预支 {{ fmtYuan(p.advanceDeduct) }}</template></p>
          </article>
          <div v-if="!pays.length" class="state-block">
            <IconInbox :size="48" :stroke-width="1.5" />
            <div class="state-block-t">还没有工资记录</div>
            <div class="state-block-d">劳务公司发布工资条后，每月工资会出现在这里。</div>
            <van-button type="primary" to="/work">看看我的工作</van-button>
          </div>
        </template>

        <p v-if="counts[tab]" class="list-end">没有更多了</p>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.lg { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.tap { cursor: pointer; }
.tap:active { background: var(--bg-hover); }
.tap:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.tl { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.tl::before { top: calc(var(--space-3) + 6px); }
.tl-t .status-tag { margin-left: var(--space-2); vertical-align: 1px; }
.pay { flex: none; display: flex; align-items: baseline; gap: var(--space-2); line-height: 24px; }
.pay span { font-size: var(--font-size-aux); color: var(--text-3); }
.pay b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
</style>
