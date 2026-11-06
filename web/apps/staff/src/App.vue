<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const showTabbar = computed(() => route.meta.tabbar === true)
</script>

<template>
  <router-view />
  <van-tabbar v-if="showTabbar" route placeholder safe-area-inset-bottom>
    <van-tabbar-item to="/" icon="apps-o">工作台</van-tabbar-item>
    <van-tabbar-item to="/todo" icon="todo-list-o">待办</van-tabbar-item>
    <van-tabbar-item to="/reminders" icon="clock-o">提醒</van-tabbar-item>
    <van-tabbar-item to="/me" icon="user-o">我的</van-tabbar-item>
  </van-tabbar>
</template>
