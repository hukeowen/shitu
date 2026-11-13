<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, useDict, type BrokerCaseRow, type BrokerReport, type JobView } from '@shitu/api-client'
import CountdownTag from '@/components/CountdownTag.vue'
import DictTag from '@/components/DictTag.vue'
import { fmtDateTime, salaryRange } from '@/utils/format'

/**
 * 流转工单抽屉：A-06 AI 分析报告 + A-07 二次推荐 / 释放至公域。
 * 按钮严格按 allowedActions（REPORT / RECOMMEND / RELEASE），其他角色只读。
 */
type CaseTab = 'report' | 'recommend' | 'release'
const props = defineProps<{ row: BrokerCaseRow | null; tab: CaseTab; now: number }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ changed: [] }>()
const { label } = useDict()

const active = ref<CaseTab>('report')
const can = (a: string) => props.row?.allowedActions.includes(a) ?? false

// ---------------------------------------------------------------- 报告
const report = ref<BrokerReport | null>(null)
const reportLoading = ref(false)
const reportError = ref('')
const generating = ref(false)

async function loadReport(id: number) {
  reportLoading.value = true
  reportError.value = ''
  try {
    report.value = await tenantApi.brokerLatestReport(id)
  } catch (e) {
    report.value = null
    reportError.value = errorMessage(e, '报告加载失败')
  } finally {
    reportLoading.value = false
  }
}
async function generate() {
  const r = props.row
  if (!r) return
  generating.value = true
  try {
    report.value = await tenantApi.brokerReport(r.id)
    ElMessage.success('AI 分析报告已生成')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    generating.value = false
  }
}
/** matchScore 兼容 0–1 与 0–100 两种口径 */
function pct(s: number): number {
  const v = Number(s)
  return Math.round(v <= 1 ? v * 100 : v)
}
function scoreColor(s: number) {
  const v = pct(s)
  return v >= 85 ? 'var(--ok)' : v >= 70 ? 'var(--warn)' : 'var(--ink-500)'
}

// ---------------------------------------------------------------- 二次推荐
const jobs = ref<JobView[]>([])
const jobsLoading = ref(false)
const rec = reactive({ jobId: '', note: '', saving: false })
const selectedJob = computed(() => jobs.value.find((j) => j.jobId === rec.jobId) ?? null)

async function loadJobs() {
  if (jobs.value.length) return
  jobsLoading.value = true
  try {
    const r = await tenantApi.jobs({ status: 'RECRUITING', page: 1, pageSize: 100 })
    jobs.value = r.records.filter((j) => j.quotaRemaining > 0)
  } catch (e) {
    ElMessage.error(errorMessage(e, '岗位加载失败'))
  } finally {
    jobsLoading.value = false
  }
}
function pickFromReport(jobId: string) {
  rec.jobId = jobId
  active.value = 'recommend'
}
async function submitRecommend() {
  const r = props.row
  if (!r) return
  if (!rec.jobId) return ElMessage.warning('请选择推荐岗位')
  rec.saving = true
  try {
    await tenantApi.brokerRecommend(r.id, rec.jobId, rec.note.trim() || undefined)
    ElMessage.success('推荐已推送给求职者（站内信 + 短信），用户在 C 端确认后进入报名流程')
    rec.jobId = ''
    rec.note = ''
    emit('changed')
    visible.value = false
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    rec.saving = false
  }
}

// ---------------------------------------------------------------- 释放
const RELEASE_REASONS = ['公司已有岗位用户均不满意', 'AI 与人工均无法匹配', '用户明确表示放弃本公司岗位']
const rel = reactive({ reason: '', remark: '', saving: false })

