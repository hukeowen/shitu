<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, logout, tenantApi, useDict, type CompanyStatus, type UploadedFile } from '@shitu/api-client'
import { BrandMark, IconBan, IconCircleX, IconClock, IconInfo } from '@shitu/ui-icons'
import CompanyForm from '@/components/CompanyForm.vue'
import DictTag from '@/components/DictTag.vue'
import FileLink from '@/components/FileLink.vue'
import { APP_TITLE } from '@/router/menu'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'

/** 入驻进度：公司未通过审核 / 被限制时唯一可访问的页面 */
const router = useRouter()
const meStore = useMeStore()
const { label } = useDict()

const company = computed(() => meStore.me?.company)
const status = computed<CompanyStatus | undefined>(() => company.value?.status)
const editable = computed(() => meStore.isOwner && (status.value === 'PENDING_AUDIT' || status.value === 'REJECTED'))
const editing = ref(false)
const saving = ref(false)
const refreshing = ref(false)
/** 刷新、重新提交被拒的原因：轻提示之外留在页面上，下一次操作时清掉 */
const refreshError = ref('')
const saveError = ref('')
const formRef = ref<InstanceType<typeof CompanyForm>>()

const stepActive = computed(() => {
  switch (status.value) {
    case 'PENDING_AUDIT':
      return 1
    case 'REJECTED':
      return 1
    default:
      return 3
  }
})

const headline = computed(() => {
  switch (status.value) {
    case 'PENDING_AUDIT':
      return { title: '入驻资料审核中', desc: '平台通常在 1–2 个工作日内完成审核，审核通过后即可发布岗位、管理成员。', icon: IconClock, tone: 'warning' }
    case 'REJECTED':
      return { title: '入驻申请被驳回', desc: '请根据驳回原因修改资料后重新提交。', icon: IconCircleX, tone: 'danger' }
    case 'BANNED':
      return { title: '公司账号已被封禁', desc: '封禁期间无法使用业务功能，如有异议请联系平台运营。', icon: IconBan, tone: 'danger' }
    case 'DEREGISTERED':
    case 'BANKRUPT':
      return { title: `公司状态：${label('CompanyStatus', status.value)}`, desc: '该公司已停止运营，业务功能不可用。', icon: IconBan, tone: 'danger' }
    default:
      return { title: `公司状态：${label('CompanyStatus', status.value)}`, desc: '当前状态下业务功能不可用。', icon: IconInfo, tone: 'neutral' }
  }
})

function upload(file: File): Promise<UploadedFile> {
  return tenantApi.upload(file, 'license')
}

async function refresh() {
  refreshError.value = ''
  refreshing.value = true
  try {
    const me = await meStore.load()
    if (me.operational) {
      ElMessage.success('公司已通过审核，欢迎使用')
      router.replace('/')
    }
  } catch (e) {
    refreshError.value = `刷新失败：${errorMessage(e)}`
    refreshing.value = false
    ElMessage.error(refreshError.value)
  } finally {
    refreshing.value = false
  }
}

async function resubmit() {
  const req = await formRef.value?.collect()
  if (!req) return
  saveError.value = ''
  saving.value = true
  try {
    await tenantApi.resubmit(req)
    await meStore.load()
    editing.value = false
    ElMessage.success('资料已重新提交，等待平台审核')
  } catch (e) {
    saveError.value = errorMessage(e)
    saving.value = false
    ElMessage.error(saveError.value)
  } finally {
    saving.value = false
  }
}

function startEdit() {
  saveError.value = ''
  editing.value = true
}

async function doLogout() {
  await logout().catch(() => undefined)
  meStore.clear()
  router.replace('/login')
}
</script>

