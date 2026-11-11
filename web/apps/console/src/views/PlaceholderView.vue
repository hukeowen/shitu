<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <b>{{ route.meta.title }}</b>
    </template>
    <el-empty :description="'该功能暂未开放'" />
  </el-card>
</template>
