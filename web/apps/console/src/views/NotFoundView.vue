<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { homePath } from '@/router/access'
import { useMeStore } from '@/stores/me'

/** 地址不存在时的提示页（在后台框架内显示，侧栏和顶栏照常可用） */
const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
</script>

<template>
  <div class="nf card">
    <div class="code num">404</div>
    <h2>页面不存在</h2>
    <p class="t-sm">地址 <span class="mono">{{ route.path }}</span> 没有对应的页面，可能是链接已失效或输入有误。</p>
    <div class="row" style="justify-content: center; margin-top: 20px">
      <el-button @click="router.back()">返回上一页</el-button>
      <el-button type="primary" @click="router.replace(homePath(meStore.me))">返回首页</el-button>
    </div>
  </div>
</template>

<style scoped>
.nf { max-width: 560px; margin: 8vh auto 0; padding: 48px 32px 40px; text-align: center; }
.code { font-size: 56px; line-height: 1; font-weight: 650; color: var(--ink-300); letter-spacing: .02em; }
h2 { margin: 16px 0 8px; font-size: 20px; font-weight: 650; color: var(--ink-900); }
.mono { color: var(--ink-700); word-break: break-all; }
</style>
