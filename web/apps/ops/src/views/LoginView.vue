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

/** 左侧品牌区的说明文案 */
const POINTS = [
  { t: '入驻与岗位审核', d: '核验营业执照与派遣许可，合同备案后岗位才能上架' },
  { t: '计费与对账', d: '按日结算服务费与流转费，月账单下发、异议复核、登记结算' },
  { t: '风控与合规', d: '投诉核实、诚信分与处罚、实名复核与黑名单' },
  { t: '全程留痕', d: '登录、审核、处罚、参数发布等关键操作全部写入审计日志' },
]

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
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--signal)" />
          <path d="M12 5.5 18 8v4.2c0 3.2-2.5 5.3-6 6.3-3.5-1-6-3.1-6-6.3V8z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
        <b>{{ APP_TITLE }}</b>
      </div>

      <div class="slogan">
        <h1>平台治理与审核，<br /><em>每一步都有记录</em></h1>
        <p>面向平台运营、财务与风控团队的工作台。</p>
        <ul class="points">
          <li v-for="p in POINTS" :key="p.t">
            <span class="ck" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </span>
            <div><b>{{ p.t }}</b><span>{{ p.d }}</span></div>
          </li>
        </ul>
      </div>

      <div class="foot">仅限内网访问 · 已启用 IP 白名单 · 关键操作全程审计</div>
    </section>

    <section class="panel">
      <div class="box">
        <template v-if="step === 'login'">
          <div class="hi">平台账号</div>
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
            <el-button type="primary" native-type="submit" class="btn" :loading="submitting">登录</el-button>
          </el-form>
        </template>

        <template v-else>
          <div class="hi">首次登录</div>
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
.login { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(460px, 1fr); background: var(--paper); }

/* ------------------------------------------------------------ 品牌区（浅色，与后台主题一致） */
.hero {
  position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; padding: 40px 56px; overflow: hidden;
  background: linear-gradient(160deg, var(--surface) 0%, var(--signal-50) 100%); border-right: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand b { font-size: 18px; font-weight: 650; color: var(--ink-900); letter-spacing: -.01em; }
.slogan { max-width: 520px; }
.slogan h1 { margin: 0; font-size: 34px; line-height: 1.35; font-weight: 650; letter-spacing: -.01em; color: var(--ink-900); }
.slogan h1 em { font-style: normal; color: var(--signal); }
.slogan p { margin: 14px 0 0; font-size: 15px; line-height: 1.8; color: var(--ink-500); }
.points { list-style: none; margin: 32px 0 0; padding: 0; display: grid; gap: 12px; }
.points li { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--sh-1); }
.ck { flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; background: var(--signal-50); color: var(--signal); }
.points b { display: block; font-size: 14.5px; font-weight: 600; color: var(--ink-900); }
.points li span:not(.ck) { display: block; margin-top: 2px; font-size: 13px; line-height: 1.6; color: var(--ink-500); }
.foot { font-size: 12.5px; color: var(--ink-400); }

/* ------------------------------------------------------------ 表单区 */
.panel { display: grid; place-items: center; padding: 48px 24px; background: var(--paper); }
.box { width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 40px 40px 32px; box-shadow: var(--sh-2); }
.hi { font-size: 13px; color: var(--signal-700); font-weight: 600; }
h2 { margin: 6px 0 8px; font-size: 24px; font-weight: 650; letter-spacing: -.01em; color: var(--ink-900); }
.sub { margin: 0 0 24px; font-size: 13px; color: var(--ink-500); line-height: 1.7; }
.notice { margin-bottom: 16px; }
.form { margin-top: 4px; }
.box :deep(.el-form-item__label) { font-weight: 600; color: var(--ink-700); padding-bottom: 6px; }
.box :deep(.el-input__wrapper) { height: 44px; border-radius: 10px; background: var(--surface); box-shadow: 0 0 0 1px var(--line-2) inset; transition: box-shadow .15s; }
.box :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px var(--ink-300) inset; }
.box :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--signal) inset, 0 0 0 3px var(--signal-50); }
.box :deep(.el-form-item.is-error .el-input__wrapper) { box-shadow: 0 0 0 1.5px var(--el-color-danger) inset; }
.cap-row { display: flex; gap: 10px; width: 100%; }
.cap { flex: none; width: 124px; height: 44px; padding: 0; border: 1px solid var(--line-2); border-radius: 10px; background: var(--surface-2); cursor: pointer; overflow: hidden; display: grid; place-items: center; }
.cap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.btn, .box :deep(.el-button--primary) { width: 100%; height: 44px; margin-top: 10px; border-radius: 10px; font-size: 15px; font-weight: 600; }
.switch { margin-top: 14px; }
@media (max-width: 900px) { .login { grid-template-columns: 1fr; } .hero { display: none; } }
</style>
