<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type CompanyDetail, type CompanyStatus, type MemberView } from '@shitu/api-client'
import DictTags from '@/components/DictTags.vue'
import FileThumbs from '@/components/FileThumbs.vue'
import FileViewButton from '@/components/FileViewButton.vue'
import StatusTag from '@/components/StatusTag.vue'
import { promptRemark } from '@/composables/useRemark'
import { daysUntil, fmtDate, fmtDateTime, fmtPenaltyLevel } from '@/utils/format'

const props = defineProps<{ companyId: string | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { label } = useDict()

const visible = computed({
  get: () => props.companyId != null,
  set: (v) => {
    if (!v) emit('close')
  },
})

const detail = ref<CompanyDetail | null>(null)
const loading = ref(false)
const error = ref('')
const acting = ref(false)

async function load() {
  if (!props.companyId) return
  loading.value = true
  error.value = ''
  try {
    detail.value = await opsApi.company(props.companyId)
  } catch (e) {
    error.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(
  () => props.companyId,
  (id) => {
    detail.value = null
    if (id) load()
  },
  { immediate: true },
)

const c = computed(() => detail.value?.company)
const isPending = computed(() => c.value?.status === 'PENDING_AUDIT')
const canAdjust = computed(() => ['NORMAL', 'THROTTLED', 'BANNED'].includes(c.value?.status ?? ''))
const freeLeft = computed(() => daysUntil(c.value?.freePeriodEnd))
const projectNames = (m: MemberView) => m.projects.map((p) => p.name).join('、') || '—'

async function run(fn: () => Promise<unknown>, okMsg: string) {
  acting.value = true
  try {
    await fn()
    ElMessage.success(okMsg)
    emit('changed')
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = false
  }
}

async function approve() {
  const id = c.value?.companyId
  if (!id) return
  const remark = await promptRemark({
    title: '入驻审核通过',
    message: `确认「${c.value?.name}」营业执照与资质核验无误？通过后入驻日为今天，并开始计算免费期。`,
    confirmText: '通过',
  })
  if (remark === null) return
  await run(() => opsApi.approveCompany(id, remark || undefined), '已通过入驻审核')
}

async function reject() {
  const id = c.value?.companyId
  if (!id) return
  const remark = await promptRemark({ title: '驳回入驻申请', message: '驳回原因将展示给申请公司，请写清需要补充或修改的内容。', required: true, danger: true, confirmText: '驳回' })
  if (remark === null) return
  await run(() => opsApi.rejectCompany(id, remark), '已驳回入驻申请')
}

// ---------- 调整状态 ----------
const ADJUSTABLE: CompanyStatus[] = ['NORMAL', 'THROTTLED', 'BANNED']
const statusDlg = reactive({ visible: false, status: 'NORMAL' as CompanyStatus, remark: '', error: '' })
function openStatus() {
  if (!c.value) return
  statusDlg.status = c.value.status
  statusDlg.remark = ''
  statusDlg.error = ''
  statusDlg.visible = true
}
async function submitStatus() {
  const id = c.value?.companyId
  if (!id) return
  if (statusDlg.status === c.value?.status) {
    statusDlg.error = '请选择新的状态'
    return
  }
  if (statusDlg.status !== 'NORMAL' && !statusDlg.remark.trim()) {
    statusDlg.error = '限流 / 封禁必须填写原因'
    return
  }
  statusDlg.visible = false
  await run(() => opsApi.setCompanyStatus(id, statusDlg.status, statusDlg.remark.trim() || undefined), `已调整为「${label('CompanyStatus', statusDlg.status)}」`)
}
const STATUS_HINT: Partial<Record<CompanyStatus, string>> = {
  NORMAL: '可发布岗位、接收匹配、正常计费',
  THROTTLED: '匹配权重降低，需填写原因',
  BANNED: '取消所有收费服务权限，需填写原因',
}
</script>

<template>
  <el-drawer v-model="visible" size="760px" destroy-on-close :with-header="true" class="ops-drawer">
    <template #header>
      <div class="dh">
        <h3>{{ c?.name ?? '公司详情' }}</h3>
        <StatusTag v-if="c" type="CompanyStatus" :value="c.status" />
      </div>
    </template>

    <div v-loading="loading" class="body">
      <el-result v-if="error && !detail" icon="error" :title="error">
        <template #extra><el-button @click="load">重试</el-button></template>
      </el-result>

      <template v-if="c && detail">
        <div v-if="isPending" class="notice notice--warn top-tip">入驻申请待审核：请核对营业执照、统一社会信用代码与劳务派遣许可证后再通过。</div>
        <div v-else-if="c.status === 'REJECTED' && c.auditRemark" class="notice notice--danger top-tip">驳回原因：{{ c.auditRemark }}</div>
        <div v-else-if="c.statusRemark && c.status !== 'NORMAL'" class="notice notice--warn top-tip">状态说明：{{ c.statusRemark }}</div>

        <div class="sec-title">基本信息</div>
        <dl class="kv-grid">
          <div class="kv"><dt>公司 ID</dt><dd class="mono">{{ c.companyId }}</dd></div>
          <div class="kv"><dt>简称</dt><dd>{{ c.shortName || '—' }}</dd></div>
          <div class="kv full"><dt>公司全称</dt><dd>{{ c.name }}</dd></div>
          <div class="kv"><dt>统一社会信用代码</dt><dd class="mono">{{ c.unifiedCreditCode }}</dd></div>
          <div class="kv"><dt>劳务派遣许可证</dt><dd class="mono">{{ c.dispatchLicenseNo || '—' }}</dd></div>
          <div class="kv"><dt>联系人</dt><dd>{{ c.contactName }}</dd></div>
          <div class="kv"><dt>联系电话</dt><dd class="mono">{{ c.contactPhone || '—' }}</dd></div>
          <div class="kv"><dt>提交时间</dt><dd class="mono">{{ fmtDateTime(c.submittedAt) }}</dd></div>
          <div class="kv"><dt>审核时间</dt><dd class="mono">{{ fmtDateTime(c.auditedAt) }}</dd></div>
          <div class="kv"><dt>入驻日</dt><dd class="mono">{{ fmtDate(c.onboardDate) }}</dd></div>
          <div class="kv">
            <dt>免费期至</dt>
            <dd>
              <span class="mono">{{ fmtDate(c.freePeriodEnd) }}</span>
              <span v-if="freeLeft != null && freeLeft >= 0" class="tag tag--warn ml">剩 {{ freeLeft }} 天</span>
              <span v-else-if="freeLeft != null" class="tag ml">已结束</span>
            </dd>
          </div>
          <div class="kv"><dt>诚信分</dt><dd class="mono">{{ c.creditScore ?? '—' }}</dd></div>
          <div class="kv"><dt>处罚等级</dt><dd>{{ fmtPenaltyLevel(c.penaltyLevel) }}</dd></div>
          <div v-if="c.auditRemark && c.status !== 'REJECTED'" class="kv full"><dt>审核备注</dt><dd>{{ c.auditRemark }}</dd></div>
        </dl>

        <div class="sec-title">营业执照 / 资质文件 <small>点击图片放大，PDF 在新标签页打开，无法预览的文件可下载</small></div>
        <FileThumbs :keys="c.licenseFiles" />

        <div class="sec-title">成员 <small>{{ detail.members.length }} 人</small></div>
        <el-table :data="detail.members" size="small" class="ops-table" max-height="260">
          <el-table-column label="姓名" prop="name" min-width="90" />
          <el-table-column label="手机号" min-width="120"><template #default="{ row }"><span class="mono">{{ row.phoneMasked }}</span></template></el-table-column>
          <el-table-column label="角色" min-width="150"><template #default="{ row }"><DictTags type="ActorRole" :values="row.roles" /></template></el-table-column>
          <el-table-column label="项目" min-width="120">
            <template #default="{ row }"><span class="t-sm">{{ projectNames(row) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag type="MemberStatus" :value="row.status" /></template></el-table-column>
          <el-table-column label="最近登录" width="140"><template #default="{ row }"><span class="mono t-xs">{{ fmtDateTime(row.lastLoginAt) }}</span></template></el-table-column>
          <template #empty><span class="dim t-sm">暂无成员</span></template>
        </el-table>

        <div class="sec-title">合作合同 <small>{{ detail.contracts.length }} 份</small></div>
        <el-table :data="detail.contracts" size="small" class="ops-table" max-height="260">
          <el-table-column label="甲方" min-width="150"><template #default="{ row }">{{ row.clientName ?? row.clientId }}</template></el-table-column>
          <el-table-column label="有效期" min-width="170">
            <template #default="{ row }"><span class="mono t-xs">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span></template>
          </el-table-column>
          <el-table-column label="备案" width="90"><template #default="{ row }"><StatusTag type="ClientContractStatus" :value="row.auditStatus" /></template></el-table-column>
          <el-table-column label="生效" width="70">
            <template #default="{ row }"><span class="tag" :class="{ 'tag--ok': row.effective }">{{ row.effective ? '生效中' : '未生效' }}</span></template>
          </el-table-column>
          <el-table-column label="文件" width="70"><template #default="{ row }"><FileViewButton :file-key="row.fileKey" /></template></el-table-column>
          <template #empty><span class="dim t-sm">暂无合同</span></template>
        </el-table>
      </template>
    </div>

    <template v-if="c" #footer>
      <div class="drawer-actions">
        <el-button @click="visible = false">关闭</el-button>
        <template v-if="isPending">
          <el-button type="danger" plain :loading="acting" @click="reject">驳回</el-button>
          <el-button type="primary" :loading="acting" @click="approve">通过入驻</el-button>
        </template>
        <el-button v-else-if="canAdjust" type="primary" :loading="acting" @click="openStatus">调整状态</el-button>
      </div>
    </template>

    <el-dialog v-model="statusDlg.visible" title="调整公司状态" width="460px" append-to-body :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent="submitStatus">
        <el-form-item label="新状态" required>
          <el-radio-group v-model="statusDlg.status" class="radios" @change="statusDlg.error = ''">
            <el-radio v-for="s in ADJUSTABLE" :key="s" :value="s" :disabled="s === c?.status" border>
              {{ label('CompanyStatus', s) }}<span v-if="s === c?.status" class="t-xs">（当前）</span>
            </el-radio>
          </el-radio-group>
          <div class="t-xs hint">{{ STATUS_HINT[statusDlg.status] }}</div>
        </el-form-item>
        <el-form-item :label="statusDlg.status === 'NORMAL' ? '备注（选填）' : '原因（必填）'" :required="statusDlg.status !== 'NORMAL'">
          <el-input v-model="statusDlg.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="将记录到审计日志并通知该公司" @input="statusDlg.error = ''" />
        </el-form-item>
        <div v-if="statusDlg.error" class="notice notice--danger">{{ statusDlg.error }}</div>
      </el-form>
      <template #footer>
        <el-button @click="statusDlg.visible = false">取消</el-button>
        <el-button :type="statusDlg.status === 'NORMAL' ? 'primary' : 'danger'" @click="submitStatus">确认调整</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
.dh { display: flex; align-items: center; gap: 10px; }
.dh h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.body { min-height: 200px; }
.top-tip { margin-bottom: 14px; }
.ml { margin-left: 6px; }
.radios { display: flex; gap: 8px; }
.radios :deep(.el-radio) { margin-right: 0; }
.hint { margin-top: 6px; width: 100%; }
</style>
