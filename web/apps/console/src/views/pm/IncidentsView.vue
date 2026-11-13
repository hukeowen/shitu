<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, useDict, type IncidentRow, type IncidentSeverity, type IncidentStatus } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconPlus, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { isBlocked } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'

/** 工伤上报（T-405）：驻场 / 项目经理上报后，老板和项目经理立刻收到站内信与短信；处理完登记结论结案 */
const { options } = useDict()
const meStore = useMeStore()
const { projects } = useProjects()
const canReport = computed(() => meStore.hasRole('PM', 'SITE'))
const canClose = computed(() => meStore.hasRole('PM', 'OWNER'))

const TABS: { key: IncidentStatus | ''; label: string }[] = [
  { key: 'OPEN', label: '处理中' },
  { key: 'CLOSED', label: '已结案' },
  { key: '', label: '全部' },
]

const tab = ref<IncidentStatus | ''>('OPEN')
const rows = ref<IncidentRow[]>([])
const loading = ref(false)
const loadError = ref('')
/** 接口一次返回全部记录（不分页），表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => rows.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await tenantApi.incidents(tab.value ? { status: tab.value } : undefined)
    pg.page = 1
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '工伤记录加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(tab, load)

const form = reactive({
  open: false, projectId: '', personName: '', severity: 'SERIOUS' as IncidentSeverity, occurredAt: undefined as Date | undefined, detail: '', saving: false, error: '', why: '',
})
// 上报被后端业务拒绝后置灰「立即上报」；改了内容再放开
watch(() => [form.projectId, form.personName, form.severity, form.occurredAt, form.detail], () => (form.why = ''))
function openReport() {
  Object.assign(form, { open: true, projectId: projects.value.length === 1 ? projects.value[0].projectId : '', personName: '', severity: 'SERIOUS', occurredAt: new Date(), detail: '', error: '', why: '' })
}
function localIso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00'
}
async function submitReport() {
  if (!form.projectId) return void (form.error = '请选择项目')
  if (!form.personName.trim()) return void (form.error = '请填写受伤人员姓名')
  if (!form.occurredAt) return void (form.error = '请填写发生时间')
  if (form.detail.trim().length < 5) return void (form.error = '请描述事发经过与当前处置（至少 5 个字）')
  if (form.saving) return
  form.saving = true
  try {
    await tenantApi.reportIncident({
      projectId: form.projectId, personName: form.personName.trim(), severity: form.severity, occurredAt: localIso(form.occurredAt), detail: form.detail.trim(),
    })
    ElMessage.success('已上报，老板和项目经理会立刻收到通知')
    form.open = false
    tab.value === 'OPEN' ? await load() : (tab.value = 'OPEN')
  } catch (e) {
    ElMessage.error(errorMessage(e, '上报失败'))
    if (isBlocked(e)) form.why = `暂时不能上报：${errorMessage(e)}`
  } finally {
    form.saving = false
  }
}

const dlg = reactive({ open: false, row: null as IncidentRow | null, note: '', saving: false, why: '' })
watch(() => dlg.note, () => (dlg.why = ''))
function openClose(row: IncidentRow) {
  Object.assign(dlg, { open: true, row, note: '', why: '' })
}
async function submitClose() {
  if (!dlg.row) return
  const note = dlg.note.trim()
  if (note.length < 2) return void ElMessage.warning('请填写处理结论')
  if (dlg.saving) return
  dlg.saving = true
  try {
    await tenantApi.closeIncident(dlg.row.id, note)
    ElMessage.success('已结案')
    dlg.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
    if (isBlocked(e)) dlg.why = `暂时不能结案：${errorMessage(e)}`
  } finally {
    dlg.saving = false
  }
}
/** 操作列宽按本页实际出现的按钮算 */
const opsWidth = computed(() => actionsColWidth([{ labels: ['结案'] }]))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>工伤上报</h2>
        <p>现场发生工伤第一时间上报 · 老板和项目经理立刻收到站内信与短信</p>
      </div>
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button v-if="canReport" type="primary" @click="openReport"><IconPlus :size="16" class="btn-i" />上报工伤</el-button>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
        </div>
      </div>
      <el-table v-loading="loading" :data="pageRows" row-key="id">
        <el-table-column label="发生时间" width="150">
          <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.occurredAt) }}</span></template>
        </el-table-column>
        <el-table-column label="人员 / 项目" width="210">
          <template #default="{ row }">
            <div class="who"><span class="strong-t">{{ row.personName }}</span><DictTag type="IncidentSeverity" :value="row.severity" /></div>
            <div class="sub">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="事发经过" min-width="300">
          <template #default="{ row }">
            <div class="content">{{ row.detail }}</div>
            <div class="sub">{{ row.reportedByName || '—' }} 上报于 <span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></div>
            <div v-if="row.handleNote" class="reply">
              <b>处理结论</b>{{ row.handleNote }}<span class="sub"> · {{ row.closedByName }} {{ fmtDateTime(row.closedAt) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><DictTag type="IncidentStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column v-if="canClose" label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN'" size="small" link type="primary" @click="openClose(row)">结案</el-button>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>{{ tab === 'OPEN' ? '没有处理中的工伤' : '暂无工伤记录' }}</h4>
            <p>{{ canReport ? '现场发生工伤时点右上角「上报工伤」' : '驻场或项目经理上报后会出现在这里' }}</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="rows.length > 0" class="pager">
        <el-pagination
          v-model:current-page="pg.page"
          v-model:page-size="pg.pageSize"
          :total="rows.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @size-change="pg.page = 1"
        />
      </div>
    </div>

    <el-dialog v-model="form.open" title="上报工伤" width="560px" destroy-on-close :close-on-click-modal="false">
      <div class="notice-bar notice-bar--danger dlg-tip">
        <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
        <span>人员安全第一：先拨打 120 / 送医并保护现场，再来这里上报。</span>
      </div>
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="项目" required>
          <el-select v-model="form.projectId" placeholder="选择发生工伤的项目" style="width: 100%" @change="form.error = ''">
            <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
        </el-form-item>
        <el-form-item label="受伤人员" required>
          <el-input v-model="form.personName" maxlength="30" placeholder="姓名" @input="form.error = ''" />
        </el-form-item>
        <el-form-item label="伤情" required>
          <el-radio-group v-model="form.severity">
            <el-radio-button v-for="o in options('IncidentSeverity')" :key="o.value" :value="o.value">{{ o.label }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="发生时间" required>
          <el-date-picker v-model="form.occurredAt" type="datetime" format="YYYY-MM-DD HH:mm" :clearable="false" :disabled-date="(d: Date) => d.getTime() > Date.now()" />
        </el-form-item>
        <el-form-item label="事发经过" required>
          <el-input v-model="form.detail" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="哪里、怎么受的伤、现在人在哪、已经做了什么处置" @input="form.error = ''" />
        </el-form-item>
      </el-form>
      <p v-if="form.error" class="form-err" role="alert">{{ form.error }}</p>
      <p v-if="form.why" class="blocked-why" role="alert">{{ form.why }}</p>
      <template #footer>
        <el-button @click="form.open = false">取消</el-button>
        <el-button type="primary" :loading="form.saving" :disabled="!!form.why" @click="submitReport">立即上报</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dlg.open" title="登记处理结论" width="540px" destroy-on-close>
      <template v-if="dlg.row">
        <div class="dlg-who"><span class="strong-t">{{ dlg.row.personName }}</span> · {{ dlg.row.projectName }} · <span class="tnum">{{ fmtDateTime(dlg.row.occurredAt) }}</span></div>
        <div class="content box">{{ dlg.row.detail }}</div>
        <el-input v-model="dlg.note" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="救治情况、是否已申报工伤认定、费用如何处理等" class="dlg-note" />
        <div class="notice-bar dlg-hint">
          <IconCircleExclamationPoint :size="16" class="notice-bar-i" />
          <span>这里只做内部留痕。工伤认定须在事故发生之日起 30 日内向社保部门申请。</span>
        </div>
        <p v-if="dlg.why" class="blocked-why dlg-why" role="alert">{{ dlg.why }}</p>
      </template>
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" :disabled="!!dlg.why" @click="submitClose">结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.btn-i { margin-right: var(--space-1); }
.strong-t { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.who { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.content { color: var(--text-1); white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
.box { padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); max-height: 200px; overflow: auto; }
.reply { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--success-soft); border-radius: var(--radius-control); color: var(--text-1); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.reply b { color: var(--success-text); margin-right: var(--space-2); font-size: var(--font-size-min); font-weight: var(--font-weight-semibold); }
.dlg-tip { margin-bottom: var(--space-4); }
.dlg-who { margin-bottom: var(--space-2); color: var(--text-2); }
.dlg-note { margin-top: var(--space-3); }
.dlg-hint { margin-top: var(--space-3); }
.dlg-why { margin-top: var(--space-3); }
</style>
