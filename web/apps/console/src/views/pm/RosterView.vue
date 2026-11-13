<script setup lang="ts">
import RowActions from '@/components/RowActions.vue'
import { opsColWidth, type RowAction } from '@/utils/rowActions'
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox, genFileId, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus'
import { errorMessage, tenantApi, type MemberView, type RosterBatch, type RosterBatchResult } from '@shitu/api-client'
import { downloadAuthed } from '@/utils/download'
import { fmtDateTime } from '@/utils/format'

/**
 * T-503 花名册导入（项目经理）：下载模板 → 上传 .xlsx（单次 ≤2000 行、≤5MB）→ 逐行校验结果 → 下载失败行修改后重传。
 * 免费期内导入的员工计入存量基数（D-42），永久免费。
 */
const uploadRef = ref<UploadInstance>()
const file = ref<File | null>(null)
const importing = ref(false)
const result = ref<RosterBatchResult | null>(null)
const batches = ref<RosterBatch[]>([])
const batchesLoading = ref(false)
const batchesError = ref('')
const members = ref<MemberView[]>([])
const downloading = ref('')

const failedRows = computed(() => result.value?.rows.filter((r) => !r.success) ?? [])
const memberName = (id: string) => members.value.find((m) => m.memberId === id)?.name ?? id

