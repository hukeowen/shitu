<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import { errorMessage, isApiError, useDict, type QuizOption, type QuizQuestion, type QuizView } from '@shitu/api-client'
import { IconCheck, IconInbox, IconLock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useMatchSession } from '@/composables/useMatchSession'
import { CITY_COLUMNS, provinceOf } from '@/utils/cities'

/** S-12 / S-13 答题（C-302）：一屏一题，点选作答，可返回修改；地域锁定题选「是」时选择城市。S-14 生成画像 */
const router = useRouter()
const { label } = useDict()
const { match, profile, locked, appliedLock, lockText } = useMatchSession()

const quiz = ref<QuizView | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    quiz.value = await match.loadQuiz()
    if (!quiz.value.questions.length) loadError.value = '题库暂未配置，请稍后再试'
  } catch (e) {
    loadError.value = errorMessage(e, '题目加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const questions = computed<QuizQuestion[]>(() => quiz.value?.questions ?? [])
const total = computed(() => questions.value.length)
const step = computed(() => Math.min(match.step, Math.max(0, total.value - 1)))
const q = computed<QuizQuestion | undefined>(() => questions.value[step.value])
const picked = computed(() => (q.value ? match.answers[q.value.seq] : undefined))
const isLast = computed(() => step.value >= total.value - 1)
const allAnswered = computed(() => questions.value.every((x) => !!match.answers[x.seq]))
/** 题型提示用求职者能看懂的话（不说「判断题 / 切割方向」；JUDGE 题也可能有 3 个选项） */
const kindText = computed(() => (q.value?.questionType === 'JUDGE' ? '先确定大方向' : '选一个最符合的'))

/** 已回答的题（S-13「已回答 · 可返回修改」） */
const answeredChips = computed(() =>
  questions.value
    .map((x, i) => {
      const a = match.answers[x.seq]
      if (!a || i === step.value) return null
      const opt = x.options.find((o) => o.code === a.code)
      if (!opt) return null
      return { i, text: a.region ? `锁定 ${a.region}` : opt.label }
    })
    .filter((x): x is { i: number; text: string } => !!x),
)

let advanceTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(advanceTimer))

function choose(opt: QuizOption) {
  if (!q.value) return
  clearTimeout(advanceTimer)
  if (opt.needRegion) {
    openCity(opt)
    return
  }
  match.setAnswer(q.value.seq, opt.code)
  // 点选后自动进入下一题（最后一题需手动提交）
  if (!isLast.value) advanceTimer = setTimeout(next, 260)
}

function next() {
  if (!q.value) return
  if (!match.answers[q.value.seq]) {
    showToast('请先选择一个选项')
    return
  }
  if (isLast.value) {
    void submit()
    return
  }
  match.setStep(step.value + 1)
  window.scrollTo(0, 0)
}

function prev() {
  if (analyzing.value) return
  clearTimeout(advanceTimer)
  if (step.value > 0) {
    match.setStep(step.value - 1)
    window.scrollTo(0, 0)
  } else {
    exit()
  }
}

function jump(i: number) {
  clearTimeout(advanceTimer)
  match.setStep(i)
  window.scrollTo(0, 0)
}

async function exit() {
  if (analyzing.value) return
  try {
    await showConfirmDialog({ title: '退出问薪', message: '已选的答案会保留，下次可以继续。确定退出吗？', confirmButtonText: '退出', cancelButtonText: '继续答题' })
  } catch {
    return
  }
  void router.replace('/')
}

// ---------- 城市选择（地域锁定题） ----------
const cityShow = ref(false)
const cityOpt = ref<QuizOption | null>(null)
const cityValues = ref<string[]>(['江苏', '苏州'])
function openCity(opt: QuizOption) {
  cityOpt.value = opt
  const cur = q.value ? match.answers[q.value.seq]?.region : undefined
  const prov = cur ? provinceOf(cur) : undefined
  cityValues.value = prov && cur ? [prov, cur] : ['江苏', '苏州']
  cityShow.value = true
}
function onCityConfirm({ selectedValues }: { selectedValues: Array<string | number> }) {
  const city = String(selectedValues[selectedValues.length - 1] ?? '')
  cityShow.value = false
  if (!q.value || !cityOpt.value || !city) return
  match.setAnswer(q.value.seq, cityOpt.value.code, city)
  if (!isLast.value) advanceTimer = setTimeout(next, 260)
}

// ---------- 提交匹配（S-14 画像生成） ----------
const analyzing = ref(false)
const phase = ref(0)
let phaseTimer: ReturnType<typeof setInterval> | undefined
onBeforeUnmount(() => clearInterval(phaseTimer))

const scopeName = computed(() => {
  const p = profile.value
  if (!p) return ''
  if (p.matchScope === 'OWN_COMPANY') return `${p.boundCompanyName ?? '本公司'}（${label('DomainTag', 'PRIVATE')}）`
  return label('MatchScope', p.matchScope)
})
const phases = computed(() => [
  `解析回答，生成画像标签（${total.value}/${total.value}）`,
  `确定匹配范围：${scopeName.value || '按当前归属'}`,
  '过滤已满员 / 暂停招聘岗位',
  '按匹配度与岗位权重排序',
  '输出匹配结果',
])

async function submit() {
  if (!allAnswered.value) {
    const i = questions.value.findIndex((x) => !match.answers[x.seq])
    showToast('还有题目没有回答')
    if (i >= 0) jump(i)
    return
  }
  analyzing.value = true
  phase.value = 0
  phaseTimer = setInterval(() => {
    if (phase.value < phases.value.length - 1) phase.value++
  }, 520)
  const minWait = new Promise((r) => setTimeout(r, 2300))
  try {
    await Promise.all([minWait, match.runMatch()])
    clearInterval(phaseTimer)
    phase.value = phases.value.length
    await new Promise((r) => setTimeout(r, 300))
    await router.replace('/match/result')
  } catch (e) {
    clearInterval(phaseTimer)
    analyzing.value = false
    if (isApiError(e, 'LC_4003')) {
      try {
        await showConfirmDialog({ title: '暂不能重新匹配', message: e.message, confirmButtonText: '查看我的报备', cancelButtonText: '回首页' })
        void router.replace('/reports')
      } catch {
        void router.replace('/')
      }
      return
    }
    await showDialog({ title: '匹配失败', message: errorMessage(e, '网络异常，请稍后重试') })
  }
}
const progress = computed(() => Math.min(100, Math.round((phase.value / phases.value.length) * 100)))
</script>

<template>
  <div class="quiz">
    <AppBar title="AI 问薪" :on-back="prev">
      <template #right><button type="button" class="bar-act" @click="exit">退出</button></template>
    </AppBar>

    <div v-if="locked" class="state-block">
      <IconLock :size="48" :stroke-width="1.5" />
      <div class="state-block-t">暂不能重新匹配</div>
      <div class="state-block-d">{{ lockText }}</div>
      <van-button v-if="appliedLock" type="primary" @click="router.replace('/reports')">查看我的报备</van-button>
    </div>
    <div v-else-if="loading" class="page-state"><van-loading size="28" vertical>题目加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <component :is="quiz ? IconInbox : IconTriangleExclamationPoint" :size="48" :stroke-width="1.5" />
      <div class="state-block-t">{{ quiz ? '暂时没有题目' : '加载失败' }}</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <template v-else-if="q">
      <div class="pad">
        <div class="prog-t"><b>第 {{ step + 1 }} / {{ total }} 题</b><span>{{ kindText }}</span></div>
        <div class="bar prog" role="progressbar" aria-valuemin="0" :aria-valuemax="total" :aria-valuenow="step + 1">
          <i class="sig" :style="{ width: ((step + 1) / total) * 100 + '%' }"></i>
        </div>

        <h1 class="stem">{{ q.stem }}</h1>
        <p v-if="q.hint" class="stem-d">{{ q.hint }}</p>

        <div class="opts" role="radiogroup" :aria-label="q.stem">
          <button
            v-for="o in q.options"
            :key="o.code"
            type="button"
            class="qopt"
            role="radio"
            :aria-checked="picked?.code === o.code"
            :class="{ sel: picked?.code === o.code }"
            @click="choose(o)"
          >
            <span class="flex1">
              {{ o.label }}
              <span v-if="o.sub" class="sub">{{ o.sub }}</span>
              <span v-if="o.needRegion && picked?.code === o.code && picked.region" class="sub">已选：{{ picked.region }} · 点击修改</span>
              <span v-else-if="o.needRegion" class="sub">选择后需选择城市</span>
            </span>
            <IconCheck v-if="picked?.code === o.code" :size="20" :stroke-width="2.25" />
          </button>
        </div>

        <section v-if="answeredChips.length" class="acard answered">
          <div class="acard-hd"><h4>已回答</h4><span class="t-xs">点击可返回修改</span></div>
          <div class="ans">
            <button v-for="c in answeredChips" :key="c.i" type="button" class="chip-tap" @click="jump(c.i)">
              <span class="chip"><IconCheck :size="12" :stroke-width="2.5" />{{ c.text }}</span>
            </button>
          </div>
        </section>
        <div class="bottom-bar-gap"></div>
      </div>

      <div class="bottom-bar row">
        <van-button size="large" class="prev" :disabled="step === 0" @click="prev">上一题</van-button>
        <van-button type="primary" size="large" class="next" :disabled="!picked" @click="next">
          {{ isLast ? '生成我的求职画像' : '下一题' }}
        </van-button>
      </div>
    </template>

    <van-popup v-model:show="cityShow" round position="bottom" teleport="body" :close-on-popstate="true">
      <van-picker v-model="cityValues" title="选择你想去的城市" :columns="CITY_COLUMNS" @confirm="onCityConfirm" @cancel="cityShow = false">
        <template #columns-top>
          <p class="city-tip">昆山、太仓、常熟、张家港等县级市请选「苏州」，仅匹配所选城市的岗位</p>
        </template>
      </van-picker>
      <div class="page-bottom-gap"></div>
    </van-popup>

    <transition name="fade">
      <div v-if="analyzing" class="analyzing" role="status" aria-live="polite">
        <div class="acard">
        <van-loading size="32" class="a-spin" />
        <div class="a-t">AI 正在分析你的求职画像</div>
        <p class="a-d">正在从{{ scopeName || '可匹配范围' }}的在招岗位中筛选最匹配的岗位</p>
        <ul class="a-steps">
          <li v-for="(t, i) in phases" :key="i" :class="{ done: i < phase, now: i === phase }">
            <span class="mk"><IconCheck v-if="i < phase" :size="16" :stroke-width="2.25" /><i v-else></i></span>{{ t }}
          </li>
        </ul>
        <div class="bar a-bar"><i class="sig" :style="{ width: progress + '%' }"></i></div>
        <div class="row-b a-foot"><span>匹配引擎运算中</span><span>{{ progress }}%</span></div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.quiz { min-height: 100vh; }
.prog-t { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.prog-t b { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.prog { height: 4px; margin-top: var(--space-2); background: var(--border); }
.stem { margin-top: var(--space-6); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.stem-d { margin-top: var(--space-1); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.opts { display: grid; gap: var(--space-3); margin-top: var(--space-4); }
.sub { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); line-height: 20px; color: var(--text-3); }
.qopt.sel .sub { color: var(--primary-text); }
.answered { margin-top: var(--space-4); }
.answered .acard-hd { margin-bottom: 0; }
.ans { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); }
.bottom-bar { gap: var(--space-3); }
.prev { flex: 1; }
.next { flex: 2; }
.city-tip { padding: var(--space-1) var(--space-4) var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-align: center; }

/* 提交中：盖住题目和底部栏（顶栏留着），浅灰底上一张白卡片，逐步显示匹配进度 */
.analyzing { position: fixed; inset: 0; z-index: 45; max-width: 750px; margin: 0 auto; padding: calc(var(--van-nav-bar-height) + env(safe-area-inset-top) + var(--space-4)) var(--space-page) 0; background: var(--bg-page); }
.analyzing .acard { display: flex; flex-direction: column; padding: var(--space-6) var(--space-card); }
.a-spin { align-self: center; --van-loading-spinner-color: var(--primary); }
.a-t { margin-top: var(--space-4); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); text-align: center; }
.a-d { margin-top: var(--space-1); font-size: var(--font-size-aux); color: var(--text-3); text-align: center; }
.a-steps { display: grid; gap: var(--space-3); margin-top: var(--space-6); }
.a-steps li { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-body); color: var(--text-3); transition: color .2s; }
.a-steps li.done { color: var(--text-2); }
.a-steps li.now { color: var(--text-1); font-weight: var(--font-weight-medium); }
.mk { flex: none; display: grid; place-items: center; width: 16px; height: 16px; color: var(--success-text); }
.mk i { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
.now .mk i { background: var(--primary); }
.a-bar { margin-top: var(--space-6); }
.a-foot { margin-top: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
