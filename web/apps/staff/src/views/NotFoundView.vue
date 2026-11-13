<script setup lang="ts">
import { useRouter } from 'vue-router'

/** 未匹配到任何路由：明确告知页面不存在，而不是悄悄显示工作台 */
const router = useRouter()
</script>

<template>
  <div class="nf">
    <van-nav-bar title="页面不存在" safe-area-inset-top />
    <van-empty image="search" description="页面不存在">
      <p class="t-xs tip">链接可能已失效，或地址输入有误</p>
      <van-button round type="primary" size="small" class="btn" @click="router.replace('/')">返回工作台</van-button>
    </van-empty>
  </div>
</template>

<style scoped>
.nf { min-height: 100vh; }
.tip { margin-bottom: 16px; text-align: center; }
.btn { display: block; margin: 0 auto; padding: 0 22px; }
</style>
