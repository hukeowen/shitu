<script setup lang="ts">
import { computed } from 'vue'
import { useDict } from '@shitu/api-client'

/**
 * 状态标签：中文名来自字典，色调按语义映射，样式用 tokens.css 的共享状态标签（.status-tag）。
 * 同一状态和企业后台（console utils/tone.ts）、求职者端、驻场端用同一色调。
 * variant 是改版前的表格状态点 / 小标签之分，现在统一成共享状态标签，不再改变样子；引用页在各自的改版工单里去掉。
 */
const props = defineProps<{ type: string; value?: string | null; variant?: 'pill' | 'tag' }>()
const { label } = useDict()

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending'
const TONES: Record<string, Record<string, Tone>> = {
  CompanyStatus: { PENDING_AUDIT: 'warning', REJECTED: 'danger', NORMAL: 'success', THROTTLED: 'warning', BANNED: 'danger', DEREGISTERED: 'neutral', BANKRUPT: 'neutral' },
  JobStatus: { PENDING_AUDIT: 'warning', REJECTED: 'danger', RECRUITING: 'success', PAUSED: 'neutral', OFFLINE: 'neutral', FORCE_OFFLINE: 'danger' },
  ClientContractStatus: { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' },
  MemberStatus: { NORMAL: 'success', DISABLED: 'neutral' },
  BillStatus: { GENERATED: 'neutral', ISSUED: 'info', DISPUTED: 'warning', CONFIRMED: 'success', SETTLED: 'success' },
  DisputeStatus: { OPEN: 'warning', ACCEPTED: 'success', REJECTED: 'danger' },
  // 以下三种只在中台出现
  ComplaintStatus: { PENDING: 'warning', VERIFIED: 'danger', REJECTED: 'neutral' },
  ReviewStatus: { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' },
  VersionStatus: { DRAFT: 'info', ACTIVE: 'success', ARCHIVED: 'neutral' },
  // 报名状态：同 console utils/tone.ts（以 seeker utils/status.ts 的 APPLICATION_TONE 为准）
  ApplicationStatus: { PENDING_INTERVIEW: 'pending', PENDING_CONFIRM: 'pending', EMPLOYED: 'success', CANCELLED: 'neutral', TIMEOUT: 'danger', INTERVIEW_FAILED: 'neutral', NO_SHOW: 'warning' },
}
const tone = computed<Tone>(() => (props.value ? TONES[props.type]?.[props.value] : undefined) ?? 'neutral')
const text = computed(() => (props.value ? label(props.type, props.value) : '—'))
</script>

<template>
  <span class="status-tag" :class="`status-tag--${tone}`">{{ text }}</span>
</template>
