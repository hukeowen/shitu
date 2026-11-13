<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, logout, tenantApi, useDict, type CompanyStatus, type UploadedFile } from '@shitu/api-client'
import BrandMark from '@/components/BrandMark.vue'
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
      return { title: '入驻资料审核中', desc: '平台通常在 1–2 个工作日内完成审核，审核通过后即可发布岗位、管理成员。', tone: 'warn' }
    case 'REJECTED':
      return { title: '入驻申请被驳回', desc: '请根据驳回原因修改资料后重新提交。', tone: 'danger' }
    case 'BANNED':
      return { title: '公司账号已被封禁', desc: '封禁期间无法使用业务功能，如有异议请联系平台运营。', tone: 'danger' }
    case 'DEREGISTERED':
    case 'BANKRUPT':
      return { title: `公司状态：${label('CompanyStatus', status.value)}`, desc: '该公司已停止运营，业务功能不可用。', tone: 'danger' }
    default:
      return { title: `公司状态：${label('CompanyStatus', status.value)}`, desc: '当前状态下业务功能不可用。', tone: 'info' }
  }
})

function upload(file: File): Promise<UploadedFile> {
  return tenantApi.upload(file, 'license')
}

async function refresh() {
  refreshing.value = true
  try {
    const me = await meStore.load()
    if (me.operational) {
      ElMessage.success('公司已通过审核，欢迎使用')
      router.replace('/')
    }
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    refreshing.value = false
  }
}

async function resubmit() {
  const req = await formRef.value?.collect()
  if (!req) return
  saving.value = true
  try {
    await tenantApi.resubmit(req)
    await meStore.load()
    editing.value = false
    ElMessage.success('资料已重新提交，等待平台审核')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    saving.value = false
  }
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
      <BrandMark />
      <b class="brand">{{ APP_TITLE }}</b>
      <span class="spacer" />
      <span class="mn">{{ meStore.me?.name }}</span>
      <span class="sep" />
      <el-button size="small" @click="doLogout">退出</el-button>
    </header>

    <main v-if="company" class="body">
      <div class="page-hd">
        <div>
          <h2>入驻进度</h2>
          <p>{{ company.name }}</p>
        </div>
        <span class="spacer" />
        <el-button :loading="refreshing" @click="refresh">刷新状态</el-button>
      </div>

      <div class="card">
        <div class="card__bd">
          <el-steps :active="stepActive" finish-status="success" align-center>
            <el-step title="提交申请" :description="fmtDateTime(company.submittedAt)" />
            <el-step title="平台审核" :status="status === 'REJECTED' ? 'error' : undefined" :description="status === 'REJECTED' ? '已驳回' : status === 'PENDING_AUDIT' ? '审核中' : fmtDateTime(company.auditedAt)" />
            <el-step title="开通使用" />
          </el-steps>
          <div class="note headline" :class="`note--${headline.tone}`">
            <div class="row"><b>{{ headline.title }}</b><DictTag type="CompanyStatus" :value="status" /></div>
            <div style="margin-top: 4px">{{ headline.desc }}</div>
            <div v-if="company.auditRemark" style="margin-top: 6px"><b>审核意见：</b>{{ company.auditRemark }}</div>
            <div v-if="company.statusRemark" style="margin-top: 6px"><b>状态说明：</b>{{ company.statusRemark }}</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 14px">
        <div class="card__hd">
          <h3>{{ editing ? '修改入驻资料' : '入驻资料' }}</h3>
          <el-button v-if="editable && !editing" type="primary" size="small" @click="editing = true">修改并重新提交</el-button>
        </div>
        <div class="card__bd">
          <template v-if="editing">
            <CompanyForm ref="formRef" :upload="upload" :initial="company" viewable />
            <div class="row" style="justify-content: flex-end">
              <el-button @click="editing = false">取消</el-button>
              <el-button type="primary" :loading="saving" @click="resubmit">重新提交审核</el-button>
            </div>
          </template>
          <template v-else>
            <dl class="kv"><dt>公司全称</dt><dd>{{ company.name }}</dd></dl>
            <dl class="kv"><dt>公司简称</dt><dd>{{ company.shortName || '—' }}</dd></dl>
            <dl class="kv"><dt>统一社会信用代码</dt><dd class="mono">{{ company.unifiedCreditCode }}</dd></dl>
            <dl class="kv"><dt>劳务派遣许可证</dt><dd>{{ company.dispatchLicenseNo || '—' }}</dd></dl>
            <dl class="kv"><dt>联系人</dt><dd>{{ company.contactName }} <span class="mono t-sm">{{ company.contactPhone }}</span></dd></dl>
            <dl class="kv"><dt>提交时间</dt><dd>{{ fmtDateTime(company.submittedAt) }}</dd></dl>
            <dl class="kv">
              <dt>营业执照 / 许可证</dt>
              <dd>
                <template v-if="company.licenseFiles?.length">
                  <FileLink v-for="(k, i) in company.licenseFiles" :key="k" :file-key="k" :label="`文件 ${i + 1}`" />
                </template>
                <span v-else>—</span>
              </dd>
            </dl>
            <p v-if="!meStore.isOwner" class="t-xs" style="margin-top: 10px">仅公司老板可修改入驻资料。</p>
          </template>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 顶栏与 AppLayout 的 header 同一套：白底、60px 高、同样的字号与分隔线 */
.wrap { min-height: 100vh; background: var(--paper); }
.top { height: 60px; position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 14px; padding: 0 28px; background: rgba(255, 255, 255, .92); backdrop-filter: saturate(1.4) blur(8px); border-bottom: 1px solid var(--line); }
.top .brand { margin-left: -4px; font-size: 16px; font-weight: 650; color: var(--ink-900); letter-spacing: -.01em; }
.top .mn { font-size: 13.5px; font-weight: 600; color: var(--ink-900); }
.top .sep { width: 1px; height: 18px; background: var(--line); }
.top .spacer { flex: 1; }
.body { max-width: 880px; margin: 0 auto; padding: 24px 28px 64px; }
.headline { margin-top: 22px; }
</style>
