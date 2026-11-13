<script lang="ts">
import type { SiteApplicationAction as Action } from '@shitu/api-client'

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

/** 平铺的主操作；未通过 / 爽约 / 取消收进「更多」 */
export const PRIMARY_ACTIONS: Action[] = ['ACKNOWLEDGE', 'REPUSH', 'ARRIVE', 'PASS', 'CONFIRM', 'RESEND_CONTRACT']
export const MORE_ACTIONS: Action[] = ['FAIL', 'NO_SHOW', 'CANCEL']

/**
 * 表格操作列（文字按钮）的宽度：按这一页实际要出的按钮算，最宽的那一行刚好放下、不折行。
 * 固定写最宽的组合（「修改面试信息」+ 两个 + 更多）时，1280 宽下其他列会被挤到横向滚动里。
 * 实测（小号文字按钮）：每个汉字 13.5px，「更多」加箭头 48px，按钮间距 8px，单元格左右内边距共 24px。
 */
export function actionsColWidth(apps: { allowedActions: string[] }[], min = 96): number {
  const widths = apps.map((a) => {
    const shown = PRIMARY_ACTIONS.filter((x) => a.allowedActions.includes(x))
    const more = MORE_ACTIONS.some((x) => a.allowedActions.includes(x))
    const n = shown.length + (more ? 1 : 0)
    return 24 + shown.reduce((w, x) => w + Math.ceil(ACTION_LABEL[x].length * 13.5), 0) + (more ? 48 : 0) + Math.max(0, n - 1) * 8
  })
  return Math.max(min, ...widths)
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'
import { IconChevronDown } from '@shitu/ui-icons'

/**
 * 报名行操作按钮：严格按后端 allowedActions 显示（A-19 矩阵）。
 * 主操作平铺，未通过 / 爽约 / 取消收进「更多」。点击只抛出事件，弹窗由 AppActionDialogs 统一处理。
 * link：表格操作列用文字按钮（规范「Key Components」表格）；blocked：被后端拒绝过的那个操作，刷新前只置灰它，别的操作照常可点。
 * 按钮样式：一排里只有一个主按钮（知悉推送 / 确权签约 / 面试通过 中排在前面的那个），其余是默认按钮。
 */
const props = withDefaults(defineProps<{ app: SiteApplication; size?: 'small' | 'default'; link?: boolean; blocked?: SiteApplicationAction }>(), { size: 'small' })
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
      :disabled="blocked === a"
      @click="emit('action', a, app)"
    >
      {{ ACTION_LABEL[a] }}
    </el-button>
    <el-dropdown v-if="more.length" trigger="click" @command="onMore">
      <el-button :size="size" :link="link" :type="link ? 'primary' : 'default'">更多<IconChevronDown :size="14" class="more-i" /></el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="a in more" :key="a" :command="a" :disabled="blocked === a">
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
