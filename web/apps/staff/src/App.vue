<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IconClipboardList, IconClock, IconLayoutDashboard, IconUser } from '@shitu/ui-icons'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'

const route = useRoute()
const router = useRouter()
const ready = ref(false)
const showTabbar = computed(() => ready.value && route.meta.tabbar === true)

// 标签栏高度交给 CSS 变量 --tabbar-h（styles/app.css）：#app 留出底部空间，各页最小高度相应扣除，短页面不再多出一截滚动
watchEffect(() => document.documentElement.classList.toggle('has-tabbar', showTabbar.value))

// 登录且公司可用时轮询未读数；退出登录即停
const auth = useAuthStore()
const inbox = useInboxStore()
watchEffect(() => (auth.isLoggedIn && auth.me?.operational === true ? inbox.start() : inbox.stop()))

/** 未读数显示在标签标题最前面：「(3) 待办 · …」。路由切换会重写标题，所以两边都要监听 */
function applyTitleBadge(n: number) {
  const base = document.title.replace(/^\(\d+\+?\)\s*/, '')
  document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base
}
watch([() => inbox.unread, () => route.fullPath], () => void nextTick(() => applyTitleBadge(inbox.unread)))

onMounted(async () => {
  await router.isReady()
  ready.value = true
})
</script>

<template>
  <router-view />
  <div v-if="!ready" class="boot-loading page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
  <van-tabbar v-if="showTabbar" route safe-area-inset-bottom>
    <van-tabbar-item to="/"><template #icon><IconLayoutDashboard :size="22" /></template>工作台</van-tabbar-item>
    <van-tabbar-item to="/todo"><template #icon><IconClipboardList :size="22" /></template>待办</van-tabbar-item>
    <van-tabbar-item to="/reminders"><template #icon><IconClock :size="22" /></template>提醒</van-tabbar-item>
    <van-tabbar-item to="/me"><template #icon><IconUser :size="22" /></template>我的</van-tabbar-item>
  </van-tabbar>
</template>

<style>
.boot-loading { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg-page); }
</style>
