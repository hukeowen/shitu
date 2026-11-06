<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useChannelStore } from '@/stores/channel'
import { useGuideStore } from '@/stores/guide'

/** S-03 游客引导弹窗：「先逛逛」关闭 /「立即匹配工作」去注册，登录后回到意图页面 */
const guide = useGuideStore()
const channel = useChannelStore()
const router = useRouter()

function start() {
  const redirect = guide.redirect
  guide.close()
  void router.push(redirect && redirect !== '/' ? { path: '/login', query: { redirect } } : '/login')
}
</script>

<template>
  <van-popup v-model:show="guide.visible" round position="bottom" teleport="body" class="guide" :close-on-popstate="true">
    <div class="handle"></div>
    <div class="hd">
      <div class="ic">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2" />
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>
      <h3>开始 AI 问薪匹配</h3>
      <p class="t-sm">仕兔不提供岗位列表 —— 需要先了解你的期望，<br />才能匹配出真正合适的 3 个岗位。</p>
    </div>
    <div v-if="channel.inviter" class="via">
      <div class="avatar avatar--o avatar--sm">{{ channel.inviter.slice(0, 1) }}</div>
      <div class="flex1">
        <b>你正在通过「{{ channel.inviter }}」进入</b>
        <span class="t-xs">注册后将优先匹配该公司岗位</span>
      </div>
    </div>
    <van-button type="primary" block class="btn-cta" @click="start">立即匹配工作</van-button>
    <van-button block class="btn-cta later" @click="guide.close()">先逛逛</van-button>
    <p class="t-xs tip">仅需手机号 + 短信验证码，无需设置密码</p>
  </van-popup>
</template>

<style scoped>
.guide { padding: 12px 16px calc(16px + env(safe-area-inset-bottom)); }
.handle { width: 34px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 auto 14px; }
.hd { text-align: center; padding: 0 6px 4px; }
.ic { width: 52px; height: 52px; border-radius: 16px; background: var(--signal-50); display: grid; place-items: center; margin: 0 auto 14px; color: var(--signal); }
.hd h3 { font-size: 18px; font-weight: 700; color: var(--ink-900); }
.hd p { margin-top: 8px; line-height: 1.7; }
.via { display: flex; gap: 10px; align-items: center; margin: 16px 0 0; padding: 11px 13px; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md); }
.via b { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-900); }
.btn-cta { margin-top: 14px; }
.later { margin-top: 9px; }
.tip { text-align: center; margin-top: 12px; }
</style>
