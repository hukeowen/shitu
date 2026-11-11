<script setup lang="ts">
import type { QuadItem } from './quad'
defineProps<{ items: QuadItem[] }>()
const emit = defineEmits<{ tap: [item: QuadItem] }>()
</script>

<template>
  <div class="quad">
    <button
      v-for="it in items"
      :key="it.key"
      type="button"
      class="quad-i"
      :class="{ off: it.off, 'has-pill': !!it.pill }"
      @click="emit('tap', it)"
    >
      <div class="ic">
        <svg v-if="it.key === 'match'" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2" /></svg>
        <svg v-else-if="it.key === 'reports'" width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" stroke-width="2" /><path d="M9 8.5h6M9 12.5h6M9 16.5h3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        <svg v-else-if="it.key === 'advance'" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.6.8-2.6 1.9 0 2.6 5.4 1.3 5.4 4 0 1.2-1.1 2.1-2.8 2.1-1.3 0-2.3-.5-2.8-1.4M12 6.2v11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M14 3.5v5h5M9 16.5l1.6-1.6 1.4 1.4 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <div class="flex1">
        <b>{{ it.title }}</b>
        <span>{{ it.desc }}</span>
      </div>
      <i v-if="it.pill" class="pill">{{ it.pill }}</i>
    </button>
  </div>
</template>
