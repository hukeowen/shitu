<script setup lang="ts">
import { computed } from 'vue'
import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'

/**
 * 报名行操作按钮：严格按后端 allowedActions 显示（A-19 矩阵）。
 * 主操作平铺，未通过 / 爽约 / 取消收进「更多」。点击只抛出事件，弹窗由 AppActionDialogs 统一处理。
 */
const props = withDefaults(defineProps<{ app: SiteApplication; size?: 'small' | 'default' }>(), { size: 'small' })
const emit = defineEmits<{ action: [action: SiteApplicationAction, app: SiteApplication] }>()

const LABEL: Record<SiteApplicationAction, string> = {
  ACKNOWLEDGE: '知悉推送',
  REPUSH: '修改面试信息',
  ARRIVE: '到厂确认',
  PASS: '面试通过',
  FAIL: '未通过',
  NO_SHOW: '爽约',
  CANCEL: '取消报名',
  CONFIRM: '确权签约',
  RESEND_CONTRACT: '重发签约',
}
const PRIMARY: SiteApplicationAction[] = ['ACKNOWLEDGE', 'REPUSH', 'ARRIVE', 'PASS', 'CONFIRM', 'RESEND_CONTRACT']
const MORE: SiteApplicationAction[] = ['FAIL', 'NO_SHOW', 'CANCEL']

const allowed = computed(() => new Set(props.app.allowedActions as SiteApplicationAction[]))
const primary = computed(() => PRIMARY.filter((a) => allowed.value.has(a)))
const more = computed(() => MORE.filter((a) => allowed.value.has(a)))

function btnType(a: SiteApplicationAction): 'primary' | 'default' {
  return a === 'ACKNOWLEDGE' || a === 'CONFIRM' || a === 'PASS' ? 'primary' : 'default'
}
function onMore(cmd: SiteApplicationAction) {
  emit('action', cmd, props.app)
}
</script>

<template>
  <div class="acts">
    <el-button
      v-for="a in primary"
      :key="a"
      :size="size"
      :type="btnType(a)"
      :plain="a === 'PASS'"
      @click="emit('action', a, app)"
    >
      {{ LABEL[a] }}
    </el-button>
    <el-dropdown v-if="more.length" trigger="click" @command="onMore">
      <el-button :size="size">更多</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="a in more" :key="a" :command="a">
            <span :class="{ danger: a !== 'CANCEL' }">{{ LABEL[a] }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <span v-if="!primary.length && !more.length" class="t-xs">—</span>
  </div>
</template>

<style scoped>
.acts { display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.acts .el-button + .el-button { margin-left: 0; }
.danger { color: var(--danger); }
</style>
