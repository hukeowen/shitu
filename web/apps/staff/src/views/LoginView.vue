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
      <div class="glow" />
      <div class="top">
        <BrandMark :size="40" />
        <span class="tag">驻场端</span>
      </div>
      <h2>仕兔驻场</h2>
      <p>报名跟进、到厂确认、确权签约，一部手机搞定</p>
      <div class="chips" aria-hidden="true">
        <span><b>24h</b>响应提醒</span>
        <span><b>扫码</b>电子签约</span>
        <span><b>一键</b>流转经纪人</span>
      </div>
    </header>

    <div class="body sheet">
      <h3>成员登录</h3>
      <p class="hint">使用公司为你开通的手机号登录</p>
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
.login { min-height: 100vh; display: flex; flex-direction: column; background: linear-gradient(170deg, #1E2834 0%, #0F141B 55%, #1C130E 100%); }

/* ------------------------------------------------------------ 顶部品牌区 */
.brand { position: relative; overflow: hidden; padding: calc(28px + env(safe-area-inset-top)) 24px 34px; color: #fff; }
.glow { position: absolute; width: 300px; height: 300px; right: -110px; top: -90px; border-radius: 50%; background: rgba(232, 89, 12, .45); filter: blur(60px); pointer-events: none; }
.top { position: relative; display: flex; align-items: center; justify-content: space-between; }
.tag { font-size: 12px; color: rgba(255,255,255,.7); padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); }
.brand h2 { position: relative; margin: 26px 0 0; font-family: var(--f-dis); font-size: 32px; font-weight: 700; letter-spacing: .02em; }
.brand p { position: relative; margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: rgba(255,255,255,.66); }
.chips { position: relative; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.chips span { font-size: 12px; color: rgba(255,255,255,.75); padding: 6px 11px; border-radius: 10px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1); }
.chips b { color: #FF9A5C; margin-right: 4px; font-weight: 700; }

/* ------------------------------------------------------------ 表单底板 */
.sheet { flex: 1; background: var(--surface); border-radius: 28px 28px 0 0; padding: 28px 22px calc(28px + env(safe-area-inset-bottom));
  box-shadow: 0 -18px 40px -24px rgba(0,0,0,.5); animation: rise .35s ease-out; }
@keyframes rise { from { transform: translateY(24px); opacity: .4 } to { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
.sheet h3 { margin: 0; font-size: 20px; font-weight: 700; color: var(--ink-900); }
.hint { margin: 4px 0 6px; font-size: 13px; color: var(--ink-500); }
.field { margin-top: 18px; }
.lbl { font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 8px; }
.line { display: flex; align-items: center; gap: 8px; height: 54px; padding: 0 8px 0 16px; border-radius: 16px; background: var(--surface-2);
  border: 1.5px solid transparent; transition: border-color .15s, background .15s, box-shadow .15s; }
.line:focus-within { background: var(--surface); border-color: var(--signal); box-shadow: 0 0 0 4px rgba(232,89,12,.12); }
.cc { font-size: 15px; color: var(--ink-600); padding-right: 10px; border-right: 1px solid var(--line-2); }
.inp { flex: 1; min-width: 0; height: 40px; border: 0; outline: none; background: transparent; padding: 0 4px; font-size: 19px; font-family: var(--f-dis); letter-spacing: .06em; color: var(--ink-900); }
.inp::placeholder { font-family: var(--f-cn); font-size: 15px; letter-spacing: 0; color: var(--ink-300); }
.inp.code { letter-spacing: .3em; }
.send { flex: none; height: 40px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--signal-50); color: var(--signal-700); font-size: 14px; font-weight: 600; }
.send:active:not(:disabled) { background: var(--signal-300); }
.send:disabled { background: var(--surface-3); color: var(--ink-400); }
.sent { margin: 8px 0 0 4px; }
.submit { margin-top: 30px; height: 52px; border: 0; border-radius: 16px; font-size: 17px; font-weight: 700; letter-spacing: .2em;
  background: linear-gradient(135deg, #F07A3A 0%, #E8590C 55%, #C9490A 100%); box-shadow: 0 14px 26px -14px rgba(232,89,12,.9); }
.tip { margin-top: 20px; text-align: center; line-height: 1.8; color: var(--ink-400); }
</style>
