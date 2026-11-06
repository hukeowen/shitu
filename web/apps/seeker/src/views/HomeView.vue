<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import GuestHome from '@/components/home/GuestHome.vue'
import MemberHome from '@/components/home/MemberHome.vue'

/** 首页：游客 S-02 / 登录后按状态展示（Sprint 1：公域求职 S-06、私域待匹配 S-07，其余状态通用展示） */
const auth = useAuthStore()
</script>

<template>
  <MemberHome v-if="auth.isLoggedIn" />
  <GuestHome v-else />
</template>
