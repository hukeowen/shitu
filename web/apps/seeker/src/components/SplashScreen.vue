<script setup lang="ts">
import BrandMark from './BrandMark.vue'
import { useChannelStore } from '@/stores/channel'

/** S-01 启动页 · 渠道识别：扫码 / 分享链接进入时展示邀请方 */
const channel = useChannelStore()
const emit = defineEmits<{ start: []; browse: [] }>()
</script>

<template>
  <div class="splash">
    <div class="main">
      <BrandMark :size="56" />
      <div class="title">仕兔<br /><span>找活儿</span></div>
      <p class="slogan">先了解你，再给你岗位。<br />不匹配，无岗位，无报名。</p>
      <div class="tags">
        <span class="tag">真实岗位</span>
        <span class="tag">薪资公示</span>
        <span class="tag">在岗保障</span>
      </div>
    </div>
    <transition name="fade">
      <div v-if="channel.inviter" class="inviter">
        <div class="avatar avatar--o avatar--sm">{{ channel.inviter.slice(0, 1) }}</div>
        <div class="flex1">
          <b>来自「{{ channel.inviter }}」专属通道</b>
          <span>{{ channel.inviter }} 邀请你加入仕兔</span>
        </div>
      </div>
    </transition>
    <van-button type="primary" block class="btn-cta" @click="emit('start')">立即匹配工作</van-button>
    <button type="button" class="browse" @click="emit('browse')">先逛逛</button>
    <p class="legal">登录即代表同意《用户协议》与《隐私政策》<br />平台仅提供匹配服务，不直接雇佣</p>
  </div>
</template>

<style scoped>
.splash { position: fixed; inset: 0; z-index: 3000; display: flex; flex-direction: column; padding: env(safe-area-inset-top) 22px calc(26px + env(safe-area-inset-bottom)); color: #fff; background: linear-gradient(165deg, #1D2733 0%, #0D1117 60%); overflow: hidden; }
.main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding-top: 40px; }
.main svg { margin-bottom: 22px; }
.title { font-family: var(--f-dis); font-size: 40px; font-weight: 700; letter-spacing: -.01em; line-height: 1.05; }
.title span { color: var(--signal-300); }
.slogan { color: rgba(255, 255, 255, .62); font-size: 13.5px; margin-top: 14px; line-height: 1.7; }
.tags { display: flex; gap: 6px; margin-top: 20px; }
.tags .tag { background: rgba(255, 255, 255, .1); color: rgba(255, 255, 255, .8); }
.inviter { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; padding: 11px 13px; background: rgba(232, 89, 12, .14); border: 1px solid rgba(232, 89, 12, .4); border-radius: 12px; }
.inviter b { display: block; font-size: 12.5px; font-weight: 600; }
.inviter span { display: block; font-size: 11px; color: rgba(255, 255, 255, .55); margin-top: 2px; }
.browse { width: 100%; height: 44px; margin-top: 9px; background: transparent; border: 1px solid rgba(255, 255, 255, .22); color: rgba(255, 255, 255, .8); border-radius: 12px; font-size: 14px; }
.legal { font-size: 10.5px; color: rgba(255, 255, 255, .35); text-align: center; margin-top: 14px; line-height: 1.6; }
.fade-enter-active { transition: opacity .25s ease; }
.fade-enter-from { opacity: 0; }
</style>
