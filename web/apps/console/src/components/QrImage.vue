<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { qrScreenDataUrl } from '@/utils/qr'

/** 前端根据渠道码 url 生成二维码图片 */
const props = withDefaults(defineProps<{ url: string; size?: number; dim?: boolean }>(), { size: 132, dim: false })
const src = ref('')
const failed = ref(false)

watchEffect(async () => {
  const u = props.url
  failed.value = false
  try {
    src.value = u ? await qrScreenDataUrl(u, props.size * 2) : ''
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
/* 码自带 4 个模块的白边当静区（utils/qr.ts 的 qrScreenDataUrl），白底、不套灰框；码点保持黑白（QR_COLOR） */
.qr { background: var(--bg-card); display: grid; place-items: center; flex: none; position: relative; }
.qr img { width: 100%; height: 100%; image-rendering: pixelated; }
.qr.dim img { opacity: .25; filter: grayscale(1); }
</style>
