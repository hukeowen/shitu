<script setup lang="ts">
import { computed } from 'vue'
import { enumLabel } from '@/utils/labels'
import { toneColor, toneOf } from '@/utils/tone'

/** 字典枚举徽标：中文取 /dict（缺失的 Sprint 4 枚举走 utils/labels 兜底），颜色按 utils/tone 映射。pill = 表格内状态点样式 */
const props = defineProps<{ type: string; value?: string | null; pill?: boolean; lg?: boolean }>()
const tone = computed(() => toneOf(props.type, props.value))
const text = computed(() => enumLabel(props.type, props.value) || '—')
</script>

<template>
  <span v-if="pill" class="st-pill" :style="{ color: toneColor(tone) }"><i />{{ text }}</span>
  <span v-else class="tag" :class="[`tag--${tone}`, { 'tag--lg': lg }]">{{ text }}</span>
</template>
