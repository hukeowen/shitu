<script setup lang="ts">
import { computed } from 'vue'

import type { UserStatus } from "./types"

const props = defineProps<{ status: UserStatus }>()

const META: Record<UserStatus, { label: string; cls: string }> = {
  GUEST: { label: '游客', cls: 'status-tag--neutral' },
  PUBLIC_SEEKING: { label: '公域求职', cls: 'status-tag--public' },
  PRIVATE_PENDING: { label: '私域待匹配', cls: 'status-tag--private' },
  PENDING_INTERVIEW: { label: '待面试', cls: 'status-tag--pending' },
  PENDING_CONFIRM: { label: '待确权', cls: 'status-tag--pending' },
  EMPLOYED: { label: '已入职在岗', cls: 'status-tag--success' },
}
const meta = computed(() => META[props.status])
</script>

<template>
  <span class="status-tag" :class="meta.cls">{{ meta.label }}</span>
</template>
