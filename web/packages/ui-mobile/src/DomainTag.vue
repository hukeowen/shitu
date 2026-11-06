<script setup lang="ts">
import { computed } from 'vue'

import type { Domain } from "./types"

const props = defineProps<{ domain: Domain }>()

const META: Record<Domain, { label: string; cls: string }> = {
  PRIVATE: { label: '私域', cls: 'tag-private' },
  PUBLIC: { label: '公域', cls: 'tag-public' },
  TEMP_PRIVATE: { label: '临时私域', cls: 'tag-temp' },
}
const meta = computed(() => META[props.domain])
</script>

<template>
  <span class="tag-domain" :class="meta.cls">{{ meta.label }}</span>
</template>
