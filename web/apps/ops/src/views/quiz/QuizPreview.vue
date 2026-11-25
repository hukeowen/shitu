<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { QuizQuestion } from '@shitu/api-client'
import { IconCheck, IconChevronLeft, IconInbox } from '@shitu/ui-icons'

/**
 * 求职者答题页（seeker views/match/QuizView.vue，S-12 / S-13）样式的只读预览：逐题翻页，可点选看效果，不保存。
 * 排法和尺寸照求职者端：白顶栏 → 「第 n / N 题」加细进度条 → 题干 18px / 600 → 大块白卡片选项（选中主色描边、浅底、带勾）→ 底部「上一题 / 下一题」。
 */
const props = defineProps<{ questions: QuizQuestion[] }>()
const idx = ref(0)
const picked = ref<Record<number, string>>({})

watch(
  () => props.questions.length,
  (n) => {
    if (idx.value > n - 1) idx.value = Math.max(0, n - 1)
  },
)
const total = computed(() => props.questions.length)
const q = computed(() => props.questions[idx.value])
const isLast = computed(() => idx.value >= total.value - 1)
const KIND: Record<string, string> = { JUDGE: '先确定大方向', CHOICE: '选一个最符合的', NUMBER: '填个数字', MATRIX: '每一行选一个' }
const kindText = computed(() => KIND[q.value?.questionType ?? 'CHOICE'] ?? '')
const pickedCode = computed(() => picked.value[idx.value])
/** 矩阵题：行编码 → 列（预览里点着玩） */
const cells = ref<Record<string, string>>({})
const COLS = ['接受', '不接受', '看情况']

function pick(code: string) {
  picked.value = { ...picked.value, [idx.value]: code }
}
function pickCell(row: string, col: string) {
  cells.value = { ...cells.value, [idx.value + ':' + row]: col }
}
function prev() {
  if (idx.value > 0) idx.value--
}
function next() {
  if (!isLast.value) idx.value++
}
</script>

