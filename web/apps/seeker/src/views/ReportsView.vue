<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type MyApplication } from '@shitu/api-client'
import { IconChevronRight, IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import CancelRequestBlock from '@/components/CancelRequestBlock.vue'
import ComplaintPopup from '@/components/ComplaintPopup.vue'
import InterviewNoticeCard from '@/components/InterviewNoticeCard.vue'
import { APPLICATION_TONE } from '@/utils/status'
import { formatServerTime, formatShort } from '@/utils/time'

/**
 * S-25 我的报备（C-501）：全部 / 待面试 / 待签约入职（内部口径「待确权」）/ 已入职 / 已取消 / 已超时（D-09）。
 * 「已取消」含取消、面试未通过、爽约（单条卡片标签仍显示精确状态）。求职者不能自行取消（R-04），进行中的报名可「申请取消报名」，由驻场处理。
 */
const router = useRouter()
const { label } = useDict()

type TabKey = 'ALL' | 'PENDING_INTERVIEW' | 'PENDING_CONFIRM' | 'EMPLOYED' | 'CANCELLED' | 'TIMEOUT'
const TAB_STATUSES: Record<Exclude<TabKey, 'ALL'>, ApplicationStatus[]> = {
  PENDING_INTERVIEW: ['PENDING_INTERVIEW'],
  PENDING_CONFIRM: ['PENDING_CONFIRM'],
  EMPLOYED: ['EMPLOYED'],
  CANCELLED: ['CANCELLED', 'INTERVIEW_FAILED', 'NO_SHOW'],
  TIMEOUT: ['TIMEOUT'],
}
const TAB_ORDER: TabKey[] = ['ALL', 'PENDING_INTERVIEW', 'PENDING_CONFIRM', 'EMPLOYED', 'CANCELLED', 'TIMEOUT']

const ACTIVE: ApplicationStatus[] = ['PENDING_INTERVIEW', 'PENDING_CONFIRM', 'EMPLOYED']
/** 面试已通过的报名：面试信息只作为过去的事实展示，不再出现倒计时与面试须知 */
const PASSED: ApplicationStatus[] = ['PENDING_CONFIRM', 'EMPLOYED']

const list = ref<MyApplication[]>([])
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)
const tab = ref<TabKey>('ALL')

