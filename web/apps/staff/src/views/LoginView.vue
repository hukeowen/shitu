<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showDialog, showToast, type FieldInstance } from 'vant'
import { errorMessage, tenantApi } from '@shitu/api-client'
import { BrandMark, IconCircleExclamationPoint } from '@shitu/ui-icons'
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
const codeInput = ref<FieldInstance | null>(null)
/** 登录没成功的原因：留在登录按钮上方，轻提示消失后还看得到 */
const formError = ref('')

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

const digits = (v: string) => v.replace(/\D/g, '')
function fail(msg: string) {
  formError.value = msg
  showToast(msg)
}

function sendCode() {
  if (!phoneValid.value) return showToast('请输入正确的 11 位手机号')
  void sms.send(phone.value)
}

async function submit() {
  if (submitting.value) return
  if (!phoneValid.value) return fail('请输入正确的 11 位手机号')
  if (!/^\d{6}$/.test(code.value)) return fail('请输入 6 位短信验证码')
  formError.value = ''
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
    fail(errorMessage(e, '登录失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="body">
      <div class="brand"><BrandMark :size="48" /><span>仕兔</span><span class="status-tag status-tag--info">驻场端</span></div>
      <p class="slogan">报名跟进、到厂确认、确权签约，一部手机搞定</p>

      <h1>成员登录</h1>
      <p class="sub">使用公司为你开通的手机号登录</p>

      <van-field
        v-model="phone"
        class="fld"
        label="手机号码"
        label-align="top"
        type="tel"
        inputmode="numeric"
        maxlength="11"
        autocomplete="tel-national"
        placeholder="请输入成员手机号"
        :formatter="digits"
        :border="false"
      >
        <template #left-icon><span class="cc">+86</span></template>
      </van-field>
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

      <p v-if="formError" class="form-err" role="alert"><IconCircleExclamationPoint :size="16" />{{ formError }}</p>
      <van-button type="primary" block size="large" class="submit" :loading="submitting" loading-text="登录中…" @click="submit">登录</van-button>

      <p class="tip">账号由所在劳务公司管理员在「公司后台 · 成员管理」中添加。<br />新公司入驻请使用电脑访问公司后台。</p>
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
.body { padding: calc(var(--space-8) + env(safe-area-inset-top)) var(--space-page) calc(var(--space-6) + env(safe-area-inset-bottom)); }
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
.fld :deep(.van-field__left-icon) { display: flex; align-items: center; height: var(--control-height); margin-right: 0; padding-left: var(--space-3); border: 1px solid var(--border); border-right: 0; border-radius: var(--radius-control) 0 0 var(--radius-control); }
.fld :deep(.van-field__left-icon + .van-field__value .van-field__body) { border-left: 0; border-radius: 0 var(--radius-control) var(--radius-control) 0; }
.cc { padding-right: var(--space-3); border-right: 1px solid var(--divider); font-size: var(--font-size-section); color: var(--text-2); }
.send { min-width: 104px; height: calc(var(--control-height) - 2px); padding: 0 var(--space-3); border: 0; background: none; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.send:disabled { color: var(--text-placeholder); }
.sent { margin-top: var(--space-2); font-size: var(--font-size-min); color: var(--text-3); }
.form-err { display: flex; align-items: flex-start; gap: var(--space-1); margin-top: var(--space-4); font-size: var(--font-size-body); line-height: 22px; color: var(--danger-text); }
.form-err svg { flex: none; margin-top: 3px; }
.submit { margin-top: var(--space-5); }
.form-err + .submit { margin-top: var(--space-2); }
.tip { margin-top: var(--space-5); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-align: center; }
</style>
