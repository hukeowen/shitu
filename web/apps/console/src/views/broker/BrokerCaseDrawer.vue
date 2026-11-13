<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, useDict, type BrokerCaseRow, type BrokerReport, type JobView } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconFileText, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import { boxSubmit, isBlocked } from '@/composables/boxSubmit'
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
/** 后端拒绝生成 / 推荐 / 释放的原因：留在抽屉里、置灰对应按钮，下次打开抽屉重新判断（断网、超时只提示） */
const why = reactive({ report: '', recommend: '', release: '' })

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
  if (!r || generating.value || why.report) return
  generating.value = true
  try {
    report.value = await tenantApi.brokerReport(r.id)
    ElMessage.success('AI 分析报告已生成')
  } catch (e) {
    generating.value = false
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) why.report = `暂时不能生成报告：${errorMessage(e)}`
  } finally {
    generating.value = false
  }
}
/** matchScore 兼容 0–1 与 0–100 两种口径 */
function pct(s: number): number {
  const v = Number(s)
  return Math.round(v <= 1 ? v * 100 : v)
}
/** 匹配度色调：85 以上成功色、70 以上提醒色，其余二级文字（数字本身照写，不只靠颜色） */
function scoreTone(s: number) {
  const v = pct(s)
  return v >= 85 ? 'score--hi' : v >= 70 ? 'score--mid' : ''
}

// ---------------------------------------------------------------- 二次推荐
const jobs = ref<JobView[]>([])
const jobsLoading = ref(false)
const jobsError = ref('')
const rec = reactive({ jobId: '', note: '', saving: false })
const selectedJob = computed(() => jobs.value.find((j) => j.jobId === rec.jobId) ?? null)

async function loadJobs() {
  if (jobs.value.length) return
  jobsLoading.value = true
  jobsError.value = ''
  try {
    const r = await tenantApi.jobs({ status: 'RECRUITING', page: 1, pageSize: 100 })
    jobs.value = r.records.filter((j) => j.quotaRemaining > 0)
  } catch (e) {
    jobsError.value = errorMessage(e, '岗位加载失败')
    ElMessage.error(jobsError.value)
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
  if (rec.saving || why.recommend) return
  rec.saving = true
  try {
    await tenantApi.brokerRecommend(r.id, rec.jobId, rec.note.trim() || undefined)
    ElMessage.success('推荐已推送给求职者（站内信 + 短信），用户在 C 端确认后进入报名流程')
    rec.jobId = ''
    rec.note = ''
    emit('changed')
    visible.value = false
  } catch (e) {
    rec.saving = false
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) why.recommend = `暂时不能推送推荐：${errorMessage(e)}`
  } finally {
    rec.saving = false
  }
}

// ---------------------------------------------------------------- 释放
const RELEASE_REASONS = ['公司已有岗位用户均不满意', 'AI 与人工均无法匹配', '用户明确表示放弃本公司岗位']
const rel = reactive({ reason: '', remark: '' })

