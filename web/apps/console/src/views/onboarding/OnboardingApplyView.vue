<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type UploadedFile } from '@shitu/api-client'
import { IconClock } from '@shitu/ui-icons'
import AuthShell from '@/layout/AuthShell.vue'
import CompanyForm from '@/components/CompanyForm.vue'
import { useAuthStore } from '@/stores/auth'
import { useMeStore } from '@/stores/me'
import { useOnboardingStore } from '@/stores/onboarding'

/** 入驻申请：凭 onboardingTicket 上传执照并提交，成功即以老板身份登录 */
const router = useRouter()
const auth = useAuthStore()
const meStore = useMeStore()
const onboarding = useOnboardingStore()

const formRef = ref<InstanceType<typeof CompanyForm>>()
const submitting = ref(false)
/** 提交被拒的原因：轻提示之外留在底部按钮上方 */
const submitError = ref('')
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const minutesLeft = computed(() => Math.max(0, Math.ceil((onboarding.expiresAt - now.value) / 60000)))

onMounted(() => {
  if (!onboarding.valid) {
    ElMessage.warning('入驻申请凭证已失效，请重新登录')
    router.replace('/login')
    return
  }
  timer = setInterval(() => (now.value = Date.now()), 15_000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

function upload(file: File): Promise<UploadedFile> {
  if (!onboarding.ticket) return Promise.reject(new Error('入驻申请凭证已失效，请重新登录'))
  return tenantApi.onboardingUpload(onboarding.ticket, file)
}

async function submit() {
  const req = await formRef.value?.collect()
  if (!req || !onboarding.ticket) return
  if (!onboarding.valid) {
    ElMessage.warning('入驻申请凭证已过期（30 分钟），请重新登录后再提交')
    router.replace('/login')
    return
  }
  submitError.value = ''
  submitting.value = true
  try {
    const r = await tenantApi.onboardingApply(onboarding.ticket, req)
    auth.accessToken = r.accessToken
    onboarding.clear()
    await meStore.load()
    ElMessage.success('入驻申请已提交，平台将在 1–2 个工作日内完成审核')
    router.replace('/onboarding/status')
  } catch (e) {
    submitError.value = errorMessage(e)
    submitting.value = false
    ElMessage.error(submitError.value)
  } finally {
    submitting.value = false
  }
}

function back() {
  onboarding.clear()
  router.replace('/login')
}
</script>

<template>
  <AuthShell>
    <div class="hd">
      <h2>劳务公司入驻申请</h2>
      <p class="sub">
        手机号 <b>{{ onboarding.phoneMasked || '—' }}</b> 尚未加入任何公司。提交后你将成为该公司的<b>老板</b>账号，审核通过后即可使用全部功能。
      </p>
      <div class="tipbar" role="note">
        <IconClock :size="18" class="tipbar-i" />
        <span>请在 <b>{{ minutesLeft }} 分钟</b>内完成提交（凭证 30 分钟有效）。资料须与营业执照一致；虚假资料将被驳回并记入诚信档案。</span>
      </div>
    </div>

    <div class="bd">
      <CompanyForm ref="formRef" :upload="upload" />
    </div>

    <div class="ft">
      <p v-if="submitError" class="form-err" role="alert">提交没有成功：{{ submitError }}</p>
      <div class="actions">
        <el-button @click="back">返回登录</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交入驻申请</el-button>
      </div>
    </div>
  </AuthShell>
</template>

<style scoped>
.hd { padding: var(--space-6) var(--space-6) 0; }
h2 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.sub { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 1.7; color: var(--text-2); }
.sub b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.tipbar { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-control); background: var(--warning-soft); color: var(--text-1); font-size: var(--font-size-aux); line-height: 1.6; }
.tipbar-i { flex: none; margin-top: 1px; color: var(--warning-text); }
.bd { padding: var(--space-6); }
.ft { padding: var(--space-4) var(--space-6); border-top: 1px solid var(--divider); }
.form-err { margin: 0 0 var(--space-3); font-size: var(--font-size-aux); line-height: 1.6; color: var(--danger-text); text-align: right; }
.actions { display: flex; justify-content: flex-end; }
</style>
