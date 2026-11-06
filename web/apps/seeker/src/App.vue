<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const showTabbar = computed(() => route.meta.tabbar === true)
</script>

<template>
  <router-view />
  <van-tabbar v-if="showTabbar" route placeholder safe-area-inset-bottom>
    <van-tabbar-item to="/" icon="home-o">首页</van-tabbar-item>
    <van-tabbar-item to="/reports" icon="todo-list-o">我的报备</van-tabbar-item>
    <van-tabbar-item to="/me" icon="user-o">我的</van-tabbar-item>
    <van-tabbar-item to="/feedback" icon="chat-o">问题反馈</van-tabbar-item>
  </van-tabbar>
</template>
