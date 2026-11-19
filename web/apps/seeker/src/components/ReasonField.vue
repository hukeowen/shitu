<script setup lang="ts">
/**
 * 原因输入：几个常见原因一点即填，也可以自己写。点选只是把文字填进输入框，提交的始终是输入框里的内容。
 */
const text = defineModel<string>({ required: true })
withDefaults(defineProps<{ id: string; label: string; presets: string[]; placeholder?: string; max?: number }>(), {
  placeholder: '',
  max: 255,
})
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <div class="presets">
      <button
        v-for="p in presets"
        :key="p"
        type="button"
        class="preset"
        :class="{ sel: text.trim() === p }"
        :aria-pressed="text.trim() === p"
        @click="text = p"
      >
        {{ p }}
      </button>
    </div>
    <textarea :id="id" v-model="text" class="ta" :maxlength="max" rows="3" :placeholder="placeholder"></textarea>
    <div class="cnt" :class="{ over: text.length >= max }">{{ text.length }} / {{ max }}</div>
  </div>
</template>

<style scoped>
.presets { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-3); }
.preset { min-height: 36px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-1); }
.preset:active { background: var(--bg-hover); }
.preset.sel { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
/* 输入框里的字不小于 16px，否则 iOS 聚焦时会放大页面 */
.ta { font-size: 16px; }
.cnt { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); text-align: right; }
.cnt.over { color: var(--danger-text); }
</style>
