<script setup lang="ts">
import { useRoute } from 'vue-router'
import { HOME_PATH } from '@/router/menu'

const route = useRoute()
</script>

<template>
  <div class="card">
    <el-result icon="info" title="页面不存在" :sub-title="`没有找到地址 ${route.path} 对应的页面，可能是链接有误或页面已下线。`">
      <template #extra>
        <router-link :to="HOME_PATH"><el-button type="primary">返回工作台</el-button></router-link>
      </template>
    </el-result>
  </div>
</template>