<template>
  <div class="wrap">
    <header class="top">
      <BrandMark :size="24" />
      <b class="brand">{{ APP_TITLE }}</b>
      <span class="spacer" />
      <span class="who">{{ meStore.me?.name }}</span>
      <el-button @click="doLogout">退出登录</el-button>
    </header>

    <main v-if="company" class="body">
      <section v-loading="refreshing" class="card result">
        <component :is="headline.icon" :size="48" class="result-i" :class="`result-i--${headline.tone}`" />
        <h2>{{ headline.title }}</h2>
        <p>{{ headline.desc }}</p>
        <div class="tags">
          <span class="who-co">{{ company.name }}</span>
          <DictTag type="CompanyStatus" :value="status" />
        </div>
        <div v-if="company.auditRemark || company.statusRemark" class="remark" :class="`remark--${headline.tone}`">
          <div v-if="company.auditRemark"><b>审核意见：</b>{{ company.auditRemark }}</div>
          <div v-if="company.statusRemark"><b>状态说明：</b>{{ company.statusRemark }}</div>
        </div>
        <div class="acts">
          <!-- 一屏一个主按钮：老板能改资料时主按钮是「修改并重新提交」（编辑中是表单里的「重新提交审核」），否则是「刷新状态」 -->
          <el-button :type="editable ? undefined : 'primary'" :loading="refreshing" @click="refresh">刷新状态</el-button>
          <el-button v-if="editable && !editing" type="primary" @click="startEdit">修改并重新提交</el-button>
        </div>
        <p v-if="refreshError" class="form-err" role="alert">{{ refreshError }}</p>
      </section>

      <section class="card">
        <div class="card__bd">
          <el-steps :active="stepActive" finish-status="success" align-center>
            <el-step title="提交申请" :description="fmtDateTime(company.submittedAt)" />
            <el-step title="平台审核" :status="status === 'REJECTED' ? 'error' : undefined" :description="status === 'REJECTED' ? '已驳回' : status === 'PENDING_AUDIT' ? '审核中' : fmtDateTime(company.auditedAt)" />
            <el-step title="开通使用" />
          </el-steps>
        </div>
      </section>

      <section class="card">
        <div class="card__hd">
          <h3>{{ editing ? '修改入驻资料' : '入驻资料' }}</h3>
        </div>
        <div class="card__bd">
          <template v-if="editing">
            <CompanyForm ref="formRef" :upload="upload" :initial="company" viewable />
            <p v-if="saveError" class="form-err form-err--r" role="alert">提交没有成功：{{ saveError }}</p>
            <div class="form-acts">
              <el-button @click="editing = false">取消</el-button>
              <el-button type="primary" :loading="saving" @click="resubmit">重新提交审核</el-button>
            </div>
          </template>
          <template v-else>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="公司全称">{{ company.name }}</el-descriptions-item>
              <el-descriptions-item label="公司简称">{{ company.shortName || '—' }}</el-descriptions-item>
              <el-descriptions-item label="统一社会信用代码"><span class="code">{{ company.unifiedCreditCode }}</span></el-descriptions-item>
              <el-descriptions-item label="劳务派遣许可证">{{ company.dispatchLicenseNo || '—' }}</el-descriptions-item>
              <el-descriptions-item label="联系人">{{ company.contactName }} {{ company.contactPhone }}</el-descriptions-item>
              <el-descriptions-item label="提交时间">{{ fmtDateTime(company.submittedAt) }}</el-descriptions-item>
              <el-descriptions-item label="营业执照 / 许可证" :span="2">
                <template v-if="company.licenseFiles?.length">
                  <FileLink v-for="(k, i) in company.licenseFiles" :key="k" :file-key="k" :label="`文件 ${i + 1}`" />
                </template>
                <span v-else class="none">未上传</span>
              </el-descriptions-item>
            </el-descriptions>
            <p v-if="!meStore.isOwner" class="hint">仅公司老板可修改入驻资料。</p>
          </template>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.wrap { min-height: 100vh; background: var(--bg-page); }
.top { height: 56px; display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-6); background: var(--bg-card); border-bottom: 1px solid var(--border); }
.top .brand { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.top .who { font-size: var(--font-size-aux); color: var(--text-2); }
.body { max-width: 880px; margin: 0 auto; padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-gap); }
.result { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) var(--space-6); text-align: center; }
.result-i { color: var(--text-3); }
.result-i--warning { color: var(--warning-text); }
.result-i--danger { color: var(--danger-text); }
.result h2 { margin-top: var(--space-2); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.result p { font-size: var(--font-size-body); color: var(--text-2); }
.tags { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.remark { width: 100%; max-width: 560px; margin-top: var(--space-2); padding: var(--space-3) var(--space-4); border-radius: var(--radius-control); background: var(--bg-fill); color: var(--text-1); font-size: var(--font-size-body); line-height: 1.6; text-align: left; }
.remark--danger { background: var(--danger-soft); }
.remark--warning { background: var(--warning-soft); }
.remark b { font-weight: var(--font-weight-semibold); }
.acts { margin-top: var(--space-3); }
.form-err { margin: var(--space-2) 0 0; font-size: var(--font-size-aux); line-height: 1.6; color: var(--danger-text); }
.form-err--r { text-align: right; }
.form-acts { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.code { font-family: var(--font-mono); }
.none, .hint { color: var(--text-3); }
.hint { margin-top: var(--space-3); font-size: var(--font-size-aux); }
</style>
