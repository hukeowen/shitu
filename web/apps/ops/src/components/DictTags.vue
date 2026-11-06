<script setup lang="ts">
import { useDict } from '@shitu/api-client'

/** 多值枚举（角色等）显示为标签组 */
defineProps<{ type: string; values?: readonly string[] | null; highlight?: string }>()
const { label } = useDict()
</script>

<template>
  <span class="tags">
    <span v-for="v in values ?? []" :key="v" class="tag" :class="{ 'tag--signal': v === highlight }">{{ label(type, v) }}</span>
    <span v-if="!values || values.length === 0" class="dim">—</span>
  </span>
</template>
