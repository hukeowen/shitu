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
      </div>
      <div class="glow g1" />
      <div class="glow g2" />
      <div class="slogan">
        <div class="pill"><i />平台运营中台</div>
        <h1>治理 · 审核<br /><em>每一步都留痕</em></h1>
        <p>入驻与岗位审核、合同备案、计费对账、风控处罚、实名复核，关键操作全部进入审计日志。</p>

        <div class="console" aria-hidden="true">
          <div class="c-hd"><span /><span /><span /><b class="mono">audit.log</b></div>
          <div class="c-body mono">
            <p><time>09:12:04</time><em class="ok">APPROVE</em>公司入驻 · 仕兔演示劳务</p>
            <p><time>09:15:31</time><em class="ok">APPROVE</em>岗位上架 · SMT 操作工</p>
            <p><time>09:21:08</time><em class="warn">PENALTY</em>二级处罚 · 限流 30 天</p>
            <p><time>09:26:47</time><em class="info">PUBLISH</em>匹配引擎参数 v3</p>
            <p class="cur"><time>09:30:12</time><em class="ok">LOGIN</em>admin<i class="caret" /></p>
          </div>
        </div>

        <div class="guards">
          <span><b>内网</b>域名访问</span><span><b>IP</b>白名单</span><span><b>全量</b>操作审计</span>
        </div>
      </div>
      <div class="foot mono">仕兔平台运营中台 · 仅限内网访问</div>
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
            <el-button type="primary" native-type="submit" class="btn" :loading="submitting">登 录</el-button>
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

