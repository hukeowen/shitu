<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showDialog, showToast } from 'vant'
import { errorMessage, tenantApi } from '@shitu/api-client'
import BrandMark from '@/components/BrandMark.vue'
import CaptchaDialog from '@/components/CaptchaDialog.vue'
import { useSmsSender } from '@/composables/useSmsSender'
import { safeRedirect } from '@/router'
import { useAuthStore } from '@/stores/auth'

/** 驻场登录：劳务公司成员账号（TENANT 域），手机号 + 短信验证码。驻场端不提供公司入驻 */
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const PHONE_RE = /^1[3-9]\d{9}$/
const phone = ref('')
const code = ref('')
const submitting = ref(false)
const sentTo = ref('')
const codeInput = ref<HTMLInputElement | null>(null)

const sms = useSmsSender(tenantApi, (r) => {
  sentTo.value = phone.value.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
  if (r.devCode) {
    code.value = r.devCode
    showToast({ message: `开发环境验证码 ${r.devCode}`, duration: 3000 })
  } else {
    codeInput.value?.focus()
  }
})
const captcha = sms.captcha
const phoneValid = computed(() => PHONE_RE.test(phone.value))

function onPhoneInput(e: Event) {
  phone.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11)
}
function onCodeInput(e: Event) {
  code.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6)
}

function sendCode() {
  if (!phoneValid.value) return showToast('请输入正确的 11 位手机号')
  void sms.send(phone.value)
}

async function submit() {
  if (submitting.value) return
  if (!phoneValid.value) return showToast('请输入正确的 11 位手机号')
  if (!/^\d{6}$/.test(code.value)) return showToast('请输入 6 位短信验证码')
  submitting.value = true
  try {
    const resp = await tenantApi.login(phone.value, code.value)
    if (resp.status === 'NOT_MEMBER' || !resp.accessToken) {
      await showDialog({
        title: '暂未加入劳务公司',
        message: '该手机号还没有加入任何劳务公司，请联系公司管理员在后台添加你为成员',
        confirmButtonText: '我知道了',
      })
      return
    }
    auth.accessToken = resp.accessToken
    const me = await auth.loadMe()
    showToast({ type: 'success', message: '登录成功' })
    await router.replace(me.operational ? safeRedirect(route.query.redirect) : '/notice')
  } catch (e) {
    showToast(errorMessage(e, '登录失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <header class="brand">
      <BrandMark :size="44" />
      <h2>仕兔驻场</h2>
      <p>劳务公司成员账号 · 手机号验证码登录</p>
    </header>

    <div class="body">
      <div class="field">
        <div class="lbl">手机号码</div>
        <div class="line">
          <span class="cc mono">+86</span>
          <input
            :value="phone"
            class="inp"
            type="tel"
            inputmode="numeric"
            maxlength="11"
            autocomplete="tel-national"
            placeholder="请输入成员手机号"
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
          <button type="button" class="send" :disabled="sms.sending.value || sms.countdown.counting.value" @click="sendCode">
            <template v-if="sms.countdown.counting.value"><span class="mono">{{ sms.countdown.seconds.value }}s</span> 后重发</template>
            <template v-else-if="sms.sending.value">发送中…</template>
            <template v-else>{{ sentTo ? '重新获取' : '获取验证码' }}</template>
          </button>
        </div>
        <p v-if="sentTo" class="t-xs sent">验证码已发送至 {{ sentTo }}</p>
      </div>

      <van-button type="primary" block class="btn-cta submit" :loading="submitting" loading-text="登录中…" @click="submit">登录</van-button>

      <p class="t-xs tip">账号由所在劳务公司管理员在「公司后台 · 成员管理」中添加。<br />新公司入驻请使用电脑访问公司后台。</p>
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
.login { min-height: 100vh; background: var(--surface); }
.brand { padding: calc(40px + env(safe-area-inset-top)) 22px 28px; color: #fff; background: linear-gradient(165deg, #1D2733 0%, #0D1117 60%); }
.brand h2 { margin-top: 16px; font-family: var(--f-dis); font-size: 28px; font-weight: 700; }
.brand p { margin-top: 6px; font-size: 13px; color: rgba(255, 255, 255, .6); }
.body { padding: 4px 20px calc(24px + env(safe-area-inset-bottom)); }
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
.submit { margin-top: 28px; }
.tip { margin-top: 16px; text-align: center; line-height: 1.7; }
</style>
