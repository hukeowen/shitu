<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AppBar from '@/components/AppBar.vue'
import { useAuthStore } from '@/stores/auth'

/** 兜底页：地址不存在（链接过期、输错地址）。不悄悄跳首页，明确告诉用户并给出去处 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
</script>

<template>
  <div class="nf">
    <AppBar title="页面不存在" fallback="/" />
    <div class="page-state">
      <van-empty image="search" description="页面不存在">
        <p class="t-xs nf-d">你打开的地址可能已失效或输入有误</p>
        <p class="t-xs mono nf-p">{{ route.path }}</p>
        <van-button round type="primary" class="nf-b" @click="router.replace('/')">返回首页</van-button>
        <van-button v-if="auth.isLoggedIn" round class="nf-b" @click="router.replace('/reports')">我的报备</van-button>
      </van-empty>
    </div>
  </div>
</template>

<style scoped>
.nf { min-height: 100vh; background: var(--surface-2); }
.nf-d { line-height: 1.7; }
.nf-p { margin-top: 4px; max-width: 260px; margin-left: auto; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; }
.nf-b { display: block; width: 168px; margin: 14px auto 0; }
.nf-b + .nf-b { margin-top: 10px; }
</style>
