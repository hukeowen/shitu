<script setup lang="ts">
import { computed } from 'vue'
import { useDict } from '@shitu/api-client'

/** 状态徽标：中文名来自字典，颜色按语义映射（原型 .st-pill） */
const props = defineProps<{ type: string; value?: string | null; variant?: 'pill' | 'tag' }>()
const { label } = useDict()

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'ink'
const TONES: Record<string, Record<string, Tone>> = {
  CompanyStatus: { PENDING_AUDIT: 'warn', REJECTED: 'danger', NORMAL: 'ok', THROTTLED: 'warn', BANNED: 'danger', DEREGISTERED: 'ink', BANKRUPT: 'muted' },
  JobStatus: { PENDING_AUDIT: 'warn', REJECTED: 'danger', RECRUITING: 'ok', PAUSED: 'info', OFFLINE: 'muted', FORCE_OFFLINE: 'danger' },
  ClientContractStatus: { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger' },
  MemberStatus: { NORMAL: 'ok', DISABLED: 'muted' },
}
const COLORS: Record<Tone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--ink-400)',
  ink: 'var(--ink-900)',
}
const tone = computed<Tone>(() => (props.value ? TONES[props.type]?.[props.value] : undefined) ?? 'muted')
const text = computed(() => (props.value ? label(props.type, props.value) : '—'))
</script>

<template>
  <span v-if="variant === 'tag'" class="tag" :class="tone === 'muted' ? '' : `tag--${tone}`">{{ text }}</span>
  <span v-else class="st-pill" :style="{ color: COLORS[tone] }"><i />{{ text }}</span>
</template>
