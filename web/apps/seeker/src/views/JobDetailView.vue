<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, useDict, type SeekerJobDetail } from '@shitu/api-client'
import { IconCheck, IconChevronRight, IconCircleExclamationPoint, IconExternalLink, IconMapPin, IconMessageSquare, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import ComplaintPopup from '@/components/ComplaintPopup.vue'
import DisclaimerPopup from '@/components/DisclaimerPopup.vue'
import JobAskPopup from '@/components/JobAskPopup.vue'
import { useApplyFlow } from '@/composables/useApplyFlow'
import { useJourney } from '@/composables/useJourney'
import { useMatchSession } from '@/composables/useMatchSession'
import { dormChips, fmtSalary, fmtScore, scoreVisible, splitLines } from '@/utils/format'
import { amapLink } from '@/utils/map'

/** S-18 岗位详情（C-401）：只能看最近一次匹配结果里的岗位；底部「报名面试」进入报名闭环 */
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const { match } = useMatchSession()
const flow = useApplyFlow()

const jobId = computed(() => String(route.params.jobId))
/** 从「专属顾问推荐」进入（T-203：报名的第二个合法入口） */
const fromRec = computed(() => route.query.from === 'rec')
const journey = useJourney()
if (fromRec.value && !journey.recsLoaded) void journey.loadRecs().catch(() => undefined)
const rec = computed(() => journey.recs.find((r) => r.jobId === jobId.value && r.decision !== 'DECLINED'))
const job = ref<SeekerJobDetail | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    job.value = await seekerApi.job(jobId.value)
  } catch (e) {
    if (isApiError(e, 'APP_4004')) {
      if (fromRec.value) {
        showToast('该推荐已失效')
        void router.replace('/recommendations')
      } else {
        showToast('该岗位不在你的匹配结果中')
        void router.replace('/match/result')
      }
      return
    }
    loadError.value = errorMessage(e, '岗位加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
if (!match.outcome) void match.loadLatest().catch(() => undefined)

/** 匹配度从结果卡取（详情接口不带） */
const card = computed(() => match.outcome?.results.find((r) => r.jobId === jobId.value))
const dorm = computed(() => (job.value ? dormChips(job.value) : []))
const duties = computed(() => splitLines(job.value?.duties))
const benefits = computed(() => splitLines(job.value?.benefits, true))
const notes = computed(() => splitLines(job.value?.notes))
const nav = computed(() =>
  job.value ? amapLink({ address: job.value.interviewAddress, name: job.value.interviewAddress, lng: job.value.lng, lat: job.value.lat }) : null,
)
const ageText = computed(() => {
  const j = job.value
  if (!j) return ''
  if (j.ageMin && j.ageMax) return `${j.ageMin}–${j.ageMax} 周岁`
  if (j.ageMin) return `${j.ageMin} 周岁以上`
  return '不限'
})
const expText = computed(() => (job.value && job.value.minWorkYears > 0 ? `${job.value.minWorkYears} 年以上相关经验` : '不限经验，可接受新手'))
const subTitle = computed(() => [job.value?.projectName, job.value?.companyName].filter(Boolean).join(' · '))

/** S-19 岗位投诉（C-402）：每个岗位详情页固定入口 */
const complainOpen = ref(false)
/** S-44 岗位问答（C-409） */
const askOpen = ref(false)

function onApply() {
  if (!job.value?.canApply) return
  void flow.apply(jobId.value)
}
</script>

<template>
  <div class="detail">
    <AppBar title="岗位详情" :fallback="fromRec ? '/recommendations' : '/match/result'" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !job" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">{{ loadError ? '加载失败' : '岗位不存在' }}</div>
      <div v-if="loadError" class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard">
          <div class="top-hd">
            <h1>{{ job.title }}</h1>
            <span v-if="card && scoreVisible(card.matchScore)" class="status-tag status-tag--info">匹配度 {{ fmtScore(card.matchScore) }}%</span>
            <span v-else-if="!card && (fromRec || rec)" class="status-tag status-tag--info">顾问推荐</span>
          </div>
          <p v-if="subTitle" class="top-sub">{{ subTitle }}</p>
          <p class="salary"><b>{{ fmtSalary(job.salaryMin, job.salaryMax) }}</b><span>元/月（综合）</span></p>
          <dl class="stats">
            <div><dt>剩余名额</dt><dd :class="{ low: job.quotaRemaining <= 5 }">{{ job.quotaRemaining }}</dd></div>
            <div><dt>班次</dt><dd>{{ label('ShiftType', job.shiftType) }}</dd></div>
            <div><dt>工种</dt><dd>{{ label('JobType', job.jobType) }}</dd></div>
          </dl>
        </section>

        <section v-if="rec?.note" class="note"><b>专属顾问推荐：</b>{{ rec.note }}</section>

        <section class="acard">
          <div class="acard-hd"><h4>薪资与班次</h4></div>
          <dl>
            <div class="kv"><dt>月综合收入</dt><dd>{{ fmtSalary(job.salaryMin, job.salaryMax) }} 元</dd></div>
            <div class="kv"><dt>班次</dt><dd>{{ label('ShiftType', job.shiftType) }}</dd></div>
            <div class="kv"><dt>工作地点</dt><dd>{{ [job.city, job.address].filter(Boolean).join(' · ') || '—' }}</dd></div>
          </dl>
          <p class="tip">薪资为区间参考值，最终以企业公示标准及实际出勤、绩效核算为准</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>吃住条件</h4></div>
          <ul class="chips flat">
            <li v-for="c in dorm" :key="c" class="chip" :class="{ 'chip-ok': c.startsWith('包') }"><IconCheck v-if="c.startsWith('包')" :size="12" :stroke-width="2.5" />{{ c }}</li>
          </ul>
        </section>

        <section v-if="duties.length" class="acard">
          <div class="acard-hd"><h4>岗位职责</h4></div>
          <ul class="lines">
            <li v-for="d in duties" :key="d">{{ d }}</li>
          </ul>
        </section>

        <section v-if="benefits.length" class="acard">
          <div class="acard-hd"><h4>福利待遇</h4></div>
          <ul class="chips flat">
            <li v-for="b in benefits" :key="b" class="chip">{{ b }}</li>
          </ul>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>入职要求</h4></div>
          <dl>
            <div class="kv"><dt>年龄</dt><dd>{{ ageText }}</dd></div>
            <div class="kv"><dt>经验</dt><dd>{{ expText }}</dd></div>
          </dl>
        </section>

        <section v-if="job.requiredDocuments?.length" class="acard">
          <div class="acard-hd"><h4>所需材料</h4></div>
          <ul class="chips flat">
            <li v-for="d in job.requiredDocuments" :key="d" class="chip">{{ d }}</li>
          </ul>
        </section>

        <section v-if="notes.length" class="tipbar tipbar--warn">
          <IconTriangleExclamationPoint :size="20" />
          <div class="flex1">
            <h4 class="tipbar-t">注意事项</h4>
            <p v-for="n in notes" :key="n" class="tipbar-d">{{ n }}</p>
          </div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>面试信息</h4></div>
          <dl>
            <div class="kv"><dt>面试地点</dt><dd>{{ job.interviewAddress || '—' }}</dd></div>
            <div v-if="job.interviewTimeDesc" class="kv"><dt>面试时间</dt><dd>{{ job.interviewTimeDesc }}</dd></div>
          </dl>
          <a v-if="nav" :href="nav" class="map" target="_blank" rel="noopener">
            <IconMapPin :size="20" />用高德地图导航到面试地点<IconExternalLink :size="16" />
          </a>
          <p class="tip">报名后驻场老师会推送具体面试时间与集合地点</p>
        </section>

        <button type="button" class="acard ask-entry" @click="askOpen = true">
          <IconMessageSquare :size="24" class="ask-ic" />
          <span class="flex1"><b>问问这个岗位</b><span>吃住、发薪、班次、体检… 有问必答</span></span>
          <IconChevronRight :size="20" class="chev" />
        </button>
        <button type="button" class="complain" @click="complainOpen = true">
          <IconCircleExclamationPoint :size="16" />岗位信息有问题？投诉该岗位
        </button>
        <div class="bottom-bar-gap" :class="{ tall: !job.canApply && job.cannotApplyReason }"></div>
      </div>

      <div class="bottom-bar">
        <p v-if="!job.canApply && job.cannotApplyReason" class="why">{{ job.cannotApplyReason }}</p>
        <van-button type="primary" size="large" block :disabled="!job.canApply" :loading="flow.submitting.value" loading-text="提交中…" @click="onApply">
          报名面试
        </van-button>
      </div>
    </template>

    <JobAskPopup v-if="job" v-model:show="askOpen" :job-id="jobId" :job-title="job.title" />
    <ComplaintPopup v-if="job" v-model:show="complainOpen" :job-id="jobId" :job-title="job.title" :subtitle="subTitle" />
    <DisclaimerPopup v-model:show="flow.disclaimerOpen.value" :company-name="job?.companyName" @agreed="flow.retry" />
  </div>
</template>

<style scoped>
.detail { min-height: 100vh; }
.top-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.top-hd h1 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.top-hd .status-tag { flex: none; margin-top: 2px; }
.top-sub { margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--divider); }
.stats > div { min-width: 0; }
.stats dt { font-size: var(--font-size-aux); color: var(--text-3); }
.stats dd { margin-top: 2px; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); overflow-wrap: anywhere; }
.stats dd.low { color: var(--warning-text); }
.tip { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.flat { margin-top: 0; }
.lines { display: grid; gap: var(--space-2); padding-left: var(--space-5); list-style: disc; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.map { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--control-height); margin-top: var(--space-3); padding: 0 var(--space-3); border: 1px solid var(--primary-line); border-radius: var(--radius-control); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); text-decoration: none; }
.map:active { background: var(--primary-bg); }
.ask-entry { display: flex; align-items: center; gap: var(--space-3); width: 100%; border: 0; text-align: left; }
.ask-entry:active { background: var(--bg-hover); }
.ask-ic { flex: none; color: var(--primary); }
.ask-entry b { display: block; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); line-height: 24px; color: var(--text-1); }
.ask-entry .flex1 span { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.ask-entry .chev { flex: none; color: var(--text-3); }
.complain { display: flex; align-items: center; justify-content: center; gap: var(--space-1); width: 100%; min-height: 44px; border: 0; background: none; font-size: var(--font-size-aux); color: var(--text-3); }
.why { margin-bottom: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--warning-text); text-align: center; }
.tall { height: calc(112px + env(safe-area-inset-bottom)); }
</style>
