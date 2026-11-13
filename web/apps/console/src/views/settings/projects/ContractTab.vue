<script setup lang="ts">
import { shNow } from '@/utils/time'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type ContractView, type UploadedFile } from '@shitu/api-client'
import ClientSelect from '@/components/ClientSelect.vue'
import DictTag from '@/components/DictTag.vue'
import FileLink from '@/components/FileLink.vue'
import FileUploader, { type FileEntry } from '@/components/FileUploader.vue'
import { fmtDate, fmtDateTime } from '@/utils/format'

const loading = ref(false)
const loadError = ref('')
const list = ref<ContractView[]>([])
const clientFilter = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    list.value = await tenantApi.contracts(clientFilter.value || undefined)
  } catch (e) {
    loadError.value = errorMessage(e, '合同加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---------------------------------------------------------------- 上传合同
const dialog = reactive({ visible: false, saving: false, seq: 0 })
const formRef = ref<FormInstance>()
const form = reactive<{ clientId: string; range: [string, string] | undefined; files: FileEntry[] }>({ clientId: '', range: undefined, files: [] })
const fileError = ref('')
const rules: FormRules = {
  clientId: [{ required: true, message: '请选择甲方企业', trigger: 'change' }],
  range: [{ required: true, message: '请选择合同有效期', trigger: 'change' }],
}

function openUpload() {
  Object.assign(form, { clientId: clientFilter.value, range: undefined, files: [] })
  fileError.value = ''
  dialog.seq++
  dialog.visible = true
  formRef.value?.clearValidate()
}

function upload(file: File): Promise<UploadedFile> {
  return tenantApi.upload(file, 'contract')
}

const today = shNow()
today.setHours(0, 0, 0, 0)

async function save() {
  const ok = await formRef.value?.validate().catch(() => false)
  fileError.value = form.files.length ? '' : '请上传合同文件'
  if (!ok || fileError.value || !form.range) return
  const [validFrom, validTo] = form.range
  if (new Date(validTo) < today) {
    ElMessage.warning('合同已过期，请上传在有效期内的合同')
    return
  }
  dialog.saving = true
  try {
    await tenantApi.submitContract({ clientId: form.clientId, fileKey: form.files[0].key, validFrom, validTo })
    ElMessage.success('合同已提交，等待平台审核')
    dialog.visible = false
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    dialog.saving = false
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <div style="width: 260px"><ClientSelect v-model="clientFilter" :allow-create="false" @change="load" /></div>
      <el-button v-if="clientFilter" link @click="(clientFilter = ''), load()">清除筛选</el-button>
      <div class="tb-fields">
        <div class="tb-group">
          <el-button @click="load">刷新</el-button>
          <el-button type="primary" @click="openUpload">+ 上传合同</el-button>
        </div>
      </div>
    </div>
    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" />
    <el-table v-loading="loading" :data="list" row-key="contractId">
      <el-table-column label="甲方企业" prop="clientName" min-width="200" show-overflow-tooltip />
      <el-table-column label="有效期" min-width="210">
        <template #default="{ row }"><span class="mono t-sm">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span></template>
      </el-table-column>
      <el-table-column label="审核" min-width="100">
        <template #default="{ row }"><DictTag type="ClientContractStatus" :value="row.auditStatus" /></template>
      </el-table-column>
      <el-table-column label="审核意见" min-width="180">
        <template #default="{ row }">
          <span :class="row.auditStatus === 'REJECTED' ? 'danger-text' : 't-sm'">{{ row.auditRemark || '—' }}</span>
          <div v-if="row.auditedAt" class="t-xs">{{ fmtDateTime(row.auditedAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="当前有效" min-width="100">
        <template #default="{ row }">
          <span v-if="row.effective" class="tag tag--ok">生效中</span>
          <span v-else class="tag tag--muted">未生效</span>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" min-width="156">
        <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="文件" min-width="80" align="right">
        <template #default="{ row }"><FileLink :file-key="row.fileKey" /></template>
      </el-table-column>
      <template #empty>
        <el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无合作合同'">
          <el-button v-if="!loadError" type="primary" @click="openUpload">上传合同</el-button>
        </el-empty>
      </template>
    </el-table>

    <el-dialog v-model="dialog.visible" title="上传甲方合作合同" width="560px" :close-on-click-modal="false">
      <div class="note" style="margin-bottom: 16px">
        合同经平台审核通过、且今天在有效期内，该甲方下的项目才能发布岗位。<b>后续发布的岗位必须与该甲方企业相关。</b>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="甲方企业" prop="clientId">
          <ClientSelect :key="dialog.seq" v-model="form.clientId" />
        </el-form-item>
        <el-form-item label="合同有效期" prop="range">
          <el-date-picker
            v-model="form.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            range-separator="~"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="合同文件" required :error="fileError">
          <FileUploader v-model="form.files" :upload="upload" :limit="1" viewable hint="PDF / JPG / PNG，≤ 10MB" @update:model-value="fileError = ''" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="save">提交审核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.danger-text { color: var(--danger); font-size: 12.5px; }
</style>
