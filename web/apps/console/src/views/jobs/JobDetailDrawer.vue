<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { errorMessage, tenantApi, useDict, type JobAuditRecord, type JobView } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import { fmtDateTime, salaryRange } from '@/utils/format'

/** 岗位详情抽屉：完整字段 + 平台审核轨迹 */
const props = defineProps<{ jobId: string | null }>()
const visible = defineModel<boolean>({ required: true })
const { label } = useDict()

const job = ref<JobView | null>(null)
const audits = ref<JobAuditRecord[]>([])
const loading = ref(false)
const error = ref('')

/** 审核动作不在字典里（仅轨迹展示用） */
const AUDIT_ACTION: Record<JobAuditRecord['action'], { text: string; type: 'primary' | 'success' | 'danger' | 'warning' }> = {
  SUBMIT: { text: '提交审核', type: 'primary' },
  APPROVE: { text: '审核通过', type: 'success' },
  REJECT: { text: '审核驳回', type: 'danger' },
  FORCE_OFFLINE: { text: '平台强制下架', type: 'danger' },
}

async function load(id: string) {
  loading.value = true
  error.value = ''
  try {
    const [j, a] = await Promise.all([tenantApi.job(id), tenantApi.jobAudits(id)])
    job.value = j
    audits.value = [...a].sort((x, y) => y.createdAt.localeCompare(x.createdAt))
  } catch (e) {
    error.value = errorMessage(e, '岗位详情加载失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => [visible.value, props.jobId] as const,
  ([v, id]) => {
    if (v && id) load(id)
  },
  { immediate: true },
)

const dorm = computed(() => {
  const j = job.value
  if (!j?.dormProvided) return '不提供住宿'
  const parts = ['包住']
  if (j.dormRoomSize) parts.push(`${j.dormRoomSize} 人间`)
  if (j.dormAircon) parts.push('空调')
  if (j.dormPrivateBath) parts.push('独立卫浴')
  return parts.join(' · ')
})
</script>

<template>
  <el-drawer v-model="visible" size="560px" :title="job?.title ?? '岗位详情'">
    <div v-loading="loading" class="body">
      <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
      <template v-else-if="job">
        <div class="row-wrap" style="margin-bottom: 12px">
          <DictTag type="JobStatus" :value="job.status" lg />
          <span class="tag tag--lg">{{ label('JobType', job.jobType) }}</span>
          <span class="tag tag--lg">{{ label('ShiftType', job.shiftType) }}</span>
        </div>
        <div v-if="job.auditRemark && (job.status === 'REJECTED' || job.status === 'FORCE_OFFLINE')" class="note note--danger" style="margin-bottom: 14px">
          <b>{{ job.status === 'REJECTED' ? '驳回原因' : '下架原因' }}：</b>{{ job.auditRemark }}
        </div>
        <div v-else-if="job.status === 'PENDING_AUDIT'" class="note note--warn" style="margin-bottom: 14px">平台审核中，审核期间不参与匹配。</div>

        <div class="salary">{{ salaryRange(job.salaryMin, job.salaryMax) }}<small> 元/月</small></div>

        <div class="eyebrow sec">基本信息</div>
        <dl class="kv"><dt>所属项目</dt><dd>{{ job.projectName }}</dd></dl>
        <dl class="kv"><dt>甲方企业</dt><dd>{{ job.clientName }}</dd></dl>
        <dl class="kv"><dt>城市</dt><dd>{{ job.city || '—' }}</dd></dl>
        <dl class="kv"><dt>工厂岗位</dt><dd>{{ job.factoryJob ? '是' : '否' }}</dd></dl>
        <dl class="kv"><dt>名额（已占用 / 总数）</dt><dd class="num">{{ job.quotaOccupied }} / {{ job.quotaTotal }} · 剩余 {{ job.quotaRemaining }}</dd></dl>

        <div class="eyebrow sec">食宿</div>
        <dl class="kv"><dt>吃</dt><dd>{{ job.mealProvided ? '包吃' : '不包吃' }}</dd></dl>
        <dl class="kv"><dt>住</dt><dd>{{ dorm }}</dd></dl>

        <div class="eyebrow sec">要求</div>
        <dl class="kv"><dt>年龄</dt><dd>{{ job.ageMin }}–{{ job.ageMax }} 岁</dd></dl>
        <dl class="kv"><dt>工作经验</dt><dd>{{ job.minWorkYears ? `${job.minWorkYears} 年以上` : '不限' }}</dd></dl>
        <dl class="kv">
          <dt>所需证件</dt>
          <dd><span v-for="d in job.requiredDocuments ?? []" :key="d" class="tag" style="margin-left: 4px">{{ d }}</span><span v-if="!job.requiredDocuments?.length">—</span></dd>
        </dl>

        <div class="eyebrow sec">面试</div>
        <dl class="kv"><dt>面试地址</dt><dd>{{ job.interviewAddress }}</dd></dl>
        <dl class="kv"><dt>面试时间</dt><dd>{{ job.interviewTimeDesc || '—' }}</dd></dl>

        <div class="eyebrow sec">岗位职责</div>
        <p class="pre">{{ job.duties }}</p>
        <template v-if="job.benefits">
          <div class="eyebrow sec">福利待遇</div>
          <p class="pre">{{ job.benefits }}</p>
        </template>
        <template v-if="job.notes">
          <div class="eyebrow sec">注意事项</div>
          <p class="pre">{{ job.notes }}</p>
        </template>

        <div class="eyebrow sec">时间</div>
        <dl class="kv"><dt>创建</dt><dd class="mono">{{ fmtDateTime(job.createdAt) }}</dd></dl>
        <dl class="kv"><dt>最近提交审核</dt><dd class="mono">{{ fmtDateTime(job.submittedAt) }}</dd></dl>
        <dl class="kv"><dt>上架</dt><dd class="mono">{{ fmtDateTime(job.postedAt) }}</dd></dl>

        <div class="eyebrow sec">审核轨迹</div>
        <el-timeline v-if="audits.length" style="padding-left: 4px">
          <el-timeline-item v-for="(a, i) in audits" :key="i" :timestamp="fmtDateTime(a.createdAt)" :type="AUDIT_ACTION[a.action]?.type ?? 'primary'">
            <b>{{ AUDIT_ACTION[a.action]?.text ?? a.action }}</b>
            <div v-if="a.remark" class="t-sm" style="margin-top: 2px">{{ a.remark }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else :image-size="50" description="暂无审核记录" />
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.body { min-height: 200px; }
.salary { font-family: var(--f-dis); font-size: 26px; font-weight: 700; color: var(--signal); }
.salary small { font-family: var(--f-cn); font-size: 12px; color: var(--ink-400); font-weight: 500; }
.sec { margin: 18px 0 4px; }
.pre { white-space: pre-wrap; font-size: 13px; color: var(--ink-700); line-height: 1.8; }
</style>
