<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const desc = computed(() => `${route.meta.title ?? ''} · 原型 ${route.meta.proto ?? '—'} · 待实现`)
</script>

<template>
  <div class="ph">
    <van-nav-bar :title="route.meta.title" />
    <van-empty :description="desc" />
  </div>
</template>
