<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showDialog, showToast } from 'vant'
import type { FieldInstance } from 'vant'
import { errorMessage, seekerApi } from '@shitu/api-client'
import { BrandMark, IconCheck } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import CaptchaDialog from '@/components/CaptchaDialog.vue'
import { useSmsSender } from '@/composables/useSmsSender'
import { safeRedirect } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useChannelStore } from '@/stores/channel'

/** S-04 手机号 + 短信验证码注册 / 登录（C-104，无密码）；首次注册按渠道锁定归属（C-105） */
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const channel = useChannelStore()

const PHONE_RE = /^1[3-9]\d{9}$/
const phone = ref('')
const code = ref('')
const agreed = ref(false)
const submitting = ref(false)
const codeInput = ref<FieldInstance | null>(null)

const phoneValid = computed(() => PHONE_RE.test(phone.value))
const codeValid = computed(() => /^\d{6}$/.test(code.value))
const sentTo = ref('')
/** 从实名「找回旧号」进入：提示用旧手机号登录 */
const fromOld = computed(() => route.query.old === '1')

const sms = useSmsSender(seekerApi, (r) => {
  sentTo.value = phone.value.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
  if (r.devCode) {
    code.value = r.devCode
    showToast({ message: `开发环境验证码 ${r.devCode}`, duration: 3000 })
  } else {
    codeInput.value?.focus()
  }
})
const captcha = sms.captcha

const digits = (v: string) => v.replace(/\D/g, '')
const points = ['手机号直接注册', '实名后才能报名', '顾问一对一跟进']

function sendCode() {
  if (!phoneValid.value) {
    showToast('请输入正确的 11 位手机号')
    return
  }
  void sms.send(phone.value)
}

