<script setup lang="ts">
import { computed } from 'vue'
import { MORE_LABEL, splitActions, type RowAction } from '@/utils/rowActions'

/**
 * 表格行操作：一行内显示，主操作平铺（最多 max 个）+「更多」下拉；左对齐。
 * 列宽用 utils/rowActions 的 opsColWidth 按同一份操作列表计算，保证不折行、不留空。
 */
const props = withDefaults(defineProps<{ actions: RowAction[]; max?: number; loading?: boolean; size?: 'small' | 'default' }>(), { max: 2, size: 'small' })
const emit = defineEmits<{ act: [key: string] }>()
const parts = computed(() => splitActions(props.actions, props.max))
</script>

<template>
  <div class="row-acts">
    <el-button
      v-for="a in parts.flat"
      :key="a.key"
      :size="size"
      :type="a.type === 'default' ? undefined : a.type ?? (a.link ? 'primary' : undefined)"
      :plain="a.plain"
      :link="a.link"
      :disabled="a.disabled || loading"
      @click.stop="emit('act', a.key)"
    >
      {{ a.label }}
    </el-button>
    <el-dropdown v-if="parts.more.length" trigger="click" :disabled="loading" @command="(k: string) => emit('act', k)">
      <el-button :size="size" @click.stop>{{ MORE_LABEL }}</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="a in parts.more" :key="a.key" :command="a.key" :disabled="a.disabled">
            <span :class="{ 'row-acts__danger': a.type === 'danger' }">{{ a.label }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<style scoped>
.row-acts { display: inline-flex; align-items: center; gap: 8px; flex-wrap: nowrap; white-space: nowrap; vertical-align: middle; }
.row-acts .el-button + .el-button { margin-left: 0; }
.row-acts .el-button.is-link { padding: 2px; }
</style>
<style>
.row-acts__danger { color: var(--danger); }
</style>
