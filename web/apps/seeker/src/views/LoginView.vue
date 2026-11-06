<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showDialog, showToast } from 'vant'
import { errorMessage, seekerApi } from '@shitu/api-client'
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
const codeInput = ref<HTMLInputElement | null>(null)

const phoneValid = computed(() => PHONE_RE.test(phone.value))
const codeValid = computed(() => /^\d{6}$/.test(code.value))
const sentTo = ref('')

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

function onPhoneInput(e: Event) {
  phone.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11)
}
function onCodeInput(e: Event) {
  code.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6)
}

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

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}

function openDoc(kind: 'user' | 'privacy') {
  // TODO: 协议正文由法务提供后改为独立页面
  void showDialog({
    title: kind === 'user' ? '仕兔用户协议' : '隐私政策',
    message:
      kind === 'user'
        ? '仕兔为求职者与劳务公司提供岗位匹配服务，平台不直接雇佣。完整协议正文即将上线。'
        : '我们仅为提供匹配服务收集你的手机号等必要信息，敏感信息加密存储。完整隐私政策即将上线。',
    confirmButtonText: '我知道了',
  })
}
</script>

<template>
  <div class="login">
    <div class="appbar">
      <button type="button" class="ico" aria-label="返回" @click="back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>

    <div class="body">
      <h2>手机号登录 / 注册</h2>
      <p class="t-sm sub">未注册的手机号验证后自动注册，生成唯一用户 ID，无需设置密码</p>

      <div class="field">
        <div class="lbl">手机号码</div>
        <div class="line">
          <span class="cc mono">+86</span>
          <input
            :value="phone"
            class="inp phone"
            type="tel"
            inputmode="numeric"
            maxlength="11"
            autocomplete="tel-national"
            placeholder="请输入手机号"
            @input="onPhoneInput"
          />
        </div>
      </div>

      <div class="field">
        <div class="lbl">短信验证码</div>
        <div class="line">
          <input
            ref="codeInput"
            :value="code"
            class="inp code"
            type="tel"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            placeholder="6 位验证码"
            @input="onCodeInput"
          />
          <button
            type="button"
            class="send"
            :disabled="sms.sending.value || sms.countdown.counting.value"
            @click="sendCode"
          >
            <template v-if="sms.countdown.counting.value"><span class="mono">{{ sms.countdown.seconds.value }}s</span> 后重发</template>
            <template v-else-if="sms.sending.value">发送中…</template>
            <template v-else>{{ sentTo ? '重新获取' : '获取验证码' }}</template>
          </button>
        </div>
        <p v-if="sentTo" class="t-xs sent">验证码已发送至 {{ sentTo }}</p>
      </div>

      <div v-if="channel.inviter" class="acard via">
        <div class="avatar avatar--o avatar--sm">{{ channel.inviter.slice(0, 1) }}</div>
        <div class="flex1">
          <b>来源渠道：{{ channel.inviter }}</b>
          <p class="t-xs">新用户注册后由 {{ channel.inviter }} 专属跟进，24 小时内联系你，优先匹配该公司岗位。已注册用户登录不改变原有归属。</p>
        </div>
      </div>

      <div class="agree">
        <van-checkbox v-model="agreed" shape="square" icon-size="16px" />
        <span class="t-xs">
          我已阅读并同意<a @click.prevent="openDoc('user')">《仕兔用户协议》</a><a @click.prevent="openDoc('privacy')">《隐私政策》</a>，理解平台仅提供匹配服务、不直接雇佣。
        </span>
      </div>

      <van-button type="primary" block class="btn-cta submit" :loading="submitting" loading-text="登录中…" @click="submit">
        登录 / 注册并开始匹配
      </van-button>
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
.login { min-height: 100vh; background: var(--surface); padding-top: env(safe-area-inset-top); }
.appbar { height: 46px; display: flex; align-items: center; padding: 0 10px; }
.ico { width: 36px; height: 36px; display: grid; place-items: center; border: 0; background: transparent; color: var(--ink-700); }
.body { padding: 6px 20px calc(24px + env(safe-area-inset-bottom)); }
h2 { font-family: var(--f-dis); font-size: 26px; font-weight: 700; color: var(--ink-900); line-height: 1.2; }
.sub { margin-top: 8px; line-height: 1.6; }
.field { margin-top: 24px; }
.lbl { font-size: 12px; color: var(--ink-500); margin-bottom: 6px; }
.line { display: flex; align-items: center; gap: 8px; border-bottom: 1.5px solid var(--ink-900); padding-bottom: 6px; }
.cc { font-size: 15px; color: var(--ink-600); }
.inp { flex: 1; min-width: 0; height: 34px; border: 0; outline: none; background: transparent; padding: 0 4px; font-size: 19px; font-family: var(--f-dis); letter-spacing: .06em; color: var(--ink-900); }
.inp::placeholder { font-family: var(--f-cn); font-size: 15px; letter-spacing: 0; color: var(--ink-300); }
.inp.code { letter-spacing: .3em; }
.send { flex: none; height: 30px; padding: 0 10px; border: 1px solid var(--signal-300); border-radius: var(--r-sm); background: var(--signal-50); color: var(--signal-700); font-size: 13px; font-weight: 600; }
.send:disabled { border-color: var(--line); background: var(--surface-3); color: var(--ink-400); }
.sent { margin-top: 8px; }
.via { display: flex; gap: 10px; align-items: flex-start; margin-top: 24px; background: var(--surface-2); }
.via b { display: block; font-size: 13px; font-weight: 700; color: var(--ink-900); }
.via p { margin-top: 4px; line-height: 1.6; }
.agree { display: flex; align-items: flex-start; gap: 8px; margin-top: 20px; }
.agree :deep(.van-checkbox) { flex: none; margin-top: 1px; }
.agree .t-xs { line-height: 1.6; color: var(--ink-500); }
.agree a { color: var(--signal-700); }
.submit { margin-top: 20px; }
</style>
