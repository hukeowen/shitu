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
const kindText = computed(() => (q.value?.questionType === 'JUDGE' ? '判断题 · 切割大方向' : '选择题 · 细化需求'))
const pickedCode = computed(() => picked.value[idx.value])

function pick(code: string) {
  picked.value = { ...picked.value, [idx.value]: code }
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
        <div class="opts" role="radiogroup" :aria-label="q.stem">
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
          {{ isLast ? '生成我的求职画像' : '下一题' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 手机端的字号、圆角、间距：取值同 @shitu/ui-tokens 的 vant-theme.css（后台的同名变量是 element-theme.css 的桌面取值） */
.phone {
  --font-size-title: 18px;
  --font-size-body: 15px;
  --radius-card: 12px;
  --radius-control: 8px;
  --space-page: var(--space-4);
  width: 336px;
  margin: 0 auto;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: 28px;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.screen { height: 620px; border-radius: 20px; overflow: hidden; background: var(--bg-page); display: flex; flex-direction: column; }
/* 顶栏：白底、高 44、标题居中 17px / 600、左侧返回、下边 1px 分隔线（同 van-nav-bar） */
.nav { position: relative; flex: none; height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-4); background: var(--bg-card); border-bottom: 1px solid var(--border); }
.nav-back { display: grid; place-items: center; width: 44px; height: 44px; margin-left: calc(-1 * var(--space-3)); padding: 0; border: 0; background: none; color: var(--text-1); cursor: pointer; }
.nav-back:disabled { color: var(--text-placeholder); cursor: default; }
.nav-t { position: absolute; left: 50%; transform: translateX(-50%); font-size: 17px; font-weight: var(--font-weight-semibold); color: var(--text-1); }
.nav-act { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.pad { flex: 1; overflow: auto; padding: var(--space-page); }
.prog-t { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.prog-t b { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.prog { height: 4px; margin-top: var(--space-2); border-radius: 3px; background: var(--border); overflow: hidden; }
.prog i { display: block; height: 100%; border-radius: 3px; background: var(--primary); transition: width .3s; }
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
.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-6); color: var(--text-3); text-align: center; }
.empty-t { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.empty-d { font-size: var(--font-size-aux); }
/* 底部通栏：白底、上边框，「上一题」占 1 份、「下一题」占 2 份，按钮高 48（同 van-button size="large"） */
.bottom { flex: none; display: flex; gap: var(--space-3); padding: var(--space-2) var(--space-page); background: var(--bg-card); border-top: 1px solid var(--border); }
.btn { height: 48px; padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-family: inherit; font-size: var(--font-size-section); color: var(--text-1); cursor: pointer; white-space: nowrap; }
.btn--primary { border-color: var(--primary); background: var(--primary); color: var(--text-on-primary); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.prev { flex: 1; }
.next { flex: 2; }
</style>
