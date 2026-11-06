<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 20 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="5" fill="#E8590C" />
    <path d="M8 17V9.5C8 7.8 9.3 6.5 11 6.5s3 1.3 3 3V17" stroke="#fff" stroke-width="2" stroke-linecap="round" />
    <path d="M14 12h3" stroke="#0D1117" stroke-width="2" stroke-linecap="round" />
  </svg>
</template>
