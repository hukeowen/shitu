<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import { errorMessage, isApiError, useDict, type QuizOption, type QuizQuestion, type QuizView } from '@shitu/api-client'
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
const kindText = computed(() => (q.value?.questionType === 'JUDGE' ? '判断题 · 切割大方向' : '选择题 · 细化需求'))

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
    <AppBar :title="total ? `AI 问薪 · ${step + 1} / ${total}` : 'AI 问薪'" :on-back="prev">
      <template #right><span class="exit" @click="exit">退出</span></template>
    </AppBar>

    <div v-if="locked" class="page-state">
      <van-empty image="error" :description="lockText">
        <van-button v-if="appliedLock" round type="primary" size="small" @click="router.replace('/reports')">查看我的报备</van-button>
      </van-empty>
    </div>
    <div v-else-if="loading" class="page-state"><van-loading size="28" vertical>题目加载中…</van-loading></div>
    <div v-else-if="loadError" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <template v-else-if="q">
      <div class="pad-x" style="padding-top: 12px">
        <div class="qprog"><i v-for="(x, i) in questions" :key="x.seq" :class="{ on: i <= step }"></i></div>
      </div>
      <div class="pad">
        <div class="row ask">
          <div class="ai">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3.2" stroke="#E8590C" stroke-width="2" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3" stroke="#fff" stroke-width="2" stroke-linecap="round" /></svg>
          </div>
          <div class="qbubble flex1">
            <div class="kind">{{ kindText }}</div>
            <div class="stem">{{ q.stem }}</div>
            <div v-if="q.hint" class="t-xs" style="margin-top: 3px">{{ q.hint }}</div>
          </div>
        </div>

        <div class="stack-sm" role="radiogroup" :aria-label="q.stem">
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
            <span class="k">{{ o.code }}</span>
            <span class="flex1">
              {{ o.label }}
              <span v-if="o.sub" class="sub">{{ o.sub }}</span>
              <span v-if="o.needRegion && picked?.code === o.code && picked.region" class="sub region">已选：{{ picked.region }} · 点击修改</span>
              <span v-else-if="o.needRegion" class="sub">选择后需选择城市</span>
            </span>
          </button>
        </div>

        <section v-if="answeredChips.length" class="acard answered">
          <div class="acard-hd"><h4>已回答</h4><span class="t-xs">点击可返回修改</span></div>
          <div class="chips">
            <button v-for="c in answeredChips" :key="c.i" type="button" class="chip" @click="jump(c.i)">✓ {{ c.text }}</button>
          </div>
        </section>
        <div class="sticky-gap"></div>
      </div>

      <div class="sticky-ft">
        <van-button type="primary" block class="btn-cta" :disabled="!picked" @click="next">
          {{ isLast ? '生成我的求职画像' : '下一题' }}
        </van-button>
      </div>
    </template>

    <van-popup v-model:show="cityShow" round position="bottom" teleport="body" :close-on-popstate="true">
      <van-picker v-model="cityValues" title="选择你想去的城市" :columns="CITY_COLUMNS" @confirm="onCityConfirm" @cancel="cityShow = false">
        <template #columns-top>
          <p class="t-xs city-tip">昆山、太仓、常熟、张家港等县级市请选「苏州」，仅匹配所选城市的岗位</p>
        </template>
      </van-picker>
      <div class="page-bottom-gap"></div>
    </van-popup>

    <transition name="fade">
      <div v-if="analyzing" class="analyzing" role="status" aria-live="polite">
        <div class="center">
          <div class="spin-ic">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </div>
          <div class="a-t">AI 正在分析你的求职画像</div>
          <p class="a-d">正在从{{ scopeName || '可匹配范围' }}的在招岗位中筛选最匹配的岗位</p>
        </div>
        <ul class="a-steps">
          <li v-for="(t, i) in phases" :key="i" :class="{ done: i < phase, now: i === phase }">
            <span class="mk">{{ i < phase ? '✓' : i === phase ? '◔' : '○' }}</span>{{ t }}
          </li>
        </ul>
        <div class="a-bar"><i :style="{ width: progress + '%' }"></i></div>
        <div class="row-b a-foot"><span>匹配引擎运算中</span><span class="mono">{{ progress }}%</span></div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.quiz { min-height: 100vh; background: var(--surface-2); }
.exit { font-size: 12.5px; color: var(--ink-400); padding: 4px 0 4px 8px; }
.ask { align-items: flex-start; gap: 10px; margin-bottom: 16px; }
.ai { width: 30px; height: 30px; border-radius: 9px; background: var(--ink-900); display: grid; place-items: center; flex: none; }
.kind { font-family: var(--f-mono); font-size: 11px; color: var(--signal); margin-bottom: 5px; }
.stem { font-weight: 700; }
.sub { display: block; font-size: 11.5px; font-weight: 500; color: var(--ink-400); margin-top: 2px; }
.qopt.sel .sub { color: var(--signal-700); opacity: .8; }
.sub.region { color: var(--signal); opacity: 1; font-weight: 600; }
.answered { margin-top: 16px; }
.answered .chip { border: 1px solid var(--line); cursor: pointer; }
.sticky-gap { height: 70px; }
.sticky-ft { position: fixed; left: 0; right: 0; bottom: 0; max-width: 750px; margin: 0 auto; padding: 22px 14px calc(14px + env(safe-area-inset-bottom)); background: linear-gradient(transparent, var(--surface-2) 30%); z-index: 30; }
.city-tip { padding: 4px 16px 6px; text-align: center; line-height: 1.5; }

.analyzing { position: fixed; inset: 0; z-index: 2000; background: linear-gradient(165deg, #1d2733, #0d1117); color: #fff; display: flex; flex-direction: column; justify-content: center; padding: 0 28px; }
.center { text-align: center; }
.spin-ic { width: 78px; height: 78px; border-radius: 24px; background: rgba(232, 89, 12, .16); border: 1px solid rgba(232, 89, 12, .4); display: grid; place-items: center; margin: 0 auto 22px; color: var(--signal-300); }
.spin-ic svg { animation: spin 2.4s linear infinite; }
.a-t { font-family: var(--f-dis); font-size: 21px; font-weight: 700; }
.a-d { font-size: 12.5px; color: rgba(255, 255, 255, .5); margin-top: 8px; }
.a-steps { margin-top: 30px; display: grid; gap: 9px; }
.a-steps li { font-size: 12.5px; color: rgba(255, 255, 255, .35); display: flex; gap: 9px; transition: color .2s; }
.a-steps li.done { color: rgba(255, 255, 255, .85); }
.a-steps li.done .mk { color: var(--ok); }
.a-steps li.now { color: #fff; }
.a-steps li.now .mk { color: var(--signal-300); }
.mk { width: 14px; flex: none; text-align: center; }
.a-bar { margin-top: 26px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .12); overflow: hidden; }
.a-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--signal-300), var(--signal)); border-radius: 3px; transition: width .45s ease; }
.a-foot { margin-top: 7px; font-size: 11.5px; color: rgba(255, 255, 255, .45); }
@keyframes spin { to { transform: rotate(360deg); } }
.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .spin-ic svg { animation: none; } }
</style>
