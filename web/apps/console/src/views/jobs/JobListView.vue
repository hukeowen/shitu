<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, useDict, type JobStatus, type JobTenantAction, type JobView, type ProjectView } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import { useMeStore } from '@/stores/me'
import RowActions from '@/components/RowActions.vue'
import { fmtDateTime, salaryRange } from '@/utils/format'
import { opsColWidth, type RowAction } from '@/utils/rowActions'
import JobDetailDrawer from './JobDetailDrawer.vue'

/** T-302 / T-303 岗位管理（原型 v-jobs）。按钮严格按后端 allowedActions 显示 */
const router = useRouter()
const meStore = useMeStore()
const { label, options } = useDict()
const canManage = computed(() => meStore.can('JOB_MANAGE'))

const filter = reactive<{ status: JobStatus | ''; projectId: string; keyword: string }>({ status: '', projectId: '', keyword: '' })
const page = reactive({ page: 1, pageSize: 20, total: 0 })
const list = ref<JobView[]>([])
const loading = ref(false)
const loadError = ref('')
const counts = ref<Record<string, number>>({})
const projects = ref<ProjectView[]>([])

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await tenantApi.jobs({
      status: filter.status || undefined,
      projectId: filter.projectId || undefined,
      keyword: filter.keyword.trim() || undefined,
      page: page.page,
      pageSize: page.pageSize,
    })
    list.value = r.records
    page.total = r.total
  } catch (e) {
    loadError.value = errorMessage(e, '岗位加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}

/** 各状态数量（用于筛选标签与统计卡） */
async function loadCounts() {
  try {
    const s = await tenantApi.jobStats(filter.projectId || undefined)
    const c: Record<string, number> = { ...s }
    c[''] = Object.values(s).reduce((a, b) => a + b, 0)
    counts.value = c
  } catch {
    counts.value = {}
  }
}

function search() {
  page.page = 1
  load()
}
function setStatus(s: JobStatus | '') {
  filter.status = s
  search()
}
function onProject() {
  search()
  loadCounts()
}
function refresh() {
  load()
  loadCounts()
}

onMounted(async () => {
  load()
  loadCounts()
  try {
    projects.value = await tenantApi.projects()
  } catch {
    projects.value = []
  }
})

// ---------------------------------------------------------------- 行操作
const has = (j: JobView, a: JobTenantAction) => canManage.value && j.allowedActions.includes(a)

async function confirmAction(j: JobView, a: 'PAUSE' | 'RESUME' | 'OFFLINE') {
  const text = {
    PAUSE: { title: '暂停招聘', msg: `暂停后「${j.title}」移出匹配池，岗位数据全部保留，可随时恢复。确定暂停？`, ok: '暂停招聘' },
    RESUME: { title: '恢复招聘', msg: `恢复后「${j.title}」重新进入匹配池，挂岗天数从今天重新计算。确定恢复？`, ok: '恢复招聘' },
    OFFLINE: { title: '下架岗位', msg: `下架后「${j.title}」不再参与匹配，已报名的求职者不受影响。确定下架？`, ok: '下架' },
  }[a]
  try {
    await ElMessageBox.confirm(text.msg, text.title, { type: 'warning', confirmButtonText: text.ok, cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    if (a === 'PAUSE') await tenantApi.pauseJob(j.jobId)
    else if (a === 'RESUME') await tenantApi.resumeJob(j.jobId)
    else await tenantApi.offlineJob(j.jobId)
    ElMessage.success(`已${text.ok}`)
    refresh()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

const quota = reactive({ visible: false, saving: false, job: null as JobView | null, value: 1 })
function openQuota(j: JobView) {
  quota.job = j
  quota.value = j.quotaTotal
  quota.visible = true
}
async function saveQuota() {
  const j = quota.job
  if (!j) return
  if (!Number.isInteger(quota.value) || quota.value < Math.max(1, j.quotaOccupied) || quota.value > 9999) {
    ElMessage.warning(`名额需为 ${Math.max(1, j.quotaOccupied)}–9999 的整数`)
    return
  }
  quota.saving = true
  try {
    await tenantApi.adjustQuota(j.jobId, quota.value)
    ElMessage.success('名额已调整')
    quota.visible = false
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    quota.saving = false
  }
}

// ---------------------------------------------------------------- 详情
const detail = reactive({ visible: false, jobId: null as string | null })
function openDetail(j: JobView) {
  detail.jobId = j.jobId
  detail.visible = true
}

/** 行操作：详情始终可见；编辑 / 暂停或恢复平铺，名额与下架收进「更多」。列宽按当前角色实际可见的按钮计算 */
function rowActions(j: JobView): RowAction[] {
  const rework = j.status === 'REJECTED' || j.status === 'FORCE_OFFLINE'
  const a: RowAction[] = [{ key: 'DETAIL', label: '详情', link: true }]
  if (has(j, 'EDIT')) a.push({ key: 'EDIT', label: rework ? '修改重提' : '编辑', type: rework ? 'primary' : 'default' })
  if (has(j, 'RESUME')) a.push({ key: 'RESUME', label: '恢复招聘', type: 'primary', plain: true })
  if (has(j, 'PAUSE')) a.push({ key: 'PAUSE', label: '暂停' })
  if (has(j, 'QUOTA')) a.push({ key: 'QUOTA', label: '调整名额', more: true })
  if (has(j, 'OFFLINE')) a.push({ key: 'OFFLINE', label: '下架', type: 'danger', more: true })
  return a
}
const OPS_MAX = 3
const opsWidth = computed(() => opsColWidth(list.value.map(rowActions), OPS_MAX))
function onAct(key: string, j: JobView) {
  if (key === 'DETAIL') openDetail(j)
  else if (key === 'EDIT') router.push({ path: '/pm/jobs/edit', query: { id: j.jobId } })
  else if (key === 'QUOTA') openQuota(j)
  else confirmAction(j, key as 'PAUSE' | 'RESUME' | 'OFFLINE')
}

function rowClass({ row }: { row: JobView }) {
  if (row.status === 'REJECTED' || row.status === 'FORCE_OFFLINE') return 'row-danger'
  if (row.status === 'PAUSED' || row.status === 'OFFLINE') return 'row-dim'
  return ''
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>岗位管理</h2>
        <p>创建 / 编辑 / 下架 / 暂停招聘 · 发布与编辑均需平台审核，暂停的岗位数据保留可随时恢复</p>
      </div>
      <span class="spacer" />
      <el-button v-if="canManage" type="primary" @click="router.push('/pm/jobs/edit')">+ 创建岗位</el-button>
    </div>

    <div class="grid g-4">
      <div class="stat"><div class="stat-l">招聘中</div><div class="stat-v">{{ counts.RECRUITING ?? '—' }}</div><div class="stat-d">参与匹配</div></div>
      <div class="stat"><div class="stat-l">待审核</div><div class="stat-v">{{ counts.PENDING_AUDIT ?? '—' }}</div><div class="stat-d">平台审核中</div></div>
      <div class="stat"><div class="stat-l">暂停招聘</div><div class="stat-v">{{ counts.PAUSED ?? '—' }}</div><div class="stat-d">数据保留可恢复</div></div>
      <div class="stat" style="border-color: var(--danger-line)">
        <div class="stat-l" style="color: var(--danger)">驳回 / 强制下架</div>
        <div class="stat-v" style="color: var(--danger)">{{ (counts.REJECTED ?? 0) + (counts.FORCE_OFFLINE ?? 0) }}</div>
        <div class="stat-d" style="color: var(--danger)">需修改后重新提交</div>
      </div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="toolbar">
        <div class="filter-tabs">
          <button :class="{ on: filter.status === '' }" @click="setStatus('')">全部<span class="n">{{ counts[''] ?? '' }}</span></button>
          <button v-for="o in options('JobStatus')" :key="o.value" :class="{ on: filter.status === o.value }" @click="setStatus(o.value as JobStatus)">
            {{ o.label }}<span class="n">{{ counts[o.value] ?? '' }}</span>
          </button>
        </div>
        <div class="tb-fields">
          <el-select v-model="filter.projectId" placeholder="全部项目" clearable filterable style="width: 190px" @change="onProject">
            <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
          <div class="tb-group">
            <el-input v-model="filter.keyword" placeholder="岗位名称" clearable style="width: 180px" @keyup.enter="search" @clear="search" />
            <el-button @click="search">查询</el-button>
          </div>
        </div>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="list" row-key="jobId" :row-class-name="rowClass">
        <el-table-column label="岗位名称" min-width="220">
          <template #default="{ row }">
            <button type="button" class="name-link clamp-2" :title="row.title" @click="openDetail(row)">{{ row.title }}</button>
            <div class="t-xs ellip">{{ [label('JobType', row.jobType), row.mealProvided ? '包吃' : '', row.dormProvided ? '包住' : ''].filter(Boolean).join(' · ') }}</div>
          </template>
        </el-table-column>
        <el-table-column label="所属项目" min-width="170">
          <template #default="{ row }">
            <div class="t-sm strong clamp-2" :title="row.projectName">{{ row.projectName }}</div>
            <div class="t-xs ellip" :title="row.clientName">{{ row.clientName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="薪资（元/月）" min-width="130">
          <template #default="{ row }"><span class="mono t-sm">{{ salaryRange(row.salaryMin, row.salaryMax) }}</span></template>
        </el-table-column>
        <el-table-column label="班次" min-width="90">
          <template #default="{ row }"><span class="t-sm nowrap">{{ label('ShiftType', row.shiftType) }}</span></template>
        </el-table-column>
        <el-table-column label="名额 占用/总数" min-width="124" align="center">
          <template #default="{ row }">
            <span class="num">{{ row.quotaOccupied }} / {{ row.quotaTotal }}</span>
            <div class="t-xs nowrap">剩余 {{ row.quotaRemaining }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="120">
          <template #default="{ row }">
            <DictTag type="JobStatus" :value="row.status" pill />
            <el-tooltip v-if="row.auditRemark && (row.status === 'REJECTED' || row.status === 'FORCE_OFFLINE')" :content="row.auditRemark" placement="top">
              <div class="remark">{{ row.auditRemark }}</div>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="上架时间" min-width="156">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.postedAt) }}</span></template>
        </el-table-column>
        <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
          <template #default="{ row }"><RowActions :actions="rowActions(row)" :max="OPS_MAX" @act="(k) => onAct(k, row)" /></template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无岗位'">
            <el-button v-if="canManage && !loadError" type="primary" @click="router.push('/pm/jobs/edit')">创建岗位</el-button>
          </el-empty>
        </template>
      </el-table>
      <div v-if="page.total > 0" class="pager">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          :total="page.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </div>

    <div class="grid g-2" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>暂停招聘的使用规范</h3></div>
        <div class="card__bd">
          <p class="t-sm" style="line-height: 1.9">岗位今天暂停但后续还要招，可点击「暂停」—— 岗位移出匹配池但不删除，<b class="strong">所有历史数据保留</b>；恢复后重新进入匹配池，挂岗天数重新计算。</p>
          <div class="note note--danger" style="margin-top: 10px"><b>硬性要求：</b>一旦从甲方得知招聘满员，<b>24 小时内必须暂停招聘</b>，否则用户报名却无法面试将产生投诉，计入企业诚信档案。</div>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>审核说明</h3></div>
        <div class="card__bd">
          <p class="t-sm" style="line-height: 1.9">新建与编辑岗位都会提交平台审核，审核期间不参与匹配；仅调整名额无需审核。岗位必须属于有<b class="strong">审核通过且在有效期内合作合同</b>的甲方项目。</p>
          <div class="note note--warn" style="margin-top: 10px">发布虚假岗位信息，用户可在岗位详情页投诉。同一岗位累计被投诉 ≥3 次并核实属实 → 自动下架 + 扣诚信分。</div>
        </div>
      </div>
    </div>

    <el-dialog v-model="quota.visible" title="调整招聘名额" width="420px">
      <template v-if="quota.job">
        <dl class="kv"><dt>岗位</dt><dd>{{ quota.job.title }}</dd></dl>
        <dl class="kv"><dt>已被报名占用</dt><dd class="num">{{ quota.job.quotaOccupied }}</dd></dl>
        <dl class="kv"><dt>当前总名额</dt><dd class="num">{{ quota.job.quotaTotal }}</dd></dl>
        <div class="row" style="margin-top: 16px">
          <span class="t-sm">新的总名额</span>
          <el-input-number v-model="quota.value" :min="Math.max(1, quota.job.quotaOccupied)" :max="9999" :step="1" step-strictly />
        </div>
        <div class="t-xs" style="margin-top: 8px">不能少于已占用的 {{ quota.job.quotaOccupied }} 个；调整名额无需重新审核。</div>
      </template>
      <template #footer>
        <el-button @click="quota.visible = false">取消</el-button>
        <el-button type="primary" :loading="quota.saving" @click="saveQuota">保存</el-button>
      </template>
    </el-dialog>

    <JobDetailDrawer v-model="detail.visible" :job-id="detail.jobId" />
  </div>
</template>

<style scoped>
.remark { font-size: 11.5px; color: var(--danger); margin-top: 2px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
