<script setup lang="ts">
import { IconClipboardList, IconFilePenLine, IconLock, IconSparkles, IconWallet } from '@shitu/ui-icons'
import type { QuadItem } from './quad'

defineProps<{ items: QuadItem[] }>()
const emit = defineEmits<{ tap: [item: QuadItem] }>()

const ICONS = { match: IconSparkles, reports: IconClipboardList, advance: IconWallet, contracts: IconFilePenLine }
</script>

<template>
  <div class="quad">
    <!-- 不能用的入口仍可点：点了会说明原因 -->
    <button v-for="it in items" :key="it.key" type="button" class="quad-i" :class="{ off: it.off }" @click="emit('tap', it)">
      <component :is="ICONS[it.key]" :size="28" />
      <b>{{ it.title }}</b>
      <span class="quad-d"><IconLock v-if="it.off" :size="14" />{{ it.desc }}</span>
    </button>
  </div>
</template>
