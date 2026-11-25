<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type MatrixChoice, type QuizOption, type QuizQuestion, type QuizView } from '@shitu/api-client'
import { IconCheck, IconInbox, IconLock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useMatchSession } from '@/composables/useMatchSession'
import { useChannelStore } from '@/stores/channel'
import { CITY_COLUMNS, provinceOf } from '@/utils/cities'
import { MATRIX_COLUMNS, NOTE_MAX, answerText, isAnswered, numberRange } from '@/utils/quiz'

/**
 * S-12 / S-13 答题（C-302）：一屏一题，可返回修改；地域锁定题选「是」时选择城市。S-14 生成画像。
 * D-62 题型：单选（点选后自动下一题）、数字（年龄，大输入框 + 加减按钮）、矩阵（每种班次 接受 / 不接受 / 看情况，
 * 选「看情况」可补一句，可不填）。游客也能答：答完看打码预览，登录后再看完整岗位。
 */
const router = useRouter()
const { match, profile, locked, appliedLock, lockText, isGuest } = useMatchSession()
const channel = useChannelStore()

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
const done = computed(() => !!q.value && isAnswered(q.value, picked.value))
// 进到哪道题就上报一次（平台用来看哪道题流失最多）；游客不上报（没有用户 ID，D-62）；上报失败不影响答题
watch(() => q.value?.seq, (seq) => { if (seq && !isGuest.value) seekerApi.quizStep(seq).catch(() => {}) }, { immediate: true })
const isLast = computed(() => step.value >= total.value - 1)
const allAnswered = computed(() => questions.value.every((x) => isAnswered(x, match.answers[x.seq])))
/** 题型提示用求职者能看懂的话（不说「判断题 / 切割方向」；JUDGE 题也可能有 3 个选项） */
const kindText = computed(() => {
  switch (q.value?.questionType) {
    case 'JUDGE': return '先确定大方向'
    case 'NUMBER': return '填个数字'
    case 'MATRIX': return '每一行选一个'
    default: return '选一个最符合的'
  }
})

/** 已回答的题（S-13「已回答 · 可返回修改」） */
const answeredChips = computed(() =>
  questions.value
    .map((x, i) => {
      if (i === step.value) return null
      const text = answerText(x, match.answers[x.seq])
      return text ? { i, text } : null
    })
    .filter((x): x is { i: number; text: string } => !!x),
)

// ---------- 数字题（年龄） ----------
const range = computed(() => (q.value ? numberRange(q.value) : { min: 16, max: 65, unit: '' }))
const numText = ref('')
watch(
  () => [q.value?.seq, q.value?.questionType] as const,
  () => {
    numText.value = q.value?.questionType === 'NUMBER' && picked.value?.number != null ? String(picked.value.number) : ''
  },
  { immediate: true },
)
const numError = computed(() => {
  if (!numText.value) return ''
  const n = Number(numText.value)
  const { min, max, unit } = range.value
  return Number.isInteger(n) && n >= min && n <= max ? '' : `请填 ${min}–${max} ${unit}之间的数`
})
function onNumInput(v: string) {
  numText.value = v.replace(/\D/g, '').slice(0, 3)
  if (!q.value) return
  const n = Number(numText.value)
  const { min, max } = range.value
  match.putAnswer(q.value.seq, numText.value && Number.isInteger(n) && n >= min && n <= max ? { number: n } : null)
}
function bump(d: number) {
  const { min, max } = range.value
  const cur = numText.value ? Number(numText.value) : 25 - d
  onNumInput(String(Math.min(max, Math.max(min, cur + d))))
}

// ---------- 矩阵题（班次 接受 / 不接受 / 看情况） ----------
function pickCell(rowCode: string, v: MatrixChoice) {
  if (!q.value) return
  const cur = picked.value ?? {}
  const matrix = { ...(cur.matrix ?? {}), [rowCode]: v }
  match.putAnswer(q.value.seq, { matrix, notes: cur.notes })
}
function setNote(rowCode: string, text: string) {
  if (!q.value) return
  const cur = picked.value ?? {}
  match.putAnswer(q.value.seq, { matrix: cur.matrix, notes: { ...(cur.notes ?? {}), [rowCode]: text.slice(0, NOTE_MAX) } })
}
const followUp = computed(() => q.value?.config?.followUp || '什么情况下可以？')

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
  if (!done.value) {
    showToast(q.value.questionType === 'NUMBER' ? numError.value || '请先填一个数' : q.value.questionType === 'MATRIX' ? '每一行都要选一个' : '请先选择一个选项')
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
  // 游客：有邀请公司就只看这家公司的岗位，否则全平台（与预览接口一致）
  if (isGuest.value) return channel.inviter ? `${channel.inviter}的岗位` : '全平台的岗位'
  const p = profile.value
  if (!p) return ''
  if (p.matchScope === 'OWN_COMPANY') return `${p.boundCompanyName ?? '本公司'}的岗位`
  if (p.matchScope === 'ALL_PLATFORM') return '全平台的岗位'
  if (p.matchScope === 'INTERNAL_TRANSFER_ONLY') return '本公司内部能调的岗位'
  return ''
})
const phases = computed(() => [
  `看完你的 ${total.value} 个回答`,
  `只在${scopeName.value || '你能报的岗位'}里找`,
  '去掉招满了、暂停招人的岗位',
  '条件最对得上的排前面',
  '把结果给你',
])

