<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type BrokerProgress, type MatchOutcome } from '@shitu/api-client'
import { IconChevronRight, IconCircleExclamationPoint, IconInbox, IconLock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
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
// 后端只返回排序前 3 且 ≥80% 的岗位（D-39）；这里再截一次，保证最多 3 张卡
const results = computed(() => (outcome.value?.results ?? []).slice(0, 3))

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
  OPEN: { text: '待联系', cls: 'status-tag--info' },
  CONTACTED: { text: '已联系', cls: 'status-tag--info' },
  RECOMMENDED: { text: '已推荐岗位', cls: 'status-tag--success' },
  APPLIED: { text: '已报名', cls: 'status-tag--success' },
  RELEASED: { text: '已开放全平台', cls: 'status-tag--warning' },
  CLOSED: { text: '已结束', cls: 'status-tag--neutral' },
}
const brokerTag = computed(() => (brokerCase.value ? BROKER_TAG[brokerCase.value.status] : { text: '处理中', cls: 'status-tag--info' }))

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
        <button v-if="!locked && outcome" type="button" class="bar-act" @click="rematch">重新匹配</button>
      </template>
    </AppBar>

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load(true)">重新加载</van-button>
    </div>
    <div v-else-if="!outcome" class="state-block">
      <IconInbox :size="48" :stroke-width="1.5" />
      <div class="state-block-t">还没有匹配结果</div>
      <div class="state-block-d">先完成 AI 问薪吧</div>
      <van-button v-if="!locked" type="primary" @click="router.replace('/match')">开始 AI 问薪</van-button>
    </div>

    <!-- S-16：有 ≥80% 的岗位 -->
    <div v-else-if="outcome.matched && results.length" class="pad stack">
      <header class="hd">
        <div class="flex1">
          <h1>为你锁定 {{ results.length }} 个岗位</h1>
          <p>匹配范围：{{ scopeText }} · 从中选 1 个报名</p>
        </div>
        <span class="status-tag status-tag--info">{{ label('DomainTag', isPrivateScope ? 'PRIVATE' : 'PUBLIC') }}</span>
      </header>

      <section v-if="locked" class="tipbar tipbar--warn">
        <IconLock :size="20" />
        <div class="flex1">
          <div class="tipbar-t">{{ lockText }}。</div>
          <div class="tipbar-d">你可以查看岗位信息，报名进度请到「我的报备」查看。</div>
        </div>
      </section>

      <section v-if="portrait.length" class="acard">
        <div class="acard-hd"><h4>你的求职画像</h4><span class="t-xs">仅用于岗位匹配，不对外展示</span></div>
        <ul class="chips portrait">
          <li v-for="p in portrait" :key="p" class="chip">{{ p }}</li>
        </ul>
      </section>

      <JobCard v-for="(j, i) in results" :key="j.jobId" :job="j" :top="i === 0" @open="openJob" />

      <div class="note">
        <b>{{ results.length < 3 ? '只显示匹配度达标的岗位，是刻意的。' : '只显示 3 个，是刻意的。' }}</b>平台不提供岗位列表浏览 —— 岗位只在完成 AI 问薪后以结果形式出现，匹配度 ≥80% 才推荐给你。都不满意可重新匹配，次数不限。
      </div>
      <van-button v-if="!locked" block @click="rematch">都不满意，重新匹配</van-button>
      <van-button v-else-if="appliedLock" block @click="router.push('/reports')">查看我的报备</van-button>
      <div class="page-bottom-gap"></div>
    </div>

    <!-- S-17：没有 ≥80% 的岗位 -->
    <template v-else>
      <div class="pad stack">
        <section class="acard">
          <div class="state-block none">
            <IconCircleExclamationPoint :size="48" :stroke-width="1.5" />
            <div class="state-block-t">{{ isPrivateScope ? '暂无高匹配度岗位' : '暂时没有特别合适的岗位' }}</div>
            <template v-if="isPrivateScope">
              <div class="state-block-d">当前范围内没有匹配度 ≥80% 的岗位。</div>
              <div class="state-block-d">为避免推荐「货不对板」的岗位，我们不展示低匹配结果。</div>
            </template>
            <template v-else>
              <div class="state-block-d">没有匹配度 ≥80% 的岗位，调整条件再试试。</div>
              <div class="state-block-d">比如放宽地域、工种或班次要求。</div>
            </template>
          </div>
        </section>

        <template v-if="isPrivateScope">
          <section class="acard">
            <div class="acard-hd"><h4>已为你安排专属人才经纪人</h4><span class="status-tag" :class="brokerTag.cls">{{ brokerTag.text }}</span></div>
            <div class="b-t">{{ brokerCase?.companyName || company || '本公司' }} · 人才经纪人</div>
            <p class="b-d">将在 2 小时内与你电话沟通，24 小时内给出推荐结果</p>
            <div class="divider"></div>
            <ul class="tl">
              <li v-for="(st, i) in brokerSteps" :key="i" :class="st.state">
                <div class="tl-t">{{ st.text }}<span v-if="st.state" class="status-tag" :class="st.state === 'done' ? 'status-tag--success' : 'status-tag--info'">{{ st.state === 'done' ? '已完成' : '进行中' }}</span></div>
                <div class="tl-m">{{ st.meta }}</div>
              </li>
            </ul>
          </section>
          <router-link to="/recommendations" class="acard recl">
            <div class="flex1">
              <div class="b-t">{{ journey.pendingRecs.length ? `顾问已为你推荐 ${journey.pendingRecs.length} 个岗位` : '专属顾问正在为你挑选岗位' }}</div>
              <p class="b-d">{{ journey.pendingRecs.length ? '确认后即可按正常流程报名' : '有推荐时会通过站内消息通知你' }}</p>
            </div>
            <span class="link">{{ journey.pendingRecs.length ? '去看看' : '查看' }}<IconChevronRight :size="16" /></span>
          </router-link>
          <div class="note">
            <b>请保持手机畅通。</b>如推荐的岗位你仍不满意，顾问会为你开放全平台岗位匹配，可以在所有劳务公司的岗位中选择。
          </div>
          <van-button v-if="!locked" block @click="rematch">调整条件重新匹配</van-button>
        </template>
        <div v-if="isPrivateScope || !locked" class="bottom-bar-gap"></div>
      </div>

      <div v-if="isPrivateScope || !locked" class="bottom-bar">
        <van-button v-if="isPrivateScope" type="primary" size="large" block @click="router.replace('/')">返回首页等待联系</van-button>
        <van-button v-else type="primary" size="large" block @click="rematch">调整条件重新匹配</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.result { min-height: 100vh; }
.hd { display: flex; align-items: flex-start; gap: var(--space-3); }
.hd h1 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.hd .status-tag { flex: none; margin-top: 2px; }
.tl-t .status-tag { margin-left: var(--space-2); vertical-align: 1px; }
.hd p { margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.portrait { margin-top: 0; }
.none { padding: var(--space-4) 0; }
.none > svg { color: var(--warning-text); }
.b-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.b-d { margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.recl { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; text-decoration: none; color: inherit; }
</style>
