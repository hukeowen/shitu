<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  errorMessage,
  tenantApi,
  useDict,
  type ClientView,
  type ProjectRequest,
  type ProjectStatus,
  type ProjectView,
} from '@shitu/api-client'
import { IconBuildingComplex, IconCircleExclamationPoint } from '@shitu/ui-icons'
import ClientSelect from '@/components/ClientSelect.vue'
import DictTag from '@/components/DictTag.vue'
import { boxSubmit, isBlocked, isNetwork } from '@/composables/boxSubmit'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDate } from '@/utils/format'

const emit = defineEmits<{ goContracts: [] }>()
const meStore = useMeStore()
const { options } = useDict()
const canManage = computed(() => meStore.can('PROJECT_MANAGE'))
const canContract = computed(() => meStore.can('CLIENT_CONTRACT_MANAGE'))

const DEFAULT_STATUS: ProjectStatus = 'ACTIVE'
const loading = ref(false)
const loadError = ref('')
const loadNet = ref(false)
const list = ref<ProjectView[]>([])
const filter = reactive<{ status: ProjectStatus | ''; keyword: string }>({ status: DEFAULT_STATUS, keyword: '' })
/** 接口一次返回全部项目，表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => list.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))
/** 结束项目被后端拒绝的项目：只置灰这一行的「结束」，原因写在表格上方，重新查询时清掉 */
const blocked = reactive<Record<string, { name: string; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    list.value = await tenantApi.projects({ status: filter.status || undefined, keyword: filter.keyword.trim() || undefined })
    pg.page = 1
  } catch (e) {
    list.value = []
    loadError.value = errorMessage(e, '项目加载失败')
    loadNet.value = isNetwork(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function setStatus(s: ProjectStatus | '') {
  filter.status = s
  load()
}
/** 重置：状态和关键词清回默认值后重新查询 */
function reset() {
  filter.status = DEFAULT_STATUS
  filter.keyword = ''
  load()
}

// ---------------------------------------------------------------- 新建 / 编辑
const dialog = reactive({ visible: false, saving: false, seq: 0, editing: null as ProjectView | null, why: '' })
const formRef = ref<FormInstance>()
const form = reactive({ name: '', clientId: '', province: '', city: '', district: '', address: '' })
// 保存被后端拒绝后置灰「保存」；改了内容再放开
watch(form, () => (dialog.why = ''))
const clientHint = ref<'none' | 'ok' | 'missing' | 'loading'>('none')
const rules: FormRules = {
  name: [
    { required: true, message: '请填写项目名称', trigger: 'blur' },
    { max: 50, message: '项目名称最多 50 个字', trigger: 'blur' },
  ],
  clientId: [{ required: true, message: '请选择甲方企业', trigger: 'change' }],
  city: [{ required: true, message: '请填写城市', trigger: 'blur' }],
  address: [{ required: true, message: '请填写详细地址', trigger: 'blur' }],
}

function openCreate() {
  dialog.editing = null
  Object.assign(form, { name: '', clientId: '', province: '', city: '', district: '', address: '' })
  clientHint.value = 'none'
  dialog.seq++
  dialog.why = ''
  dialog.visible = true
  formRef.value?.clearValidate()
}

function openEdit(p: ProjectView) {
  dialog.editing = p
  Object.assign(form, { name: p.name, clientId: p.clientId, province: p.province ?? '', city: p.city, district: p.district ?? '', address: p.address })
  clientHint.value = p.contractEffective ? 'ok' : 'missing'
  dialog.seq++
  dialog.why = ''
  dialog.visible = true
  formRef.value?.clearValidate()
}

async function onClientChange(c: ClientView | undefined) {
  if (!c) {
    clientHint.value = 'none'
    return
  }
  if (!form.city && c.city) form.city = c.city
  clientHint.value = 'loading'
  try {
    const contracts = await tenantApi.contracts(c.clientId)
    clientHint.value = contracts.some((x) => x.effective) ? 'ok' : 'missing'
  } catch {
    clientHint.value = 'none'
  }
}

async function save() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  const req: ProjectRequest = {
    name: form.name.trim(),
    clientId: form.clientId,
    province: form.province.trim() || undefined,
    city: form.city.trim(),
    district: form.district.trim() || undefined,
    address: form.address.trim(),
  }
  dialog.saving = true
  try {
    if (dialog.editing) {
      await tenantApi.updateProject(dialog.editing.projectId, req)
      ElMessage.success('项目已保存')
    } else {
      await tenantApi.createProject(req)
      ElMessage.success('项目已创建')
    }
    dialog.visible = false
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) dialog.why = `暂时不能保存：${errorMessage(e)}`
  } finally {
    dialog.saving = false
  }
}

