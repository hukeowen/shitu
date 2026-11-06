<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const desc = computed(() => `${route.meta.title ?? '该功能'}即将上线`)
</script>

<template>
  <div class="ph">
    <van-nav-bar :title="route.meta.title" safe-area-inset-top />
    <van-empty :description="desc" />
  </div>
</template>
