<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { IconLock } from '@shitu/ui-icons'
import { HOME_PATH } from '@/router/menu'

const route = useRoute()
const router = useRouter()
</script>

<template>
  <!-- 规范第 13 类：48 线性图标、16px / 600 标题、一行说明、一个主按钮 -->
  <div class="card">
    <div class="result">
      <IconLock :size="48" />
      <h2>无权限</h2>
      <p>当前账号的角色无权访问{{ route.query.from ? ` ${route.query.from}` : '该页面' }}，如需开通请联系超级管理员。</p>
      <el-button type="primary" @click="router.push(HOME_PATH)">返回工作台</el-button>
    </div>
  </div>
</template>

<style scoped>
.result { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: 64px var(--space-6); text-align: center; }
.result > svg { color: var(--text-3); }
.result h2 { margin: var(--space-2) 0 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.result p { margin: 0 0 var(--space-2); max-width: 480px; font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
</style>