async function loadBatches() {
  batchesLoading.value = true
  batchesError.value = ''
  try {
    const r = await tenantApi.rosterBatches()
    batches.value = [...r].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch (e) {
    batchesError.value = errorMessage(e, '导入记录加载失败')
  } finally {
    batchesLoading.value = false
  }
}
onMounted(async () => {
  loadBatches()
  members.value = await tenantApi.members().catch(() => [])
})

async function download(kind: 'template' | string) {
  downloading.value = kind
  try {
    if (kind === 'template') await downloadAuthed(tenantApi.rosterTemplatePath, '花名册导入模板.xlsx')
    else await downloadAuthed(tenantApi.rosterFailedPath(kind), `导入失败行-${kind}.xlsx`)
  } catch (e) {
    ElMessage.error(errorMessage(e, '下载失败'))
  } finally {
    downloading.value = ''
  }
}

function onChange(f: UploadFile) {
  const raw = f.raw
  if (!raw) return
  if (!/\.xlsx$/i.test(raw.name)) {
    ElMessage.warning('请上传 .xlsx 格式的文件（可先下载模板）')
    uploadRef.value?.clearFiles()
    file.value = null
    return
  }
  if (raw.size > 5 * 1024 * 1024) {
    ElMessage.warning('文件不能超过 5MB')
    uploadRef.value?.clearFiles()
    file.value = null
    return
  }
  file.value = raw
}
function onExceed(files: File[]) {
  uploadRef.value?.clearFiles()
  const f = files[0] as UploadRawFile | undefined
  if (f) {
    f.uid = genFileId()
    uploadRef.value?.handleStart(f)
  }
}
function onRemove() {
  file.value = null
}

async function doImport() {
  const f = file.value
  if (!f) return ElMessage.warning('请先选择要导入的 .xlsx 文件')
  try {
    await ElMessageBox.confirm(`导入「${f.name}」？每行将为员工建档并绑定本公司，成功的行不可撤销。`, '导入花名册', {
      confirmButtonText: '开始导入',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  importing.value = true
  try {
    result.value = await tenantApi.rosterImport(f)
    const r = result.value
    if (r.failed === 0) ElMessage.success(`导入完成：${r.success} 行全部成功`)
    else ElMessage.warning(`导入完成：成功 ${r.success} 行，失败 ${r.failed} 行`)
    uploadRef.value?.clearFiles()
    file.value = null
    loadBatches()
  } catch (e) {
    ElMessage.error(errorMessage(e, '导入失败'))
  } finally {
    importing.value = false
  }
}

/** 只有存在失败行的批次才有「下载失败行」；都成功时不渲染操作列 */
const batchActions = (b: RosterBatch): RowAction[] => (b.failedRows > 0 ? [{ key: 'failed', label: '下载失败行', link: true }] : [])
const batchOpsWidth = computed(() => opsColWidth(batches.value.map(batchActions)))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>花名册导入</h2>
        <p>存量员工批量建档 · Excel 模板、逐行校验报告、失败行下载后修改重传</p>
      </div>
      <span class="spacer" />
      <el-button :loading="downloading === 'template'" @click="download('template')">下载模板</el-button>
    </div>

    <div class="grid g-32">
      <div class="card">
        <div class="card__hd"><h3>上传花名册</h3><span class="t-xs">.xlsx · 单次最多 2000 行 · 5MB 以内</span></div>
        <div class="card__bd">
          <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :limit="1"
            accept=".xlsx"
            :on-change="onChange"
            :on-exceed="onExceed"
            :on-remove="onRemove"
          >
            <div class="up">
              <b>将 .xlsx 文件拖到此处，或点击选择</b>
              <div class="t-xs" style="margin-top: 4px">列：姓名、手机号、身份证号、项目（编号或名称）、岗位编号（选填）、入职日期、工号（选填）</div>
            </div>
          </el-upload>
          <div class="row" style="margin-top: 12px">
            <span class="t-sm">{{ file ? `已选择：${file.name}` : '未选择文件' }}</span>
            <span class="spacer" />
            <el-button type="primary" :loading="importing" :disabled="!file" @click="doImport">开始导入</el-button>
          </div>
        </div>

        <template v-if="result">
          <div class="divider" style="margin: 0" />
          <div class="card__bd">
            <div class="row" style="margin-bottom: 12px">
              <span class="form-sec" style="margin: 0; flex: 1">本次导入结果</span>
              <span class="mono t-xs">批次 {{ result.batchId }}</span>
            </div>
            <div class="grid g-4" style="gap: 10px">
              <div class="stat"><div class="stat-l">总行数</div><div class="stat-v">{{ result.total }}</div></div>
              <div class="stat"><div class="stat-l">成功</div><div class="stat-v" style="color: var(--ok)">{{ result.success }}</div></div>
              <div class="stat" :class="{ 'stat--danger': result.failed > 0 }"><div class="stat-l">失败</div><div class="stat-v">{{ result.failed }}</div></div>
              <div class="stat">
                <div class="stat-l">计费口径</div>
                <div style="margin-top: 10px"><span class="tag tag--lg" :class="result.inFreePeriod ? 'tag--ok' : 'tag--warn'">{{ result.inFreePeriod ? '免费期 · 计入存量' : '免费期外 · 计入增量' }}</span></div>
              </div>
            </div>
            <template v-if="failedRows.length">
              <div class="row" style="margin: 14px 0 8px">
                <span class="t-sm strong">失败行</span>
                <span class="spacer" />
                <el-button size="small" type="primary" plain :loading="downloading === result.batchId" @click="download(result.batchId)">下载失败行</el-button>
              </div>
              <el-table :data="failedRows" size="small" max-height="320" row-key="rowNo">
                <el-table-column label="行号" min-width="80"><template #default="{ row }"><span class="mono">{{ row.rowNo }}</span></template></el-table-column>
                <el-table-column label="失败原因" min-width="260"><template #default="{ row }"><span class="t-sm" style="color: var(--danger)">{{ row.error || '—' }}</span></template></el-table-column>
              </el-table>
            </template>
            <div v-else class="note note--ok" style="margin-top: 12px">全部导入成功。</div>
          </div>
        </template>
      </div>

      <div class="grid" style="gap: 14px; align-content: start">
        <div class="card">
          <div class="card__hd"><h3>导入规则</h3></div>
          <div class="card__bd">
            <dl class="kv"><dt>来源渠道</dt><dd>花名册导入（绑定本公司）</dd></dl>
            <dl class="kv"><dt>公域 / 私域</dt><dd><span class="tag tag--private">私域</span></dd></dl>
            <dl class="kv"><dt>匹配范围</dt><dd>仅本公司内部调岗</dd></dl>
            <dl class="kv"><dt>免费期内导入</dt><dd>计入存量基数，永久免费</dd></dl>
            <div class="note" style="margin-top: 10px">存量基数按<b>免费期最后一天</b>的在岗人数统计，免费期满次日锁定。逐行处理，失败行不影响其他行。</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="card__hd"><h3>导入记录</h3><el-button size="small" @click="loadBatches">刷新</el-button></div>
      <el-alert v-if="batchesError" type="error" :title="batchesError" show-icon :closable="false" />
      <el-table v-loading="batchesLoading" :data="batches" row-key="batchId">
        <el-table-column label="批次" min-width="170" show-overflow-tooltip><template #default="{ row }"><span class="mono t-sm">{{ row.batchId }}</span></template></el-table-column>
        <el-table-column label="导入时间" min-width="156"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column label="总行数" min-width="80" align="center"><template #default="{ row }"><span class="num">{{ row.totalRows }}</span></template></el-table-column>
        <el-table-column label="成功" min-width="80" align="center"><template #default="{ row }"><span class="num" style="color: var(--ok)">{{ row.successRows }}</span></template></el-table-column>
        <el-table-column label="失败" min-width="80" align="center"><template #default="{ row }"><span class="num" :style="{ color: row.failedRows ? 'var(--danger)' : undefined }">{{ row.failedRows }}</span></template></el-table-column>
        <el-table-column label="计费口径" min-width="120"><template #default="{ row }"><span class="tag" :class="row.inFreePeriod ? 'tag--ok' : 'tag--warn'">{{ row.inFreePeriod ? '存量' : '增量' }}</span></template></el-table-column>
        <el-table-column label="操作人" min-width="110"><template #default="{ row }"><span class="t-sm">{{ memberName(row.operatorId) }}</span></template></el-table-column>
        <el-table-column v-if="batchOpsWidth" label="操作" :width="batchOpsWidth" fixed="right" class-name="ops-col">
          <template #default="{ row }"><RowActions :actions="batchActions(row)" :loading="downloading === row.batchId" @act="download(row.batchId)" /></template>
        </el-table-column>
        <template #empty><el-empty :image-size="70" :description="batchesError ? '加载失败' : '暂无导入记录'" /></template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.up { padding: 6px 0; color: var(--ink-700); }
</style>
