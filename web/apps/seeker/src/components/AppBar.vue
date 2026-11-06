<script setup lang="ts">
import { useRouter } from 'vue-router'

/**
 * 二级页顶栏：有站内历史时返回上一页，否则回到 fallback（直接打开链接 / 刷新后）。
 * 传 onBack 时由页面自己处理返回（如答题页回到上一题）。
 */
const props = withDefaults(
  defineProps<{ title: string; fallback?: string; back?: boolean; onBack?: () => void }>(),
  { fallback: '/', back: true, onBack: undefined },
)
const router = useRouter()

function goBack() {
  if (props.onBack) return props.onBack()
  if (window.history.state?.back) router.back()
  else void router.replace(props.fallback)
}
</script>

<template>
  <van-nav-bar :title="title" :left-arrow="back" fixed placeholder safe-area-inset-top class="appbar" z-index="50" @click-left="goBack">
    <template #right><slot name="right" /></template>
  </van-nav-bar>
</template>

<style scoped>
.appbar :deep(.van-nav-bar__title) { font-weight: 700; color: var(--ink-900); }
.appbar :deep(.van-nav-bar__left .van-icon) { color: var(--ink-700); }
</style>
