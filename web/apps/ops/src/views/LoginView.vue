<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules, InputInstance } from 'element-plus'
import { errorMessage, isApiError, logout, opsApi } from '@shitu/api-client'
import { BrandMark } from '@shitu/ui-icons'
import ChangePasswordForm from '@/components/ChangePasswordForm.vue'
import { APP_TITLE, HOME_PATH } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'

/** 平台中台登录：用户名 + 密码 + 图形验证码；首次登录 / 被重置后强制改密 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const step = ref<'login' | 'change'>('login')
const formRef = ref<FormInstance>()
const captchaInput = ref<InputInstance>()
const form = reactive({ username: '', password: '', captchaCode: '' })
const captcha = reactive({ id: '', image: '', loading: false, error: '' })
const submitting = ref(false)
const notice = ref<{ tone: 'warn' | 'ok' | 'info'; text: string } | null>(null)
/** 登录被拒的原因：留在主按钮上方，下一次提交时清掉 */
const formError = ref('')

const rules: FormRules<typeof form> = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  captchaCode: [{ required: true, message: '请输入图形验证码', trigger: 'blur' }],
}

async function loadCaptcha() {
  captcha.loading = true
  captcha.error = ''
  try {
    const c = await opsApi.captcha()
    captcha.id = c.captchaId
    captcha.image = c.imageBase64
  } catch (e) {
    captcha.error = errorMessage(e, '验证码加载失败')
  } finally {
    captcha.loading = false
  }
}

function redirectTarget(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('/login') ? r : HOME_PATH
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  submitting.value = true
  notice.value = null
  formError.value = ''
  try {
    const res = await opsApi.login({
      username: form.username.trim(),
      password: form.password,
      captchaId: captcha.id,
      captchaCode: form.captchaCode.trim(),
    })
    auth.accessToken = res.accessToken
    auth.sessionChecked = true
    const me = await auth.loadMe()
    if (res.mustChangePassword || me.mustChangePassword) {
      step.value = 'change'
      notice.value = { tone: 'warn', text: '首次登录或密码已被重置，请先修改密码后再使用系统。' }
      return
    }
    await router.replace(redirectTarget())
  } catch (e) {
    // 验证码一次性：失败后必须换一张
    form.captchaCode = ''
    loadCaptcha()
    formError.value = errorMessage(e, '登录失败，请稍后重试')
    if (isApiError(e, 'AUTH_4005')) captchaInput.value?.focus()
    if (isApiError(e, 'AUTH_4008')) form.password = ''
  } finally {
    submitting.value = false
  }
}

function onPasswordChanged() {
  // 服务端已吊销全部会话
  auth.clear()
  step.value = 'login'
  form.password = ''
  form.captchaCode = ''
  notice.value = { tone: 'ok', text: '密码修改成功，请使用新密码重新登录。' }
  loadCaptcha()
}

async function switchAccount() {
  try {
    await logout()
  } finally {
    auth.clear()
    step.value = 'login'
    notice.value = null
    formError.value = ''
    loadCaptcha()
  }
}

onMounted(() => {
  if (auth.accessToken && auth.me?.mustChangePassword) {
    step.value = 'change'
    notice.value = { tone: 'warn', text: '首次登录或密码已被重置，请先修改密码后再使用系统。' }
    return
  }
  if (auth.accessToken && auth.me) {
    router.replace(redirectTarget())
    return
  }
  if (route.query.changed) notice.value = { tone: 'ok', text: '密码修改成功，请使用新密码重新登录。' }
  else if (route.query.expired) notice.value = { tone: 'info', text: '登录已失效，请重新登录。' }
  loadCaptcha()
})
</script>

<template>
  <main class="login">
    <div class="login-card">
      <div class="brand">
        <BrandMark :size="32" />
        <b>{{ APP_TITLE }}</b>
      </div>
      <template v-if="step === 'login'">
        <h1>登录运营中台</h1>
        <p class="sub">使用平台账号登录。连续 5 次密码错误将锁定 15 分钟。</p>
        <div v-if="notice" class="notice-bar ntc" :class="`notice-bar--${notice.tone}`" role="status">{{ notice.text }}</div>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="form-roomy" @submit.prevent="submit">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" autocomplete="username" maxlength="32" placeholder="请输入用户名" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" show-password autocomplete="current-password" placeholder="请输入密码" />
          </el-form-item>
          <el-form-item label="图形验证码" prop="captchaCode">
            <div class="cap-row">
              <el-input ref="captchaInput" v-model="form.captchaCode" maxlength="6" placeholder="请输入右侧字符" />
              <button type="button" class="cap" title="看不清？点击换一张" :disabled="captcha.loading" @click="loadCaptcha">
                <img v-if="captcha.image && !captcha.error" :src="captcha.image" alt="图形验证码" />
                <span v-else>{{ captcha.loading ? '加载中…' : captcha.error ? `${captcha.error}，点击重试` : '点击获取' }}</span>
              </button>
            </div>
          </el-form-item>
          <p v-if="formError" class="form-err" role="alert">{{ formError }}</p>
          <el-button type="primary" native-type="submit" size="large" class="btn" :loading="submitting">登录</el-button>
        </el-form>
        <p class="tip">仕兔平台运营中台 · 仅限内网访问</p>
      </template>

      <template v-else>
        <h1>首次登录 · 修改密码</h1>
        <p class="sub">账号 <b>{{ auth.me?.username }}</b>（{{ auth.me?.displayName }}）· 修改成功后需重新登录。</p>
        <div v-if="notice" class="notice-bar ntc" :class="`notice-bar--${notice.tone}`" role="status">{{ notice.text }}</div>
        <ChangePasswordForm submit-text="修改密码并重新登录" @success="onPasswordChanged" />
        <div class="switch"><el-button link type="primary" @click="switchAccount">使用其他账号登录</el-button></div>
      </template>
    </div>
  </main>
</template>

<style scoped>
/* 规范第 12 类：页面底色上居中一张宽约 400 的白卡片，从上到下品牌标、标题、表单、通栏主按钮（同 console 登录页） */
.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--space-8) var(--space-6); background: var(--bg-page); }
.login-card { width: 400px; max-width: 100%; padding: var(--space-8); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-card); }
.brand { display: flex; align-items: center; gap: var(--space-2); }
.brand b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
h1 { margin: var(--space-6) 0 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.sub { margin: var(--space-2) 0 var(--space-6); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
.sub b { color: var(--text-1); font-weight: var(--font-weight-medium); }
.ntc { margin: calc(-1 * var(--space-2)) 0 var(--space-4); }
.cap-row { display: flex; gap: var(--space-2); width: 100%; }
.cap-row .el-input { flex: 1; min-width: 0; }
.cap { flex: none; width: 112px; height: var(--control-height); padding: 0 var(--space-1); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); cursor: pointer; overflow: hidden; display: grid; place-items: center; font-family: inherit; font-size: var(--font-size-min); line-height: 1.3; color: var(--text-3); }
.cap:disabled { cursor: progress; }
.cap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.form-err { margin-bottom: var(--space-3); }
.btn { width: 100%; margin-top: var(--space-1); }
.tip { margin: var(--space-6) 0 0; padding-top: var(--space-4); border-top: 1px solid var(--divider); font-size: var(--font-size-min); color: var(--text-3); text-align: center; }
.switch { margin-top: var(--space-4); text-align: center; }
</style>
