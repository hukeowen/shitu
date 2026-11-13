<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const ready = ref(false)
const showTabbar = computed(() => ready.value && route.meta.tabbar === true)

// 标签栏高度交给 CSS 变量 --tabbar-h（styles/app.css）：#app 留出底部空间，各页最小高度相应扣除，短页面不再多出一截滚动
watchEffect(() => document.documentElement.classList.toggle('has-tabbar', showTabbar.value))

onMounted(async () => {
  await router.isReady()
  ready.value = true
})
</script>

<template>
  <router-view />
  <div v-if="!ready" class="boot-loading"><van-loading size="28" vertical>加载中…</van-loading></div>
  <van-tabbar v-if="showTabbar" route safe-area-inset-bottom>
    <van-tabbar-item to="/" icon="apps-o">工作台</van-tabbar-item>
    <van-tabbar-item to="/todo" icon="todo-list-o">待办</van-tabbar-item>
    <van-tabbar-item to="/reminders" icon="clock-o">提醒</van-tabbar-item>
    <van-tabbar-item to="/me" icon="user-o">我的</van-tabbar-item>
  </van-tabbar>
</template>

<style>
.boot-loading { position: fixed; inset: 0; display: grid; place-items: center; background: var(--surface-2); }
</style>
