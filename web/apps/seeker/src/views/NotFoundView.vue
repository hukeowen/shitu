<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppBar from '@/components/AppBar.vue'
import { useAuthStore } from '@/stores/auth'

/** 兜底页：地址不存在（链接过期、输错地址）。不悄悄跳首页，明确告诉用户并给出去处 */
const router = useRouter()
const auth = useAuthStore()
</script>

<template>
  <div class="nf">
    <AppBar title="页面不存在" fallback="/" />
    <div class="pad stack">
      <section class="acard nf-c">
        <div class="big-ic nf-ic">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" /><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        </div>
        <h3 class="nf-t">页面不存在</h3>
        <p class="t-sm nf-d">你打开的地址可能已失效或输入有误</p>
        <van-button type="primary" block class="btn-cta" style="margin-top: 16px" @click="router.replace('/')">返回首页</van-button>
        <van-button v-if="auth.isLoggedIn" block class="btn-cta" style="margin-top: 10px" @click="router.replace('/reports')">我的报名</van-button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nf { min-height: 100vh; background: var(--bg-page); }
.nf-c { text-align: center; padding: 26px 16px 18px; }
.nf-ic { background: var(--bg-fill); color: var(--text-3); }
.nf-t { font-size: 17px; font-weight: 700; color: var(--text-1); }
.nf-d { margin-top: 6px; line-height: 1.7; }
</style>
