<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules, InputInstance } from 'element-plus'
import { errorMessage, isApiError, logout, opsApi } from '@shitu/api-client'
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
const notice = ref<{ tone: 'danger' | 'warn' | 'ok' | 'info'; text: string } | null>(null)

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
    const tone = isApiError(e, 'AUTH_4009') || isApiError(e, 'AUTH_4006') ? 'warn' : 'danger'
    notice.value = { tone, text: errorMessage(e, '登录失败，请稍后重试') }
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
  <div class="login">
    <section class="hero">
      <div class="brand">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--signal)" />
          <path d="M12 5.5 18 8v4.2c0 3.2-2.5 5.3-6 6.3-3.5-1-6-3.1-6-6.3V8z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
        <b>{{ APP_TITLE }}</b>
        <span class="env">OPS</span>
      </div>
      <div class="slogan">
        <h1>平台中台<br /><em>治理 · 审核 · 留痕</em></h1>
        <p>入驻审核、岗位审核与合同备案、平台账号与权限、关键操作审计日志。</p>
      </div>
      <div class="foot mono">SHITU PLATFORM · V1.0 MVP · 仅限内网访问</div>
    </section>

    <section class="panel">
      <div class="box">
        <template v-if="step === 'login'">
          <div class="eyebrow mono">SIGN IN</div>
          <h2>登录运营中台</h2>
          <p class="sub">使用平台账号登录。连续 5 次密码错误将锁定 15 分钟。</p>
          <div v-if="notice" class="notice" :class="`notice--${notice.tone}`">{{ notice.text }}</div>
          <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="form" @submit.prevent="submit">
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
                  <span v-else class="t-xs">{{ captcha.loading ? '加载中…' : captcha.error || '点击获取' }}</span>
                </button>
              </div>
            </el-form-item>
            <el-button type="primary" native-type="submit" class="btn" :loading="submitting">登 录</el-button>
          </el-form>
        </template>

        <template v-else>
          <div class="eyebrow mono">CHANGE PASSWORD</div>
          <h2>修改密码</h2>
          <p class="sub">账号 <b class="mono">{{ auth.me?.username }}</b>（{{ auth.me?.displayName }}）· 修改成功后需重新登录。</p>
          <div v-if="notice" class="notice" :class="`notice--${notice.tone}`">{{ notice.text }}</div>
          <div class="form">
            <ChangePasswordForm submit-text="修改密码并重新登录" @success="onPasswordChanged" />
          </div>
          <el-button link class="switch" @click="switchAccount">使用其他账号登录</el-button>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(420px, 1fr); background: var(--paper); }
.hero {
  position: relative; display: flex; flex-direction: column; justify-content: space-between; padding: 36px 44px; color: #fff; overflow: hidden;
  background:
    linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px) 0 0 / 28px 28px,
    linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px) 0 0 / 28px 28px,
    var(--chrome);
}
.hero::after { content: ""; position: absolute; right: -120px; bottom: -120px; width: 360px; height: 360px; border-radius: 50%; border: 1px solid rgba(232, 89, 12, .35); box-shadow: 0 0 0 40px rgba(232, 89, 12, .05), 0 0 0 80px rgba(232, 89, 12, .03); }
.brand { display: flex; align-items: center; gap: 10px; }
.brand b { font-family: var(--f-dis); font-size: 18px; letter-spacing: .02em; }
.env { font-family: var(--f-mono); font-size: 9px; letter-spacing: .1em; border: 1px solid rgba(255, 255, 255, .22); color: rgba(255, 255, 255, .6); padding: 1px 5px; border-radius: 3px; }
.slogan h1 { margin: 0; font-family: var(--f-dis); font-size: 40px; line-height: 1.25; font-weight: 700; }
.slogan h1 em { font-style: normal; color: var(--signal-300); font-size: 28px; }
.slogan p { margin: 14px 0 0; max-width: 420px; font-size: 13.5px; line-height: 1.8; color: rgba(255, 255, 255, .6); }
.foot { font-size: 10.5px; letter-spacing: .12em; color: rgba(255, 255, 255, .35); }
.panel { display: grid; place-items: center; padding: 32px; }
.box { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--sh-2); padding: 30px 30px 26px; }
.eyebrow { font-size: 10px; letter-spacing: .16em; color: var(--signal-700); }
h2 { margin: 6px 0 4px; font-family: var(--f-dis); font-size: 22px; color: var(--ink-900); }
.sub { margin: 0 0 16px; font-size: 12.5px; color: var(--ink-500); line-height: 1.6; }
.notice { margin-bottom: 14px; }
.form { margin-top: 4px; }
.cap-row { display: flex; gap: 10px; width: 100%; }
.cap { flex: none; width: 120px; height: 32px; padding: 0; border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--surface-2); cursor: pointer; overflow: hidden; display: grid; place-items: center; }
.cap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.btn { width: 100%; height: 38px; margin-top: 6px; font-size: 14px; }
.switch { margin-top: 12px; }
@media (max-width: 900px) { .login { grid-template-columns: 1fr; } .hero { display: none; } }
</style>
