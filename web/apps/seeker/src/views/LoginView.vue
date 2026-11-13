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
        ? '仕兔为求职者与劳务公司提供岗位匹配服务，平台不直接雇佣。完整协议以平台正式发布的版本为准。'
        : '我们仅为提供匹配服务收集你的手机号等必要信息，敏感信息加密存储。完整隐私政策以平台正式发布的版本为准。',
    confirmButtonText: '我知道了',
  })
}
</script>

<template>
  <div class="login">
    <header class="lhero">
      <div class="appbar">
        <button type="button" class="ico" aria-label="返回" @click="back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
      <div class="hero-in">
        <div class="copy">
          <h1>找工作<br /><em>先问问薪资</em></h1>
          <p>回答几个问题，马上看到适合你的岗位</p>
        </div>
        <svg class="art" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" fill="#fff" opacity=".55" />
          <rect x="30" y="34" width="60" height="58" rx="12" fill="#fff" />
          <rect x="40" y="46" width="28" height="6" rx="3" fill="#E8590C" />
          <rect x="40" y="58" width="40" height="5" rx="2.5" fill="#F3D4C0" />
          <rect x="40" y="68" width="34" height="5" rx="2.5" fill="#F3D4C0" />
          <circle cx="84" cy="34" r="14" fill="#E8590C" />
          <text x="84" y="39" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">¥</text>
          <circle cx="32" cy="88" r="9" fill="#3DB57D" />
          <path d="M28 88l3 3 5-6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="points">
        <span><i>1</i>手机号直接注册</span>
        <span><i>2</i>实名后才能报名</span>
        <span><i>3</i>顾问一对一跟进</span>
      </div>
    </header>

    <div class="body sheet">
      <h2>{{ fromOld ? '用旧手机号登录' : '手机号登录 / 注册' }}</h2>
      <p class="sub">{{ fromOld ? '请输入当初实名认证时使用的手机号，登录后即可继续' : '没注册过的手机号，验证后自动注册，不用设密码' }}</p>

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
.login { min-height: 100vh; display: flex; flex-direction: column; background: linear-gradient(170deg, #FFE7D6 0%, #FFD2B3 45%, #FBB78E 100%); }

/* ------------------------------------------------------------ 顶部 */
.lhero { position: relative; padding: env(safe-area-inset-top) 0 26px; color: var(--ink-900); overflow: hidden; }
.lhero::after { content: ""; position: absolute; width: 260px; height: 260px; right: -90px; top: -80px; border-radius: 50%; background: rgba(255,255,255,.35); pointer-events: none; }
.appbar { position: relative; z-index: 1; height: 46px; display: flex; align-items: center; padding: 0 10px; }
.ico { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: rgba(255,255,255,.55); color: var(--ink-800); }
.hero-in { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 6px 22px 0; }
.copy { flex: 1; min-width: 0; }
.lhero h1 { margin: 0; font-family: var(--f-dis); font-size: 30px; line-height: 1.25; font-weight: 800; letter-spacing: .02em; }
.lhero h1 em { font-style: normal; color: #C9490A; }
.lhero p { margin: 8px 0 0; font-size: 14px; color: rgba(31, 22, 15, .7); line-height: 1.6; text-wrap: balance; }
.art { flex: none; width: 112px; height: 112px; }
.points { position: relative; z-index: 1; display: flex; gap: 8px; padding: 18px 22px 0; flex-wrap: wrap; }
.points span { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-800); padding: 6px 10px 6px 6px; border-radius: 999px; background: rgba(255,255,255,.62); }
.points i { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 11px; font-weight: 700; color: #fff; background: var(--signal); }

/* ------------------------------------------------------------ 表单底板 */
.sheet { flex: 1; background: var(--surface); border-radius: 28px 28px 0 0; padding: 26px 22px calc(28px + env(safe-area-inset-bottom));
  box-shadow: 0 -16px 36px -24px rgba(120, 50, 10, .45); animation: rise .35s ease-out; }
@keyframes rise { from { transform: translateY(24px); opacity: .4 } to { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
h2 { margin: 0; font-family: var(--f-dis); font-size: 21px; font-weight: 700; color: var(--ink-900); line-height: 1.3; }
.sub { margin: 6px 0 4px; font-size: 13px; line-height: 1.6; color: var(--ink-500); text-wrap: pretty; }
.field { margin-top: 18px; }
.lbl { font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 8px; }
.line { display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 8px 0 16px; border-radius: 16px; background: var(--surface-2);
  border: 1.5px solid transparent; transition: border-color .15s, background .15s, box-shadow .15s; }
.line:focus-within { background: var(--surface); border-color: var(--signal); box-shadow: 0 0 0 4px rgba(232,89,12,.12); }
.cc { font-size: 16px; color: var(--ink-600); padding-right: 10px; border-right: 1px solid var(--line-2); }
.inp { flex: 1; min-width: 0; height: 42px; border: 0; outline: none; background: transparent; padding: 0 4px; font-size: 20px; font-family: var(--f-dis); letter-spacing: .06em; color: var(--ink-900); }
.inp::placeholder { font-family: var(--f-cn); font-size: 16px; letter-spacing: 0; color: var(--ink-300); }
.inp.code { letter-spacing: .3em; }
.send { flex: none; height: 42px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--signal-50); color: var(--signal-700); font-size: 14px; font-weight: 600; }
.send:active:not(:disabled) { background: var(--signal-300); }
.send:disabled { background: var(--surface-3); color: var(--ink-400); }
.sent { margin: 8px 0 0 4px; }
.via { display: flex; gap: 10px; align-items: flex-start; margin-top: 20px; background: var(--signal-50); border: 1px solid rgba(232,89,12,.18); }
.via b { display: block; font-size: 13px; font-weight: 700; color: var(--ink-900); }
.via p { margin-top: 4px; line-height: 1.6; }
.agree { display: flex; align-items: flex-start; gap: 8px; margin-top: 20px; }
.agree :deep(.van-checkbox) { flex: none; margin-top: 1px; }
.agree .t-xs { line-height: 1.6; color: var(--ink-500); }
.agree a { color: var(--signal-700); }
.submit { margin-top: 20px; height: 54px; border: 0; border-radius: 16px; font-size: 17px; font-weight: 700; letter-spacing: .06em;
  background: linear-gradient(135deg, #F07A3A 0%, #E8590C 55%, #C9490A 100%); box-shadow: 0 14px 26px -14px rgba(232,89,12,.9); }
</style>
