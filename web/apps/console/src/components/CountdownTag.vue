<script setup lang="ts">
import { computed } from 'vue'
import { countdownTone, fmtCountdown, remainMs } from '@/utils/time'

/** 截止时间倒计时徽标：超时 / <1h 红，<6h 橙，其余灰。now 由页面的 useNow 传入 */
const props = defineProps<{ deadline?: string | null; now: number; doneText?: string }>()
const ms = computed(() => remainMs(props.deadline, props.now))
const tone = computed(() => countdownTone(ms.value))
</script>

<template>
  <span v-if="ms == null" class="t-xs">{{ doneText ?? '—' }}</span>
  <span v-else-if="tone === 'muted'" class="mono t-sm dim" :title="deadline ?? ''">{{ fmtCountdown(ms) }}</span>
  <span v-else class="tag mono" :class="`tag--${tone}`" :title="deadline ?? ''">{{ fmtCountdown(ms) }}</span>
</template>
