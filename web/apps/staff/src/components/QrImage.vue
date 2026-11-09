<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'

/** 前端按链接生成二维码（签署码等），现场可直接给求职者扫码 */
const props = withDefaults(defineProps<{ url: string; size?: number; alt?: string }>(), { size: 132, alt: '二维码' })
const src = ref('')
const failed = ref(false)

watchEffect(async () => {
  const u = props.url
  failed.value = false
  try {
    src.value = u
      ? await QRCode.toDataURL(u, { width: props.size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0D1117', light: '#FFFFFF' } })
      : ''
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="qr" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="src && !failed" :src="src" :alt="alt" />
    <span v-else class="t-xs">{{ failed ? '生成失败' : '…' }}</span>
  </div>
</template>

<style scoped>
.qr { background: #fff; border: 1px solid var(--line); border-radius: var(--r-md); padding: 8px; display: grid; place-items: center; flex: none; box-sizing: border-box; }
.qr img { width: 100%; height: 100%; image-rendering: pixelated; }
</style>
