<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type MyApplication } from '@shitu/api-client'
import ComplaintPopup from '@/components/ComplaintPopup.vue'
import InterviewNoticeCard from '@/components/InterviewNoticeCard.vue'
import { formatServerTime, formatShort } from '@/utils/time'

/**
 * S-25 我的报备（C-501）：全部 / 待面试 / 待确权 / 已入职 / 已取消 / 已超时（D-09）。
 * 「已取消」含取消、面试未通过、爽约（单条卡片标签仍显示精确状态）。全部只读，取消需联系驻场（R-04）。
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

const STATUS_TAG: Record<ApplicationStatus, string> = {
  PENDING_INTERVIEW: 'tag-temp',
  PENDING_CONFIRM: 'tag-temp',
  EMPLOYED: 'tag-ok',
  CANCELLED: 'tag-muted',
  INTERVIEW_FAILED: 'tag-muted',
  NO_SHOW: 'tag-warn',
  TIMEOUT: 'tag-danger',
}
const ACTIVE: ApplicationStatus[] = ['PENDING_INTERVIEW', 'PENDING_CONFIRM', 'EMPLOYED']

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
  if (a.status === 'PENDING_CONFIRM') return '面试已通过 · 等待入职确权'
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
    <van-nav-bar title="我的报备" fixed placeholder safe-area-inset-top z-index="50" class="bar" />
    <div class="atabs" role="tablist">
      <button v-for="k in TAB_ORDER" :key="k" type="button" role="tab" :aria-selected="tab === k" :class="{ on: tab === k }" @click="tab = k">
        {{ tabLabel(k) }} <span class="mono">{{ counts[k] }}</span>
      </button>
    </div>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="pad stack body">
        <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
        <div v-else-if="loadError" class="page-state">
          <van-empty image="error" :description="loadError">
            <van-button round type="primary" size="small" @click="load">重新加载</van-button>
          </van-empty>
        </div>
        <template v-else-if="shown.length">
          <article v-for="a in shown" :key="a.applicationId" class="acard rep" :class="{ dim: !ACTIVE.includes(a.status), cur: a.status === 'PENDING_INTERVIEW' }">
            <div class="row-b" style="margin-bottom: 9px">
              <span class="tag" :class="STATUS_TAG[a.status]"><i class="dot"></i>{{ label('ApplicationStatus', a.status) }}</span>
              <span class="t-xs">{{ rightMeta(a) }}</span>
            </div>
            <div class="jt">{{ a.jobTitle || '岗位' }}</div>
            <div v-if="where(a)" class="t-sm" style="margin-top: 2px">{{ where(a) }}</div>
            <div class="divider" style="margin: 10px 0"></div>
            <dl>
              <div class="kv"><dt>报名单号</dt><dd class="num">{{ a.applicationId }}</dd></div>
              <div class="kv"><dt>报名时间</dt><dd class="num">{{ formatServerTime(a.createdAt) }}</dd></div>
              <div v-if="!a.notice && a.address" class="kv"><dt>面试地点</dt><dd>{{ a.address }}</dd></div>
              <div class="kv"><dt>当前状态</dt><dd>{{ stateText(a) }}</dd></div>
              <div v-if="a.endReason" class="kv"><dt>原因</dt><dd>{{ a.endReason }}</dd></div>
            </dl>

            <template v-if="a.notice && ACTIVE.includes(a.status)">
              <div class="ntc">
                <div class="ntc-t">面试确认信息</div>
                <InterviewNoticeCard :notice="a.notice" />
              </div>
              <van-button block size="small" class="more" @click="router.push(`/reports/${a.applicationId}`)">查看完整面试须知</van-button>
            </template>

            <div v-if="ACTIVE.includes(a.status)" class="t-xs ro">仅可查看 · 如需更换岗位，请联系驻场</div>
            <div v-else-if="a.status !== 'TIMEOUT'" class="note note--info" style="margin-top: 10px">报名已结束，可重新进入 AI 问薪匹配。</div>
            <button type="button" class="cmp-link" @click="openComplain(a)">岗位与描述不符？投诉该岗位 ›</button>
          </article>
        </template>
        <div v-else class="page-state">
          <van-empty :description="tab === 'ALL' ? '还没有报名记录' : `没有「${tabLabel(tab)}」的报名`">
            <van-button v-if="tab === 'ALL'" round type="primary" size="small" @click="router.push('/match')">去 AI 问薪</van-button>
          </van-empty>
        </div>
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
.reports { min-height: 100vh; background: var(--surface-2); }
.bar :deep(.van-nav-bar__title) { font-weight: 700; color: var(--ink-900); }
.body { min-height: 60vh; align-content: start; }
.page-state { padding-top: 40px; }
.rep.cur { border-color: var(--temp-line); }
.rep.dim { opacity: .78; }
.jt { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.ntc { margin-top: 10px; padding: 10px 12px 4px; border-radius: var(--r-md); background: var(--temp-bg); border: 1px solid var(--temp-line); }
.ntc-t { font-size: 12.5px; font-weight: 700; color: var(--temp); }
.more { margin-top: 10px; }
.ro { margin-top: 8px; text-align: center; }
.cmp-link { display: block; margin: 8px auto 0; padding: 4px 8px; background: none; border: 0; font-size: 12px; color: var(--ink-400); }
</style>
