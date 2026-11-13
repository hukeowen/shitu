<script setup lang="ts">
import { computed } from 'vue'
import { countdownTone, fmtRemain, remainMs } from '@/utils/time'

/**
 * 驻场页面的 24h 响应剩余：带单位写（「3 小时 41 分」），超时 / 不到 1 小时危险色、不到 6 小时提醒色，其余是普通文字。
 * 没有截止时间（公域用户）显示「—」。now 由页面的 useNow 传入。
 */
const props = defineProps<{ deadline?: string | null; now: number }>()
const ms = computed(() => remainMs(props.deadline, props.now))
const tone = computed(() => countdownTone(ms.value))
</script>

<template>
  <span v-if="ms == null" class="remain-none">—</span>
  <span v-else-if="tone === 'muted'" class="remain-plain">{{ fmtRemain(ms) }}</span>
  <span v-else class="status-tag" :class="tone === 'danger' ? 'status-tag--danger' : 'status-tag--warning'">{{ fmtRemain(ms) }}</span>
</template>

<style scoped>
.remain-none { color: var(--text-3); }
.remain-plain { color: var(--text-2); white-space: nowrap; }
.status-tag { white-space: nowrap; }
</style>
