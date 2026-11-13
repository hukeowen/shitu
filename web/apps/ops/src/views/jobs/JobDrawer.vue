<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, opsApi, useDict, type JobAuditRecord, type JobOpsAction, type OpsJobDetail } from '@shitu/api-client'
import FileViewButton from '@/components/FileViewButton.vue'
import StatusTag from '@/components/StatusTag.vue'
import { promptRemark } from '@/composables/useRemark'
import { fmtDate, fmtDateTime, fmtOperator, fmtSalary, yesNo } from '@/utils/format'

const props = defineProps<{ jobId: string | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { label } = useDict()

const visible = computed({
  get: () => props.jobId != null,
  set: (v) => {
    if (!v) emit('close')
  },
})

const detail = ref<OpsJobDetail | null>(null)
const loading = ref(false)
const error = ref('')
const acting = ref(false)
const actionError = ref('')

async function load() {
  if (!props.jobId) return
  loading.value = true
  error.value = ''
  try {
    detail.value = await opsApi.job(props.jobId)
  } catch (e) {
    error.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(
  () => props.jobId,
  (id) => {
    detail.value = null
    actionError.value = ''
    if (id) load()
  },
  { immediate: true },
)

const j = computed(() => detail.value?.job)
const actions = computed(() => new Set((j.value?.allowedActions ?? []) as JobOpsAction[]))
const hasEffective = computed(() => detail.value?.contracts.some((c) => c.effective) ?? false)

/** 审核记录动作没有字典（后端 JobAuditRecord.action），本地映射 */
const AUDIT_ACTION: Record<JobAuditRecord['action'], { text: string; cls: string }> = {
  SUBMIT: { text: '提交审核', cls: 'now' },
  APPROVE: { text: '审核通过', cls: 'done' },
  REJECT: { text: '审核驳回', cls: 'fail' },
  FORCE_OFFLINE: { text: '强制下架', cls: 'fail' },
}

async function run(fn: () => Promise<unknown>, okMsg: string) {
  acting.value = true
  actionError.value = ''
  try {
    await fn()
    ElMessage.success(okMsg)
    emit('changed')
    await load()
  } catch (e) {
    const msg = errorMessage(e)
    actionError.value = isApiError(e, 'TEN_4004') ? `${msg}。请先在「合同备案」中审核该公司与甲方的合同，或驳回此岗位。` : msg
    ElMessage.error(msg)
  } finally {
    acting.value = false
  }
}

async function approve() {
  const id = j.value?.jobId
  if (!id) return
  const remark = await promptRemark({
    title: '岗位审核通过',
    message: `确认「${j.value?.title}」信息真实、与已备案甲方一致？通过后岗位上架并进入匹配池。`,
    confirmText: '通过',
  })
  if (remark === null) return
  await run(() => opsApi.approveJob(id, remark || undefined), '审核通过，岗位已上架')
}
async function reject() {
  const id = j.value?.jobId
  if (!id) return
  const remark = await promptRemark({ title: '驳回岗位', message: '驳回原因将展示给发布公司。', required: true, danger: true, confirmText: '驳回' })
  if (remark === null) return
  await run(() => opsApi.rejectJob(id, remark), '已驳回')
}
async function forceOffline() {
  const id = j.value?.jobId
  if (!id) return
  const remark = await promptRemark({
    title: '强制下架',
    message: '强制下架后公司无法自行恢复，原因将通知发布公司并记入审计日志。',
    required: true,
    danger: true,
    confirmText: '强制下架',
  })
  if (remark === null) return
  await run(() => opsApi.forceOfflineJob(id, remark), '已强制下架')
}
</script>

<template>
  <el-drawer v-model="visible" size="780px" destroy-on-close class="ops-drawer">
    <template #header>
      <div class="dh">
        <h3>{{ j?.title ?? '岗位详情' }}</h3>
        <StatusTag v-if="j" type="JobStatus" :value="j.status" />
        <span v-if="j" class="mono t-xs">{{ j.jobId }}</span>
      </div>
    </template>

    <div v-loading="loading" class="body">
      <el-result v-if="error && !detail" icon="error" :title="error">
        <template #extra><el-button @click="load">重试</el-button></template>
      </el-result>

      <template v-if="j && detail">
        <div v-if="actionError" class="notice notice--danger tip">{{ actionError }}</div>
        <div v-if="j.auditRemark && (j.status === 'REJECTED' || j.status === 'FORCE_OFFLINE')" class="notice notice--danger tip">
          {{ label('JobStatus', j.status) }}说明：{{ j.auditRemark }}
        </div>
        <div v-if="actions.has('APPROVE') && !hasEffective" class="notice notice--warn tip">
          该公司与甲方「{{ j.clientName ?? j.clientId }}」暂无审核通过且在有效期内的合作合同，审核通过将被拒绝。
        </div>

        <div class="weight">
          <div>
            <div class="stat-l">平台匹配权重 <span class="tag tag--temp">仅平台可见</span></div>
            <div class="stat-v">{{ detail.matchWeight }}</div>
          </div>
          <div class="t-xs">真实匹配权重仅平台可见，劳务公司后台不展示</div>
        </div>

        <div class="sec-title">基本信息</div>
        <dl class="kv-grid">
          <div class="kv"><dt>发布企业</dt><dd>{{ j.companyName ?? '—' }} <span class="mono t-xs">{{ j.companyId }}</span></dd></div>
          <div class="kv"><dt>关联甲方</dt><dd>{{ j.clientName ?? j.clientId }}</dd></div>
          <div class="kv"><dt>所属项目</dt><dd>{{ j.projectName ?? j.projectId }}</dd></div>
          <div class="kv"><dt>城市</dt><dd>{{ j.city ?? '—' }}</dd></div>
          <div class="kv"><dt>工种</dt><dd>{{ label('JobType', j.jobType) }}</dd></div>
          <div class="kv"><dt>工厂岗位</dt><dd>{{ yesNo(j.factoryJob) }}</dd></div>
          <div class="kv"><dt>提交审核</dt><dd class="mono">{{ fmtDateTime(j.submittedAt) }}</dd></div>
          <div class="kv"><dt>上架时间</dt><dd class="mono">{{ fmtDateTime(j.postedAt) }}</dd></div>
          <div class="kv"><dt>信息更新</dt><dd class="mono">{{ fmtDateTime(j.lastInfoUpdateAt) }}</dd></div>
          <div class="kv"><dt>创建时间</dt><dd class="mono">{{ fmtDateTime(j.createdAt) }}</dd></div>
        </dl>

        <div class="sec-title">薪资 · 班次</div>
        <dl class="kv-grid">
          <div class="kv"><dt>综合薪资</dt><dd class="mono">{{ fmtSalary(j.salaryMin, j.salaryMax) }} 元/月</dd></div>
          <div class="kv"><dt>班次</dt><dd>{{ label('ShiftType', j.shiftType) }}</dd></div>
        </dl>

        <div class="sec-title">食宿</div>
        <dl class="kv-grid">
          <div class="kv"><dt>包住</dt><dd>{{ yesNo(j.dormProvided) }}</dd></div>
          <div class="kv"><dt>包吃</dt><dd>{{ yesNo(j.mealProvided) }}</dd></div>
          <template v-if="j.dormProvided">
            <div class="kv"><dt>宿舍人数</dt><dd>{{ j.dormRoomSize != null ? `${j.dormRoomSize} 人间` : '—' }}</dd></div>
            <div class="kv"><dt>空调 / 独卫</dt><dd>{{ yesNo(j.dormAircon) }} / {{ yesNo(j.dormPrivateBath) }}</dd></div>
          </template>
        </dl>

        <div class="sec-title">要求</div>
        <dl class="kv-grid">
          <div class="kv"><dt>年龄</dt><dd>{{ j.ageMin }}–{{ j.ageMax }} 岁</dd></div>
          <div class="kv"><dt>工作经验</dt><dd>{{ j.minWorkYears > 0 ? `${j.minWorkYears} 年以上` : '不限' }}</dd></div>
          <div class="kv full"><dt>所需证件</dt><dd>{{ j.requiredDocuments?.length ? j.requiredDocuments.join('、') : '—' }}</dd></div>
          <div class="kv full block"><dt>岗位职责</dt><dd>{{ j.duties }}</dd></div>
          <div v-if="j.benefits" class="kv full block"><dt>福利待遇</dt><dd>{{ j.benefits }}</dd></div>
          <div v-if="j.notes" class="kv full block"><dt>备注</dt><dd>{{ j.notes }}</dd></div>
        </dl>

        <div class="sec-title">面试</div>
        <dl class="kv-grid">
          <div class="kv full"><dt>面试地址</dt><dd>{{ j.interviewAddress }}</dd></div>
          <div class="kv full"><dt>面试时间</dt><dd>{{ j.interviewTimeDesc || '—' }}</dd></div>
        </dl>

        <div class="sec-title">名额</div>
        <div class="grid g-3">
          <div class="stat"><div class="stat-l">总名额</div><div class="stat-v">{{ j.quotaTotal }}</div></div>
          <div class="stat"><div class="stat-l">已占用</div><div class="stat-v">{{ j.quotaOccupied }}</div></div>
          <div class="stat"><div class="stat-l">剩余</div><div class="stat-v">{{ j.quotaRemaining }}</div></div>
        </div>

        <div class="sec-title">合作合同 <small>{{ j.companyName ?? j.companyId }} ↔ {{ j.clientName ?? j.clientId }}</small></div>
        <el-table :data="detail.contracts" size="small" class="ops-table">
          <el-table-column label="合同 ID" min-width="120"><template #default="{ row }"><span class="mono t-xs">{{ row.contractId }}</span></template></el-table-column>
          <el-table-column label="有效期" min-width="170">
            <template #default="{ row }"><span class="mono t-xs">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span></template>
          </el-table-column>
          <el-table-column label="备案" width="90"><template #default="{ row }"><StatusTag type="ClientContractStatus" :value="row.auditStatus" /></template></el-table-column>
          <el-table-column label="生效" width="80">
            <template #default="{ row }"><span class="tag" :class="{ 'tag--ok': row.effective }">{{ row.effective ? '生效中' : '未生效' }}</span></template>
          </el-table-column>
          <el-table-column label="文件" width="70"><template #default="{ row }"><FileViewButton :file-key="row.fileKey" /></template></el-table-column>
          <template #empty><span class="t-sm" style="color: var(--danger)">该公司与此甲方没有任何合作合同</span></template>
        </el-table>

        <div class="sec-title">审核记录</div>
        <ul v-if="detail.audits.length" class="tl">
          <li v-for="(a, i) in detail.audits" :key="i" :class="AUDIT_ACTION[a.action]?.cls">
            <div class="tl-t">{{ AUDIT_ACTION[a.action]?.text ?? a.action }}</div>
            <div class="tl-m">{{ fmtDateTime(a.createdAt) }} · 操作人 {{ fmtOperator(a.operatorId) }}</div>
            <div v-if="a.remark" class="tl-r">{{ a.remark }}</div>
          </li>
        </ul>
        <div v-else class="dim t-sm">暂无审核记录</div>
      </template>
    </div>

    <template v-if="j" #footer>
      <div class="drawer-actions">
        <el-button @click="visible = false">关闭</el-button>
        <el-button v-if="actions.has('FORCE_OFFLINE')" type="danger" plain :loading="acting" @click="forceOffline">强制下架</el-button>
        <el-button v-if="actions.has('REJECT')" type="danger" plain :loading="acting" @click="reject">驳回</el-button>
        <el-button v-if="actions.has('APPROVE')" type="primary" :loading="acting" @click="approve">审核通过</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.dh { display: flex; align-items: center; gap: 10px; }
.dh h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.body { min-height: 200px; }
.tip { margin-bottom: 12px; }
.weight { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--temp-line); background: var(--temp-bg); border-radius: var(--r-md); }
.weight .stat-v { color: var(--temp); }
</style>
