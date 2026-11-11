<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, useDict, type IncidentRow, type IncidentSeverity, type IncidentStatus } from '@shitu/api-client'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'

/** 工伤上报（T-405）：驻场 / 项目经理上报后，老板和项目经理立刻收到站内信与短信；处理完登记结论结案 */
const { label, options } = useDict()
const meStore = useMeStore()
const { projects } = useProjects()
const canReport = computed(() => meStore.hasRole('PM', 'SITE'))
const canClose = computed(() => meStore.hasRole('PM', 'OWNER'))

const TABS: { key: IncidentStatus | ''; label: string }[] = [
  { key: 'OPEN', label: '处理中' },
  { key: 'CLOSED', label: '已结案' },
  { key: '', label: '全部' },
]
const SEV_TAG: Record<IncidentSeverity, string> = { MINOR: 'tag--info', SERIOUS: 'tag--warn', CRITICAL: 'tag--danger' }

const tab = ref<IncidentStatus | ''>('OPEN')
const rows = ref<IncidentRow[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await tenantApi.incidents(tab.value ? { status: tab.value } : undefined)
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
  open: false, projectId: '', personName: '', severity: 'SERIOUS' as IncidentSeverity, occurredAt: undefined as Date | undefined, detail: '', saving: false, error: '',
})
function openReport() {
  Object.assign(form, { open: true, projectId: projects.value.length === 1 ? projects.value[0].projectId : '', personName: '', severity: 'SERIOUS', occurredAt: new Date(), detail: '', error: '' })
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
  form.saving = true
  try {
    await tenantApi.reportIncident({
      projectId: form.projectId, personName: form.personName.trim(), severity: form.severity, occurredAt: localIso(form.occurredAt), detail: form.detail.trim(),
    })
    ElMessage.success('已上报，老板和项目经理会立刻收到通知')
    form.open = false
    tab.value === 'OPEN' ? await load() : (tab.value = 'OPEN')
  } catch (e) {
    form.error = errorMessage(e, '上报失败')
  } finally {
    form.saving = false
  }
}

const dlg = reactive({ open: false, row: null as IncidentRow | null, note: '', saving: false })
function openClose(row: IncidentRow) {
  Object.assign(dlg, { open: true, row, note: '' })
}
async function submitClose() {
  if (!dlg.row) return
  const note = dlg.note.trim()
  if (note.length < 2) return void ElMessage.warning('请填写处理结论')
  dlg.saving = true
  try {
    await tenantApi.closeIncident(dlg.row.id, note)
    ElMessage.success('已结案')
    dlg.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
  } finally {
    dlg.saving = false
  }
}
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
      <el-button v-if="canReport" type="danger" @click="openReport">上报工伤</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px" />

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
        </div>
      </div>
      <el-table v-loading="loading" :data="rows" row-key="id">
        <el-table-column label="发生时间" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.occurredAt) }}</span></template>
        </el-table-column>
        <el-table-column label="项目 / 人员" width="200">
          <template #default="{ row }">
            <b>{{ row.personName }}</b> <span class="tag" :class="SEV_TAG[row.severity as IncidentSeverity]">{{ label('IncidentSeverity', row.severity) }}</span>
            <div class="t-xs">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="事发经过" min-width="300">
          <template #default="{ row }">
            <div class="content">{{ row.detail }}</div>
            <div class="t-xs">{{ row.reportedByName || '—' }} 上报于 <span class="mono">{{ fmtDateTime(row.createdAt) }}</span></div>
            <div v-if="row.handleNote" class="reply"><b>处理结论</b>{{ row.handleNote }}<span class="t-xs"> · {{ row.closedByName }} {{ fmtDateTime(row.closedAt) }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><span class="tag" :class="row.status === 'OPEN' ? 'tag--warn' : 'tag--ok'">{{ label('IncidentStatus', row.status) }}</span></template>
        </el-table-column>
        <el-table-column v-if="canClose" label="操作" width="100" align="right" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN'" size="small" type="primary" @click="openClose(row)">结案</el-button>
            <span v-else class="t-xs">—</span>
          </template>
        </el-table-column>
        <template #empty><el-empty :description="loadError ? '加载失败' : '暂无工伤记录'" :image-size="80" /></template>
      </el-table>
    </div>

    <el-dialog v-model="form.open" title="上报工伤" width="560px" destroy-on-close :close-on-click-modal="false">
      <div class="note note--danger" style="margin-bottom: 14px">人员安全第一：先拨打 120 / 送医并保护现场，再来这里上报。</div>
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
      <div v-if="form.error" class="note note--danger">{{ form.error }}</div>
      <template #footer>
        <el-button @click="form.open = false">取消</el-button>
        <el-button type="danger" :loading="form.saving" @click="submitReport">立即上报</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dlg.open" title="登记处理结论" width="540px" destroy-on-close>
      <template v-if="dlg.row">
        <div class="t-sm" style="margin-bottom: 8px"><b>{{ dlg.row.personName }}</b> · {{ dlg.row.projectName }} · <span class="mono">{{ fmtDateTime(dlg.row.occurredAt) }}</span></div>
        <div class="content box">{{ dlg.row.detail }}</div>
        <el-input v-model="dlg.note" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="救治情况、是否已申报工伤认定、费用如何处理等" style="margin-top: 12px" />
        <div class="note" style="margin-top: 10px">这里只做内部留痕。工伤认定须在事故发生之日起 30 日内向社保部门申请。</div>
      </template>
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="submitClose">结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
.box { padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); max-height: 200px; overflow: auto; }
.reply { margin-top: 6px; padding: 6px 10px; border-left: 3px solid var(--ok); background: var(--surface-2); border-radius: var(--r-xs); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.reply b { color: var(--ok); margin-right: 6px; font-size: 12px; }
</style>
