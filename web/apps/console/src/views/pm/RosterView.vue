<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, genFileId, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus'
import { errorMessage, tenantApi, type MemberView, type RosterBatch, type RosterBatchResult } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconDownload, IconFileText, IconUpload } from '@shitu/ui-icons'
import { boxSubmit } from '@/composables/boxSubmit'
import { downloadAuthed } from '@/utils/download'
import { fmtDateTime } from '@/utils/format'

/**
 * T-503 花名册导入（项目经理）：下载模板 → 上传 .xlsx（单次 ≤2000 行、≤5MB）→ 逐行校验结果 → 下载失败行修改后重传。
 * 免费期内导入的员工计入存量基数（D-42），永久免费。
 */
const uploadRef = ref<UploadInstance>()
const file = ref<File | null>(null)
const result = ref<RosterBatchResult | null>(null)
const batches = ref<RosterBatch[]>([])
const batchesLoading = ref(false)
const batchesError = ref('')
const members = ref<MemberView[]>([])
const downloading = ref('')

/** 导入被后端业务拒绝（如表头不对）的原因：留在上传区下方、置灰「开始导入」，换了文件再放开 */
const why = ref('')
/** 逐行结果：全部行（失败行用危险浅底标出），前端分页 */
const rowPage = reactive({ page: 1, pageSize: 20 })
const resultRows = computed(() => (result.value?.rows ?? []).slice((rowPage.page - 1) * rowPage.pageSize, rowPage.page * rowPage.pageSize))
function rowClass({ row }: { row: { success: boolean } }) {
  return row.success ? '' : 'row-danger'
}
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
  why.value = ''
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
  why.value = ''
}

