<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IconClipboardList, IconClock, IconLayoutDashboard, IconUser } from '@shitu/ui-icons'

const route = useRoute()
const router = useRouter()
const ready = ref(false)
const showTabbar = computed(() => ready.value && route.meta.tabbar === true)

onMounted(async () => {
  await router.isReady()
  ready.value = true
})
</script>

<template>
  <router-view />
  <div v-if="!ready" class="boot-loading page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
  <van-tabbar v-if="showTabbar" route placeholder safe-area-inset-bottom>
    <van-tabbar-item to="/"><template #icon><IconLayoutDashboard :size="22" /></template>工作台</van-tabbar-item>
    <van-tabbar-item to="/todo"><template #icon><IconClipboardList :size="22" /></template>待办</van-tabbar-item>
    <van-tabbar-item to="/reminders"><template #icon><IconClock :size="22" /></template>提醒</van-tabbar-item>
    <van-tabbar-item to="/me"><template #icon><IconUser :size="22" /></template>我的</van-tabbar-item>
  </van-tabbar>
</template>

<style>
.boot-loading { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg-page); }
</style>
