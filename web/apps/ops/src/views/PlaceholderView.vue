<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <b>{{ route.meta.title }}</b>
    </template>
    <el-empty :description="`原型 ${route.meta.proto ?? '—'} · 待实现`" />
  </el-card>
</template>
