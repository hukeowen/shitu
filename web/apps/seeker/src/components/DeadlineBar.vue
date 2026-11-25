<script setup lang="ts">
import { computed } from 'vue'
import { IconClock } from '@shitu/ui-icons'
import { useCountdown } from '@/composables/useCountdown'
import { formatShort, parseServerTime } from '@/utils/time'

/**
 * 截止时间倒计时条（产品要求：超时限制必须让本人看得见）。
 * 「{lead} X 小时 X 分内{action}」+ 进度条（按 24 小时窗口算剩余比例），剩不到 4 小时变红。
 * 到点后触发 expire（一般用于刷新状态）。
 */
const props = withDefaults(
  defineProps<{
    deadline?: string | null
    /** 如「驻场老师会在」 */
    lead: string
    /** 如「联系你」 */
    action: string
    /** 窗口总时长（小时），用于进度条 */
    totalHours?: number
  }>(),
  { deadline: null, totalHours: 24 },
)
const emit = defineEmits<{ expire: [] }>()

const target = computed(() => parseServerTime(props.deadline))
const cd = useCountdown(target, () => emit('expire'))

const dur = computed(() => {
  const mins = Math.max(1, Math.ceil(cd.remaining.value / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} 分钟`
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
})
const pct = computed(() => Math.min(100, Math.max(0, (cd.remaining.value / (props.totalHours * 3600_000)) * 100)))
const urgent = computed(() => cd.remaining.value < 4 * 3600_000)
</script>

<template>
  <div v-if="target != null" class="dl" :class="{ urgent }" role="timer">
    <template v-if="cd.active.value">
      <p class="dl-t"><IconClock :size="18" class="dl-ic" /><span>{{ lead }} <b>{{ dur }}</b>内{{ action }}</span></p>
      <div class="bar dl-bar"><i :class="urgent ? 'danger' : 'sig'" :style="{ width: pct + '%' }"></i></div>
      <p class="dl-m">截止 {{ formatShort(deadline) }}<template v-if="urgent"> · 时间不多了</template></p>
    </template>
    <p v-else class="dl-t"><IconClock :size="18" class="dl-ic" /><span>已经到时间了，正在更新状态…</span></p>
  </div>
</template>

<style scoped>
.dl { padding: var(--space-3); border-radius: var(--radius-control); background: var(--primary-bg); }
.dl.urgent { background: var(--danger-soft); }
.dl-t { display: flex; gap: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.dl-t b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--primary-text); }
.dl.urgent .dl-t b { color: var(--danger-text); }
.dl-ic { flex: none; margin-top: 2px; color: var(--primary-text); }
.dl.urgent .dl-ic { color: var(--danger-text); }
.dl-bar { margin-top: var(--space-2); background: var(--bg-card); }
.dl-bar > i.danger { background: var(--danger-solid); }
.dl-m { margin-top: var(--space-1); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.dl.urgent .dl-m { color: var(--danger-text); }
</style>
