<script setup lang="ts">
import { BrandMark, IconCheck } from '@shitu/ui-icons'
import { useChannelStore } from '@/stores/channel'

/** S-01 启动页 · 渠道识别：扫码 / 分享链接进入时展示邀请方 */
const channel = useChannelStore()
const emit = defineEmits<{ start: []; browse: [] }>()

const points = ['真实岗位', '薪资公示', '在岗保障']
</script>

<template>
  <div class="splash">
    <div class="main">
      <BrandMark :size="64" />
      <div class="name">仕兔找活儿</div>
      <p class="slogan">先了解你，再给你岗位。<br />不匹配，无岗位，无报名。</p>
      <ul class="points">
        <li v-for="p in points" :key="p"><IconCheck :size="16" />{{ p }}</li>
      </ul>
    </div>
    <transition name="fade">
      <div v-if="channel.inviter" class="inviter">
        <div class="avatar">{{ channel.inviter.slice(0, 1) }}</div>
        <div class="flex1">
          <b>来自「{{ channel.inviter }}」专属通道</b>
          <span>{{ channel.inviter }} 邀请你加入仕兔</span>
        </div>
      </div>
    </transition>
    <van-button type="primary" block size="large" @click="emit('start')">立即匹配工作</van-button>
    <van-button block class="browse" @click="emit('browse')">先逛逛</van-button>
    <p class="legal">登录即代表同意《用户协议》与《隐私政策》<br />平台仅提供匹配服务，不直接雇佣</p>
  </div>
</template>

<style scoped>
.splash { position: fixed; inset: 0; z-index: 3000; display: flex; flex-direction: column; padding: env(safe-area-inset-top) var(--space-page) calc(var(--space-6) + env(safe-area-inset-bottom)); background: var(--bg-card); overflow: hidden; }
.main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
/* 品牌字标：全站只有启动屏和登录页用这个字号 */
.name { margin-top: var(--space-4); font-size: 24px; font-weight: var(--font-weight-semibold); line-height: 32px; color: var(--text-1); }
.slogan { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 24px; color: var(--text-2); }
.points { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2) var(--space-4); margin-top: var(--space-5); font-size: var(--font-size-aux); color: var(--text-2); }
.points li { display: flex; align-items: center; gap: var(--space-1); }
.points svg { color: var(--success-text); }
.inviter { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); background: var(--primary-bg); border-radius: var(--radius-card); }
.inviter .avatar { background: var(--bg-card); }
.inviter b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.inviter span { display: block; font-size: var(--font-size-aux); color: var(--text-2); margin-top: 2px; }
.browse { margin-top: var(--space-3); }
.legal { font-size: var(--font-size-min); color: var(--text-3); text-align: center; margin-top: var(--space-4); line-height: 18px; }
.fade-enter-active { transition: opacity .25s ease; }
.fade-enter-from { opacity: 0; }
</style>
