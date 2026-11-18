<script setup lang="ts">
import { useDict } from '@shitu/api-client'

/** 多值枚举（角色等）显示为一组共享状态标签；highlight 的那一个用信息色，其余中性色 */
defineProps<{ type: string; values?: readonly string[] | null; highlight?: string }>()
const { label } = useDict()
</script>

<template>
  <span class="tags">
    <span v-for="v in values ?? []" :key="v" class="status-tag" :class="v === highlight ? 'status-tag--info' : 'status-tag--neutral'">{{ label(type, v) }}</span>
    <span v-if="!values || values.length === 0" class="dim">—</span>
  </span>
</template>
