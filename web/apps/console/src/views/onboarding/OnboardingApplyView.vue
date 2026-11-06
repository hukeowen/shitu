<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type UploadedFile } from '@shitu/api-client'
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
  submitting.value = true
  try {
    const r = await tenantApi.onboardingApply(onboarding.ticket, req)
    auth.accessToken = r.accessToken
    onboarding.clear()
    await meStore.load()
    ElMessage.success('入驻申请已提交，平台将在 1–2 个工作日内完成审核')
    router.replace('/onboarding/status')
  } catch (e) {
    ElMessage.error(errorMessage(e))
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
  <AuthShell wide>
    <div class="box">
      <div class="eyebrow">ONBOARDING · 入驻申请</div>
      <h2>劳务公司入驻申请</h2>
      <p class="t-sm sub">
        手机号 <b class="mono strong">{{ onboarding.phoneMasked || '—' }}</b> 尚未加入任何公司。提交后你将成为该公司的<b class="strong">老板</b>账号，审核通过后即可使用全部功能。
      </p>
      <div class="note note--warn" style="margin-bottom: 18px">
        请在 <b>{{ minutesLeft }} 分钟</b>内完成提交（凭证 30 分钟有效）。资料须与营业执照一致；虚假资料将被驳回并记入诚信档案。
      </div>

      <CompanyForm ref="formRef" :upload="upload" />

      <div class="actions">
        <el-button @click="back">返回登录</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交入驻申请</el-button>
      </div>
    </div>
  </AuthShell>
</template>

<style scoped>
.box { width: 680px; max-width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--sh-2); padding: 30px 30px 24px; }
h2 { margin: 8px 0 6px; font-family: var(--f-dis); font-size: 24px; color: var(--ink-900); }
.sub { margin-bottom: 14px; line-height: 1.7; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
