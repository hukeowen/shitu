<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type LedgerApplication, type SeekerLedger } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { fmtMonth, fmtYuan } from '@/utils/format'
import { APP_TAG_CLASS } from '@/utils/status'
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
/** 与「我的报备」同一套状态配色（待面试 / 待签约入职为紫色） */
function appTag(a: LedgerApplication) {
  return APP_TAG_CLASS[a.status as ApplicationStatus] ?? (a.interviewResult === 'PASS' ? 'tag-ok' : 'tag-muted')
}
function interviewText(a: LedgerApplication) {
  if (a.interviewResult === 'PASS') return '面试通过'
  if (a.interviewResult === 'FAIL') return '面试未通过'
  if (a.arrivedAt) return '已到厂，等待结果'
  return ACTIVE.includes(a.status) ? '待面试' : '未到场'
}
function interviewTag(a: LedgerApplication) {
  if (a.interviewResult === 'PASS') return 'tag-ok'
  if (a.interviewResult === 'FAIL') return 'tag-danger'
  return ACTIVE.includes(a.status) ? 'tag-temp' : 'tag-muted'
}
</script>

<template>
  <div class="lg">
    <AppBar title="我的台账" fallback="/me" />
    <van-tabs v-model:active="tab" sticky offset-top="46" shrink class="tabs">
      <van-tab v-for="t in TABS" :key="t.key" :name="t.key" :title="counts[t.key] ? `${t.title} ${counts[t.key]}` : t.title" />
    </van-tabs>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="page-state">
        <van-empty image="error" :description="loadError">
          <van-button round type="primary" size="small" @click="load">重新加载</van-button>
        </van-empty>
      </div>

      <div v-else class="pad stack">
        <template v-if="tab === 'apply'">
          <button v-for="a in apps" :key="a.applicationId" type="button" class="acard item" @click="router.push(`/reports/${a.applicationId}`)">
            <div class="row-b">
              <b class="ttl">{{ a.jobTitle }}</b>
              <span class="tag" :class="appTag(a)">{{ label('ApplicationStatus', a.status) }}</span>
            </div>
            <div class="t-sm sub">{{ a.companyName }}</div>
            <div class="t-xs num meta">报名 {{ formatServerTime(a.createdAt) }}<template v-if="a.endedAt"> · 结束 {{ formatServerTime(a.endedAt, false) }}</template></div>
            <div v-if="a.endReason" class="t-xs meta">结束原因：{{ label('LifecycleEvent', a.endReason) }}</div>
          </button>
          <van-empty v-if="!apps.length" image="search" description="还没有报名记录">
            <van-button round type="primary" size="small" to="/match">去问薪找岗位</van-button>
          </van-empty>
        </template>

        <template v-else-if="tab === 'interview'">
          <button v-for="a in interviews" :key="a.applicationId" type="button" class="acard item" @click="router.push(`/reports/${a.applicationId}`)">
            <div class="row-b">
              <b class="ttl">{{ a.jobTitle }}</b>
              <span class="tag" :class="interviewTag(a)">{{ interviewText(a) }}</span>
            </div>
            <div class="t-sm sub">{{ a.companyName }}</div>
            <div class="t-xs num meta">面试时间 {{ formatServerTime(a.interviewAt) }}</div>
            <div v-if="a.interviewAddress" class="t-xs meta">地点：{{ a.interviewAddress }}</div>
            <div v-if="a.arrivedAt" class="t-xs num meta">到厂 {{ formatServerTime(a.arrivedAt) }}</div>
          </button>
          <van-empty v-if="!interviews.length" image="search" description="还没有面试记录">
            <p class="t-xs hint">报名后，驻场老师确认并发来面试时间和地点，记录会出现在这里。</p>
          </van-empty>
        </template>

        <template v-else-if="tab === 'work'">
          <section v-for="w in works" :key="w.employmentId" class="acard">
            <div class="row-b">
              <b class="ttl">{{ w.projectName || w.jobTitle || w.companyName }}</b>
              <span class="tag" :class="w.endDate ? 'tag-muted' : 'tag-ok'">{{ w.endDate ? '已离职' : '在岗' }}</span>
            </div>
            <div class="t-sm sub">{{ w.companyName }}<template v-if="w.jobTitle && w.projectName"> · {{ w.jobTitle }}</template></div>
            <div class="t-xs num meta">{{ w.startDate }} 至 {{ w.endDate ?? '今' }} · 共 {{ w.days }} 天</div>
            <div v-if="w.endReason" class="t-xs meta">离职原因：{{ label('EmploymentEndReason', w.endReason) }}</div>
          </section>
          <van-empty v-if="!works.length" image="search" description="还没有入职记录" />
        </template>

        <template v-else>
          <button v-for="p in pays" :key="p.payslipId" type="button" class="acard item" @click="router.push(`/payslips/${p.payslipId}`)">
            <div class="row-b">
              <b class="ttl">{{ fmtMonth(p.payMonth) }}工资</b>
              <b class="num pay">{{ fmtYuan(p.netPay) }}</b>
            </div>
            <div class="t-sm sub">{{ p.companyName }}</div>
            <div class="t-xs num meta">应发 {{ fmtYuan(p.grossPay) }}<template v-if="Number(p.advanceDeduct) > 0"> · 抵扣预支 {{ fmtYuan(p.advanceDeduct) }}</template></div>
          </button>
          <van-empty v-if="!pays.length" image="search" description="还没有工资记录">
            <p class="t-xs hint">劳务公司发布工资条后，每月工资会出现在这里。</p>
          </van-empty>
        </template>

        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.lg { min-height: 100vh; background: var(--surface-2); }
.tabs :deep(.van-tabs__wrap) { border-bottom: 1px solid var(--line); }
.tabs :deep(.van-tab) { padding: 0 16px; }
button.item { display: block; width: 100%; text-align: left; font: inherit; }
.ttl { font-size: 14.5px; color: var(--ink-900); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { margin-top: 3px; color: var(--ink-700); }
.meta { margin-top: 4px; color: var(--ink-500); line-height: 1.6; }
.pay { font-size: 16px; color: var(--ink-900); flex: none; }
.hint { line-height: 1.7; padding: 0 20px; }
</style>