async function submit() {
  if (!allAnswered.value) {
    const i = questions.value.findIndex((x) => !isAnswered(x, match.answers[x.seq]))
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
    // 游客：只看打码预览，不落库；登录用户：正式匹配
    await Promise.all([minWait, isGuest.value ? match.runPreview(channel.submitCode()) : match.runMatch()])
    clearInterval(phaseTimer)
    phase.value = phases.value.length
    await new Promise((r) => setTimeout(r, 300))
    await router.replace(isGuest.value ? '/match/preview' : '/match/result')
  } catch (e) {
    clearInterval(phaseTimer)
    analyzing.value = false
    if (isApiError(e, 'LC_4003')) {
      try {
        await showConfirmDialog({ title: '暂不能重新匹配', message: e.message, confirmButtonText: '查看我的报名', cancelButtonText: '回首页' })
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
      <van-button v-if="appliedLock" type="primary" @click="router.replace('/reports')">查看我的报名</van-button>
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

        <!-- 数字题：大输入框 + 加减按钮 -->
        <div v-if="q.questionType === 'NUMBER'" class="num">
          <div class="num-row">
            <button type="button" class="num-btn" aria-label="减一" :disabled="!!numText && Number(numText) <= range.min" @click="bump(-1)">−</button>
            <label class="num-box" :class="{ err: !!numError }">
              <input
                :value="numText"
                class="num-in"
                type="tel"
                inputmode="numeric"
                maxlength="3"
                :aria-label="q.stem"
                placeholder="比如 28"
                @input="onNumInput(($event.target as HTMLInputElement).value)"
              />
              <span v-if="range.unit" class="num-unit">{{ range.unit }}</span>
            </label>
            <button type="button" class="num-btn" aria-label="加一" :disabled="!!numText && Number(numText) >= range.max" @click="bump(1)">+</button>
          </div>
          <p class="num-tip" :class="{ err: !!numError }">{{ numError || `填 ${range.min}–${range.max} ${range.unit}之间的数` }}</p>
        </div>

        <!-- 矩阵题：每行一种班次，三个大按钮；选「看情况」可补一句（可不填） -->
        <div v-else-if="q.questionType === 'MATRIX'" class="mtx">
          <div v-for="r in q.options" :key="r.code" class="mrow" role="radiogroup" :aria-label="r.label">
            <div class="mrow-t">{{ r.label }}<span v-if="r.sub" class="sub">{{ r.sub }}</span></div>
            <div class="mcells">
              <button
                v-for="c in MATRIX_COLUMNS"
                :key="c.value"
                type="button"
                class="mcell"
                role="radio"
                :aria-checked="picked?.matrix?.[r.code] === c.value"
                :class="{ sel: picked?.matrix?.[r.code] === c.value }"
                @click="pickCell(r.code, c.value)"
              >{{ c.label }}</button>
            </div>
            <van-field
              v-if="picked?.matrix?.[r.code] === 'DEPENDS'"
              :model-value="picked?.notes?.[r.code] ?? ''"
              class="mnote"
              :placeholder="`${followUp}（可不填）`"
              :maxlength="NOTE_MAX"
              :border="false"
              @update:model-value="(v: string) => setNote(r.code, v)"
            />
          </div>
        </div>

        <div v-else class="opts" role="radiogroup" :aria-label="q.stem">
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
        <van-button type="primary" size="large" class="next" :disabled="!done" @click="next">
          {{ isLast ? '看看有哪些活' : '下一题' }}
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
        <div class="a-t">正在帮你找活…</div>
        <p class="a-d">正在{{ scopeName || '你能报的岗位' }}里挑条件对得上的</p>
        <ul class="a-steps">
          <li v-for="(t, i) in phases" :key="i" :class="{ done: i < phase, now: i === phase }">
            <span class="mk"><IconCheck v-if="i < phase" :size="16" :stroke-width="2.25" /><i v-else></i></span>{{ t }}
          </li>
        </ul>
        <div class="bar a-bar"><i class="sig" :style="{ width: progress + '%' }"></i></div>
        <div class="row-b a-foot"><span>马上就好</span><span>{{ progress }}%</span></div>
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
.num { margin-top: var(--space-6); }
.num-row { display: flex; align-items: stretch; gap: var(--space-3); }
.num-btn { flex: none; width: 64px; min-height: 64px; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--bg-card); font-size: 28px; line-height: 1; color: var(--text-1); }
.num-btn:active { background: var(--bg-hover); }
.num-btn:disabled { opacity: .45; }
.num-box { flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: 64px; border: 1px solid var(--primary); border-radius: var(--radius-card); background: var(--bg-card); }
.num-box.err { border-color: var(--danger-text, var(--warning-text)); }
.num-in { width: 4.5em; min-width: 0; border: 0; background: none; text-align: center; font-size: 32px; font-weight: var(--font-weight-semibold); line-height: 40px; color: var(--text-1); }
.num-in::placeholder { font-size: var(--font-size-section); font-weight: var(--font-weight-regular); color: var(--text-3); }
.num-unit { font-size: var(--font-size-section); color: var(--text-2); }
.num-tip { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-align: center; }
.num-tip.err { color: var(--danger-text, var(--warning-text)); }
.mtx { display: grid; gap: var(--space-3); margin-top: var(--space-4); }
.mrow { padding: var(--space-3) var(--space-4); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); }
.mrow-t { font-size: var(--font-size-section); font-weight: var(--font-weight-medium); line-height: 24px; color: var(--text-1); }
.mcells { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin-top: var(--space-2); }
.mcell { min-height: 48px; padding: 0 var(--space-1); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.mcell:active { background: var(--bg-hover); }
.mcell.sel { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); }
.mnote { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-page); }
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
