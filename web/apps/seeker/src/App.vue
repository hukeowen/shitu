<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SplashScreen from '@/components/SplashScreen.vue'
import GuidePopup from '@/components/GuidePopup.vue'
import { useAuthStore } from '@/stores/auth'
import { useChannelStore } from '@/stores/channel'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const channel = useChannelStore()
const showTabbar = computed(() => route.meta.tabbar === true)

/** S-01 启动页：每个会话首次从首页进入时展示（已登录的老用户跳过）；扫码进入时多停留一会儿展示邀请方 */
const SPLASH_KEY = 'shitu.splash'
function splashSeen(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === '1'
  } catch {
    return false
  }
}
const ready = ref(false)
const splash = ref(!splashSeen() && location.pathname === '/')

function hideSplash() {
  splash.value = false
  try {
    sessionStorage.setItem(SPLASH_KEY, '1')
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  const start = Date.now()
  await router.isReady()
  ready.value = true
  if (!splash.value) return
  if (auth.isLoggedIn) return hideSplash()
  setTimeout(() => {
    if (splash.value) hideSplash()
  }, Math.max(0, (channel.code ? 2600 : 1500) - (Date.now() - start)))
})

function splashStart() {
  hideSplash()
  void router.push('/login')
}
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>
  <div v-if="!ready && !splash" class="boot-loading"><van-loading size="28" vertical>加载中…</van-loading></div>
  <van-tabbar v-if="ready && showTabbar" route placeholder safe-area-inset-bottom>
    <van-tabbar-item to="/" icon="home-o">首页</van-tabbar-item>
    <van-tabbar-item to="/reports" icon="todo-list-o">我的报备</van-tabbar-item>
    <van-tabbar-item to="/me" icon="user-o">我的</van-tabbar-item>
    <van-tabbar-item to="/feedback" icon="chat-o">问题反馈</van-tabbar-item>
  </van-tabbar>
  <GuidePopup />
  <transition name="splash-fade">
    <SplashScreen v-if="splash" @start="splashStart" @browse="hideSplash" />
  </transition>
</template>

<style>
.boot-loading { position: fixed; inset: 0; display: grid; place-items: center; background: var(--surface-2); }
.splash-fade-leave-active { transition: opacity .3s ease; }
.splash-fade-leave-to { opacity: 0; }
</style>
