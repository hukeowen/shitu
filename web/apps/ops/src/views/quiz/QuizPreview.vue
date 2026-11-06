<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { QuizQuestion } from '@shitu/api-client'
import { QUESTION_TYPES, fieldLabel } from './quizMeta'

/** C 端问薪页（S-12 / S-13）样式的只读预览：逐题翻页，可点选看效果 */
const props = defineProps<{ questions: QuizQuestion[] }>()
const idx = ref(0)
const picked = ref<Record<number, string>>({})

watch(
  () => props.questions.length,
  (n) => {
    if (idx.value > n - 1) idx.value = Math.max(0, n - 1)
  },
)
const q = computed(() => props.questions[idx.value])
const typeLabel = (t: string) => QUESTION_TYPES.find((x) => x.value === t)?.label ?? t
const pickedOpt = computed(() => q.value?.options.find((o) => o.code === picked.value[idx.value]))

function pick(code: string) {
  picked.value = { ...picked.value, [idx.value]: code }
}
</script>

<template>
  <div class="phone">
    <div class="screen">
      <div class="appbar">
        <button type="button" class="ico" :disabled="idx === 0" aria-label="上一题" @click="idx--">‹</button>
        <div class="ttl">AI 问薪 · {{ questions.length ? idx + 1 : 0 }} / {{ questions.length }}</div>
        <button type="button" class="ico" :disabled="idx >= questions.length - 1" aria-label="下一题" @click="idx++">›</button>
      </div>
      <div class="qprog"><i v-for="(_, i) in questions" :key="i" :class="{ on: i <= idx }" @click="idx = i" /></div>
      <div v-if="q" class="body">
        <div class="ask">
          <div class="bot" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" stroke="#E8590C" stroke-width="2" /><path d="M12 3v3m0 12v3" stroke="#fff" stroke-width="2" stroke-linecap="round" /></svg>
          </div>
          <div class="qbubble">
            <div class="mono qtype">{{ typeLabel(q.questionType) }} · {{ fieldLabel(q.profileField) }}</div>
            {{ q.stem || '（未填写题干）' }}
            <div v-if="q.hint" class="hint">{{ q.hint }}</div>
          </div>
        </div>
        <div class="opts">
          <button v-for="o in q.options" :key="o.code" type="button" class="qopt" :class="{ sel: picked[idx] === o.code }" @click="pick(o.code)">
            <span class="k">{{ o.code || '?' }}</span>
            <span class="lb">{{ o.label || '（未填写）' }}</span>
            <span v-if="o.sub" class="sub">{{ o.sub }}</span>
          </button>
        </div>
        <div v-if="pickedOpt?.needRegion" class="region">选中后弹出城市选择 ▾</div>
      </div>
      <div v-else class="body empty">暂无题目</div>
      <div class="foot">
        <button type="button" class="next" :disabled="!questions.length" @click="idx = Math.min(idx + 1, questions.length - 1)">
          {{ idx >= questions.length - 1 ? '生成画像，开始匹配' : '下一题' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phone { width: 320px; margin: 0 auto; padding: 10px; border-radius: 34px; background: #0D1117; box-shadow: var(--sh-1); }
.screen { height: 600px; border-radius: 26px; overflow: hidden; background: var(--surface-2); display: flex; flex-direction: column; }
.appbar { height: 46px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: var(--surface); border-bottom: 1px solid var(--line); }
.appbar .ttl { flex: 1; text-align: center; font-size: 14px; font-weight: 700; color: var(--ink-900); }
.ico { width: 26px; height: 26px; border: 0; background: transparent; font-size: 20px; color: var(--ink-700); cursor: pointer; }
.ico:disabled { color: var(--ink-300); cursor: default; }
.qprog { display: flex; gap: 3px; padding: 12px 14px 0; }
.qprog i { flex: 1; height: 3px; border-radius: 2px; background: var(--line-2); cursor: pointer; }
.qprog i.on { background: var(--signal); }
.body { flex: 1; overflow: auto; padding: 14px; }
.body.empty { display: grid; place-items: center; color: var(--ink-400); font-size: 13px; }
.ask { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; }
.bot { width: 30px; height: 30px; border-radius: 9px; background: var(--ink-900); display: grid; place-items: center; flex: none; }
.qbubble { flex: 1; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 4px 16px 16px 16px; padding: 12px 14px; font-size: 14px; color: var(--ink-900); line-height: 1.55; word-break: break-all; }
.qtype { font-size: 11px; margin-bottom: 5px; color: var(--signal); }
.hint { font-size: 11.5px; color: var(--ink-400); margin-top: 2px; }
.opts { display: grid; gap: 8px; }
.qopt { width: 100%; text-align: left; padding: 12px 13px; background: var(--surface); border: 1.5px solid var(--line); border-radius: var(--r-lg); font-size: 13.5px; font-weight: 600; color: var(--ink-800); display: flex; align-items: center; gap: 10px; cursor: pointer; font-family: inherit; }
.qopt.sel { border-color: var(--signal); background: var(--signal-50); color: var(--signal-700); }
.qopt .k { font-family: var(--f-mono); font-size: 11px; width: 20px; height: 20px; border-radius: 5px; background: var(--surface-3); display: grid; place-items: center; color: var(--ink-500); flex: none; }
.qopt.sel .k { background: var(--signal); color: #fff; }
.qopt .lb { flex: 1; min-width: 0; word-break: break-all; }
.qopt .sub { font-size: 11px; font-weight: 400; color: var(--ink-400); flex: none; }
.region { margin-top: 10px; padding: 10px 12px; border-radius: var(--r-sm); border: 1px dashed var(--signal-300); color: var(--signal-700); font-size: 12px; background: var(--signal-50); }
.foot { flex: none; padding: 10px 14px 16px; }
.next { width: 100%; height: 44px; border: 0; border-radius: 12px; background: var(--ink-900); color: #fff; font-size: 14.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.next:disabled { opacity: .45; cursor: default; }
</style>
