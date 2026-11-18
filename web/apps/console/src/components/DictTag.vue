<script setup lang="ts">
import { computed } from 'vue'
import { enumLabel } from '@/utils/labels'
import { toneOf } from '@/utils/tone'

/**
 * 字典枚举标签：中文取 /dict（缺失的 Sprint 4 枚举走 utils/labels 兜底），色调按 utils/tone 映射，样式用 tokens.css 的共享状态标签。
 * pill、lg 是改版前的表格状态点和大号标签，现在统一成共享状态标签，两个属性不再改变样子；引用页在各自的改版工单里去掉。
 */
const props = defineProps<{ type: string; value?: string | null; pill?: boolean; lg?: boolean }>()
const tone = computed(() => toneOf(props.type, props.value))
const text = computed(() => enumLabel(props.type, props.value) || '—')
</script>

<template>
  <span class="status-tag" :class="`status-tag--${tone}`">{{ text }}</span>
</template>
