<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, opsApi, useDict, type JobAuditRecord, type JobOpsAction, type OpsJobDetail } from '@shitu/api-client'
import { IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import FileViewButton from '@/components/FileViewButton.vue'
import StatusTag from '@/components/StatusTag.vue'
import { isNetwork, remarkInBox } from '@/composables/boxSubmit'
import { fmtDate, fmtDateTime, fmtOperator, fmtSalary, yesNo } from '@/utils/format'

/** 岗位详情 / 审核抽屉（第 5 类分块 + 第 8 类底部「驳回 / 审核通过」） */
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
const offline = ref(false)
/** 被后端拒绝的操作：只置灰这一个按钮，原因写在底部按钮上方 */
const blocked = reactive<{ act: '' | JobOpsAction; why: string }>({ act: '', why: '' })

async function load() {
  if (!props.jobId) return
  loading.value = true
  error.value = ''
  offline.value = false
  try {
    detail.value = await opsApi.job(props.jobId)
  } catch (e) {
    error.value = errorMessage(e, '加载失败')
    offline.value = isNetwork(e)
  } finally {
    loading.value = false
  }
}
watch(
  () => props.jobId,
  (id) => {
    detail.value = null
    Object.assign(blocked, { act: '', why: '' })
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

async function done(okMsg: string) {
  ElMessage.success(okMsg)
  emit('changed')
  await load()
}
const onBlocked = (act: JobOpsAction) => (why: string) => Object.assign(blocked, { act, why })

async function approve() {
  const id = j.value?.jobId
  if (!id) return
  const ok = await remarkInBox({
    title: '岗位审核通过',
    text: `确认「${j.value?.title}」信息真实、与已备案甲方一致？通过后岗位上架并进入匹配池。`,
    action: '审核通过',
    confirmText: '通过',
    api: (remark) => opsApi.approveJob(id, remark || undefined),
    onBlocked: onBlocked('APPROVE'),
    // 原来被拒时的下一步指引一并写进框里
    explain: (e) => (isApiError(e, 'TEN_4004') ? '请先在「合同备案」中审核该公司与甲方的合同，或驳回此岗位' : undefined),
  })
  if (ok) await done('审核通过，岗位已上架')
}
async function reject() {
  const id = j.value?.jobId
  if (!id) return
  const ok = await remarkInBox({
    title: '驳回岗位',
    text: '驳回原因将展示给发布公司。',
    action: '驳回',
    required: true,
    danger: true,
    api: (remark) => opsApi.rejectJob(id, remark),
    onBlocked: onBlocked('REJECT'),
  })
  if (ok) await done('已驳回')
}
async function forceOffline() {
  const id = j.value?.jobId
  if (!id) return
  const ok = await remarkInBox({
    title: '强制下架',
    text: '强制下架后公司无法自行恢复，原因将通知发布公司并记入审计日志。',
    action: '强制下架',
    required: true,
    danger: true,
    api: (remark) => opsApi.forceOfflineJob(id, remark),
    onBlocked: onBlocked('FORCE_OFFLINE'),
  })
  if (ok) await done('已强制下架')
}
</script>

<template>
  <el-drawer v-model="visible" size="680px" destroy-on-close class="rv-drawer job-audit-drawer">
    <template #header>
      <div class="rv-hd">
        <h3>{{ j?.title ?? '岗位详情' }}</h3>
        <StatusTag v-if="j" type="JobStatus" :value="j.status" />
        <span v-if="j" class="t-xs">{{ j.jobId }}</span>
      </div>
    </template>

    <div v-loading="loading" class="body">
      <div v-if="error && !detail && !loading" class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>岗位详情加载失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" @click="load">重新加载</el-button>
      </div>

      <template v-if="j && detail">
        <div v-if="j.auditRemark && (j.status === 'REJECTED' || j.status === 'FORCE_OFFLINE')" class="notice-bar notice-bar--danger top-tip">
          <IconInfo :size="16" class="notice-bar-i" />{{ label('JobStatus', j.status) }}说明：{{ j.auditRemark }}
        </div>
        <div v-if="actions.has('APPROVE') && !hasEffective" class="notice-bar notice-bar--warn top-tip">
          <IconInfo :size="16" class="notice-bar-i" />该公司与甲方「{{ j.clientName ?? j.clientId }}」暂无审核通过且在有效期内的合作合同，审核通过将被拒绝。
        </div>

        <div class="weight">
          <div>
            <div class="w-l">平台匹配权重 <span class="status-tag status-tag--private">仅平台可见</span></div>
            <div class="w-v">{{ detail.matchWeight }}</div>
          </div>
          <div class="t-xs">真实匹配权重仅平台可见，劳务公司后台不展示</div>
        </div>

        <section class="blk">
          <h4 class="blk-t">合作合同<small>{{ j.companyName ?? j.companyId }} ↔ {{ j.clientName ?? j.clientId }}</small></h4>
          <el-table :data="detail.contracts" class="ops-table contract-tbl">
            <el-table-column label="甲方 / 合同编号" min-width="220">
              <template #default="{ row }">{{ row.clientName ?? row.clientId }}<div class="t-xs">{{ row.contractId }}</div></template>
            </el-table-column>
            <el-table-column label="有效期" width="200">
              <template #default="{ row }"><span class="tnum cell-one">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span></template>
            </el-table-column>
            <el-table-column label="备案" width="76"><template #default="{ row }"><StatusTag type="ClientContractStatus" :value="row.auditStatus" /></template></el-table-column>
            <el-table-column label="生效" width="76">
              <template #default="{ row }"><span class="status-tag" :class="{ 'status-tag--success': row.effective }">{{ row.effective ? '生效中' : '未生效' }}</span></template>
            </el-table-column>
            <el-table-column label="文件" width="60"><template #default="{ row }"><FileViewButton :file-key="row.fileKey" /></template></el-table-column>
            <template #empty><span class="t-sm none">该公司与此甲方没有任何合作合同</span></template>
          </el-table>
        </section>

        <section class="blk">
          <h4 class="blk-t">基本信息</h4>
          <dl class="desc-list">
            <div><dt>发布企业</dt><dd>{{ j.companyName ?? '—' }}<span class="t-xs co-id">{{ j.companyId }}</span></dd></div>
            <div><dt>关联甲方</dt><dd>{{ j.clientName ?? j.clientId }}</dd></div>
            <div><dt>所属项目</dt><dd>{{ j.projectName ?? j.projectId }}</dd></div>
            <div><dt>城市</dt><dd>{{ j.city ?? '—' }}</dd></div>
            <div><dt>工种</dt><dd>{{ label('JobType', j.jobType) }}</dd></div>
            <div><dt>工厂岗位</dt><dd>{{ yesNo(j.factoryJob) }}</dd></div>
            <div><dt>提交审核</dt><dd>{{ fmtDateTime(j.submittedAt) }}</dd></div>
            <div><dt>上架时间</dt><dd>{{ fmtDateTime(j.postedAt) }}</dd></div>
            <div><dt>信息更新</dt><dd>{{ fmtDateTime(j.lastInfoUpdateAt) }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ fmtDateTime(j.createdAt) }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">薪资 · 班次 · 食宿</h4>
          <dl class="desc-list">
            <div><dt>综合薪资</dt><dd>{{ fmtSalary(j.salaryMin, j.salaryMax) }} 元/月</dd></div>
            <div><dt>班次</dt><dd>{{ label('ShiftType', j.shiftType) }}</dd></div>
            <div><dt>包住</dt><dd>{{ yesNo(j.dormProvided) }}</dd></div>
            <div><dt>包吃</dt><dd>{{ yesNo(j.mealProvided) }}</dd></div>
            <template v-if="j.dormProvided">
              <div><dt>宿舍人数</dt><dd>{{ j.dormRoomSize != null ? `${j.dormRoomSize} 人间` : '—' }}</dd></div>
              <div><dt>空调 / 独卫</dt><dd>{{ yesNo(j.dormAircon) }} / {{ yesNo(j.dormPrivateBath) }}</dd></div>
            </template>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">要求</h4>
          <dl class="desc-list">
            <div><dt>年龄</dt><dd>{{ j.ageMin }}–{{ j.ageMax }} 岁</dd></div>
            <div><dt>工作经验</dt><dd>{{ j.minWorkYears > 0 ? `${j.minWorkYears} 年以上` : '不限' }}</dd></div>
            <div class="full"><dt>所需证件</dt><dd>{{ j.requiredDocuments?.length ? j.requiredDocuments.join('、') : '—' }}</dd></div>
            <div class="full"><dt>岗位职责</dt><dd class="pre">{{ j.duties }}</dd></div>
            <div v-if="j.benefits" class="full"><dt>福利待遇</dt><dd class="pre">{{ j.benefits }}</dd></div>
            <div v-if="j.notes" class="full"><dt>备注</dt><dd class="pre">{{ j.notes }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">面试与名额</h4>
          <dl class="desc-list">
            <div class="full"><dt>面试地址</dt><dd>{{ j.interviewAddress }}</dd></div>
            <div class="full"><dt>面试时间</dt><dd>{{ j.interviewTimeDesc || '—' }}</dd></div>
            <div><dt>总名额</dt><dd class="tnum">{{ j.quotaTotal }}</dd></div>
            <div><dt>已占用</dt><dd class="tnum">{{ j.quotaOccupied }}</dd></div>
            <div><dt>剩余</dt><dd class="tnum">{{ j.quotaRemaining }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">审核记录</h4>
          <ul v-if="detail.audits.length" class="tl">
            <li v-for="(a, i) in detail.audits" :key="i" :class="AUDIT_ACTION[a.action]?.cls">
              <div class="tl-t">{{ AUDIT_ACTION[a.action]?.text ?? a.action }}</div>
              <div class="t-xs">{{ fmtDateTime(a.createdAt) }} · 操作人 {{ fmtOperator(a.operatorId) }}</div>
              <div v-if="a.remark" class="tl-r">{{ a.remark }}</div>
            </li>
          </ul>
          <p v-else class="t-sm dim">暂无审核记录</p>
        </section>
      </template>
    </div>

    <template v-if="j" #footer>
      <div class="rv-foot">
        <p v-if="blocked.why" class="blocked-why" role="status">{{ blocked.why }}</p>
        <div class="rv-acts">
          <el-button @click="visible = false">关闭</el-button>
          <!-- 强制下架不是审核结论：放在左边「关闭」旁，和右边的驳回 / 通过分开 -->
          <el-button v-if="actions.has('FORCE_OFFLINE')" type="danger" plain class="btn-reject" :disabled="blocked.act === 'FORCE_OFFLINE'" @click="forceOffline">强制下架</el-button>
          <span class="rv-gap" />
          <el-button v-if="actions.has('REJECT')" type="danger" plain class="btn-reject" :disabled="blocked.act === 'REJECT'" @click="reject">驳回</el-button>
          <el-button v-if="actions.has('APPROVE')" type="primary" :disabled="blocked.act === 'APPROVE'" @click="approve">审核通过</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.body { min-height: 200px; }
.top-tip { margin-bottom: var(--space-3); }
.weight { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-6); border-radius: var(--radius-control); background: var(--bg-fill); }
.w-l { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-2); }
.w-v { margin-top: var(--space-1); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); font-variant-numeric: tabular-nums; }
.none { color: var(--danger-text); }
.co-id { margin-left: var(--space-2); }
</style>
