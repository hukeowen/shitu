<script setup lang="ts">
/**
 * 仕兔品牌标：四个端共用的唯一一份。旁边总有「仕兔」文字，所以标本身是装饰性的。
 * 短横用 80% 白：混到主色上对比度 3.4，60% 只有 2.6，过不了图形 3:1。
 * 造型改动要同步 ../public/favicon.svg（favicon 读不到设计变量，色值是写死的）。
 */
withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--primary)" />
    <path d="M8 17V9.5C8 7.8 9.3 6.5 11 6.5s3 1.3 3 3V17" stroke="var(--text-on-primary)" stroke-width="2" stroke-linecap="round" />
    <path d="M14 12h3" stroke="var(--text-on-primary)" stroke-opacity=".8" stroke-width="2" stroke-linecap="round" />
  </svg>
</template>
