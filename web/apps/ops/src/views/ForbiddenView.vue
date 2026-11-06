<script setup lang="ts">
import { useRoute } from 'vue-router'
import { HOME_PATH } from '@/router/menu'

const route = useRoute()
</script>

<template>
  <div class="card">
    <el-result icon="warning" title="无权限" :sub-title="`当前账号的角色无权访问${route.query.from ? ` ${route.query.from}` : '该页面'}，如需开通请联系超级管理员。`">
      <template #extra>
        <router-link :to="HOME_PATH"><el-button type="primary">返回工作台</el-button></router-link>
      </template>
    </el-result>
  </div>
</template>
