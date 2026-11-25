<script setup lang="ts">
import type { AdvanceCheck } from '@shitu/api-client'

/**
 * 预支审批用的「在岗情况」：在岗天数、本月请假 / 旷工、后端给的每条提醒。
 * blocking（已不在岗 / 已提交离职 / 离职已批）时提醒用红色，否则用橙色；没有提醒就只显示基本情况。
 * compact：列表卡片里用的紧凑样式
 */
defineProps<{ check: AdvanceCheck; blockText?: string; compact?: boolean }>()
</script>

<template>
  <div class="ck" :class="{ 'ck--compact': compact }">
    <div class="ck-row">
      <span class="ck-k">在岗情况</span>
      <span class="ck-v">
        <template v-if="check.onDuty">在岗 {{ check.dutyDays }} 天<template v-if="check.startDate">（入职 {{ check.startDate }}）</template></template>
        <b v-else class="bad">已不在岗</b>
      </span>
    </div>
    <div v-if="check.onDuty" class="ck-row">
      <span class="ck-k">本月考勤</span>
      <span class="ck-v">
        请假 {{ check.leaveThisMonth }} 天 / <span :class="{ bad: check.absentThisMonth > 0 }">旷工 {{ check.absentThisMonth }} 天</span>
      </span>
    </div>
    <div v-if="check.warnings.length" class="ck-warn" :class="check.blocking ? 'ck-warn--danger' : 'ck-warn--warn'" role="status">
      <p v-for="w in check.warnings" :key="w">· {{ w }}</p>
      <p v-if="blockText" class="ck-block">{{ blockText }}</p>
    </div>
  </div>
</template>

<style scoped>
.ck { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-body); line-height: 22px; }
.ck--compact { margin-top: var(--space-2); padding-top: var(--space-2); }
.ck-row { display: flex; justify-content: space-between; gap: var(--space-3); padding: 2px 0; }
.ck-k { flex: none; color: var(--text-3); }
.ck-v { color: var(--text-1); text-align: right; }
.bad { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
.ck-warn { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); border-left: 4px solid; }
.ck-warn p { margin: 0; }
.ck-warn--warn { background: var(--warning-soft); border-color: var(--warning-solid); color: var(--warning-text); }
.ck-warn--danger { background: var(--danger-soft); border-color: var(--danger-solid); color: var(--danger-text); }
.ck-block { margin-top: var(--space-1) !important; font-weight: var(--font-weight-semibold); }
</style>
