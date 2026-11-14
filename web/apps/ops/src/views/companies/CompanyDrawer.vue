<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type CompanyDetail, type CompanyStatus, type MemberView } from '@shitu/api-client'
import { IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import DictTags from '@/components/DictTags.vue'
import FileThumbs from '@/components/FileThumbs.vue'
import FileViewButton from '@/components/FileViewButton.vue'
import StatusTag from '@/components/StatusTag.vue'
import { isBlocked, isNetwork, remarkInBox } from '@/composables/boxSubmit'
import { daysUntil, fmtDate, fmtDateTime } from '@/utils/format'

/** 公司详情 / 入驻审核抽屉（第 5 类分块 + 第 8 类底部「驳回 / 通过入驻」） */
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
const offline = ref(false)
/** 被后端拒绝的审核操作：只置灰这一个按钮，原因写在底部按钮上方 */
const blocked = reactive<{ act: '' | 'approve' | 'reject' | 'status'; why: string }>({ act: '', why: '' })

async function load() {
  if (!props.companyId) return
  loading.value = true
  error.value = ''
  offline.value = false
  try {
    detail.value = await opsApi.company(props.companyId)
  } catch (e) {
    error.value = errorMessage(e, '加载失败')
    offline.value = isNetwork(e)
  } finally {
    loading.value = false
  }
}
watch(
  () => props.companyId,
  (id) => {
    detail.value = null
    Object.assign(blocked, { act: '', why: '' })
    if (id) load()
  },
  { immediate: true },
)

const c = computed(() => detail.value?.company)
const isPending = computed(() => c.value?.status === 'PENDING_AUDIT')
const canAdjust = computed(() => ['NORMAL', 'THROTTLED', 'BANNED'].includes(c.value?.status ?? ''))
const freeLeft = computed(() => daysUntil(c.value?.freePeriodEnd))
const projectNames = (m: MemberView) => m.projects.map((p) => p.name).join('、') || '—'

async function done(okMsg: string) {
  ElMessage.success(okMsg)
  emit('changed')
  await load()
}

async function approve() {
  const id = c.value?.companyId
  if (!id) return
  const ok = await remarkInBox({
    title: '入驻审核通过',
    text: `确认「${c.value?.name}」营业执照与资质核验无误？通过后入驻日为今天，并开始计算免费期。`,
    action: '通过入驻',
    confirmText: '通过',
    api: (remark) => opsApi.approveCompany(id, remark || undefined),
    onBlocked: (why) => Object.assign(blocked, { act: 'approve', why }),
  })
  if (ok) await done('已通过入驻审核')
}

async function reject() {
  const id = c.value?.companyId
  if (!id) return
  const ok = await remarkInBox({
    title: '驳回入驻申请',
    text: '驳回原因将展示给申请公司，请写清需要补充或修改的内容。',
    action: '驳回',
    required: true,
    danger: true,
    api: (remark) => opsApi.rejectCompany(id, remark),
    onBlocked: (why) => Object.assign(blocked, { act: 'reject', why }),
  })
  if (ok) await done('已驳回入驻申请')
}

// ---------- 调整状态：弹窗里提交，被拒原因留在弹窗里 ----------
const ADJUSTABLE: CompanyStatus[] = ['NORMAL', 'THROTTLED', 'BANNED']
const statusDlg = reactive({ visible: false, status: 'NORMAL' as CompanyStatus, remark: '', error: '', why: '', saving: false })
function openStatus() {
  if (!c.value) return
  Object.assign(statusDlg, { visible: true, status: c.value.status, remark: '', error: '', why: '', saving: false })
}
function editStatus() {
  statusDlg.error = ''
  statusDlg.why = ''
}
async function submitStatus() {
  const id = c.value?.companyId
  if (!id || statusDlg.saving) return
  if (statusDlg.status === c.value?.status) {
    statusDlg.error = '请选择新的状态'
    return
  }
  if (statusDlg.status !== 'NORMAL' && !statusDlg.remark.trim()) {
    statusDlg.error = '限流 / 封禁必须填写原因'
    return
  }
  statusDlg.saving = true
  try {
    await opsApi.setCompanyStatus(id, statusDlg.status, statusDlg.remark.trim() || undefined)
    statusDlg.visible = false
    await done(`已调整为「${label('CompanyStatus', statusDlg.status)}」`)
  } catch (e) {
    ElMessage.error(errorMessage(e))
    // 后端业务拒绝：原因留在弹窗里、「确认调整」置灰，改了选项或原因再放开；断网只提示
    if (isBlocked(e)) {
      statusDlg.why = `暂时不能调整状态：${errorMessage(e)}`
      Object.assign(blocked, { act: 'status', why: statusDlg.why })
    }
  } finally {
    statusDlg.saving = false
  }
}
const STATUS_HINT: Partial<Record<CompanyStatus, string>> = {
  NORMAL: '可发布岗位、接收匹配、正常计费',
  THROTTLED: '匹配权重降低，需填写原因',
  BANNED: '取消所有收费服务权限，需填写原因',
}
</script>

<template>
  <el-drawer v-model="visible" size="680px" destroy-on-close class="rv-drawer company-drawer">
    <template #header>
      <div class="rv-hd">
        <h3>{{ c?.name ?? '公司详情' }}</h3>
        <StatusTag v-if="c" type="CompanyStatus" :value="c.status" />
      </div>
    </template>

    <div v-loading="loading" class="body">
      <div v-if="error && !detail && !loading" class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>公司详情加载失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" @click="load">重新加载</el-button>
      </div>

      <template v-if="c && detail">
        <div v-if="isPending" class="notice-bar notice-bar--warn top-tip"><IconInfo :size="16" class="notice-bar-i" />入驻申请待审核：请核对营业执照、统一社会信用代码与劳务派遣许可证后再通过。</div>
        <div v-else-if="c.status === 'REJECTED' && c.auditRemark" class="notice-bar notice-bar--danger top-tip"><IconInfo :size="16" class="notice-bar-i" />驳回原因：{{ c.auditRemark }}</div>
        <div v-else-if="c.statusRemark && c.status !== 'NORMAL'" class="notice-bar notice-bar--warn top-tip"><IconInfo :size="16" class="notice-bar-i" />状态说明：{{ c.statusRemark }}</div>

        <section class="blk">
          <h4 class="blk-t">基本信息</h4>
          <dl class="desc-list">
            <div><dt>公司 ID</dt><dd>{{ c.companyId }}</dd></div>
            <div><dt>简称</dt><dd>{{ c.shortName || '—' }}</dd></div>
            <div class="full"><dt>公司全称</dt><dd>{{ c.name }}</dd></div>
            <div><dt>统一社会信用代码</dt><dd>{{ c.unifiedCreditCode }}</dd></div>
            <div><dt>劳务派遣许可证</dt><dd>{{ c.dispatchLicenseNo || '—' }}</dd></div>
            <div><dt>联系人</dt><dd>{{ c.contactName }}</dd></div>
            <div><dt>联系电话</dt><dd>{{ c.contactPhone || '—' }}</dd></div>
            <div><dt>提交时间</dt><dd>{{ fmtDateTime(c.submittedAt) }}</dd></div>
            <div><dt>审核时间</dt><dd>{{ fmtDateTime(c.auditedAt) }}</dd></div>
            <div><dt>入驻日</dt><dd>{{ fmtDate(c.onboardDate) }}</dd></div>
            <div>
              <dt>免费期至</dt>
              <dd class="free">
                {{ fmtDate(c.freePeriodEnd) }}
                <span v-if="freeLeft != null && freeLeft >= 0" class="status-tag status-tag--warning">剩 {{ freeLeft }} 天</span>
                <span v-else-if="freeLeft != null" class="status-tag">已结束</span>
              </dd>
            </div>
            <div><dt>诚信分</dt><dd>{{ c.creditScore ?? '—' }}</dd></div>
            <div><dt>处罚等级</dt><dd>{{ c.penaltyLevel ?? '—' }}</dd></div>
            <div v-if="c.auditRemark && c.status !== 'REJECTED'" class="full"><dt>审核备注</dt><dd>{{ c.auditRemark }}</dd></div>
          </dl>
        </section>

        <section class="blk mat-blk">
          <h4 class="blk-t">营业执照 / 资质文件<small>点击图片放大，PDF 在新标签页打开</small></h4>
          <FileThumbs :keys="c.licenseFiles" label="营业执照" />
        </section>

        <section class="blk">
          <h4 class="blk-t">合作合同<small>{{ detail.contracts.length }} 份</small></h4>
          <el-table :data="detail.contracts" class="ops-table contract-tbl">
            <el-table-column label="甲方 / 合同编号" min-width="170">
              <template #default="{ row }">{{ row.clientName ?? row.clientId }}<div class="t-xs">{{ row.contractId }}</div></template>
            </el-table-column>
            <el-table-column label="有效期" min-width="190">
              <template #default="{ row }"><span class="tnum">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span></template>
            </el-table-column>
            <el-table-column label="备案" width="80"><template #default="{ row }"><StatusTag type="ClientContractStatus" :value="row.auditStatus" /></template></el-table-column>
            <el-table-column label="生效" width="80">
              <template #default="{ row }"><span class="status-tag" :class="{ 'status-tag--success': row.effective }">{{ row.effective ? '生效中' : '未生效' }}</span></template>
            </el-table-column>
            <el-table-column label="文件" width="64"><template #default="{ row }"><FileViewButton :file-key="row.fileKey" /></template></el-table-column>
            <template #empty><span class="t-sm dim">暂无合同</span></template>
          </el-table>
        </section>

        <section class="blk">
          <h4 class="blk-t">成员<small>{{ detail.members.length }} 人</small></h4>
          <el-table :data="detail.members" class="ops-table" max-height="300">
            <el-table-column label="姓名 / 手机号" min-width="120">
              <template #default="{ row }">{{ row.name }}<div class="t-xs">{{ row.phoneMasked }}</div></template>
            </el-table-column>
            <el-table-column label="角色" min-width="140"><template #default="{ row }"><DictTags type="ActorRole" :values="row.roles" /></template></el-table-column>
            <el-table-column label="项目" min-width="110">
              <template #default="{ row }"><span class="t-sm">{{ projectNames(row) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag type="MemberStatus" :value="row.status" /></template></el-table-column>
            <el-table-column label="最近登录" width="140"><template #default="{ row }"><span class="t-sm tnum">{{ fmtDateTime(row.lastLoginAt) }}</span></template></el-table-column>
            <template #empty><span class="t-sm dim">暂无成员</span></template>
          </el-table>
        </section>
      </template>
    </div>

    <template v-if="c" #footer>
      <div class="rv-foot">
        <p v-if="blocked.why" class="blocked-why" role="status">{{ blocked.why }}</p>
        <div class="rv-acts">
          <el-button @click="visible = false">关闭</el-button>
          <span class="rv-gap" />
          <template v-if="isPending">
            <el-button type="danger" plain class="btn-reject" :disabled="blocked.act === 'reject'" @click="reject">驳回</el-button>
            <el-button type="primary" :disabled="blocked.act === 'approve'" @click="approve">通过入驻</el-button>
          </template>
          <el-button v-else-if="canAdjust" type="primary" :disabled="blocked.act === 'status'" @click="openStatus">调整状态</el-button>
        </div>
      </div>
    </template>

    <el-dialog v-model="statusDlg.visible" title="调整公司状态" width="480px" class="dlg-16" append-to-body :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent="submitStatus">
        <el-form-item label="新状态" required>
          <el-radio-group v-model="statusDlg.status" class="radios" @change="editStatus">
            <el-radio v-for="s in ADJUSTABLE" :key="s" :value="s" :disabled="s === c?.status" border>
              {{ label('CompanyStatus', s) }}<span v-if="s === c?.status" class="t-xs">（当前）</span>
            </el-radio>
          </el-radio-group>
          <div class="t-xs hint">{{ STATUS_HINT[statusDlg.status] }}</div>
        </el-form-item>
        <el-form-item :label="statusDlg.status === 'NORMAL' ? '备注（选填）' : '原因（必填）'" :required="statusDlg.status !== 'NORMAL'">
          <el-input v-model="statusDlg.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="将记录到审计日志并通知该公司" @input="editStatus" />
        </el-form-item>
      </el-form>
      <p v-if="statusDlg.error" class="form-err" role="alert">{{ statusDlg.error }}</p>
      <p v-if="statusDlg.why" class="blocked-why" role="alert">{{ statusDlg.why }}</p>
      <template #footer>
        <el-button @click="statusDlg.visible = false">取消</el-button>
        <el-button v-if="statusDlg.status === 'NORMAL'" type="primary" :loading="statusDlg.saving" :disabled="!!statusDlg.why" @click="submitStatus">确认调整</el-button>
        <el-button v-else type="danger" plain class="btn-reject" :loading="statusDlg.saving" :disabled="!!statusDlg.why" @click="submitStatus">确认调整</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
.body { min-height: 200px; }
.top-tip { margin-bottom: var(--space-6); }
.free { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.radios { display: flex; gap: var(--space-2); }
.radios :deep(.el-radio) { margin-right: 0; }
.hint { margin-top: var(--space-1); width: 100%; }
</style>
