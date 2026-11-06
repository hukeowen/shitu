<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { qrDataUrl } from '@/utils/qr'

/** 前端根据渠道码 url 生成二维码图片 */
const props = withDefaults(defineProps<{ url: string; size?: number; dim?: boolean }>(), { size: 132, dim: false })
const src = ref('')
const failed = ref(false)

watchEffect(async () => {
  const u = props.url
  failed.value = false
  try {
    src.value = u ? await qrDataUrl(u, props.size * 2) : ''
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="qr" :class="{ dim }" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="src && !failed" :src="src" alt="渠道二维码" />
    <span v-else class="t-xs">{{ failed ? '生成失败' : '…' }}</span>
  </div>
</template>

<style scoped>
.qr { background: #fff; border: 1px solid var(--line); border-radius: var(--r-md); padding: 8px; display: grid; place-items: center; flex: none; position: relative; }
.qr img { width: 100%; height: 100%; image-rendering: pixelated; }
.qr.dim img { opacity: .25; filter: grayscale(1); }
</style>
