<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  errorMessage,
  isApiError,
  tenantApi,
  useDict,
  type JobRequest,
  type JobType,
  type JobView,
  type ProjectView,
  type ShiftType,
} from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import { useMeStore } from '@/stores/me'
import { salaryRange } from '@/utils/format'

/** T-302 创建 / 编辑岗位（原型 v-job-edit）。提交即进入平台审核 */
const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
const { label, options } = useDict()

const jobId = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const isEdit = computed(() => !!jobId.value)
const job = ref<JobView | null>(null)
const projects = ref<ProjectView[]>([])
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const formRef = ref<FormInstance>()

const DOC_SUGGEST = ['身份证原件', '身份证复印件 ×2', '银行卡', '1 寸白底照 ×2', '健康证', '毕业证']

interface JobForm {
  projectId: string
  title: string
  jobType: JobType | ''
  factoryJob: boolean
  salaryMin: number | undefined
  salaryMax: number | undefined
  shiftType: ShiftType | ''
  mealProvided: boolean
  dormProvided: boolean
  dormRoomSize: number | undefined
  dormAircon: boolean
  dormPrivateBath: boolean
  minWorkYears: number
  ageMin: number
  ageMax: number
  duties: string
  benefits: string
  requiredDocuments: string[]
  notes: string
  interviewAddress: string
  interviewTimeDesc: string
  quotaTotal: number
}

function blank(): JobForm {
  return {
    projectId: '',
    title: '',
    jobType: '',
    factoryJob: true,
    salaryMin: undefined,
    salaryMax: undefined,
    shiftType: '',
    mealProvided: false,
    dormProvided: false,
    dormRoomSize: undefined,
    dormAircon: false,
    dormPrivateBath: false,
    minWorkYears: 0,
    ageMin: 18,
    ageMax: 45,
    duties: '',
    benefits: '',
    requiredDocuments: ['身份证原件'],
    notes: '',
    interviewAddress: '',
    interviewTimeDesc: '',
    quotaTotal: 10,
  }
}
const form = reactive<JobForm>(blank())

function fill(j: JobView) {
  Object.assign(form, {
    projectId: j.projectId,
    title: j.title,
    jobType: j.jobType,
    factoryJob: j.factoryJob,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    shiftType: j.shiftType,
    mealProvided: j.mealProvided,
    dormProvided: j.dormProvided,
    dormRoomSize: j.dormRoomSize,
    dormAircon: j.dormAircon ?? false,
    dormPrivateBath: j.dormPrivateBath ?? false,
    minWorkYears: j.minWorkYears ?? 0,
    ageMin: j.ageMin,
    ageMax: j.ageMax,
    duties: j.duties,
    benefits: j.benefits ?? '',
    requiredDocuments: [...(j.requiredDocuments ?? [])],
    notes: j.notes ?? '',
    interviewAddress: j.interviewAddress,
    interviewTimeDesc: j.interviewTimeDesc ?? '',
    quotaTotal: j.quotaTotal,
  } satisfies JobForm)
}