async function submitRelease() {
  const r = props.row
  if (!r) return
  if (!rel.reason) return ElMessage.warning('请选择释放原因')
  try {
    await ElMessageBox.confirm(
      `释放后 ${r.seekerName} 的当前归属清空、变为公域，可被全平台劳务公司匹配；来源归属保留。此操作不可逆，确定释放？`,
      '释放至公域',
      { type: 'warning', confirmButtonText: '确认释放', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  rel.saving = true
  try {
    const reason = rel.remark.trim() ? `${rel.reason}：${rel.remark.trim()}` : rel.reason
    await tenantApi.brokerRelease(r.id, reason)
    ElMessage.success('已释放至公域，用户可匹配全平台岗位')
    rel.reason = ''
    rel.remark = ''
    emit('changed')
    visible.value = false
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    rel.saving = false
  }
}

watch(
  () => [visible.value, props.row?.id] as const,
  ([v, id]) => {
    if (!v || id == null) return
    active.value = props.tab
    report.value = null
    loadReport(id)
    if (can('RECOMMEND')) loadJobs()
  },
  { immediate: true },
)
watch(active, (t) => {
  if (t === 'recommend' && can('RECOMMEND')) loadJobs()
})
</script>

<template>
  <el-drawer v-model="visible" size="640px" :title="row ? `流转工单 #${row.id}` : '流转工单'">
    <template v-if="row">
      <div class="hd">
        <div class="av">{{ row.seekerName.slice(0, 1) }}</div>
        <div style="flex: 1; min-width: 0">
          <div class="nm">{{ row.seekerName }} <span class="mono t-sm dim">{{ row.phoneMasked }}</span></div>
          <div class="row-wrap" style="margin-top: 5px">
            <DictTag type="BrokerCaseStatus" :value="row.status" />
            <DictTag type="BrokerTriggerType" :value="row.triggerType" />
            <span class="tag">已匹配 {{ row.matchCount }} 次</span>
          </div>
        </div>
      </div>
      <div class="grid g-3" style="gap: 10px; margin: 14px 0">
        <div>
          <div class="t-xs">联系时限（2h）</div>
          <div v-if="row.contactedAt" class="t-sm strong">已联系 {{ fmtDateTime(row.contactedAt).slice(5) }}</div>
          <CountdownTag v-else :deadline="row.contactDueAt" :now="now" />
        </div>
        <div>
          <div class="t-xs">出结果时限（24h）</div>
          <CountdownTag :deadline="row.resolveDueAt" :now="now" />
        </div>
        <div><div class="t-xs">流转时间</div><div class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</div></div>
      </div>
      <div class="note" style="margin-bottom: 12px"><b>画像摘要：</b>{{ row.profileSummary }}</div>
      <div v-if="!row.allowedActions.length" class="note note--info" style="margin-bottom: 12px">
        {{ ['OPEN', 'CONTACTED', 'RECOMMENDED'].includes(row.status) ? '当前角色只读：二次推荐由人才经纪人操作，释放由经纪人或驻场操作。' : '工单已结束。' }}
      </div>

      <el-tabs v-model="active">
        <el-tab-pane label="AI 分析报告" name="report">
          <div v-loading="reportLoading" style="min-height: 120px">
            <el-alert v-if="reportError" type="error" :title="reportError" show-icon :closable="false" />
            <template v-else-if="report">
              <div class="row" style="margin-bottom: 10px">
                <span class="t-xs mono">生成于 {{ fmtDateTime(report.createdAt) }} · {{ report.generator === 'LLM' ? '大模型' : '规则模板' }}</span>
                <span class="spacer" />
                <el-button v-if="can('REPORT')" size="small" :loading="generating" @click="generate">重新生成</el-button>
              </div>
              <div class="note note--info" style="margin-bottom: 12px"><b>AI 结论：</b>{{ report.summary }}</div>
              <div class="eyebrow" style="margin-bottom: 8px">推荐岗位（本公司全部招聘中岗位）</div>
              <div v-if="!report.recommendations.length" class="t-sm dim">本公司当前没有可推荐的招聘中岗位。</div>
              <div v-for="(r, i) in report.recommendations" :key="r.jobId" class="rec" :class="{ top: i === 0 }">
                <div class="row" style="align-items: flex-start">
                  <div style="flex: 1; min-width: 0">
                    <b class="rt">{{ r.title }}</b>
                    <div class="t-xs mono">{{ r.jobId }}</div>
                  </div>
                  <div style="text-align: right">
                    <div class="num score" :style="{ color: scoreColor(r.matchScore) }">{{ pct(r.matchScore) }}%</div>
                    <div class="t-xs">匹配度</div>
                  </div>
                </div>
                <div class="t-sm" style="margin-top: 6px; line-height: 1.7"><b class="strong">推荐理由：</b>{{ r.reason }}</div>
                <div v-if="can('RECOMMEND')" style="margin-top: 8px; text-align: right">
                  <el-button size="small" type="primary" plain @click="pickFromReport(r.jobId)">推荐此岗位</el-button>
                </div>
              </div>
            </template>
            <el-empty v-else :image-size="70" description="暂无 AI 分析报告">
              <el-button v-if="can('REPORT')" type="primary" :loading="generating" @click="generate">生成报告</el-button>
            </el-empty>
          </div>
        </el-tab-pane>

        <el-tab-pane label="二次推荐" name="recommend">
          <template v-if="can('RECOMMEND')">
            <el-form label-width="80px" @submit.prevent>
              <el-form-item label="推荐岗位" required>
                <el-select v-model="rec.jobId" filterable placeholder="选择本公司招聘中的岗位" :loading="jobsLoading" style="width: 100%">
                  <el-option v-for="j in jobs" :key="j.jobId" :label="`${j.title} · ${j.projectName}`" :value="j.jobId">
                    <span>{{ j.title }}</span>
                    <span class="t-xs" style="float: right">{{ j.projectName }} · 剩 {{ j.quotaRemaining }}</span>
                  </el-option>
                </el-select>
              </el-form-item>
              <div v-if="selectedJob" class="jobcard">
                <div class="row-wrap">
                  <span class="tag">{{ salaryRange(selectedJob.salaryMin, selectedJob.salaryMax) }} 元/月</span>
                  <span class="tag">{{ label('ShiftType', selectedJob.shiftType) }}</span>
                  <span class="tag">{{ selectedJob.mealProvided ? '包吃' : '不包吃' }} · {{ selectedJob.dormProvided ? '包住' : '不包住' }}</span>
                  <span class="tag">剩余 {{ selectedJob.quotaRemaining }} 名额</span>
                </div>
                <div class="t-xs" style="margin-top: 6px">{{ selectedJob.clientName }} · {{ selectedJob.city }}</div>
              </div>
              <el-form-item label="推荐说明">
                <el-input v-model="rec.note" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="给求职者的说明，如：长白班、4 人间，与您诉求最接近" />
              </el-form-item>
            </el-form>
            <div class="note note--info">推荐通过站内信 + 短信推送给求职者；用户在 C 端确认后进入报名流程，仍需实名 + 告知书。</div>
            <div style="margin-top: 14px; text-align: right">
              <el-button type="primary" :loading="rec.saving" @click="submitRecommend">推送推荐给用户</el-button>
            </div>
          </template>
          <el-empty v-else :image-size="60" description="二次推荐由人才经纪人操作" />
        </el-tab-pane>

        <el-tab-pane label="释放至公域" name="release">
          <template v-if="can('RELEASE')">
            <div class="note note--danger" style="margin-bottom: 14px"><b>此操作不可逆。</b>释放后用户当前归属清空、变为公域，可被全平台所有劳务公司匹配。只有劳务公司（驻场 / 经纪人）可操作释放。</div>
            <el-form label-position="top" @submit.prevent>
              <el-form-item label="释放原因" required>
                <el-radio-group v-model="rel.reason" class="reasons">
                  <el-radio v-for="r in RELEASE_REASONS" :key="r" :value="r">{{ r }}</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="备注">
                <el-input v-model="rel.remark" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="补充说明…" />
              </el-form-item>
            </el-form>
            <dl class="kv"><dt>当前归属</dt><dd>本公司 → <span style="color: var(--danger)">清空</span></dd></dl>
            <dl class="kv"><dt>公域 / 私域</dt><dd>私域 → <span class="tag tag--public">公域</span></dd></dl>
            <dl class="kv"><dt>来源归属</dt><dd style="color: var(--ok)">保持不变</dd></dl>
            <dl class="kv"><dt>后续流转费</dt><dd>本公司得 8 元/人/天</dd></dl>
            <div style="margin-top: 14px; text-align: right">
              <el-button type="danger" :loading="rel.saving" @click="submitRelease">确认释放</el-button>
            </div>
          </template>
          <el-empty v-else :image-size="60" description="释放由人才经纪人或驻场操作" />
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-drawer>
</template>

<style scoped>
.hd { display: flex; gap: 12px; align-items: center; }
.av { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 16px; background: var(--signal-50); color: var(--signal-700); flex: none; }
.nm { font-size: 16px; font-weight: 700; color: var(--ink-900); }
.rec { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px 14px; margin-bottom: 10px; }
.rec.top { border-color: var(--ok-line); }
.rt { font-size: 14.5px; color: var(--ink-900); }
.score { font-size: 22px; }
.jobcard { margin: -6px 0 14px 80px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--line); }
.reasons { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
</style>
