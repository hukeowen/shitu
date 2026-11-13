<script setup lang="ts">
import { computed } from 'vue'
import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'
import RowActions from '@/components/RowActions.vue'
import { appRowActions } from './appActions'

/**
 * 报名行操作按钮：严格按后端 allowedActions 显示（A-19 矩阵）。
 * 一行内：最多两个主操作平铺，其余与未通过 / 爽约 / 取消收进「更多」。点击只抛出事件，弹窗由 AppActionDialogs 统一处理。
 * 所在表格的操作列宽度用 appOpsWidth(list) 计算；为 0 时不渲染该列。
 */
const props = withDefaults(defineProps<{ app: SiteApplication; size?: 'small' | 'default' }>(), { size: 'small' })
const emit = defineEmits<{ action: [action: SiteApplicationAction, app: SiteApplication] }>()
const actions = computed(() => appRowActions(props.app))
</script>

<template>
  <RowActions :actions="actions" :size="size" @act="(k) => emit('action', k as SiteApplicationAction, app)" />
</template>
