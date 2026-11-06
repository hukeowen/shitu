<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, isApiError, tenantApi } from '@shitu/api-client'
import AuthShell from '@/layout/AuthShell.vue'
import { useSmsCountdown } from '@/composables/useSmsCountdown'
import { useAuthStore } from '@/stores/auth'
import { useMeStore } from '@/stores/me'
import { useOnboardingStore } from '@/stores/onboarding'
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
    ElMessage.error(errorMessage(e, '图形验证码加载失败'))
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
    if (isApiError(e, 'AUTH_4004') || isApiError(e, 'AUTH_4005')) {
      ElMessage.warning(errorMessage(e))
      await loadCaptcha()
    } else {
      ElMessage.error(errorMessage(e))
    }
  } finally {
    sending.value = false
  }
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
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
      ElMessage.error('登录失败，请稍后重试')
    }
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthShell>
    <div class="box">
      <div class="eyebrow">SIGN IN</div>
      <h2>登录劳务工作台</h2>
      <p class="t-sm sub">使用成员手机号登录；新公司登录后可直接提交入驻申请</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @submit.prevent="submit">
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

        <el-button type="primary" native-type="submit" class="btn" :loading="submitting">登录</el-button>
      </el-form>

      <div class="note note--info tip">
        登录即表示同意《仕兔平台企业服务协议》。成员账号由公司老板在「组织与权限」中添加；停用或角色变更后需重新登录。
      </div>
    </div>
  </AuthShell>
</template>

<style scoped>
.box { width: 380px; max-width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--sh-2); padding: 32px 30px 26px; }
h2 { margin: 8px 0 6px; font-family: var(--f-dis); font-size: 24px; color: var(--ink-900); }
.sub { margin-bottom: 22px; }
.cap { display: flex; gap: 10px; width: 100%; }
.cap .el-input { flex: 1; }
.cap img { width: 120px; height: 40px; border: 1px solid var(--line-2); border-radius: var(--r-sm); cursor: pointer; object-fit: cover; flex: none; }
.send { width: 120px; flex: none; }
.btn { width: 100%; margin-top: 6px; }
.tip { margin-top: 18px; font-size: 11.5px; }
</style>
