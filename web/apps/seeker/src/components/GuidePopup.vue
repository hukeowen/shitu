<script setup lang="ts">
import { useRouter } from 'vue-router'
import { IconSparkles } from '@shitu/ui-icons'
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
    <div class="hd">
      <IconSparkles :size="32" />
      <h3>开始 AI 问薪匹配</h3>
      <p>仕兔不提供岗位列表 —— 需要先了解你的期望，才能匹配出真正合适的 3 个岗位。</p>
    </div>
    <div v-if="channel.inviter" class="via">
      <div class="avatar">{{ channel.inviter.slice(0, 1) }}</div>
      <div class="flex1">
        <b>你正在通过「{{ channel.inviter }}」进入</b>
        <span>注册后将优先匹配该公司岗位</span>
      </div>
    </div>
    <van-button type="primary" block size="large" class="go" @click="start">立即匹配工作</van-button>
    <van-button block class="later" @click="guide.close()">先逛逛</van-button>
    <p class="note-line">仅需手机号 + 短信验证码，无需设置密码</p>
  </van-popup>
</template>

<style scoped>
.guide { padding: var(--space-6) var(--space-page) calc(var(--space-4) + env(safe-area-inset-bottom)); }
.hd { text-align: center; }
.hd svg { color: var(--primary); }
.hd h3 { margin-top: var(--space-2); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.hd p { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 24px; color: var(--text-2); }
.via { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-4); padding: var(--space-3) var(--space-4); background: var(--primary-bg); border-radius: var(--radius-card); }
.via .avatar { background: var(--bg-card); }
.via b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.via span { display: block; margin-top: 2px; font-size: var(--font-size-aux); color: var(--text-2); }
.go { margin-top: var(--space-5); }
.later { margin-top: var(--space-3); }
.note-line { text-align: center; margin-top: var(--space-3); font-size: var(--font-size-min); color: var(--text-3); }
</style>
