<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
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
import ClientSelect from '@/components/ClientSelect.vue'
import DictTag from '@/components/DictTag.vue'
import { useMeStore } from '@/stores/me'
import { fmtDate } from '@/utils/format'

const emit = defineEmits<{ goContracts: [] }>()
const meStore = useMeStore()
const { options } = useDict()
const canManage = computed(() => meStore.can('PROJECT_MANAGE'))

const loading = ref(false)
const loadError = ref('')
const list = ref<ProjectView[]>([])
const filter = reactive<{ status: ProjectStatus | ''; keyword: string }>({ status: 'ACTIVE', keyword: '' })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    list.value = await tenantApi.projects({ status: filter.status || undefined, keyword: filter.keyword.trim() || undefined })
  } catch (e) {
    loadError.value = errorMessage(e, '项目加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---------------------------------------------------------------- 新建 / 编辑
const dialog = reactive({ visible: false, saving: false, seq: 0, editing: null as ProjectView | null })
const formRef = ref<FormInstance>()
const form = reactive({ name: '', clientId: '', province: '', city: '', district: '', address: '' })
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
  dialog.visible = true
  formRef.value?.clearValidate()
}

function openEdit(p: ProjectView) {
  dialog.editing = p
  Object.assign(form, { name: p.name, clientId: p.clientId, province: p.province ?? '', city: p.city, district: p.district ?? '', address: p.address })
  clientHint.value = p.contractEffective ? 'ok' : 'missing'
  dialog.seq++
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
  } finally {
    dialog.saving = false
  }
}

async function close(p: ProjectView) {
  try {
    await ElMessageBox.confirm(`结束后「${p.name}」将不能再发布或恢复岗位，确定结束该项目？`, '结束项目', {
      type: 'warning',
      confirmButtonText: '结束项目',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await tenantApi.closeProject(p.projectId)
    ElMessage.success('项目已结束')
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

function location(p: ProjectView) {
  return [p.province, p.city, p.district].filter(Boolean).join(' · ')
}
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="filter-tabs">
        <button :class="{ on: filter.status === '' }" @click="(filter.status = ''), load()">全部</button>
        <button v-for="o in options('ProjectStatus')" :key="o.value" :class="{ on: filter.status === o.value }" @click="(filter.status = o.value as ProjectStatus), load()">
          {{ o.label }}
        </button>
      </div>
      <span class="spacer" />
      <el-input v-model="filter.keyword" placeholder="项目 / 甲方名称" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
      <el-button @click="load">查询</el-button>
      <el-button v-if="canManage" type="primary" @click="openCreate">+ 新建项目</el-button>
    </div>
    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" />
    <el-table v-loading="loading" :data="list" row-key="projectId" :row-class-name="({ row }) => (row.status === 'CLOSED' ? 'row-dim' : '')">
      <el-table-column label="项目名称" min-width="180">
        <template #default="{ row }"><b>{{ row.name }}</b><div class="t-xs">创建于 {{ fmtDate(row.createdAt) }}</div></template>
      </el-table-column>
      <el-table-column label="甲方企业" prop="clientName" min-width="200" />
      <el-table-column label="地点" min-width="220">
        <template #default="{ row }">
          <div class="t-sm strong">{{ location(row) }}</div>
          <div class="t-xs">{{ row.address }}</div>
        </template>
      </el-table-column>
      <el-table-column label="合同" width="130">
        <template #default="{ row }">
          <span v-if="row.contractEffective" class="tag tag--ok">合同有效</span>
          <span v-else class="tag tag--warn">无有效合同</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><DictTag type="ProjectStatus" :value="row.status" /></template>
      </el-table-column>
      <el-table-column v-if="canManage" label="操作" width="200" align="right">
        <template #default="{ row }">
          <template v-if="row.status === 'ACTIVE'">
            <el-button v-if="!row.contractEffective && meStore.can('CLIENT_CONTRACT_MANAGE')" size="small" link type="primary" @click="emit('goContracts')">上传合同</el-button>
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="close(row)">结束</el-button>
          </template>
          <span v-else class="t-xs">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无项目'">
          <el-button v-if="canManage && !loadError" type="primary" @click="openCreate">新建项目</el-button>
        </el-empty>
      </template>
    </el-table>

    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑项目' : '新建项目'" width="560px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="86px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" maxlength="50" placeholder="如：立讯精密昆山二期" />
        </el-form-item>
        <el-form-item label="甲方企业" prop="clientId">
          <ClientSelect :key="dialog.seq" v-model="form.clientId" :disabled="!!dialog.editing" :initial-name="dialog.editing?.clientName" @change="onClientChange" />
          <div v-if="dialog.editing" class="t-xs" style="margin-top: 4px">项目创建后不能更换甲方企业</div>
          <div v-if="clientHint === 'ok'" class="tag tag--ok" style="margin-top: 6px">该甲方已有有效合同，可发布岗位</div>
          <div v-else-if="clientHint === 'missing'" class="note note--warn" style="margin-top: 6px; width: 100%">该甲方暂无审核通过且在有效期内的合作合同：项目可以创建，但需上传合同并审核通过后才能发布岗位。</div>
        </el-form-item>
        <div class="grid g-3" style="gap: 0 10px">
          <el-form-item label="省份" label-width="86px"><el-input v-model="form.province" maxlength="20" placeholder="选填" /></el-form-item>
          <el-form-item label="城市" prop="city" label-width="50px"><el-input v-model="form.city" maxlength="20" placeholder="如：苏州" /></el-form-item>
          <el-form-item label="区县" label-width="50px"><el-input v-model="form.district" maxlength="20" placeholder="如：昆山" /></el-form-item>
        </div>
        <el-form-item label="详细地址" prop="address">
          <el-input v-model="form.address" maxlength="200" placeholder="厂区地址，求职者端用于展示与通勤计算" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
