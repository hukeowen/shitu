<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { errorMessage, tenantApi, useDict, type JobAuditRecord, type JobView } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconClock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { fmtDateTime, salaryRange } from '@/utils/format'

/** 岗位详情抽屉：完整字段 + 平台审核轨迹（规范第 5 类：分块，字段用两列描述列表） */
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
  <el-drawer v-model="visible" size="640px" class="job-drawer" :title="job?.title ?? '岗位详情'">
    <div v-loading="loading" class="wrap">
      <div v-if="error" class="state-box">
        <IconCircleExclamationPoint :size="48" />
        <h4>{{ error }}</h4>
        <p>请检查网络后重新加载</p>
        <el-button @click="jobId && load(jobId)">重新加载</el-button>
      </div>
      <template v-else-if="job">
        <div class="hd">
          <DictTag type="JobStatus" :value="job.status" />
          <span class="status-tag">{{ label('JobType', job.jobType) }}</span>
          <span class="status-tag">{{ label('ShiftType', job.shiftType) }}</span>
          <span class="spacer" />
          <span class="salary">{{ salaryRange(job.salaryMin, job.salaryMax) }}<small> 元/月</small></span>
        </div>
        <div v-if="job.auditRemark && (job.status === 'REJECTED' || job.status === 'FORCE_OFFLINE')" class="notice-bar notice-bar--danger hd-tip">
          <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
          <span><b>{{ job.status === 'REJECTED' ? '驳回原因' : '下架原因' }}：</b>{{ job.auditRemark }}</span>
        </div>
        <div v-else-if="job.status === 'PENDING_AUDIT'" class="notice-bar notice-bar--warn hd-tip">
          <IconClock :size="16" class="notice-bar-i" />
          <span>平台审核中，审核期间不参与匹配。</span>
        </div>

        <section class="blk">
          <h4 class="blk-t">基本信息</h4>
          <dl class="desc-list">
            <div><dt>所属项目</dt><dd>{{ job.projectName }}</dd></div>
            <div><dt>甲方企业</dt><dd>{{ job.clientName }}</dd></div>
            <div><dt>城市</dt><dd>{{ job.city || '—' }}</dd></div>
            <div><dt>工厂岗位</dt><dd>{{ job.factoryJob ? '是' : '否' }}</dd></div>
            <div><dt>名额（已占用 / 总数）</dt><dd>{{ job.quotaOccupied }} / {{ job.quotaTotal }} · 剩余 {{ job.quotaRemaining }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">食宿</h4>
          <dl class="desc-list">
            <div><dt>吃</dt><dd>{{ job.mealProvided ? '包吃' : '不包吃' }}</dd></div>
            <div><dt>住</dt><dd>{{ dorm }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">要求</h4>
          <dl class="desc-list">
            <div><dt>年龄</dt><dd>{{ job.ageMin }}–{{ job.ageMax }} 岁</dd></div>
            <div><dt>工作经验</dt><dd>{{ job.minWorkYears ? `${job.minWorkYears} 年以上` : '不限' }}</dd></div>
            <div class="full">
              <dt>所需证件</dt>
              <dd class="docs"><span v-for="d in job.requiredDocuments ?? []" :key="d" class="status-tag">{{ d }}</span><span v-if="!job.requiredDocuments?.length">—</span></dd>
            </div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">面试</h4>
          <dl class="desc-list">
            <div class="full"><dt>面试地址</dt><dd>{{ job.interviewAddress }}</dd></div>
            <div><dt>面试时间</dt><dd>{{ job.interviewTimeDesc || '—' }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">岗位职责</h4>
          <p class="pre">{{ job.duties }}</p>
        </section>
        <section v-if="job.benefits" class="blk">
          <h4 class="blk-t">福利待遇</h4>
          <p class="pre">{{ job.benefits }}</p>
        </section>
        <section v-if="job.notes" class="blk">
          <h4 class="blk-t">注意事项</h4>
          <p class="pre">{{ job.notes }}</p>
        </section>

        <section class="blk">
          <h4 class="blk-t">时间</h4>
          <dl class="desc-list">
            <div><dt>创建</dt><dd>{{ fmtDateTime(job.createdAt) }}</dd></div>
            <div><dt>最近提交审核</dt><dd>{{ fmtDateTime(job.submittedAt) }}</dd></div>
            <div><dt>上架</dt><dd>{{ fmtDateTime(job.postedAt) }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">审核轨迹</h4>
          <el-timeline v-if="audits.length" class="tline">
            <el-timeline-item v-for="(a, i) in audits" :key="i" :timestamp="fmtDateTime(a.createdAt)" :type="AUDIT_ACTION[a.action]?.type ?? 'primary'">
              <b class="tl-a">{{ AUDIT_ACTION[a.action]?.text ?? a.action }}</b>
              <p v-if="a.remark" class="tl-r">{{ a.remark }}</p>
            </el-timeline-item>
          </el-timeline>
          <p v-else class="hint">暂无审核记录</p>
        </section>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.wrap { min-height: 200px; }
.hd { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.hd-tip { margin-top: var(--space-3); }
.hd + .blk, .hd-tip + .blk { margin-top: var(--space-6); }
/* 薪资：白底上 20px / 600 的薪资色（规范 Color Roles：薪资色只给 18px 以上加粗的数字） */
.salary { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--salary); white-space: nowrap; }
.salary small { margin-left: 2px; font-size: var(--font-size-min); font-weight: var(--font-weight-regular); color: var(--text-3); }
.desc-list .full { grid-column: 1 / -1; }
.docs { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.pre { margin: 0; white-space: pre-wrap; font-size: var(--font-size-body); line-height: 1.7; color: var(--text-1); }
.hint { margin: 0; font-size: var(--font-size-aux); color: var(--text-3); }
.tline { padding-left: var(--space-1); }
.tl-a { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tl-r { margin: 2px 0 0; font-size: var(--font-size-aux); color: var(--text-2); }
</style>

<style>
/* 抽屉挂在 body 上：标题用区块标题样式（同消息抽屉），标题下不留大块空白 */
.job-drawer .el-drawer__title { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.job-drawer .el-drawer__header { margin-bottom: 0; }
</style>
