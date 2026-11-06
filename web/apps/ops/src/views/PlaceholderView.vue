<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>{{ route.meta.title }}</h2><p>该功能不在 Sprint 1 范围内，后续版本开放。</p></div>
      <div class="spacer" />
      <span class="ref">原型 <b>{{ route.meta.proto ?? '—' }}</b></span>
    </div>
    <div class="card">
      <el-empty :description="`原型 ${route.meta.proto ?? '—'} · 待实现`" />
    </div>
  </div>
</template>