async function submit() {
  if (submitting.value) return
  if (!phoneValid.value) return showToast('请输入正确的 11 位手机号')
  if (!codeValid.value) return showToast('请输入 6 位短信验证码')
  if (!agreed.value) return showToast('请先阅读并同意用户协议和隐私政策')
  submitting.value = true
  try {
    const resp = await seekerApi.login(phone.value, code.value, channel.submitCode())
    auth.setSession(resp)
    // 渠道只在首次注册时绑定（已注册用户再扫码不改变归属），登录后即清除暂存
    channel.reset()
    showToast({ type: 'success', message: resp.newUser ? '注册成功' : '登录成功' })
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    showToast(errorMessage(e, '登录失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}

function openDoc(kind: 'user' | 'privacy') {
  // TODO: 协议正文由法务提供后改为独立页面
  void showDialog({
    title: kind === 'user' ? '仕兔用户协议' : '隐私政策',
    message:
      kind === 'user'
        ? '仕兔为求职者与劳务公司提供岗位匹配服务，平台不直接雇佣。完整协议以平台正式发布的版本为准。'
        : '我们仅为提供匹配服务收集你的手机号等必要信息，敏感信息加密存储。完整隐私政策以平台正式发布的版本为准。',
    confirmButtonText: '我知道了',
  })
}
</script>

<template>
  <div class="login">
    <AppBar title="登录 / 注册" />
    <div class="body">
      <div class="brand"><BrandMark :size="48" /><span>仕兔</span></div>
      <p class="slogan">找工作，先问问薪资。<br />回答几个问题，马上看到适合你的岗位</p>

      <h1>{{ fromOld ? '用旧手机号登录' : '手机号登录 / 注册' }}</h1>
      <p class="sub">{{ fromOld ? '请输入当初实名认证时使用的手机号，登录后即可继续' : '没注册过的手机号，验证后自动注册，不用设密码' }}</p>

      <van-field
        v-model="phone"
        class="fld"
        label="手机号码"
        label-align="top"
        type="tel"
        inputmode="numeric"
        maxlength="11"
        autocomplete="tel-national"
        placeholder="请输入 11 位手机号"
        :formatter="digits"
        :border="false"
      />
      <van-field
        ref="codeInput"
        v-model="code"
        class="fld"
        label="短信验证码"
        label-align="top"
        type="tel"
        inputmode="numeric"
        maxlength="6"
        autocomplete="one-time-code"
        placeholder="6 位验证码"
        :formatter="digits"
        :border="false"
      >
        <template #button>
          <button type="button" class="send" :disabled="sms.sending.value || sms.countdown.counting.value" @click="sendCode">
            <template v-if="sms.countdown.counting.value">{{ sms.countdown.seconds.value }}s 后重发</template>
            <template v-else-if="sms.sending.value">发送中…</template>
            <template v-else>{{ sentTo ? '重新获取' : '获取验证码' }}</template>
          </button>
        </template>
      </van-field>
      <p v-if="sentTo" class="sent">验证码已发送至 {{ sentTo }}</p>

      <div v-if="channel.inviter" class="via">
        <div class="avatar">{{ channel.inviter.slice(0, 1) }}</div>
        <div class="flex1">
          <b>来源渠道：{{ channel.inviter }}</b>
          <p>新用户注册后由 {{ channel.inviter }} 专属跟进，24 小时内联系你，优先匹配该公司岗位。已注册用户登录不改变原有归属。</p>
        </div>
      </div>

      <div class="agree">
        <van-checkbox v-model="agreed" shape="square" icon-size="18px" aria-label="同意用户协议和隐私政策" />
        <span>
          我已阅读并同意<a href="#" @click.prevent="openDoc('user')">《仕兔用户协议》</a><a href="#" @click.prevent="openDoc('privacy')">《隐私政策》</a>，理解平台仅提供匹配服务、不直接雇佣。
        </span>
      </div>

      <van-button type="primary" block size="large" class="submit" :loading="submitting" loading-text="登录中…" @click="submit">
        登录 / 注册并开始匹配
      </van-button>

      <ul class="points">
        <li v-for="p in points" :key="p"><IconCheck :size="16" />{{ p }}</li>
      </ul>
    </div>

    <CaptchaDialog
      v-model:show="captcha.visible"
      v-model:code="captcha.code"
      :image="captcha.image"
      :loading="captcha.loading"
      :confirm="sms.confirmCaptcha"
      @refresh="sms.refreshCaptcha"
    />
  </div>
</template>

<style scoped>
.login { min-height: 100vh; background: var(--bg-card); }
.body { padding: var(--space-6) var(--space-page) calc(var(--space-6) + env(safe-area-inset-bottom)); }
/* 品牌字标：全站只有启动屏和登录页用这个字号 */
.brand { display: flex; align-items: center; gap: var(--space-3); font-size: 24px; font-weight: var(--font-weight-semibold); color: var(--text-1); }
.slogan { margin-top: var(--space-3); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
h1 { margin-top: var(--space-8); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-2); }
.fld { margin-top: var(--space-4); padding: 0; }
.fld :deep(.van-field__label) { margin-bottom: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); }
.fld :deep(.van-field__body) { height: var(--control-height); padding: 0 var(--space-1) 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); transition: border-color .15s; }
.fld :deep(.van-field__body:focus-within) { border-color: var(--primary); }
/* 输入框不小于 16px，否则 iOS 聚焦时会放大页面 */
.fld :deep(.van-field__control) { font-size: var(--font-size-section); }
.send { min-width: 104px; height: calc(var(--control-height) - 2px); padding: 0 var(--space-3); border: 0; background: none; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.send:disabled { color: var(--text-placeholder); }
.sent { margin-top: var(--space-2); font-size: var(--font-size-min); color: var(--text-3); }
.via { display: flex; gap: var(--space-3); align-items: flex-start; margin-top: var(--space-5); padding: var(--space-3) var(--space-4); background: var(--primary-bg); border-radius: var(--radius-card); }
.via .avatar { background: var(--bg-card); }
.via b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.via p { margin-top: var(--space-1); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-2); }
.agree { --van-checkbox-border-color: var(--text-3); display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-5); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-2); }
/* 勾选框本身 18px，用内边距把点击区撑到 44 */
.agree :deep(.van-checkbox) { flex: none; padding: 13px; margin: -12px -5px -13px -13px; }
.agree a { color: var(--primary-text); }
.submit { margin-top: var(--space-5); }
.points { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2) var(--space-4); margin-top: var(--space-6); font-size: var(--font-size-aux); color: var(--text-3); }
.points li { display: flex; align-items: center; gap: var(--space-1); }
.points svg { color: var(--success-text); }
</style>
