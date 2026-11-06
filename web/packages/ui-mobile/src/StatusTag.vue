<script setup lang="ts">
import { computed } from 'vue'

import type { UserStatus } from "./types"

const props = defineProps<{ status: UserStatus }>()

const META: Record<UserStatus, { label: string; cls: string }> = {
  GUEST: { label: '游客', cls: 'tag-muted' },
  PUBLIC_SEEKING: { label: '公域求职', cls: 'tag-public' },
  PRIVATE_PENDING: { label: '私域待匹配', cls: 'tag-private' },
  PENDING_INTERVIEW: { label: '待面试', cls: 'tag-temp' },
  PENDING_CONFIRM: { label: '待确权', cls: 'tag-temp' },
  EMPLOYED: { label: '已入职在岗', cls: 'tag-ok' },
}
const meta = computed(() => META[props.status])
</script>

<template>
  <span class="tag-domain" :class="meta.cls">{{ meta.label }}</span>
</template>
