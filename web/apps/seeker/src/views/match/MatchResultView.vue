<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type BrokerProgress, type MatchOutcome } from '@shitu/api-client'
import { formatRelative, formatServerTime, untilText } from '@/utils/time'
import AppBar from '@/components/AppBar.vue'
import JobCard from '@/components/JobCard.vue'
import { useJourney } from '@/composables/useJourney'
import { useMatchSession } from '@/composables/useMatchSession'

/**
 * S-16 匹配结果（C-304 / C-306）：固定 3 岗、只展示 ≥80%（D-39，可能少于 3 个）；报名前可无限次重新匹配。
 * S-17 匹配度不足（C-305 / D-38）：私域 → 已转本公司人才经纪人；公域 → 提示调整条件重新匹配。
 */
const router = useRouter()
const { label } = useDict()
const { match, profile, locked, appliedLock, lockText } = useMatchSession()

const loading = ref(!match.outcome)
const loadError = ref('')
const outcome = computed<MatchOutcome | null>(() => match.outcome)

async function load(force = false) {
  loading.value = !match.outcome
  loadError.value = ''
  try {
    await match.loadLatest(force)
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
// 从岗位详情等返回时也能恢复最近一次结果（后端快照）
void load(!match.outcome)

const isPrivateScope = computed(() => outcome.value?.scope === 'OWN_COMPANY' || outcome.value?.scope === 'INTERNAL_TRANSFER_ONLY')
const company = computed(() => profile.value?.boundCompanyName ?? '')
const scopeText = computed(() => {
  const o = outcome.value
  if (!o) return ''
  if (o.scope === 'OWN_COMPANY') return `${company.value || '本公司'}（${label('DomainTag', 'PRIVATE')}）`
  if (o.scope === 'ALL_PLATFORM') return `${label('MatchScope', 'ALL_PLATFORM')}（${label('DomainTag', 'PUBLIC')}）`
  return label('MatchScope', o.scope)
})
const results = computed(() => outcome.value?.results ?? [])
/** 已有进行中的报名 / 已在岗：结果只读（与岗位详情页禁用「报名面试」保持一致） */
const employed = computed(() => profile.value?.status === 'EMPLOYED')
const viewOnly = computed(() => locked.value || employed.value)

// S-17 私域匹配度不足：已转专属顾问（人才经纪人），推荐结果在「专属顾问推荐」查看（T-203）
const journey = useJourney()
watch(
  () => (outcome.value && !outcome.value.matched && isPrivateScope.value ? outcome.value : null),
  (o) => {
    if (!o) return
    void journey.loadRecs().catch(() => undefined)
    void seekerApi.brokerCase().then((c) => (brokerCase.value = c)).catch(() => undefined)
  },
  { immediate: true },
)

/** C-305：经纪人工单的真实进度；取不到工单时退回到固定的时限说明 */
const brokerCase = ref<BrokerProgress | null>(null)
interface Step { text: string; meta: string; state: '' | 'done' | 'now' }
const brokerSteps = computed<Step[]>(() => {
  const c = brokerCase.value
  if (!c) {
    return [
      { text: '画像与匹配记录已同步至经纪人', meta: '刚刚', state: 'done' },
      { text: '经纪人电话联系你，了解需求', meta: '2 小时内', state: 'now' },
      { text: '人工二次匹配推荐', meta: '24 小时内', state: '' },
      { text: '仍不满意 → 可改为匹配全平台岗位', meta: '兜底路径', state: '' },
    ]
  }
  const open = c.status === 'OPEN' || c.status === 'CONTACTED' || c.status === 'RECOMMENDED'
  const recommended = c.recommendCount > 0
  const left = (due: string, done: string) => (untilText(due) ? `还剩 ${untilText(due)}` : done)
  return [
    { text: '画像与匹配记录已同步至经纪人', meta: formatRelative(c.createdAt), state: 'done' },
    c.contactedAt
      ? { text: '经纪人已联系你', meta: formatServerTime(c.contactedAt), state: 'done' }
      : { text: '经纪人电话联系你，了解需求', meta: open ? left(c.contactDueAt, '已超过 2 小时，平台已催办') : '—', state: open ? 'now' : '' },
    recommended
      ? { text: `已为你推荐 ${c.recommendCount} 个岗位`, meta: formatServerTime(c.firstRecommendedAt), state: 'done' }
      : { text: '人工二次匹配推荐', meta: open ? left(c.resolveDueAt, '即将给出结果') : '—', state: open && c.contactedAt ? 'now' : '' },
    c.status === 'RELEASED'
      ? { text: '已为你开放全平台岗位匹配', meta: formatServerTime(c.closedAt), state: 'done' }
      : c.status === 'APPLIED'
        ? { text: '你已报名推荐的岗位', meta: formatServerTime(c.closedAt), state: 'done' }
        : { text: '仍不满意 → 可改为匹配全平台岗位', meta: '兜底路径', state: '' },
  ]
})
const BROKER_TAG: Record<BrokerProgress['status'], { text: string; cls: string }> = {
  OPEN: { text: '待联系', cls: 'tag-info' },
  CONTACTED: { text: '已联系', cls: 'tag-info' },
  RECOMMENDED: { text: '已推荐岗位', cls: 'tag-ok' },
  APPLIED: { text: '已报名', cls: 'tag-ok' },
  RELEASED: { text: '已开放全平台', cls: 'tag-warn' },
  CLOSED: { text: '已结束', cls: 'tag-muted' },
}
const brokerTag = computed(() => (brokerCase.value ? BROKER_TAG[brokerCase.value.status] : { text: '处理中', cls: 'tag-info' }))

/** S-15 画像摘要：来自本次作答（刷新后从 sessionStorage 恢复；仅后端快照时不展示） */
const portrait = computed(() => {
  const qz = match.quiz
  if (!qz) return []
  return qz.questions
    .map((q) => {
      const a = match.answers[q.seq]
      const o = a && q.options.find((x) => x.code === a.code)
      if (!o) return null
      return a.region ? `锁定 ${a.region}` : o.label
    })
    .filter((x): x is string => !!x)
})
if (!match.quiz) void match.loadQuiz().catch(() => undefined)

function openJob(jobId: string) {
  void router.push(`/jobs/${jobId}`)
}
function rematch() {
  match.setStep(0)
  void router.push('/match/quiz')
}
</script>

<template>
  <div class="result">
    <AppBar title="匹配结果" fallback="/" :on-back="() => router.replace('/')">
      <template #right>
        <span v-if="!viewOnly && outcome" class="re" @click="rematch">重新匹配</span>
      </template>
    </AppBar>

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round type="primary" size="small" @click="load(true)">重新加载</van-button>
      </van-empty>
    </div>
    <div v-else-if="!outcome" class="page-state">
      <van-empty :description="viewOnly ? `还没有匹配结果。${lockText}` : '还没有匹配结果，先完成 AI 问薪吧'">
        <van-button v-if="!viewOnly" round type="primary" size="small" @click="router.replace('/match')">开始 AI 问薪</van-button>
      </van-empty>
    </div>

    <!-- S-16：有 ≥80% 的岗位 -->
    <template v-else-if="outcome.matched && results.length">
      <div class="pad-x hd">
        <div class="row-b">
          <div>
            <div class="h-t">{{ viewOnly ? `上次匹配到 ${results.length} 个岗位` : `为你锁定 ${results.length} 个岗位` }}</div>
            <div class="t-xs">匹配范围：{{ scopeText }} · {{ viewOnly ? '当前仅可查看' : '从中选 1 个报名' }}</div>
          </div>
          <span class="tag" :class="isPrivateScope ? 'tag-private' : 'tag-public'">{{ label('DomainTag', isPrivateScope ? 'PRIVATE' : 'PUBLIC') }}</span>
        </div>
      </div>

      <div class="pad stack">
        <section v-if="viewOnly" class="note note--warn">
          <b>{{ lockText }}。</b>{{ employed ? '以下为上次的匹配结果，仅可查看岗位信息，不能报名。' : '以下岗位仅可查看、不能报名，报名进度请到「我的报备」查看。' }}
        </section>

        <section v-if="portrait.length" class="acard portrait">
          <div class="row-b"><b>你的求职画像</b><span class="t-xs pt-tip">仅用于岗位匹配，不对外展示</span></div>
          <div class="chips">
            <span v-for="p in portrait" :key="p" class="chip">{{ p }}</span>
          </div>
        </section>

        <JobCard v-for="(j, i) in results" :key="j.jobId" :job="j" :top="i === 0" :view-only="viewOnly" @open="openJob" />

        <div class="note note--info">
          <b>{{ results.length < 3 ? '只显示匹配度达标的岗位，是刻意的。' : '只显示 3 个，是刻意的。' }}</b>平台不提供岗位列表浏览 —— 岗位只在完成 AI 问薪后以结果形式出现，匹配度 ≥80% 才推荐给你。<template v-if="!viewOnly">都不满意可重新匹配，次数不限。</template>
        </div>
        <van-button v-if="!viewOnly" block class="btn-cta" @click="rematch">都不满意，重新匹配</van-button>
        <van-button v-else-if="appliedLock" block class="btn-cta" @click="router.push('/reports')">查看我的报备</van-button>
        <van-button v-else-if="employed" block class="btn-cta" @click="router.push('/work')">查看我的工作</van-button>
        <div class="page-bottom-gap"></div>
      </div>
    </template>

    <!-- S-17：没有 ≥80% 的岗位 -->
    <div v-else class="pad stack">
      <section class="acard none">
        <div class="big-ic none-ic">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.5v5m0 3.2v.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /></svg>
        </div>
        <div class="none-t">{{ isPrivateScope ? '暂无高匹配度岗位' : '暂时没有特别合适的岗位' }}</div>
        <p v-if="isPrivateScope" class="t-sm none-d">当前范围内没有匹配度 ≥80% 的岗位。<br />为避免推荐「货不对板」的岗位，我们不展示低匹配结果。</p>
        <p v-else class="t-sm none-d">没有匹配度 ≥80% 的岗位，调整条件再试试。<br />比如放宽地域、工种或班次要求。</p>
      </section>

      <template v-if="isPrivateScope">
        <section class="acard">
          <div class="acard-hd"><h4>已为你安排专属人才经纪人</h4><span class="tag" :class="brokerTag.cls">{{ brokerTag.text }}</span></div>
          <div class="row" style="gap: 10px; padding: 2px 0 4px">
            <div class="avatar avatar--o avatar--sm">{{ (company || '经').slice(0, 1) }}</div>
            <div class="flex1">
              <b class="b-t">{{ brokerCase?.companyName || company || '本公司' }} · 人才经纪人</b>
              <div class="t-xs">将在 2 小时内与你电话沟通，24 小时内给出推荐结果</div>
            </div>
          </div>
          <div class="divider" style="margin: 10px 0"></div>
          <ul class="tl">
            <li v-for="(st, i) in brokerSteps" :key="i" :class="st.state"><div class="tl-t">{{ st.text }}</div><div class="tl-m">{{ st.meta }}</div></li>
          </ul>
        </section>
        <router-link to="/recommendations" class="acard recl">
          <div class="flex1">
            <b class="recl-t">{{ journey.pendingRecs.length ? `顾问已为你推荐 ${journey.pendingRecs.length} 个岗位` : viewOnly ? '暂无顾问推荐' : '专属顾问正在为你挑选岗位' }}</b>
            <div class="t-xs">{{ journey.pendingRecs.length ? (viewOnly ? '当前仅可查看' : '确认后即可按正常流程报名') : viewOnly ? lockText : '有推荐时会通过站内消息通知你' }}</div>
          </div>
          <span class="recl-a">{{ journey.pendingRecs.length ? '去看看' : '查看' }} ›</span>
        </router-link>
        <div class="note">
          <b>请保持手机畅通。</b>如推荐的岗位你仍不满意，顾问会为你开放全平台岗位匹配，可以在所有劳务公司的岗位中选择。
        </div>
      </template>

      <van-button v-if="!viewOnly" block class="btn-cta" :type="isPrivateScope ? 'default' : 'primary'" @click="rematch">调整条件重新匹配</van-button>
      <van-button v-if="isPrivateScope" type="primary" block class="btn-cta" @click="router.replace('/')">返回首页等待联系</van-button>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.result { min-height: 100vh; background: var(--surface-2); }
.re { font-size: 12.5px; color: var(--signal); font-weight: 600; padding: 4px 0 4px 8px; }
.hd { padding-top: 14px; }
.h-t { font-size: 16px; font-weight: 700; color: var(--ink-900); }
.portrait { background: linear-gradient(160deg, #1d2733, #0d1117); border: 0; color: #fff; }
.portrait b { font-size: 14px; }
.portrait .pt-tip { color: rgba(255, 255, 255, .45); }
.portrait .chip { background: rgba(255, 255, 255, .1); color: #fff; border-color: rgba(255, 255, 255, .16); }
.none { text-align: center; padding: 22px 16px; border-color: var(--warn-line); background: var(--warn-bg); }
.none-ic { color: var(--warn); }
.none-t { font-size: 17px; font-weight: 700; color: var(--warn); }
.none-d { color: var(--warn); margin-top: 7px; line-height: 1.7; }
.b-t { font-size: 13.5px; color: var(--ink-900); display: block; }
.recl { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; border-color: var(--private-line); background: var(--private-bg); }
.recl-t { font-size: 13.5px; color: var(--private); display: block; }
.recl .t-xs { margin-top: 2px; }
.recl-a { flex: none; font-size: 12.5px; font-weight: 700; color: var(--private); }
</style>
