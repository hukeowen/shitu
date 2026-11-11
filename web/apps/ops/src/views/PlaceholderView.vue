<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>{{ route.meta.title }}</h2><p>该功能暂未开放。</p></div>
      <div class="spacer" />
    </div>
    <div class="card">
      <el-empty :description="'该功能暂未开放'" />
    </div>
  </div>
</template>
