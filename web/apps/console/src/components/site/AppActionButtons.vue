<script lang="ts">
import type { SiteApplicationAction as Action } from '@shitu/api-client'
import { actionsColWidth } from '@/utils/actionsWidth'

/** 按钮文字；被拒原因「暂时不能…」也用它（AppActionDialogs） */
export const ACTION_LABEL: Record<Action, string> = {
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

/** 平铺的主操作，顺序 = 当前最该做的在前：先知悉，再到厂 / 通过，修改面试信息靠后；未通过 / 爽约 / 取消收进「更多」 */
export const PRIMARY_ACTIONS: Action[] = ['ACKNOWLEDGE', 'CONFIRM', 'RESEND_CONTRACT', 'ARRIVE', 'PASS', 'REPUSH']
export const MORE_ACTIONS: Action[] = ['FAIL', 'NO_SHOW', 'CANCEL']

/** 报名行操作列宽：按这一页实际要出的按钮算（公式见 utils/actionsWidth.ts，流转池、费用账单共用） */
export function appActionsColWidth(apps: { allowedActions: string[] }[], min = 96): number {
  return actionsColWidth(
    apps.map((a) => ({
      labels: PRIMARY_ACTIONS.filter((x) => a.allowedActions.includes(x)).map((x) => ACTION_LABEL[x]),
      more: MORE_ACTIONS.some((x) => a.allowedActions.includes(x)),
    })),
    min,
  )
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'
import { IconChevronDown } from '@shitu/ui-icons'

/**
 * 报名行操作按钮：严格按后端 allowedActions 显示（A-19 矩阵）。
 * 主操作平铺，未通过 / 爽约 / 取消收进「更多」。点击只抛出事件，弹窗由 AppActionDialogs 统一处理。
 * link：表格操作列用文字按钮（规范「Key Components」表格）。
 * 按钮样式：一排里只有一个主按钮（知悉推送 / 确权签约 / 面试通过 中排在前面的那个），其余是默认按钮。
 */
const props = withDefaults(defineProps<{ app: SiteApplication; size?: 'small' | 'default'; link?: boolean }>(), { size: 'small' })
const emit = defineEmits<{ action: [action: SiteApplicationAction, app: SiteApplication] }>()

const allowed = computed(() => new Set(props.app.allowedActions as SiteApplicationAction[]))
const primary = computed(() => PRIMARY_ACTIONS.filter((a) => allowed.value.has(a)))
const more = computed(() => MORE_ACTIONS.filter((a) => allowed.value.has(a)))

const MAIN_ORDER: SiteApplicationAction[] = ['ACKNOWLEDGE', 'CONFIRM', 'PASS']
const main = computed(() => MAIN_ORDER.find((a) => allowed.value.has(a)))
function btnType(a: SiteApplicationAction): 'primary' | 'default' {
  // 文字按钮一律主色文字，不分主次
  return props.link || a === main.value ? 'primary' : 'default'
}
function onMore(cmd: SiteApplicationAction) {
  emit('action', cmd, props.app)
}
</script>

<template>
  <div class="acts" :class="{ 'acts--link': link }">
    <el-button
      v-for="a in primary"
      :key="a"
      :size="size"
      :type="btnType(a)"
      :link="link"
      @click="emit('action', a, app)"
    >
      {{ ACTION_LABEL[a] }}
    </el-button>
    <el-dropdown v-if="more.length" trigger="click" @command="onMore">
      <el-button :size="size" :link="link" :type="link ? 'primary' : 'default'">更多<IconChevronDown :size="14" class="more-i" /></el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="a in more" :key="a" :command="a">
            <span :class="{ danger: a !== 'CANCEL' }">{{ ACTION_LABEL[a] }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <span v-if="!primary.length && !more.length" class="none">—</span>
  </div>
</template>

<style scoped>
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.acts--link { gap: var(--space-2); flex-wrap: nowrap; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.more-i { margin-left: var(--space-1); }
.none { color: var(--text-3); }
.danger { color: var(--danger-text); }
</style>
