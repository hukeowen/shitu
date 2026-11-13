<script setup lang="ts">
import { shNow } from '@/utils/time'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type ContractView, type UploadedFile } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconFileText, IconInfo } from '@shitu/ui-icons'
import ClientSelect from '@/components/ClientSelect.vue'
import DictTag from '@/components/DictTag.vue'
import FileLink from '@/components/FileLink.vue'
import FileUploader, { type FileEntry } from '@/components/FileUploader.vue'
import { isBlocked } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDate, fmtDateTime } from '@/utils/format'

const loading = ref(false)
const loadError = ref('')
const list = ref<ContractView[]>([])
const clientFilter = ref('')
/** 接口一次返回全部合同，表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => list.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    list.value = await tenantApi.contracts(clientFilter.value || undefined)
    pg.page = 1
  } catch (e) {
    list.value = []
    loadError.value = errorMessage(e, '合同加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 重置：甲方筛选清空后重新查询 */
function reset() {
  clientFilter.value = ''
  load()
}

// ---------------------------------------------------------------- 上传合同
const dialog = reactive({ visible: false, saving: false, seq: 0, why: '' })
const formRef = ref<FormInstance>()
const form = reactive<{ clientId: string; range: [string, string] | undefined; files: FileEntry[] }>({ clientId: '', range: undefined, files: [] })
// 提交被后端拒绝后置灰「提交审核」；改了内容再放开
watch(form, () => (dialog.why = ''))
const fileError = ref('')
const rules: FormRules = {
  clientId: [{ required: true, message: '请选择甲方企业', trigger: 'change' }],
  range: [{ required: true, message: '请选择合同有效期', trigger: 'change' }],
}

function openUpload() {
  Object.assign(form, { clientId: clientFilter.value, range: undefined, files: [] })
  fileError.value = ''
  dialog.seq++
  dialog.why = ''
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
    if (isBlocked(e)) dialog.why = `暂时不能提交审核：${errorMessage(e)}`
  } finally {
    dialog.saving = false
  }
}

/** 「文件」列只有一个「查看」 */
const fileColWidth = actionsColWidth([{ labels: ['查看'] }], 72)

defineExpose({ openUpload })
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="client-f"><ClientSelect v-model="clientFilter" :allow-create="false" @change="load" /></div>
      <span class="spacer" />
      <el-button @click="load">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>
    <el-table v-loading="loading" :data="pageRows" row-key="contractId">
      <el-table-column label="甲方企业" min-width="180">
        <template #default="{ row }"><span class="strong-t">{{ row.clientName }}</span></template>
      </el-table-column>
      <el-table-column label="有效期" width="210">
        <template #default="{ row }"><span class="tnum">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span></template>
      </el-table-column>
      <el-table-column label="审核" width="90">
        <template #default="{ row }"><DictTag type="ClientContractStatus" :value="row.auditStatus" /></template>
      </el-table-column>
      <el-table-column label="审核意见" min-width="160">
        <template #default="{ row }">
          <span :class="row.auditStatus === 'REJECTED' ? 'remark-bad' : 'strong-t'">{{ row.auditRemark || '—' }}</span>
          <div v-if="row.auditedAt" class="sub tnum">{{ fmtDateTime(row.auditedAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="当前有效" width="90">
        <template #default="{ row }">
          <span class="status-tag" :class="row.effective ? 'status-tag--success' : 'status-tag--neutral'">{{ row.effective ? '生效中' : '未生效' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="150">
        <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="文件" :width="fileColWidth" align="right" class-name="ops-col">
        <template #default="{ row }"><FileLink :file-key="row.fileKey" /></template>
      </el-table-column>
      <template #empty>
        <div v-if="loadError" class="state-box">
          <IconCircleExclamationPoint :size="48" />
          <h4>{{ loadError }}</h4>
          <p>请检查网络后重新加载</p>
          <el-button @click="load">重新加载</el-button>
        </div>
        <div v-else-if="!loading" class="state-box">
          <IconFileText :size="48" />
          <h4>暂无合作合同</h4>
          <p>{{ clientFilter ? '这个甲方还没有上传过合同，换个甲方或点「重置」' : '点右上角「上传合同」，平台审核通过后该甲方下的项目即可发布岗位' }}</p>
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

    <el-dialog v-model="dialog.visible" title="上传甲方合作合同" width="560px" :close-on-click-modal="false">
      <div class="notice-bar dlg-tip">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>合同经平台审核通过、且今天在有效期内，该甲方下的项目才能发布岗位。<b>后续发布的岗位必须与该甲方企业相关。</b></span>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
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
      <p v-if="dialog.why" class="blocked-why" role="alert">{{ dialog.why }}</p>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" :disabled="!!dialog.why" @click="save">提交审核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar .el-button + .el-button { margin-left: 0; }
.client-f { width: 260px; }
.strong-t { color: var(--text-1); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 驳回意见：危险文字色，和「审核」列的驳回标签同一色调 */
.remark-bad { font-size: var(--font-size-aux); color: var(--danger-text); }
.dlg-tip { margin-bottom: var(--space-4); }
</style>