async function load() {
  loadError.value = ''
  try {
    list.value = await seekerApi.myApplications()
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

const counts = computed(() => {
  const c: Record<TabKey, number> = { ALL: list.value.length, PENDING_INTERVIEW: 0, PENDING_CONFIRM: 0, EMPLOYED: 0, CANCELLED: 0, TIMEOUT: 0 }
  for (const a of list.value) {
    for (const k of TAB_ORDER.slice(1) as Array<Exclude<TabKey, 'ALL'>>) if (TAB_STATUSES[k].includes(a.status)) c[k]++
  }
  return c
})
const shown = computed(() => (tab.value === 'ALL' ? list.value : list.value.filter((a) => TAB_STATUSES[tab.value as Exclude<TabKey, 'ALL'>].includes(a.status))))
function tabLabel(k: TabKey) {
  return k === 'ALL' ? '全部' : label('ApplicationStatus', k)
}

function rightMeta(a: MyApplication): string {
  if (a.status === 'PENDING_INTERVIEW' && a.notice) return `${formatShort(a.notice.interviewAt)} 面试`
  if (a.status === 'PENDING_INTERVIEW') return '等待驻场联系'
  if (a.status === 'TIMEOUT') return '系统自动作废'
  if (a.endedAt && !ACTIVE.includes(a.status)) return formatShort(a.endedAt)
  return ''
}
function stateText(a: MyApplication): string {
  if (a.status === 'PENDING_INTERVIEW') return a.notice ? '驻场已推送面试信息 · 待面试' : '已通知驻场 · 等待面试安排'
  if (a.status === 'PENDING_CONFIRM') return '面试已通过 · 等待签约入职'
  if (a.status === 'EMPLOYED') return '面试已通过 · 已入职'
  return label('ApplicationStatus', a.status)
}
function where(a: MyApplication) {
  return [a.projectName, a.companyName].filter(Boolean).join(' · ')
}

/** S-19 岗位投诉（C-402）：报名过的岗位都可投诉 */
const complainFor = ref<MyApplication | null>(null)
const complainOpen = ref(false)
function openComplain(a: MyApplication) {
  complainFor.value = a
  complainOpen.value = true
}
</script>

<template>
  <div class="reports">
    <van-nav-bar title="我的报备" fixed placeholder safe-area-inset-top z-index="50" />
    <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab v-for="k in TAB_ORDER" :key="k" :name="k" :title="`${tabLabel(k)} ${counts[k]}`" />
    </van-tabs>

    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>
      <div v-else-if="shown.length" class="pad stack">
        <article v-for="a in shown" :key="a.applicationId" class="acard">
          <div class="item-hd">
            <h3>{{ a.jobTitle || '岗位' }}</h3>
            <span class="status-tag" :class="APPLICATION_TONE[a.status]">{{ label('ApplicationStatus', a.status) }}</span>
          </div>
          <p v-if="where(a)" class="item-sub">{{ where(a) }}</p>
          <p v-if="rightMeta(a)" class="item-meta">{{ rightMeta(a) }}</p>
          <dl class="facts">
            <div class="kv"><dt>报名单号</dt><dd class="code">{{ a.applicationId }}</dd></div>
            <div class="kv"><dt>报名时间</dt><dd>{{ formatServerTime(a.createdAt) }}</dd></div>
            <div v-if="!a.notice && a.address" class="kv"><dt>面试地点</dt><dd>{{ a.address }}</dd></div>
            <div v-if="a.notice && a.status !== 'PENDING_INTERVIEW'" class="kv"><dt>面试时间</dt><dd>{{ formatServerTime(a.notice.interviewAt) }}</dd></div>
            <div class="kv"><dt>当前状态</dt><dd>{{ stateText(a) }}</dd></div>
            <div v-if="a.endReason" class="kv"><dt>原因</dt><dd>{{ label('LifecycleEvent', a.endReason) }}</dd></div>
          </dl>

          <!-- 面试须知只给「待面试」；面试已通过的报名只留一个详情入口 -->
          <template v-if="a.notice && a.status === 'PENDING_INTERVIEW'">
            <h4 class="sub-t">面试确认信息</h4>
            <InterviewNoticeCard :notice="a.notice" />
            <van-button block class="more" @click="router.push(`/reports/${a.applicationId}`)">查看完整面试须知</van-button>
          </template>

          <van-button v-else-if="PASSED.includes(a.status)" block class="more" @click="router.push(`/reports/${a.applicationId}`)">查看报名详情</van-button>

          <!-- 进行中的报名：申请取消报名的入口与申请状态 -->
          <CancelRequestBlock
            v-if="a.status === 'PENDING_INTERVIEW' || a.status === 'PENDING_CONFIRM'"
            :application-id="a.applicationId"
            :job-title="a.jobTitle"
            :subtitle="where(a)"
          />
          <template v-else-if="a.status === 'EMPLOYED'"></template>
          <p v-else-if="a.status !== 'TIMEOUT'" class="note ended">报名已结束，可重新进入 AI 问薪匹配。</p>
          <button type="button" class="cmp-link" @click="openComplain(a)">岗位与描述不符？投诉该岗位<IconChevronRight :size="16" /></button>
        </article>
        <p class="list-end">没有更多了</p>
      </div>
      <div v-else class="state-block">
        <IconInbox :size="48" :stroke-width="1.5" />
        <div class="state-block-t">{{ tab === 'ALL' ? '还没有报名记录' : `没有「${tabLabel(tab)}」的报名` }}</div>
        <div v-if="tab === 'ALL'" class="state-block-d">完成 AI 问薪后，从推荐岗位里选 1 个报名</div>
        <van-button v-if="tab === 'ALL'" type="primary" @click="router.push('/match')">去 AI 问薪</van-button>
      </div>
    </van-pull-refresh>
    <ComplaintPopup
      v-if="complainFor"
      v-model:show="complainOpen"
      :job-id="complainFor.jobId"
      :job-title="complainFor.jobTitle"
      :subtitle="where(complainFor)"
    />
  </div>
</template>

<style scoped>
.reports { min-height: var(--page-h-tabbar); --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.facts { margin-top: var(--space-3); border-top: 1px solid var(--divider); }
/* 长地址折行时两行尽量等长，不留孤字 */
.facts dd { word-break: normal; overflow-wrap: anywhere; text-wrap: balance; }
.code { font-family: var(--font-mono); }
.sub-t { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); line-height: 22px; color: var(--text-1); }
.more { margin-top: var(--space-3); }
.ended { margin-top: var(--space-3); }
.cmp-link { display: flex; align-items: center; justify-content: center; gap: 2px; width: 100%; min-height: 44px; margin-bottom: calc(var(--space-3) * -1); padding: 0; border: 0; background: none; font-size: var(--font-size-aux); color: var(--text-3); }
</style>