/* ------------------------------------------------------------ 品牌区 */
.hero {
  position: relative; isolation: isolate; display: flex; flex-direction: column; justify-content: space-between; padding: 36px 48px; color: #fff; overflow: hidden;
  background: linear-gradient(155deg, #141A22 0%, #0E1217 60%, #181310 100%);
}
.hero::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 32px 32px;
  mask-image: radial-gradient(ellipse 75% 65% at 35% 45%, #000 30%, transparent 75%);
}
.glow { position: absolute; border-radius: 50%; filter: blur(80px); z-index: -1; pointer-events: none; }
.g1 { width: 460px; height: 460px; right: -180px; bottom: -200px; background: rgba(232, 89, 12, .32); }
.g2 { width: 320px; height: 320px; left: -120px; top: -100px; background: rgba(76, 110, 160, .2); }
.brand { display: flex; align-items: center; gap: 10px; }
.brand b { font-family: var(--f-dis); font-size: 18px; letter-spacing: .02em; }
.env { font-family: var(--f-mono); font-size: 9px; letter-spacing: .12em; border: 1px solid rgba(255,255,255,.2); color: rgba(255,255,255,.55); padding: 1px 6px; border-radius: 4px; }
.pill { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: .14em; color: var(--signal-300);
  padding: 5px 12px 5px 10px; border-radius: 999px; background: rgba(232,89,12,.12); border: 1px solid rgba(232,89,12,.28); }
.pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); box-shadow: 0 0 0 4px rgba(232,89,12,.25); }
.slogan h1 { margin: 20px 0 0; font-family: var(--f-dis); font-size: 42px; line-height: 1.22; font-weight: 700; }
.slogan h1 em { font-style: normal; background: linear-gradient(90deg, #FF9A5C, #E8590C); -webkit-background-clip: text; background-clip: text; color: transparent; }
.slogan p { margin: 14px 0 0; max-width: 460px; font-size: 14px; line-height: 1.8; color: rgba(255,255,255,.6); }

.console { margin: 34px 0 26px; max-width: 470px; border-radius: 14px; overflow: hidden; background: rgba(8, 11, 15, .72);
  border: 1px solid rgba(255,255,255,.1); box-shadow: 0 30px 60px -24px rgba(0,0,0,.7); backdrop-filter: blur(10px); }
.c-hd { display: flex; align-items: center; gap: 6px; padding: 10px 14px; background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.06); }
.c-hd span { width: 9px; height: 9px; border-radius: 50%; }
.c-hd span:nth-child(1) { background: #FF6B57; }
.c-hd span:nth-child(2) { background: #F5B33E; }
.c-hd span:nth-child(3) { background: #3DD68C; }
.c-hd b { margin-left: 8px; font-size: 11px; font-weight: 500; color: rgba(255,255,255,.45); }
.c-body { padding: 12px 16px 14px; font-size: 12px; line-height: 2; }
.c-body p { margin: 0; display: flex; gap: 10px; align-items: center; color: rgba(255,255,255,.72); white-space: nowrap; overflow: hidden; }
.c-body time { color: rgba(255,255,255,.35); }
.c-body em { font-style: normal; font-size: 10.5px; letter-spacing: .06em; padding: 0 6px; border-radius: 4px; line-height: 18px; }
.c-body .ok { color: #3DD68C; background: rgba(61,214,140,.12); }
.c-body .warn { color: #FFB25C; background: rgba(255,178,92,.12); }
.c-body .info { color: #8FB7FF; background: rgba(143,183,255,.12); }
.c-body .cur { color: #fff; }
.caret { width: 7px; height: 14px; background: var(--signal); animation: blink 1.1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .caret { animation: none; } }
.guards { display: flex; flex-wrap: wrap; gap: 8px; }
.guards span { font-size: 12px; color: rgba(255,255,255,.62); padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); }
.guards b { color: #fff; margin-right: 4px; font-weight: 600; }
.foot { font-size: 10.5px; letter-spacing: .12em; color: rgba(255,255,255,.32); }

/* ------------------------------------------------------------ 表单区 */
.panel { display: grid; place-items: center; padding: 48px 24px; background: radial-gradient(rgba(16,20,26,.07) 1px, transparent 1px) 0 0 / 22px 22px, var(--paper); }
.box { width: 100%; max-width: 420px; background: var(--surface); border-radius: 20px; padding: 40px 40px 32px;
  box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 30px 70px -30px rgba(13,17,23,.35), 0 0 0 1px rgba(13,17,23,.06); }
.hi { font-size: 13px; color: var(--signal-700); font-weight: 600; }
h2 { margin: 6px 0 8px; font-family: var(--f-dis); font-size: 28px; color: var(--ink-900); }
.sub { margin: 0 0 24px; font-size: 13px; color: var(--ink-500); line-height: 1.7; }
.notice { margin-bottom: 16px; }
.form { margin-top: 4px; }
.box :deep(.el-form-item__label) { font-weight: 600; color: var(--ink-700); padding-bottom: 6px; }
.box :deep(.el-input__wrapper) { height: 46px; border-radius: 12px; background: var(--surface-2); box-shadow: 0 0 0 1px transparent inset; transition: box-shadow .15s, background .15s; }
.box :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px var(--line-2) inset; }
.box :deep(.el-input__wrapper.is-focus) { background: var(--surface); box-shadow: 0 0 0 1.5px var(--signal) inset, 0 0 0 4px rgba(232,89,12,.12); }
.box :deep(.el-form-item.is-error .el-input__wrapper) { box-shadow: 0 0 0 1.5px var(--el-color-danger) inset; }
.cap-row { display: flex; gap: 10px; width: 100%; }
.cap { flex: none; width: 124px; height: 46px; padding: 0; border: 0; border-radius: 12px; background: var(--surface-2); cursor: pointer; overflow: hidden; display: grid; place-items: center; }
.cap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.btn, .box :deep(.el-button--primary) { width: 100%; height: 48px; margin-top: 10px; border: 0; border-radius: 12px; font-size: 16px; font-weight: 700; letter-spacing: .2em;
  background: linear-gradient(135deg, #F07A3A 0%, #E8590C 55%, #C9490A 100%); box-shadow: 0 12px 24px -12px rgba(232,89,12,.8); }
.btn:hover { filter: brightness(1.05); }
.switch { margin-top: 14px; }
@media (max-width: 1100px) { .console { display: none; } }
@media (max-width: 900px) { .login { grid-template-columns: 1fr; } .hero { display: none; } }
</style>
