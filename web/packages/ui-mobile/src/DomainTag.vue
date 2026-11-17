<script setup lang="ts">
import { computed } from 'vue'

import type { Domain } from "./types"

/** text：覆盖默认叫法（C 端对求职者不说「私域 / 公域」） */
const props = defineProps<{ domain: Domain; text?: string }>()

const META: Record<Domain, { label: string; cls: string }> = {
  PRIVATE: { label: '私域', cls: 'status-tag--private' },
  PUBLIC: { label: '公域', cls: 'status-tag--public' },
  TEMP_PRIVATE: { label: '临时私域', cls: 'status-tag--pending' },
}
const meta = computed(() => META[props.domain])
</script>

<template>
  <span class="status-tag" :class="meta.cls">{{ text || meta.label }}</span>
</template>
