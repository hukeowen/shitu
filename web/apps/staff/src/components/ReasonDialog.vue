<script setup lang="ts">
import { ref } from 'vue'
import { showToast } from 'vant'

/**
 * 填原因 / 意见的确认弹窗（面试未通过、取消报名、爽约备注、预支驳回等）。
 * open() 返回 Promise：确认 → 原因文本（选填时可为空串），取消 → null。
 * submit 回调在弹窗内执行，失败时保留弹窗与已填内容。
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
let resolver: ((v: string | null) => void) | null = null

function open(o: Opts): Promise<string | null> {
  opts.value = o
  text.value = ''
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
  try {
    await o.submit(v)
    finish(v)
    return true
  } catch {
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
    :confirm-button-color="opts?.danger ? 'var(--danger)' : undefined"
    :before-close="beforeClose"
    teleport="body"
    class="reason-dlg"
  >
    <div class="rd">
      <p v-if="opts?.message" class="msg">{{ opts.message }}</p>
      <div v-if="opts?.presets?.length" class="presets">
        <button v-for="p in opts.presets" :key="p" type="button" class="chip" :class="{ on: text.includes(p) }" @click="pick(p)">{{ p }}</button>
      </div>
      <textarea
        v-model="text"
        class="ta"
        rows="3"
        :maxlength="opts?.maxlength ?? 200"
        :placeholder="opts?.placeholder ?? (opts?.required ? '请填写原因（必填）' : '备注（选填）')"
      />
      <div class="cnt">{{ text.length }} / {{ opts?.maxlength ?? 200 }}</div>
    </div>
  </van-dialog>
</template>

<style scoped>
.rd { padding: 8px 18px 4px; }
.msg { font-size: 13px; line-height: 1.7; color: var(--ink-600); margin-bottom: 10px; }
.presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chip { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--surface); font-size: 12px; color: var(--ink-700); }
.chip.on { border-color: var(--signal); background: var(--signal-50); color: var(--signal-700); font-weight: 600; }
.ta { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--line-2); border-radius: var(--r-sm); font-size: 13.5px; line-height: 1.6; color: var(--ink-800); background: var(--surface-2); resize: none; outline: none; font-family: inherit; }
.ta:focus { border-color: var(--signal); background: var(--surface); }
.cnt { text-align: right; font-size: 11px; color: var(--ink-400); margin-top: 2px; }
</style>