async function submitRelease() {
  const r = props.row
  if (!r) return
  if (!rel.reason) return ElMessage.warning('请选择释放原因')
  const reason = rel.remark.trim() ? `${rel.reason}：${rel.remark.trim()}` : rel.reason
  // 确认框里提交：框不关、确认按钮转圈，被拒时原因写在框里，抽屉里也留原因并置灰「确认释放」
  const s = boxSubmit(
    `释放后 ${r.seekerName} 的当前归属清空、变为公域，可被全平台劳务公司匹配；来源归属保留。此操作不可逆，确定释放？`,
    '释放',
    () => tenantApi.brokerRelease(r.id, reason),
    (w) => (why.release = w),
  )
  try {
    await ElMessageBox.confirm(s.message, '释放至公域', {
      type: 'warning',
      confirmButtonText: '确认释放',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      beforeClose: s.beforeClose,
    })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('已释放至公域，用户可匹配全平台岗位')
  rel.reason = ''
  rel.remark = ''
  emit('changed')
  visible.value = false
}

watch(
  () => [visible.value, props.row?.id] as const,
  ([v, id]) => {
    if (!v || id == null) return
    active.value = props.tab
    report.value = null
    why.report = ''
    why.recommend = ''
    why.release = ''
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
  <el-drawer v-model="visible" size="640px" class="case-drawer" :title="row ? `流转工单 #${row.id}` : '流转工单'">
    <template v-if="row">
      <div class="hd">
        <div class="av">{{ row.seekerName.slice(0, 1) }}</div>
        <div class="hd-main">
          <h3>{{ row.seekerName }} <span class="phone">{{ row.phoneMasked }}</span></h3>
          <div class="tags">
            <DictTag type="BrokerCaseStatus" :value="row.status" />
            <DictTag type="BrokerTriggerType" :value="row.triggerType" />
            <span class="status-tag">已匹配 {{ row.matchCount }} 次</span>
          </div>
        </div>
      </div>

      <section class="blk">
        <h4 class="blk-t">时限</h4>
        <dl class="desc-list">
          <div>
            <dt>联系时限（2h）</dt>
            <dd v-if="row.contactedAt">已联系 {{ fmtDateTime(row.contactedAt).slice(5) }}</dd>
            <dd v-else><RemainTag :deadline="row.contactDueAt" :now="now" /></dd>
          </div>
          <div><dt>出结果时限（24h）</dt><dd><RemainTag :deadline="row.resolveDueAt" :now="now" /></dd></div>
          <div><dt>流转时间</dt><dd>{{ fmtDateTime(row.createdAt) }}</dd></div>
        </dl>
      </section>

      <section class="blk">
        <h4 class="blk-t">画像摘要</h4>
        <p class="para">{{ row.profileSummary }}</p>
        <div v-if="!row.allowedActions.length" class="notice-bar readonly">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>{{ ['OPEN', 'CONTACTED', 'RECOMMENDED'].includes(row.status) ? '当前角色只读：二次推荐由人才经纪人操作，释放由经纪人或驻场操作。' : '工单已结束。' }}</span>
        </div>
      </section>

      <el-tabs v-model="active" class="blk tabs">
        <el-tab-pane label="AI 分析报告" name="report">
          <div v-loading="reportLoading" class="pane">
            <div v-if="reportError" class="state-box">
              <IconCircleExclamationPoint :size="48" />
              <h4>{{ reportError }}</h4>
              <p>请检查网络后重新加载</p>
              <el-button @click="loadReport(row.id)">重新加载</el-button>
            </div>
            <template v-else-if="report">
              <div class="rep-hd">
                <span class="hint">生成于 {{ fmtDateTime(report.createdAt) }} · {{ report.generator === 'LLM' ? '大模型' : '规则模板' }}</span>
                <span class="spacer" />
                <el-button v-if="can('REPORT')" size="small" :loading="generating" :disabled="!!why.report" @click="generate">重新生成</el-button>
              </div>
              <p v-if="why.report" class="blocked-why why" role="status">{{ why.report }}</p>
              <div class="notice-bar conclusion"><IconInfo :size="16" class="notice-bar-i" /><span><b>AI 结论：</b>{{ report.summary }}</span></div>
              <h4 class="blk-t">推荐岗位<small>本公司全部招聘中岗位</small></h4>
              <p v-if="!report.recommendations.length" class="hint">本公司当前没有可推荐的招聘中岗位。</p>
              <div v-for="r in report.recommendations" :key="r.jobId" class="rec">
                <div class="rec-hd">
                  <div class="rec-main">
                    <b class="rt">{{ r.title }}</b>
                    <div class="hint code">{{ r.jobId }}</div>
                  </div>
                  <div class="rec-score">
                    <b class="score" :class="scoreTone(r.matchScore)">{{ pct(r.matchScore) }}%</b>
                    <div class="hint">匹配度</div>
                  </div>
                </div>
                <p class="para rec-why"><b>推荐理由：</b>{{ r.reason }}</p>
                <div v-if="can('RECOMMEND')" class="rec-act">
                  <el-button size="small" @click="pickFromReport(r.jobId)">推荐此岗位</el-button>
                </div>
              </div>
            </template>
            <div v-else-if="!reportLoading" class="state-box">
              <IconFileText :size="48" />
              <h4>暂无 AI 分析报告</h4>
              <p>{{ can('REPORT') ? '根据求职者画像和本公司招聘中的岗位生成' : '报告由人才经纪人生成' }}</p>
              <el-button v-if="can('REPORT')" type="primary" :loading="generating" :disabled="!!why.report" @click="generate">生成报告</el-button>
              <p v-if="why.report" class="blocked-why" role="status">{{ why.report }}</p>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="二次推荐" name="recommend">
          <template v-if="can('RECOMMEND')">
            <el-form label-width="80px" @submit.prevent>
              <el-form-item label="推荐岗位" required>
                <el-select v-model="rec.jobId" filterable placeholder="选择本公司招聘中的岗位" :loading="jobsLoading" style="width: 100%">
                  <el-option v-for="j in jobs" :key="j.jobId" :label="`${j.title} · ${j.projectName}`" :value="j.jobId">
                    <span>{{ j.title }}</span>
                    <span class="hint opt-sub">{{ j.projectName }} · 剩 {{ j.quotaRemaining }}</span>
                  </el-option>
                </el-select>
                <p v-if="jobsError" class="blocked-why">{{ jobsError }} <el-button link type="primary" @click="loadJobs">重新加载</el-button></p>
              </el-form-item>
              <div v-if="selectedJob" class="jobcard">
                <div class="tags">
                  <span class="status-tag">{{ salaryRange(selectedJob.salaryMin, selectedJob.salaryMax) }} 元/月</span>
                  <span class="status-tag">{{ label('ShiftType', selectedJob.shiftType) }}</span>
                  <span class="status-tag">{{ selectedJob.mealProvided ? '包吃' : '不包吃' }} · {{ selectedJob.dormProvided ? '包住' : '不包住' }}</span>
                  <span class="status-tag">剩余 {{ selectedJob.quotaRemaining }} 名额</span>
                </div>
                <div class="hint">{{ selectedJob.clientName }} · {{ selectedJob.city }}</div>
              </div>
              <el-form-item label="推荐说明">
                <el-input v-model="rec.note" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="给求职者的说明，如：长白班、4 人间，与您诉求最接近" />
              </el-form-item>
            </el-form>
            <div class="notice-bar"><IconInfo :size="16" class="notice-bar-i" /><span>推荐通过站内信 + 短信推送给求职者；用户在 C 端确认后进入报名流程，仍需实名 + 告知书。</span></div>
            <div class="foot">
              <p v-if="why.recommend" class="blocked-why" role="status">{{ why.recommend }}</p>
              <el-button type="primary" :loading="rec.saving" :disabled="!!why.recommend" @click="submitRecommend">推送推荐给用户</el-button>
            </div>
          </template>
          <div v-else class="state-box"><IconInfo :size="48" /><h4>二次推荐由人才经纪人操作</h4><p>当前角色只能查看</p></div>
        </el-tab-pane>

        <el-tab-pane label="释放至公域" name="release">
          <template v-if="can('RELEASE')">
            <div class="notice-bar notice-bar--danger irrev">
              <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
              <span><b>此操作不可逆。</b>释放后用户当前归属清空、变为公域，可被全平台所有劳务公司匹配。只有劳务公司（驻场 / 经纪人）可操作释放。</span>
            </div>
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
            <dl class="kv"><dt>当前归属（bound）</dt><dd>本公司 → <span class="danger">清空</span></dd></dl>
            <dl class="kv"><dt>公域 / 私域</dt><dd>私域 → <span class="status-tag status-tag--public">公域</span></dd></dl>
            <dl class="kv"><dt>来源归属（source）</dt><dd class="ok">保持不变</dd></dl>
            <dl class="kv"><dt>后续流转费</dt><dd>本公司得 8 元/人/天</dd></dl>
            <div class="foot">
              <p v-if="why.release" class="blocked-why" role="status">{{ why.release }}</p>
              <el-button type="danger" :disabled="!!why.release" @click="submitRelease">确认释放</el-button>
            </div>
          </template>
          <div v-else class="state-box"><IconInfo :size="48" /><h4>释放由人才经纪人或驻场操作</h4><p>当前角色只能查看</p></div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-drawer>
</template>

<style scoped>
.hd { display: flex; gap: var(--space-3); align-items: center; }
.hd-main { flex: 1; min-width: 0; }
.hd h3 { margin: 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.phone { margin-left: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); color: var(--text-3); }
.av { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: var(--font-weight-semibold); font-size: var(--font-size-section); background: var(--primary-bg); color: var(--primary-text); flex: none; }
.tags { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.hd + .blk { margin-top: var(--space-6); }
.para { margin: 0; font-size: var(--font-size-body); line-height: 1.7; color: var(--text-1); }
.para b { font-weight: var(--font-weight-semibold); }
.hint { margin: 0; font-size: var(--font-size-aux); color: var(--text-3); }
.readonly { margin-top: var(--space-3); }
.tabs { margin-top: var(--space-6); }
.pane { min-height: 120px; }
.rep-hd { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.why { margin-bottom: var(--space-3); }
.conclusion { margin-bottom: var(--space-4); }
.rec { border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-3); }
.rec-hd { display: flex; align-items: flex-start; gap: var(--space-3); }
.rec-main { flex: 1; min-width: 0; }
.rt { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.rec-score { text-align: right; }
.score { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-2); }
.score--hi { color: var(--success-text); }
.score--mid { color: var(--warning-text); }
.rec-why { margin-top: var(--space-2); font-size: var(--font-size-aux); }
.rec-act { margin-top: var(--space-2); text-align: right; }
.opt-sub { float: right; }
.code { font-family: var(--font-mono); }
.jobcard { margin: calc(var(--space-2) * -1) 0 var(--space-4) 80px; padding: var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); }
.jobcard .tags { margin: 0 0 var(--space-2); }
.foot { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-2); margin-top: var(--space-4); }
.irrev { margin-bottom: var(--space-4); }
.reasons { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); }
.danger { color: var(--danger-text); }
.ok { color: var(--success-text); }
</style>

<style>
/* 抽屉挂在 body 上：标题用区块标题样式（同消息抽屉），标题下不留大块空白 */
.case-drawer .el-drawer__title { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.case-drawer .el-drawer__header { margin-bottom: 0; }
</style>
