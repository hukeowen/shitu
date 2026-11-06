<script setup lang="ts">
import { computed } from 'vue'
import { useDict } from '@shitu/api-client'
import { toneColor, toneOf } from '@/utils/tone'

/** 字典枚举徽标：中文取 /dict，颜色按 utils/tone 映射。pill = 表格内状态点样式 */
const props = defineProps<{ type: string; value?: string | null; pill?: boolean; lg?: boolean }>()
const { label } = useDict()
const tone = computed(() => toneOf(props.type, props.value))
</script>

<template>
  <span v-if="pill" class="st-pill" :style="{ color: toneColor(tone) }"><i />{{ label(type, value) || '—' }}</span>
  <span v-else class="tag" :class="[`tag--${tone}`, { 'tag--lg': lg }]">{{ label(type, value) || '—' }}</span>
</template>