async function doImport() {
  const f = file.value
  if (!f) return ElMessage.warning('请先选择要导入的 .xlsx 文件')
  // 确认框里提交（规范 Page States「后台确认框一律在框内提交」）：导入期间框不关、「开始导入」转圈
  const s = boxSubmit(
    `导入「${f.name}」？每行将为员工建档并绑定本公司，成功的行不可撤销。`,
    '导入',
    async () => {
      result.value = await tenantApi.rosterImport(f)
    },
    (w) => (why.value = w),
  )
  try {
    await ElMessageBox.confirm(s.message, '导入花名册', { confirmButtonText: '开始导入', cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  const r = result.value
  if (r) {
    if (r.failed === 0) ElMessage.success(`导入完成：${r.success} 行全部成功`)
    else ElMessage.warning(`导入完成：成功 ${r.success} 行，失败 ${r.failed} 行`)
  }
  rowPage.page = 1
  uploadRef.value?.clearFiles()
  file.value = null
  loadBatches()
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>花名册导入</h2>
        <p>存量员工批量建档 · Excel 模板、逐行校验报告、失败行下载后修改重传</p>
      </div>
      <span class="spacer" />
      <el-button :loading="downloading === 'template'" @click="download('template')"><IconDownload :size="16" class="btn-i" />下载模板</el-button>
    </div>

    <!-- 第 16 类导入：步骤说明 → 上传区 → 结果汇总 → 逐行结果表 -->
    <ol class="steps card">
      <li><b>1</b><div><h4>下载模板</h4><p>点右上角「下载模板」，按模板的列填写</p></div></li>
      <li><b>2</b><div><h4>上传并导入</h4><p>.xlsx，单次最多 2000 行、5MB 以内</p></div></li>
      <li><b>3</b><div><h4>查看逐行结果</h4><p>失败行写明原因，下载后修改再重传</p></div></li>
    </ol>

    <div class="grid-up">
      <div class="card">
        <div class="card__hd"><h3>上传花名册</h3></div>
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
              <IconUpload :size="32" class="up-i" />
              <b>将 .xlsx 文件拖到此处，或点击选择</b>
              <p>列：姓名、手机号、身份证号、项目（编号或名称）、岗位编号（选填）、入职日期、工号（选填）</p>
              <p>没有模板？点右上角「下载模板」</p>
            </div>
          </el-upload>
          <div class="up-ft">
            <span class="up-f">{{ file ? `已选择：${file.name}` : '未选择文件' }}</span>
            <span class="spacer" />
            <el-button type="primary" :disabled="!file || !!why" @click="doImport">开始导入</el-button>
          </div>
          <p v-if="why" class="blocked-why up-why" role="status">{{ why }}。换一个文件后可再导入</p>
        </div>
      </div>

      <div class="card">
        <div class="card__hd"><h3>导入规则</h3></div>
        <div class="card__bd">
          <dl class="desc-list">
            <div><dt>来源渠道</dt><dd>花名册导入（绑定本公司）</dd></div>
            <div><dt>公域 / 私域</dt><dd><span class="status-tag status-tag--private">私域</span></dd></div>
            <div><dt>匹配范围</dt><dd>仅本公司内部调岗</dd></div>
            <div><dt>免费期内导入</dt><dd>计入存量基数，永久免费</dd></div>
          </dl>
          <p class="rule-note">存量基数按<b>免费期最后一天</b>的在岗人数统计，免费期满次日锁定。逐行处理，失败行不影响其他行。</p>
        </div>
      </div>
    </div>

    <div v-if="result" class="card result">
      <div class="card__hd">
        <h3>本次导入结果</h3>
        <span class="sub tnum">批次 {{ result.batchId }}</span>
      </div>
      <div class="card__bd">
        <div class="sum">
          <div class="sum-i"><span>总行数</span><b class="tnum">{{ result.total }}</b></div>
          <div class="sum-i"><span>成功</span><b class="tnum">{{ result.success }}<small> 条</small></b></div>
          <div class="sum-i" :class="{ bad: result.failed > 0 }"><span>失败</span><b class="tnum">{{ result.failed }}<small> 条</small></b></div>
          <div class="sum-i">
            <span>计费口径</span>
            <span class="status-tag" :class="result.inFreePeriod ? 'status-tag--success' : 'status-tag--warning'">{{ result.inFreePeriod ? '免费期 · 计入存量' : '免费期外 · 计入增量' }}</span>
          </div>
          <span class="spacer" />
          <el-button v-if="result.failed > 0" :loading="downloading === result.batchId" @click="download(result.batchId)"><IconDownload :size="16" class="btn-i" />下载失败行</el-button>
        </div>
        <el-table class="row-tbl" :data="resultRows" row-key="rowNo" :row-class-name="rowClass">
          <el-table-column label="行号" width="90" align="right"><template #default="{ row }"><span class="tnum">{{ row.rowNo }}</span></template></el-table-column>
          <el-table-column label="结果" width="100">
            <template #default="{ row }">
              <span class="status-tag" :class="row.success ? 'status-tag--success' : 'status-tag--danger'">{{ row.success ? '成功' : '失败' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="原因" min-width="300">
            <template #default="{ row }"><span :class="row.success ? 'sub' : 'why-t'">{{ row.success ? '—' : row.error || '—' }}</span></template>
          </el-table-column>
        </el-table>
        <div v-if="result.rows.length > rowPage.pageSize" class="pager">
          <el-pagination v-model:current-page="rowPage.page" :page-size="rowPage.pageSize" :total="result.rows.length" layout="total, prev, pager, next" background size="small" />
        </div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="card__hd"><h3>导入记录</h3><el-button size="small" @click="loadBatches">刷新</el-button></div>
      <el-table v-loading="batchesLoading" :data="batches" row-key="batchId">
        <el-table-column label="批次" min-width="160"><template #default="{ row }"><span class="tnum">{{ row.batchId }}</span></template></el-table-column>
        <el-table-column label="导入时间" width="150"><template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column label="总行数" width="90" align="right"><template #default="{ row }"><span class="tnum">{{ row.totalRows }}</span></template></el-table-column>
        <el-table-column label="成功" width="90" align="right"><template #default="{ row }"><span class="tnum">{{ row.successRows }}</span></template></el-table-column>
        <el-table-column label="失败" width="90" align="right"><template #default="{ row }"><span class="tnum" :class="{ 'why-t': row.failedRows }">{{ row.failedRows }}</span></template></el-table-column>
        <el-table-column label="计费口径" width="110"><template #default="{ row }"><span class="status-tag" :class="row.inFreePeriod ? 'status-tag--success' : 'status-tag--warning'">{{ row.inFreePeriod ? '存量' : '增量' }}</span></template></el-table-column>
        <el-table-column label="操作人" width="110"><template #default="{ row }">{{ memberName(row.operatorId) }}</template></el-table-column>
        <el-table-column label="操作" width="104" align="right" class-name="ops-col">
          <template #default="{ row }">
            <el-button v-if="row.failedRows > 0" size="small" link type="primary" :loading="downloading === row.batchId" @click="download(row.batchId)">下载失败行</el-button>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="batchesError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ batchesError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="loadBatches">重新加载</el-button>
          </div>
          <div v-else-if="!batchesLoading" class="state-box">
            <IconFileText :size="48" />
            <h4>暂无导入记录</h4>
            <p>按上面的步骤下载模板、填写后上传，导入记录会出现在这里</p>
          </div>
          <span v-else />
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.btn-i { margin-right: var(--space-1); }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); margin: 0; padding: var(--space-4); list-style: none; }
.steps li { display: flex; gap: var(--space-3); align-items: flex-start; min-width: 0; }
.steps li > b { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--primary-bg); color: var(--primary-text); font-size: var(--font-size-min); font-weight: var(--font-weight-semibold); }
.steps h4 { margin: 0; font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.steps p { margin-top: var(--space-1); font-size: var(--font-size-aux); color: var(--text-3); }
.grid-up { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
/* 上传区：虚线边框（Element 拖拽区默认就是虚线），可拖拽或点击 */
.up { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); color: var(--text-1); }
.up-i { color: var(--primary); margin-bottom: var(--space-1); }
.up p { font-size: var(--font-size-min); color: var(--text-3); }
.up-ft { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
.up-f { font-size: var(--font-size-aux); color: var(--text-2); }
.up-why { margin-top: var(--space-2); }
.rule-note { margin-top: var(--space-4); font-size: var(--font-size-aux); line-height: 1.7; color: var(--text-2); }
.rule-note b { color: var(--text-1); }
.result, .tbl-card { margin-top: var(--space-gap); }
.sum { display: flex; align-items: center; gap: var(--space-8); margin-bottom: var(--space-4); flex-wrap: wrap; }
.sum-i { display: flex; flex-direction: column; gap: var(--space-1); }
.sum-i > span:first-child { font-size: var(--font-size-aux); color: var(--text-2); }
.sum-i b { font-size: var(--font-size-metric); font-weight: var(--font-weight-semibold); color: var(--text-1); line-height: 1.2; }
.sum-i b small { font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--text-3); }
.sum-i.bad b { color: var(--danger-text); }
.sub { font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.why-t { color: var(--danger-text); }
</style>
