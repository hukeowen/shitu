<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, isApiError, tenantApi } from '@shitu/api-client'
import { BrandMark } from '@shitu/ui-icons'
import { useSmsCountdown } from '@/composables/useSmsCountdown'
import { useAuthStore } from '@/stores/auth'
import { useMeStore } from '@/stores/me'
import { useOnboardingStore } from '@/stores/onboarding'
import { APP_TITLE } from '@/router/menu'
import { PHONE_RE } from '@/utils/format'

/** 后台登录：手机号 + 短信验证码；非成员进入入驻申请 */
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const meStore = useMeStore()
const onboarding = useOnboardingStore()
const { remaining, counting, start } = useSmsCountdown()

const formRef = ref<FormInstance>()
const form = reactive({ phone: '', code: '', captchaCode: '' })
const captcha = ref<{ id: string; image: string } | null>(null)
const captchaLoading = ref(false)
const sending = ref(false)
const submitting = ref(false)
/** 发码、登录被拒的原因：轻提示之外留在主按钮上方，下一次操作时清掉 */
const formError = ref('')

const rules: FormRules = {
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: PHONE_RE, message: '请输入正确的 11 位手机号', trigger: 'blur' },
  ],
  code: [
    { required: true, message: '请输入短信验证码', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '验证码为 6 位数字', trigger: 'blur' },
  ],
}

async function loadCaptcha() {
  captchaLoading.value = true
  try {
    const c = await tenantApi.captcha()
    captcha.value = { id: c.captchaId, image: c.imageBase64 }
    form.captchaCode = ''
  } catch (e) {
    formError.value = `图形验证码加载失败：${errorMessage(e)}，点「获取验证码」重试`
    ElMessage.error(formError.value)
  } finally {
    captchaLoading.value = false
  }
}

async function sendCode() {
  const ok = await formRef.value?.validateField('phone').catch(() => false)
  if (!ok) return
  if (captcha.value && !form.captchaCode.trim()) {
    ElMessage.warning('请先输入图形验证码')
    return
  }
  formError.value = ''
  sending.value = true
  try {
    const r = await tenantApi.sendSms({
      phone: form.phone,
      captchaId: captcha.value?.id,
      captchaCode: captcha.value ? form.captchaCode.trim() : undefined,
    })
    start(r.retryAfterSeconds || 60)
    captcha.value = null
    form.captchaCode = ''
    if (r.devCode) {
      form.code = r.devCode
      ElMessage.success(`开发环境验证码：${r.devCode}（已自动填入）`)
    } else {
      ElMessage.success('验证码已发送')
    }
  } catch (e) {
    formError.value = errorMessage(e)
    if (isApiError(e, 'AUTH_4004') || isApiError(e, 'AUTH_4005')) {
      ElMessage.warning(formError.value)
      await loadCaptcha()
    } else {
      ElMessage.error(formError.value)
    }
  } finally {
    sending.value = false
  }
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  formError.value = ''
  submitting.value = true
  try {
    const r = await tenantApi.login(form.phone, form.code)
    if (r.status === 'OK' && r.accessToken) {
      auth.accessToken = r.accessToken
      await meStore.load()
      const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
      router.replace(redirect.startsWith('/') && !redirect.startsWith('/login') ? redirect : '/')
    } else if (r.status === 'NOT_MEMBER' && r.onboardingTicket) {
      onboarding.set(r.onboardingTicket, r.phoneMasked)
      ElMessage.info('该手机号尚未加入任何劳务公司，请先提交入驻申请')
      router.push('/onboarding/apply')
    } else {
      formError.value = '登录失败，请稍后重试'
      ElMessage.error(formError.value)
    }
  } catch (e) {
    formError.value = errorMessage(e)
    submitting.value = false
    ElMessage.error(formError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <div class="login-card">
      <div class="brand">
        <BrandMark :size="32" />
        <b>{{ APP_TITLE }}</b>
      </div>
      <h1>登录劳务工作台</h1>
      <p class="sub">使用成员手机号 + 短信验证码登录。新公司登录后可直接提交入驻申请。</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" maxlength="11" placeholder="请输入 11 位手机号" autocomplete="tel" clearable />
        </el-form-item>

        <el-form-item v-if="captcha" label="图形验证码">
          <div class="cap">
            <el-input v-model="form.captchaCode" maxlength="6" placeholder="请输入右侧字符" />
            <img v-loading="captchaLoading" :src="captcha.image" alt="图形验证码" title="看不清？点击刷新" @click="loadCaptcha" />
          </div>
        </el-form-item>

        <el-form-item label="短信验证码" prop="code">
          <div class="cap">
            <el-input v-model="form.code" maxlength="6" placeholder="6 位数字验证码" autocomplete="one-time-code" />
            <el-button class="send" :disabled="counting" :loading="sending" @click="sendCode">
              {{ counting ? `${remaining}s 后重发` : '获取验证码' }}
            </el-button>
          </div>
        </el-form-item>

        <p v-if="formError" class="form-err" role="alert">{{ formError }}</p>
        <el-button type="primary" native-type="submit" size="large" class="btn" :loading="submitting">登录</el-button>
      </el-form>

      <div class="tip">
        <span>登录即表示同意《仕兔平台企业服务协议》</span>
        <span>成员账号由老板在「组织与权限」中添加</span>
      </div>
    </div>
  </main>
</template>

<style scoped>
.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--space-8) var(--space-6); background: var(--bg-page); }
.login-card { width: 400px; max-width: 100%; padding: var(--space-8); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-card); }
.brand { display: flex; align-items: center; gap: var(--space-2); }
.brand b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
h1 { margin-top: var(--space-6); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.sub { margin: var(--space-2) 0 var(--space-6); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
.cap { display: flex; gap: var(--space-2); width: 100%; }
.cap .el-input { flex: 1; min-width: 0; }
.cap img { width: 112px; height: var(--control-height); flex: none; border: 1px solid var(--border); border-radius: var(--radius-control); cursor: pointer; object-fit: cover; }
.send { width: 112px; flex: none; }
.form-err { margin: 0 0 var(--space-3); font-size: var(--font-size-aux); line-height: 1.6; color: var(--danger-text); }
.btn { width: 100%; margin-top: var(--space-1); }
.tip { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); text-align: center; }
</style>
