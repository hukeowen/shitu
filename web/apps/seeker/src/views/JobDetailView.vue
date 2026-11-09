<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, useDict, type SeekerJobDetail } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import ComplaintPopup from '@/components/ComplaintPopup.vue'
import DisclaimerPopup from '@/components/DisclaimerPopup.vue'
import JobAskPopup from '@/components/JobAskPopup.vue'
import { useApplyFlow } from '@/composables/useApplyFlow'
import { useJourney } from '@/composables/useJourney'
import { useMatchSession } from '@/composables/useMatchSession'
import { dormChips, fmtSalary, fmtScore, scoreClass, splitLines } from '@/utils/format'
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
    <div v-else-if="loadError || !job" class="page-state">
      <van-empty image="error" :description="loadError || '岗位不存在'">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <template v-else>
      <header class="head">
        <div class="row" style="align-items: flex-start; gap: 10px">
          <div class="flex1">
            <h1 class="title">{{ job.title }}</h1>
            <div class="t-sm" style="margin-top: 4px">{{ subTitle }}</div>
          </div>
          <span v-if="!card && (fromRec || rec)" class="tag tag-private" style="flex: none">顾问推荐</span>
          <div v-if="card" class="match" :class="scoreClass(card.matchScore)">
            <div class="mv">{{ fmtScore(card.matchScore) }}%</div>
            <div class="ml">MATCH</div>
          </div>
        </div>
        <div class="job-sal big">{{ fmtSalary(job.salaryMin, job.salaryMax) }}<small>元 / 月（综合收入）</small></div>
        <div class="stats">
          <div><div class="t-xs">剩余名额</div><div class="num sv" :class="{ low: job.quotaRemaining <= 5 }">{{ job.quotaRemaining }}</div></div>
          <div><div class="t-xs">班次</div><div class="sv2">{{ label('ShiftType', job.shiftType) }}</div></div>
          <div><div class="t-xs">工种</div><div class="sv2">{{ label('JobType', job.jobType) }}</div></div>
        </div>
      </header>

      <div class="pad stack">
        <section v-if="rec?.note" class="note"><b>专属顾问推荐：</b>{{ rec.note }}</section>
        <section class="acard">
          <div class="acard-hd"><h4>薪资与班次</h4></div>
          <dl>
            <div class="kv"><dt>月综合收入</dt><dd>{{ fmtSalary(job.salaryMin, job.salaryMax) }} 元</dd></div>
            <div class="kv"><dt>班次</dt><dd>{{ label('ShiftType', job.shiftType) }}</dd></div>
            <div class="kv"><dt>工作地点</dt><dd>{{ [job.city, job.address].filter(Boolean).join(' · ') || '—' }}</dd></div>
          </dl>
          <p class="t-xs" style="margin-top: 6px">薪资为区间参考值，最终以企业公示标准及实际出勤、绩效核算为准</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>吃住条件</h4></div>
          <div class="chips" style="margin-top: 0">
            <span v-for="c in dorm" :key="c" class="chip" :class="{ 'chip-ok': c.startsWith('包') }">{{ c.startsWith('包') ? '✓ ' : '' }}{{ c }}</span>
          </div>
        </section>

        <section v-if="duties.length" class="acard">
          <div class="acard-hd"><h4>岗位职责</h4></div>
          <ul class="lines t-sm">
            <li v-for="d in duties" :key="d">· {{ d }}</li>
          </ul>
        </section>

        <section v-if="benefits.length" class="acard">
          <div class="acard-hd"><h4>福利待遇</h4></div>
          <div class="chips" style="margin-top: 0">
            <span v-for="b in benefits" :key="b" class="chip">{{ b }}</span>
          </div>
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
          <div class="chips" style="margin-top: 0">
            <span v-for="d in job.requiredDocuments" :key="d" class="chip">{{ d }}</span>
          </div>
        </section>

        <section v-if="notes.length" class="acard warnc">
          <div class="acard-hd"><h4>注意事项</h4></div>
          <ul class="lines t-sm">
            <li v-for="n in notes" :key="n">· {{ n }}</li>
          </ul>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>面试信息</h4></div>
          <dl>
            <div class="kv">
              <dt>面试地点</dt>
              <dd>{{ job.interviewAddress || '—' }}</dd>
            </div>
            <div v-if="job.interviewTimeDesc" class="kv"><dt>面试时间</dt><dd>{{ job.interviewTimeDesc }}</dd></div>
          </dl>
          <a v-if="nav" :href="nav" class="map" target="_blank" rel="noopener">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><circle cx="12" cy="10" r="2.6" fill="currentColor" /></svg>
            <span>用高德地图导航到面试地点</span>
          </a>
          <p class="t-xs" style="margin-top: 8px">报名后驻场老师会推送具体面试时间与集合地点</p>
        </section>

        <button type="button" class="acard ask-entry" @click="askOpen = true">
          <span class="ask-ic" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /><path d="M9.6 8.4a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.7-.9 1.3M12 13.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </span>
          <span class="flex1"><b>问问这个岗位</b><span class="t-xs">吃住、发薪、班次、体检… 有问必答</span></span>
          <van-icon name="arrow" class="chev" />
        </button>
        <button type="button" class="complain" @click="complainOpen = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.5v5m0 3.2v.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9" /></svg>
          岗位信息有问题？投诉该岗位
        </button>
        <div class="bottom-bar-gap"></div>
      </div>

      <div class="bottom-bar">
        <p v-if="!job.canApply && job.cannotApplyReason" class="why">{{ job.cannotApplyReason }}</p>
        <van-button type="primary" block class="btn-cta" :disabled="!job.canApply" :loading="flow.submitting.value" loading-text="提交中…" @click="onApply">
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
.detail { min-height: 100vh; background: var(--surface-2); }
.head { background: var(--surface); padding: 16px 14px; border-bottom: 1px solid var(--line); }
.title { font-size: 19px; font-weight: 700; color: var(--ink-900); line-height: 1.3; }
.job-sal.big { font-size: 26px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line); }
.sv { font-size: 17px; font-weight: 700; color: var(--ink-900); }
.sv.low { color: var(--warn); }
.sv2 { font-size: 13px; font-weight: 600; color: var(--ink-900); margin-top: 2px; }
.lines { line-height: 1.7; display: grid; gap: 4px; color: var(--ink-700); }
.warnc { border-color: var(--warn-line); background: var(--warn-bg); }
.warnc h4, .warnc .lines { color: var(--warn); }
.map { margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; height: 64px; border-radius: var(--r-md); border: 1px solid var(--line); color: var(--signal); font-size: 13px; font-weight: 600; text-decoration: none; background: repeating-linear-gradient(135deg, var(--surface-3) 0 10px, var(--surface-2) 10px 20px); }
.ask-entry { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border-color: var(--signal-300); background: linear-gradient(180deg, var(--signal-50), var(--surface)); }
.ask-entry b { display: block; font-size: 14px; font-weight: 700; color: var(--ink-900); }
.ask-entry .t-xs { display: block; margin-top: 2px; }
.ask-ic { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--signal); color: #fff; }
.ask-entry .chev { color: var(--ink-300); }
.complain { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px; border: 1px dashed var(--line-2); border-radius: var(--r-md); background: transparent; font-size: 12.5px; color: var(--ink-500); }
.complain:active { background: var(--surface-3); }
.why { font-size: 12px; color: var(--warn); text-align: center; margin-bottom: 8px; }
</style>