async function close(p: ProjectView) {
  const s = boxSubmit(`结束后「${p.name}」将不能再发布或恢复岗位，确定结束该项目？`, '结束项目', () => tenantApi.closeProject(p.projectId), (why) => {
    blocked[p.projectId] = { name: p.name, text: why }
  })
  try {
    await ElMessageBox.confirm(s.message, '结束项目', {
      type: 'warning',
      confirmButtonText: '结束项目',
      // 不可撤回：确认按钮和表格里一样用危险色描边
      confirmButtonClass: 'el-button--danger is-plain btn-reject',
      cancelButtonText: '取消',
      beforeClose: s.beforeClose,
    })
  } catch {
    return
  }
  ElMessage.success('项目已结束')
  load()
}

function location(p: ProjectView) {
  return [p.province, p.city, p.district].filter(Boolean).join(' · ')
}

/** 「上传合同」只在没有有效合同且有合同权限时出现 */
const uploadable = (p: ProjectView) => !p.contractEffective && canContract.value
/** 操作列宽按本页实际出现的按钮算（规范 Page States「console 表格操作列宽」） */
const opsWidth = computed(() =>
  actionsColWidth(pageRows.value.map((p) => ({ labels: p.status === 'ACTIVE' ? [...(uploadable(p) ? ['上传合同'] : []), '编辑', '结束'] : [] }))),
)

