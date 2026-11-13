<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError } from '@shitu/api-client'
import { IconCheck } from '@shitu/ui-icons'

/**
 * 填原因 / 意见的确认弹窗（面试未通过、取消报名、爽约备注、预支驳回等）。
 * open() 返回 Promise：确认 → 原因文本（选填时可为空串），取消 → null。
 * submit 回调在弹窗内执行，失败时保留弹窗与已填内容；被拒的原因留在确认按钮上方，业务拒绝时确认按钮置灰，改了原因后可再提交。
 */
interface Opts {
  title: string
  message?: string
  placeholder?: string
  presets?: string[]
  required?: boolean
  confirmText?: string
  danger?: boolean
  maxlength?: number
  submit: (reason: string) => Promise<void>
}

const show = ref(false)
const text = ref('')
const opts = ref<Opts | null>(null)
const submitError = ref('')
const rejected = ref(false)
watch(text, () => (rejected.value = false))
let resolver: ((v: string | null) => void) | null = null

function open(o: Opts): Promise<string | null> {
  opts.value = o
  text.value = ''
  submitError.value = ''
  rejected.value = false
  show.value = true
  return new Promise((r) => (resolver = r))
}

function finish(v: string | null) {
  resolver?.(v)
  resolver = null
}

async function beforeClose(action: string): Promise<boolean> {
  const o = opts.value
  if (action !== 'confirm' || !o) {
    finish(null)
    return true
  }
  const v = text.value.trim()
  if (o.required && !v) {
    showToast(o.placeholder ?? '请填写原因')
    return false
  }
  submitError.value = ''
  try {
    await o.submit(v)
    finish(v)
    return true
  } catch (e) {
    submitError.value = errorMessage(e, '提交失败，请稍后重试')
    rejected.value = isApiError(e)
    return false
  }
}

function pick(p: string) {
  if (text.value.includes(p)) return
  text.value = text.value.trim() ? `${text.value.trim()}；${p}` : p
}

defineExpose({ open })
</script>

<template>
  <van-dialog
    v-model:show="show"
    :title="opts?.title"
    show-cancel-button
    :confirm-button-text="opts?.confirmText ?? '确定'"
    :confirm-button-color="opts?.danger ? 'var(--danger-text)' : undefined"
    :confirm-button-disabled="rejected"
    :before-close="beforeClose"
    teleport="body"
    class="reason-dlg"
  >
    <div class="rd">
      <p v-if="opts?.message" class="msg">{{ opts.message }}</p>
      <div v-if="opts?.presets?.length" class="presets">
        <button v-for="p in opts.presets" :key="p" type="button" class="chip-tap" :aria-pressed="text.includes(p)" @click="pick(p)">
          <span class="chip" :class="{ on: text.includes(p) }"><IconCheck :size="14" :stroke-width="2.25" class="ck" />{{ p }}</span>
        </button>
      </div>
      <textarea
        v-model="text"
        class="ta"
        rows="3"
        :maxlength="opts?.maxlength ?? 200"
        :placeholder="opts?.placeholder ?? (opts?.required ? '请填写原因（必填）' : '备注（选填）')"
      />
      <div class="cnt">{{ text.length }} / {{ opts?.maxlength ?? 200 }}</div>
      <p v-if="submitError" class="bar-why err" role="status">没有提交成功：{{ submitError }}</p>
    </div>
  </van-dialog>
</template>

<style scoped>
.rd { padding: 8px 18px 4px; }
.msg { font-size: var(--font-size-body); line-height: 1.7; color: var(--text-2); margin-bottom: 10px; }
.presets { display: flex; flex-wrap: wrap; column-gap: var(--space-2); margin-bottom: var(--space-1); }
/* 可点的小标签：外层按钮撑到 44 高当点击区，里面的标签保持原来大小 */
.chip-tap { display: inline-flex; align-items: center; min-height: var(--control-height); padding: 0; border: 0; background: none; font: inherit; }
.chip { height: 30px; padding: 0 var(--space-3); border-radius: 15px; border: 1px solid var(--border); background: var(--bg-card); font-size: var(--font-size-aux); line-height: 28px; color: var(--text-2); }
.chip.on { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); }
/* 选中除了变色还带勾；勾一直占位、没选中时隐藏，选中前后宽度不变 */
.chip { display: inline-flex; align-items: center; gap: 2px; }
.chip .ck { flex: none; visibility: hidden; }
.chip.on .ck { visibility: visible; }
.chip-tap:focus-visible .chip { outline: 2px solid var(--primary); outline-offset: 2px; }
.ta { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-control); font-size: 16px; line-height: 1.6; color: var(--text-1); background: var(--bg-page); resize: none; outline: none; font-family: inherit; }
.ta:focus { border-color: var(--primary); background: var(--bg-card); }
.cnt { text-align: right; font-size: var(--font-size-min); color: var(--text-3); margin-top: 2px; }
/* 被拒的原因：危险文字色、左对齐 */
.bar-why { display: block; justify-content: flex-start; margin: var(--space-2) 0 0; text-align: left; }
</style>