<template>
  <div class="phone">
    <div class="screen">
      <div class="nav">
        <button type="button" class="nav-back" :disabled="idx === 0" aria-label="上一题" @click="prev"><IconChevronLeft :size="22" /></button>
        <div class="nav-t">AI 问薪</div>
        <span class="nav-act" aria-hidden="true">退出</span>
      </div>
      <div v-if="q" class="pad">
        <div class="prog-t"><b>第 {{ idx + 1 }} / {{ total }} 题</b><span>{{ kindText }}</span></div>
        <div class="prog" role="progressbar" aria-valuemin="0" :aria-valuemax="total" :aria-valuenow="idx + 1">
          <i :style="{ width: ((idx + 1) / total) * 100 + '%' }"></i>
        </div>
        <h1 class="stem">{{ q.stem || '（未填写题干）' }}</h1>
        <p v-if="q.hint" class="stem-d">{{ q.hint }}</p>
        <div v-if="q.questionType === 'NUMBER'" class="num">
          <span class="num-btn">−</span>
          <span class="num-box"><span class="num-ph">比如 28</span><span v-if="q.config?.unit" class="num-unit">{{ q.config.unit }}</span></span>
          <span class="num-btn">+</span>
          <p class="num-tip">填 {{ q.config?.min ?? '?' }}–{{ q.config?.max ?? '?' }} {{ q.config?.unit ?? '' }}之间的数</p>
        </div>
        <div v-else-if="q.questionType === 'MATRIX'" class="mtx">
          <div v-for="r in q.options" :key="r.code" class="mrow">
            <div class="mrow-t">{{ r.label || '（未填写行文字）' }}<span v-if="r.sub" class="sub">{{ r.sub }}</span></div>
            <div class="mcells">
              <button v-for="c in COLS" :key="c" type="button" class="mcell" :class="{ sel: cells[idx + ':' + r.code] === c }" @click="pickCell(r.code, c)">{{ c }}</button>
            </div>
            <div v-if="cells[idx + ':' + r.code] === '看情况' && q.config?.followUp" class="mnote">{{ q.config.followUp }}（可不填）</div>
          </div>
        </div>
        <div v-else class="opts" role="radiogroup" :aria-label="q.stem">
          <button
            v-for="o in q.options"
            :key="o.code"
            type="button"
            class="qopt"
            role="radio"
            :aria-checked="pickedCode === o.code"
            :class="{ sel: pickedCode === o.code }"
            @click="pick(o.code)"
          >
            <span class="flex1">
              {{ o.label || '（未填写选项文字）' }}
              <span v-if="o.sub" class="sub">{{ o.sub }}</span>
              <span v-if="o.needRegion" class="sub">选择后需选择城市</span>
            </span>
            <IconCheck v-if="pickedCode === o.code" :size="20" :stroke-width="2.25" />
          </button>
        </div>
      </div>
      <div v-else class="empty">
        <IconInbox :size="48" :stroke-width="1.5" />
        <div class="empty-t">暂时没有题目</div>
        <div class="empty-d">左边新增题目后在这里预览</div>
      </div>
      <div class="bottom">
        <button type="button" class="btn prev" :disabled="idx === 0" @click="prev">上一题</button>
        <button type="button" class="btn btn--primary next" :disabled="!total" @click="next">
          {{ isLast ? '看看有哪些活' : '下一题' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 手机端的字号、圆角、间距：取值同 @shitu/ui-tokens 的 vant-theme.css（后台的同名变量是 element-theme.css 的桌面取值） */
/* 手机端的字号、圆角、间距：取 tokens.css 的 --mobile-*（和 vant-theme.css 同一来源；后台的同名变量是 element-theme.css 的桌面取值） */
.phone {
  --font-size-title: var(--mobile-font-size-title);
  --font-size-body: var(--mobile-font-size-body);
  --radius-card: var(--mobile-radius-card);
  --radius-control: var(--mobile-radius-control);
  --space-page: var(--space-4);
  width: 100%;
  max-width: 336px;
  margin: 0 auto;
  padding: var(--space-2);
  border: 1px solid var(--border);
  /* 外框圆角 = 屏幕圆角 + 外框内边距，两圈同心 */
  border-radius: calc(var(--radius-card) + var(--space-2));
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
/* 矮屏（1280×800）上整台手机仍放得进吸顶区 */
.screen { height: min(620px, calc(100vh - 260px)); border-radius: var(--radius-card); overflow: hidden; background: var(--bg-page); display: flex; flex-direction: column; }
/* 顶栏：白底、高 44、标题居中 17px / 600、左侧返回、下边 1px 分隔线（同 van-nav-bar） */
.nav { position: relative; flex: none; height: var(--mobile-nav-height); display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-4); background: var(--bg-card); border-bottom: 1px solid var(--border); }
.nav-back { display: grid; place-items: center; width: var(--mobile-control-height); height: var(--mobile-control-height); margin-left: calc(-1 * var(--space-3)); padding: 0; border: 0; background: none; color: var(--text-1); cursor: pointer; }
.nav-back:disabled { color: var(--text-placeholder); cursor: default; }
.nav-t { position: absolute; left: 50%; transform: translateX(-50%); font-size: var(--mobile-nav-title-size); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.nav-act { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.pad { flex: 1; overflow: auto; padding: var(--space-page); }
.prog-t { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.prog-t b { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.prog { height: 4px; margin-top: var(--space-2); border-radius: var(--radius-tag); background: var(--border); overflow: hidden; }
.prog i { display: block; height: 100%; border-radius: var(--radius-tag); background: var(--primary); transition: width .3s; }
.stem { margin: var(--space-6) 0 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); word-break: break-all; }
.stem-d { margin: var(--space-1) 0 0; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.opts { display: grid; gap: var(--space-3); margin-top: var(--space-4); }
/* 选项：同 seeker styles/app.css 的 .qopt */
.qopt { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 52px; padding: var(--space-3) var(--space-4); text-align: left; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); font-family: inherit; font-size: var(--font-size-section); font-weight: var(--font-weight-medium); line-height: 24px; color: var(--text-1); cursor: pointer; transition: border-color .15s, background .15s; }
.qopt:active { background: var(--bg-hover); }
.qopt.sel { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); }
.qopt > svg { flex: none; color: var(--primary); }
.flex1 { flex: 1; min-width: 0; word-break: break-all; }
.sub { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); line-height: 20px; color: var(--text-3); }
.qopt.sel .sub { color: var(--primary-text); }
.num { display: grid; grid-template-columns: 52px 1fr 52px; gap: var(--space-2); margin-top: var(--space-5); }
.num-btn { display: grid; place-items: center; min-height: 52px; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--bg-card); font-size: 22px; color: var(--text-1); }
.num-box { display: flex; align-items: center; justify-content: center; gap: var(--space-1); border: 1px solid var(--primary); border-radius: var(--radius-card); background: var(--bg-card); }
.num-ph { color: var(--text-3); }
.num-unit { color: var(--text-2); }
.num-tip { grid-column: 1 / -1; margin: 0; font-size: var(--font-size-aux); color: var(--text-3); text-align: center; }
.mtx { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.mrow { padding: var(--space-2) var(--space-3); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); }
.mrow-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.mcells { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-1); margin-top: var(--space-2); }
.mcell { min-height: 40px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-family: inherit; font-size: var(--font-size-aux); color: var(--text-1); cursor: pointer; }
.mcell.sel { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); }
.mnote { margin-top: var(--space-2); padding: var(--space-1) var(--space-2); border-radius: var(--radius-control); background: var(--bg-page); font-size: var(--font-size-aux); color: var(--text-3); }
.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-6); color: var(--text-3); text-align: center; }
.empty-t { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.empty-d { font-size: var(--font-size-aux); }
/* 底部通栏：白底、上边框，「上一题」占 1 份、「下一题」占 2 份，按钮高 48（同 van-button size="large"） */
.bottom { flex: none; display: flex; gap: var(--space-3); padding: var(--space-2) var(--space-page); background: var(--bg-card); border-top: 1px solid var(--border); }
.btn { height: var(--mobile-bottom-bar-button-height); padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-family: inherit; font-size: var(--font-size-section); color: var(--text-1); cursor: pointer; white-space: nowrap; }
.btn--primary { border-color: var(--primary); background: var(--primary); color: var(--text-on-primary); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.prev { flex: 1; }
.next { flex: 2; }
</style>