defineExpose({ openCreate })
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="filter-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="filter.status === ''" :class="{ on: filter.status === '' }" @click="setStatus('')">全部</button>
        <button
          v-for="o in options('ProjectStatus')"
          :key="o.value"
          type="button"
          role="tab"
          :aria-selected="filter.status === o.value"
          :class="{ on: filter.status === o.value }"
          @click="setStatus(o.value as ProjectStatus)"
        >
          {{ o.label }}
        </button>
      </div>
      <span class="spacer" />
      <el-input v-model="filter.keyword" placeholder="项目 / 甲方名称" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
      <el-button @click="load">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>
    <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.name }}」{{ b.text }}</p>
    <el-table v-loading="loading" :data="pageRows" row-key="projectId" :row-class-name="({ row }) => (row.status === 'CLOSED' ? 'row-dim' : '')">
      <el-table-column label="项目名称" min-width="160">
        <template #default="{ row }">
          <div class="strong-t">{{ row.name }}</div>
          <div class="sub">创建于 <span class="tnum">{{ fmtDate(row.createdAt) }}</span></div>
        </template>
      </el-table-column>
      <el-table-column label="甲方企业" min-width="180">
        <template #default="{ row }"><span class="strong-t">{{ row.clientName }}</span></template>
      </el-table-column>
      <el-table-column label="地点" min-width="200">
        <template #default="{ row }">
          <div class="strong-t">{{ location(row) }}</div>
          <div class="sub">{{ row.address }}</div>
        </template>
      </el-table-column>
      <el-table-column label="合同" width="104">
        <template #default="{ row }">
          <span class="status-tag" :class="row.contractEffective ? 'status-tag--success' : 'status-tag--warning'">{{ row.contractEffective ? '合同有效' : '无有效合同' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="84">
        <template #default="{ row }"><DictTag type="ProjectStatus" :value="row.status" /></template>
      </el-table-column>
      <el-table-column v-if="canManage" label="操作" :width="opsWidth" align="right" class-name="ops-col">
        <template #default="{ row }">
          <div v-if="row.status === 'ACTIVE'" class="acts">
            <el-button v-if="uploadable(row)" size="small" link type="primary" @click="emit('goContracts')">上传合同</el-button>
            <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" link type="danger" :disabled="!!blocked[row.projectId]" @click="close(row)">结束</el-button>
          </div>
          <span v-else class="sub">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <div v-if="loadError" class="state-box">
          <IconCircleExclamationPoint :size="48" />
          <h4>{{ loadError }}</h4>
          <p>{{ loadNet ? '请检查网络后重新加载' : '加载失败，可以稍后重新加载' }}</p>
          <el-button @click="load">重新加载</el-button>
        </div>
        <div v-else-if="!loading" class="state-box">
          <IconBuildingComplex :size="48" />
          <h4>暂无项目</h4>
          <p>{{ filter.keyword.trim() || filter.status !== DEFAULT_STATUS ? '当前筛选范围内没有项目，换个条件或点「重置」' : canManage ? '新建甲方企业与项目，上传合作合同后即可发布岗位' : '项目经理或老板新建项目后会出现在这里' }}</p>
          <el-button v-if="canManage" type="primary" @click="openCreate">新建项目</el-button>
        </div>
        <span v-else />
      </template>
    </el-table>
    <div v-if="list.length > 0" class="pager">
      <el-pagination
        v-model:current-page="pg.page"
        v-model:page-size="pg.pageSize"
        :total="list.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        size="small"
        @size-change="pg.page = 1"
      />
    </div>

    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑项目' : '新建项目'" width="560px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" maxlength="50" placeholder="如：立讯精密昆山二期" />
        </el-form-item>
        <el-form-item label="甲方企业" prop="clientId">
          <ClientSelect :key="dialog.seq" v-model="form.clientId" :disabled="!!dialog.editing" :initial-name="dialog.editing?.clientName" @change="onClientChange" />
          <div v-if="dialog.editing" class="sub lock-tip">项目创建后不能更换甲方企业</div>
          <div v-if="clientHint === 'ok'" class="hint"><span class="status-tag status-tag--success">该甲方已有有效合同，可发布岗位</span></div>
          <div v-else-if="clientHint === 'missing'" class="notice-bar notice-bar--warn hint">
            <IconCircleExclamationPoint :size="16" class="notice-bar-i" />
            <span>该甲方暂无审核通过且在有效期内的合作合同：项目可以创建，但需上传合同并审核通过后才能发布岗位。</span>
          </div>
        </el-form-item>
        <div class="place">
          <el-form-item label="省份" label-width="90px"><el-input v-model="form.province" maxlength="20" placeholder="选填" /></el-form-item>
          <el-form-item label="城市" prop="city" label-width="58px"><el-input v-model="form.city" maxlength="20" placeholder="如：苏州" /></el-form-item>
          <el-form-item label="区县" label-width="48px"><el-input v-model="form.district" maxlength="20" placeholder="如：昆山" /></el-form-item>
        </div>
        <el-form-item label="详细地址" prop="address">
          <el-input v-model="form.address" maxlength="200" placeholder="厂区地址，求职者端用于展示与通勤计算" />
        </el-form-item>
      </el-form>
      <p v-if="dialog.why" class="blocked-why" role="alert">{{ dialog.why }}</p>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" :disabled="!!dialog.why" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar .el-button + .el-button { margin-left: 0; }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.strong-t { color: var(--text-1); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.hint { margin-top: var(--space-2); }
.notice-bar.hint { width: 100%; }
/* 「项目创建后不能更换甲方企业」占一整行，和下面的提示隔开 */
.lock-tip { width: 100%; margin-top: var(--space-1); }
.place { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr); gap: 0 var(--space-2); }
</style>