async function init() {
  loading.value = true
  loadError.value = ''
  job.value = null
  try {
    const [ps, j] = await Promise.all([tenantApi.projects({ status: 'ACTIVE' }), jobId.value ? tenantApi.job(jobId.value) : Promise.resolve(null)])
    projects.value = ps
    if (j) {
      if (!j.allowedActions.includes('EDIT')) {
        ElMessage.warning(`当前状态（${label('JobStatus', j.status)}）不允许编辑`)
        router.replace('/pm/jobs')
        return
      }
      job.value = j
      fill(j)
      // 已结束项目不在 ACTIVE 列表里时补上，避免下拉显示 id
      if (!ps.some((p) => p.projectId === j.projectId)) {
        tenantApi.project(j.projectId).then((p) => (projects.value = [p, ...projects.value])).catch(() => undefined)
      }
    } else {
      Object.assign(form, blank())
    }
    formRef.value?.clearValidate()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(init)
watch(jobId, init)

const project = computed(() => projects.value.find((p) => p.projectId === form.projectId))
const reauditWarn = computed(() => job.value && (job.value.status === 'RECRUITING' || job.value.status === 'PAUSED'))
const minQuota = computed(() => Math.max(1, job.value?.quotaOccupied ?? 1))

watch(
  () => form.projectId,
  (id, old) => {
    const p = projects.value.find((x) => x.projectId === id)
    if (p && old !== undefined && !form.interviewAddress) form.interviewAddress = p.address
  },
)
watch(
  () => form.dormProvided,
  (v) => {
    if (!v) Object.assign(form, { dormRoomSize: undefined, dormAircon: false, dormPrivateBath: false })
  },
)

// ---------------------------------------------------------------- 校验（与后端 JobService.validate 一致）
const rules = computed<FormRules>(() => ({
  title: [
    { required: true, message: '请填写岗位名称', trigger: 'blur' },
    { max: 64, message: '岗位名称 64 字以内', trigger: 'blur' },
  ],
  projectId: [{ required: true, message: '请选择所属项目', trigger: 'change' }],
  jobType: [{ required: true, message: '请选择工种', trigger: 'change' }],
  shiftType: [{ required: true, message: '请选择班次', trigger: 'change' }],
  salaryMin: [{ required: true, type: 'number', min: 1, message: '请填写薪资下限', trigger: 'blur' }],
  salaryMax: [
    { required: true, type: 'number', message: '请填写薪资上限', trigger: 'blur' },
    {
      validator: (_r, v: number | undefined, cb) => {
        if (v == null) return cb()
        if (form.salaryMin != null && v < form.salaryMin) return cb(new Error('上限不能低于下限'))
        if (v >= 100000) return cb(new Error('薪资上限需低于 100000'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  ageMax: [
    {
      validator: (_r, _v, cb) => (form.ageMin <= form.ageMax ? cb() : cb(new Error('最小年龄不能大于最大年龄'))),
      trigger: 'change',
    },
  ],
  duties: [
    { required: true, message: '请填写岗位职责', trigger: 'blur' },
    { max: 2000, message: '岗位职责 2000 字以内', trigger: 'blur' },
  ],
  interviewAddress: [{ required: true, message: '请填写面试地址', trigger: 'blur' }],
  quotaTotal: [{ required: true, type: 'number', min: minQuota.value, max: 9999, message: `名额为 ${minQuota.value}–9999`, trigger: 'change' }],
  requiredDocuments: [{ type: 'array', max: 10, message: '所需证件最多 10 项', trigger: 'change' }],
}))

function toRequest(): JobRequest {
  return {
    projectId: form.projectId,
    title: form.title.trim(),
    jobType: form.jobType as JobType,
    factoryJob: form.factoryJob,
    salaryMin: form.salaryMin ?? 0,
    salaryMax: form.salaryMax ?? 0,
    shiftType: form.shiftType as ShiftType,
    mealProvided: form.mealProvided,
    dormProvided: form.dormProvided,
    dormRoomSize: form.dormProvided ? form.dormRoomSize : undefined,
    dormAircon: form.dormProvided ? form.dormAircon : undefined,
    dormPrivateBath: form.dormProvided ? form.dormPrivateBath : undefined,
    minWorkYears: form.minWorkYears,
    ageMin: form.ageMin,
    ageMax: form.ageMax,
    duties: form.duties.trim(),
    benefits: form.benefits.trim() || undefined,
    requiredDocuments: form.requiredDocuments.map((d) => d.trim()).filter(Boolean),
    notes: form.notes.trim() || undefined,
    interviewAddress: form.interviewAddress.trim(),
    interviewTimeDesc: form.interviewTimeDesc.trim() || undefined,
    quotaTotal: form.quotaTotal,
  }
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) {
    ElMessage.warning('请检查表单中标红的字段')
    return
  }
  if (project.value && !project.value.contractEffective) {
    ElMessage.warning('该项目的甲方没有审核通过且在有效期内的合作合同，无法发布岗位')
    return
  }
  if (reauditWarn.value) {
    try {
      await ElMessageBox.confirm('保存后将重新提交平台审核，审核期间暂停匹配。确定保存？', '重新提交审核', {
        type: 'warning',
        confirmButtonText: '保存并提交审核',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  saving.value = true
  try {
    if (isEdit.value && job.value) {
      await tenantApi.updateJob(job.value.jobId, toRequest())
      ElMessage.success('已保存，岗位已重新提交平台审核')
    } else {
      await tenantApi.createJob(toRequest())
      ElMessage.success('岗位已提交，等待平台审核')
    }
    router.push('/pm/jobs')
  } catch (e) {
    if (isApiError(e, 'TEN_4004')) {
      ElMessageBox.alert(`${errorMessage(e)}。请先在「项目与甲方 → 合作合同」上传合同并等待平台审核通过。`, '无法发布', {
        confirmButtonText: '知道了',
      })
    } else {
      ElMessage.error(errorMessage(e))
    }
  } finally {
    saving.value = false
  }
}

const preview = computed(() => {
  const chips: string[] = []
  if (form.mealProvided && form.dormProvided) chips.push('包吃包住')
  else if (form.mealProvided) chips.push('包吃')
  else if (form.dormProvided) chips.push('包住')
  if (form.dormProvided && form.dormRoomSize) chips.push(`${form.dormRoomSize} 人间${form.dormAircon ? '·空调' : ''}`)
  if (form.shiftType) chips.push(label('ShiftType', form.shiftType))
  chips.push(`剩 ${Math.max(0, form.quotaTotal - (job.value?.quotaOccupied ?? 0))} 名额`)
  return chips
})
</script>

<template>
  <div v-loading="loading">
    <div class="page-hd">
      <div>
        <h2>{{ isEdit ? '编辑岗位' : '创建岗位' }}</h2>
        <p>岗位信息将作为 AI 问薪匹配的输入，并直接展示于求职者端岗位详情页</p>
      </div>
      <span class="spacer" />
      <span class="ref">功能 <b>T-302</b></span>
      <el-button @click="router.push('/pm/jobs')">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!!loadError || !meStore.can('JOB_MANAGE')" @click="submit">
        {{ isEdit ? '保存并提交审核' : '提交审核并发布' }}
      </el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="init">重试</el-button>
    </el-alert>

    <div v-if="reauditWarn" class="note note--warn" style="margin-bottom: 14px">
      <b>该岗位当前为「{{ label('JobStatus', job?.status) }}」：</b>保存后将重新提交平台审核，审核期间暂停匹配。仅调整名额请回到列表使用「名额」按钮（无需审核）。
    </div>
    <div v-if="job?.auditRemark && (job.status === 'REJECTED' || job.status === 'FORCE_OFFLINE')" class="note note--danger" style="margin-bottom: 14px">
      <b>{{ job.status === 'REJECTED' ? '平台驳回原因' : '强制下架原因' }}：</b>{{ job.auditRemark }}
    </div>

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="job-form" scroll-to-error>
      <div class="grid g-32">
        <div class="grid" style="align-content: start">
          <div class="card">
            <div class="card__hd"><h3>基本信息</h3></div>
            <div class="card__bd">
              <div class="grid g-2 tight">
                <el-form-item label="岗位名称" prop="title"><el-input v-model="form.title" maxlength="64" placeholder="如：SMT 贴片操作工" /></el-form-item>
                <el-form-item label="所属项目" prop="projectId">
                  <el-select v-model="form.projectId" filterable placeholder="选择项目" style="width: 100%" :disabled="isEdit" no-data-text="暂无进行中的项目">
                    <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" :disabled="!p.contractEffective">
                      <span>{{ p.name }}</span>
                      <span class="t-xs" style="float: right">{{ p.contractEffective ? p.clientName : '无有效合同' }}</span>
                    </el-option>
                  </el-select>
                  <div v-if="isEdit" class="t-xs" style="margin-top: 4px">岗位创建后不能更换所属项目</div>
                </el-form-item>
                <el-form-item label="工种" prop="jobType">
                  <el-select v-model="form.jobType" placeholder="选择工种" style="width: 100%">
                    <el-option v-for="o in options('JobType')" :key="o.value" :label="o.label" :value="o.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="岗位性质">
                  <el-switch v-model="form.factoryJob" active-text="工厂岗位" inactive-text="非工厂岗位" />
                </el-form-item>
              </div>
              <el-form-item label="岗位职责" prop="duties">
                <el-input v-model="form.duties" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="逐条描述岗位工作内容…" />
              </el-form-item>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>薪资与班次</h3></div>
            <div class="card__bd">
              <div class="grid g-3 tight">
                <el-form-item label="月综合薪资下限（元）" prop="salaryMin">
                  <el-input-number v-model="form.salaryMin" :min="1" :max="99999" :step="100" :controls="false" placeholder="5800" style="width: 100%" />
                </el-form-item>
                <el-form-item label="月综合薪资上限（元）" prop="salaryMax">
                  <el-input-number v-model="form.salaryMax" :min="1" :max="99999" :step="100" :controls="false" placeholder="6800" style="width: 100%" />
                </el-form-item>
                <el-form-item label="班次" prop="shiftType">
                  <el-select v-model="form.shiftType" placeholder="选择班次" style="width: 100%">
                    <el-option v-for="o in options('ShiftType')" :key="o.value" :label="o.label" :value="o.value" />
                  </el-select>
                </el-form-item>
              </div>
              <el-form-item label="福利待遇">
                <el-input v-model="form.benefits" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="如：五险、全勤奖 200、夜班补贴 25/班、免费班车" />
              </el-form-item>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>食宿</h3></div>
            <div class="card__bd">
              <div class="row" style="gap: 28px; margin-bottom: 8px">
                <el-checkbox v-model="form.mealProvided">包吃</el-checkbox>
                <el-checkbox v-model="form.dormProvided">包住</el-checkbox>
              </div>
              <div v-if="form.dormProvided" class="dorm">
                <el-form-item label="宿舍人数（人/间）">
                  <el-input-number v-model="form.dormRoomSize" :min="1" :max="20" placeholder="如 4" />
                </el-form-item>
                <el-checkbox v-model="form.dormAircon">空调</el-checkbox>
                <el-checkbox v-model="form.dormPrivateBath">独立卫浴</el-checkbox>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>入职要求</h3></div>
            <div class="card__bd">
              <div class="grid g-3 tight">
                <el-form-item label="最小年龄">
                  <el-input-number v-model="form.ageMin" :min="16" :max="65" style="width: 100%" @change="formRef?.validateField('ageMax')" />
                </el-form-item>
                <el-form-item label="最大年龄" prop="ageMax">
                  <el-input-number v-model="form.ageMax" :min="16" :max="65" style="width: 100%" />
                </el-form-item>
                <el-form-item label="工作经验">
                  <el-select v-model="form.minWorkYears" style="width: 100%">
                    <el-option :value="0" label="不限" />
                    <el-option :value="1" label="1 年以上" />
                    <el-option :value="2" label="2 年以上" />
                    <el-option :value="3" label="3 年以上" />
                  </el-select>
                </el-form-item>
              </div>
              <el-form-item label="所需证件" prop="requiredDocuments">
                <el-select v-model="form.requiredDocuments" multiple filterable allow-create default-first-option :reserve-keyword="false" placeholder="选择或输入后回车添加" style="width: 100%">
                  <el-option v-for="d in DOC_SUGGEST" :key="d" :label="d" :value="d" />
                </el-select>
              </el-form-item>
              <el-form-item label="注意事项">
                <el-input v-model="form.notes" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="纹身要求、体检项目、试岗期等…" />
              </el-form-item>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>面试</h3></div>
            <div class="card__bd">
              <div class="grid g-2 tight">
                <el-form-item label="面试地址" prop="interviewAddress">
                  <el-input v-model="form.interviewAddress" maxlength="200" placeholder="如：立讯精密二期 · 招聘大厅" />
                </el-form-item>
                <el-form-item label="面试时间">
                  <el-input v-model="form.interviewTimeDesc" maxlength="100" placeholder="如：每日 09:00 / 14:00（工作日）" />
                </el-form-item>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>名额</h3></div>
            <div class="card__bd">
              <el-form-item label="招聘总名额" prop="quotaTotal" style="margin-bottom: 4px">
                <el-input-number v-model="form.quotaTotal" :min="minQuota" :max="9999" step-strictly />
              </el-form-item>
              <div v-if="job" class="t-xs">已被报名占用 {{ job.quotaOccupied }} 个，总名额不能低于该数。</div>
            </div>
          </div>
        </div>

        <div class="grid side" style="align-content: start">
          <div class="card" style="border-color: var(--signal-300)">
            <div class="card__hd"><h3>甲方合同关联</h3><span class="tag tag--signal">平台强审</span></div>
            <div class="card__bd">
              <p class="t-sm" style="margin-bottom: 12px; line-height: 1.8">岗位必须发布在<b class="strong">有审核通过且在有效期内合作合同</b>的甲方项目下，平台将核对岗位与甲方的相关性。</p>
              <template v-if="project">
                <dl class="kv"><dt>项目</dt><dd>{{ project.name }}</dd></dl>
                <dl class="kv"><dt>甲方企业</dt><dd>{{ project.clientName }}</dd></dl>
                <dl class="kv"><dt>地点</dt><dd>{{ project.city }} {{ project.district }}</dd></dl>
                <dl class="kv">
                  <dt>合同状态</dt>
                  <dd><span v-if="project.contractEffective" class="tag tag--ok">合同有效</span><span v-else class="tag tag--danger">无有效合同</span></dd>
                </dl>
                <div v-if="!project.contractEffective" class="note note--danger" style="margin-top: 10px">该甲方暂无有效合同，无法发布岗位。请先到「项目与甲方 → 合作合同」上传。</div>
              </template>
              <div v-else class="t-xs">请先选择所属项目。下拉中置灰的项目为甲方无有效合同。</div>
              <el-button v-if="meStore.can('CLIENT_CONTRACT_MANAGE')" link type="primary" style="margin-top: 8px" @click="router.push({ path: '/settings/projects', query: { tab: 'contracts' } })">管理项目与合同 →</el-button>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>求职者端预览</h3><DictTag v-if="job" type="JobStatus" :value="job.status" /></div>
            <div class="card__bd">
              <div class="pv">
                <div class="pv-main">
                  <b class="pv-title">{{ form.title || '岗位名称' }}</b>
                  <div class="t-xs" style="margin-top: 2px">{{ project?.name ?? '所属项目' }} · {{ meStore.me?.company.shortName || meStore.me?.company.name }}</div>
                  <div class="pv-salary">{{ form.salaryMin || form.salaryMax ? salaryRange(form.salaryMin, form.salaryMax) : '— –  —' }}<small> 元/月</small></div>
                  <div class="row-wrap" style="margin-top: 8px"><span v-for="c in preview" :key="c" class="tag">{{ c }}</span></div>
                </div>
                <div class="pv-ft"><span class="t-xs">{{ form.interviewAddress || '面试地址' }}</span><span class="tag tag--signal">报名面试</span></div>
              </div>
              <div class="t-xs" style="margin-top: 10px">该卡片仅在用户完成 AI 问薪匹配且匹配度 ≥80% 时出现，平台不提供岗位列表浏览。</div>
            </div>
          </div>
        </div>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.tight { gap: 0 14px; }
.dorm { display: flex; align-items: flex-end; gap: 22px; padding: 12px 14px 0; background: var(--surface-2); border: 1px dashed var(--line-2); border-radius: var(--r-md); }
.dorm .el-checkbox { margin-bottom: 18px; }
.side { position: sticky; top: 72px; }
.pv { border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; }
.pv-main { padding: 12px; }
.pv-title { font-size: 15px; color: var(--ink-900); }
.pv-salary { font-family: var(--f-dis); font-size: 22px; font-weight: 700; color: var(--signal); margin-top: 6px; }
.pv-salary small { font-family: var(--f-cn); font-size: 11px; color: var(--ink-400); font-weight: 500; }
.pv-ft { padding: 8px 12px; background: var(--surface-2); border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
</style>
