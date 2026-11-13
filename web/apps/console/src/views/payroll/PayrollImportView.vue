<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, genFileId, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus'
import { errorMessage, tenantApi, type MemberView, type PayrollBatchResult } from '@shitu/api-client'
import { IconCircleCheck, IconCircleExclamationPoint, IconDownload, IconFileText, IconInfo, IconUpload } from '@shitu/ui-icons'
import { boxSubmit } from '@/composables/boxSubmit'
import { useMeStore } from '@/stores/me'
import { fmtDateTime, fmtYuan, toNum } from '@/utils/format'

/**
 * 工资表导入（D-28 精简版，项目经理 / 老板）：选择月份 → 上传 .xlsx（第一行表头，列顺序：手机号、工号、应发、社保、个税、其他扣款）
 * → 逐行结果（自动抵扣预支欠款，生成 C 端工资条）。同一员工同一月份只能导入一次（防止重复抵扣）；核算与代发审批放到 V1.5。
 */
interface BatchRow {
  batchId: string
  payMonth: string
  headcount: number
  grossTotal: number
  advanceDeductTotal: number
  netTotal: number
  status: string
  operatorId: string
  createdAt: string
}

const meStore = useMeStore()
const uploadRef = ref<UploadInstance>()
const file = ref<File | null>(null)
const month = ref(prevMonth())
const result = ref<PayrollBatchResult | null>(null)
const rowFilter = ref<'all' | 'ok' | 'fail'>('all')
const batches = ref<BatchRow[]>([])
const batchesLoading = ref(false)
const batchesError = ref('')
const members = ref<MemberView[]>([])
/** 导入被后端业务拒绝的原因：留在上传区下方、置灰「开始导入」，换了文件或月份再放开 */
const why = ref('')
watch(month, () => (why.value = ''))
/** 逐行结果：前端分页，切换「全部 / 成功 / 失败」回到第一页 */
const rowPage = reactive({ page: 1, pageSize: 20 })
watch(rowFilter, () => (rowPage.page = 1))

function prevMonth() {
  const d = shNow()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function rowClass({ row }: { row: { success: boolean } }) {
  return row.success ? '' : 'row-danger'
}
function disabledMonth(d: Date) {
  return d.getTime() > shNowMs()
}

const failed = computed(() => result.value?.rows.filter((r) => !r.success) ?? [])

/** 失败行导出为 CSV（行号对应原表格，便于逐行修改后只上传失败行） */
function downloadFailed() {
  const r = result.value
  if (!r || !failed.value.length) return
  const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const lines = [['原表行号', '手机号（脱敏）', '工号', '失败原因'].map(esc).join(',')]
  for (const x of failed.value) lines.push([x.rowNo, x.phoneMasked, x.employeeNo, x.error].map(esc).join(','))
  // 带 BOM，Excel 打开不乱码
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `工资表失败行-${r.payMonth}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const shownRows = computed(() => {
  const rs = result.value?.rows ?? []
  if (rowFilter.value === 'ok') return rs.filter((r) => r.success)
  if (rowFilter.value === 'fail') return rs.filter((r) => !r.success)
  return rs
})
const pageRows = computed(() => shownRows.value.slice((rowPage.page - 1) * rowPage.pageSize, rowPage.page * rowPage.pageSize))
const memberName = (id: string) => (id === meStore.me?.memberId ? meStore.me?.name : members.value.find((m) => m.memberId === id)?.name) ?? id

/** 后端批次为 Map（驼峰键），金额可能是字符串 */
function toBatch(r: Record<string, unknown>): BatchRow {
  return {
    batchId: String(r.batchId ?? ''),
    payMonth: String(r.payMonth ?? ''),
    headcount: toNum(r.headcount),
    grossTotal: toNum(r.grossTotal),
    advanceDeductTotal: toNum(r.advanceDeductTotal),
    netTotal: toNum(r.netTotal),
    status: String(r.status ?? ''),
    operatorId: String(r.operatorId ?? ''),
    createdAt: String(r.createdAt ?? ''),
  }
}

async function loadBatches() {
  batchesLoading.value = true
  batchesError.value = ''
  try {
    batches.value = (await tenantApi.payrollBatches()).map((r) => toBatch(r as unknown as Record<string, unknown>))
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

function onChange(f: UploadFile) {
  const raw = f.raw
  if (!raw) return
  if (!/\.xlsx$/i.test(raw.name)) {
    ElMessage.warning('请上传 .xlsx 格式的工资表')
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
  if (!f) return ElMessage.warning('请先选择工资表 .xlsx 文件')
  if (!month.value) return ElMessage.warning('请选择工资所属月份')
  const dup = batches.value.filter((b) => b.payMonth === month.value).length
  const payMonth = month.value
  // 确认框里提交（规范 Page States「后台确认框一律在框内提交」）：导入期间框不关、「开始导入」转圈
  const s = boxSubmit(
    `导入 ${payMonth} 工资表「${f.name}」？成功的行会生成工资条推送员工，并自动抵扣预支欠款，不可撤销。` +
      (dup ? `该月份已有 ${dup} 个批次，已导入过的员工会被拒绝（防重复抵扣）。` : ''),
    '导入',
    async () => {
      result.value = await tenantApi.importPayroll(f, payMonth)
    },
    (w) => (why.value = w),
  )
  try {
    await ElMessageBox.confirm(s.message, '导入工资表', { confirmButtonText: '开始导入', cancelButtonText: '取消', type: dup ? 'warning' : 'info', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  const r = result.value
  if (r) {
    rowFilter.value = 'all'
    const bad = r.rows.filter((x) => !x.success).length
    if (bad === 0) ElMessage.success(`导入完成：${r.headcount} 人全部成功`)
    else ElMessage.warning(`导入完成：成功 ${r.headcount} 人，失败 ${bad} 行`)
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
        <h2>工资表导入</h2>
        <p>按月导入工资表 → 自动抵扣预支欠款 → 生成员工工资条</p>
      </div>
      <span class="spacer" />
    </div>

    <!-- 第 16 类导入（同花名册导入）：步骤说明 → 上传区 → 结果汇总 → 逐行结果表 -->
    <ol class="steps card">
      <li><b>1</b><div><h4>选择工资月份</h4><p>按员工在该月是否在本公司任职匹配</p></div></li>
      <li><b>2</b><div><h4>上传并导入</h4><p>.xlsx，单次最多 5000 行、5MB 以内</p></div></li>
      <li><b>3</b><div><h4>查看逐行结果</h4><p>失败行写明原因，修改后只保留失败行重传</p></div></li>
    </ol>

    <div class="grid-up">
      <div class="card">
        <div class="card__hd"><h3>上传工资表</h3></div>
        <div class="card__bd">
          <el-form label-width="auto" @submit.prevent>
            <el-form-item label="工资月份" required>
              <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" :disabled-date="disabledMonth" style="width: 160px" />
              <span class="hint">按员工在该月是否在本公司任职匹配</span>
            </el-form-item>
          </el-form>
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
              <b>将 .xlsx 工资表拖到此处，或点击选择</b>
              <p>列顺序：手机号 / 工号 / 应发 / 社保 / 个税 / 其他扣款（工号优先，无工号按手机号匹配）</p>
              <p>.xlsx 格式，第一行为表头，单次最多 5000 行、5MB 以内 · 各列按右侧「表格格式」排列</p>
            </div>
          </el-upload>
          <div class="up-ft">
            <span v-if="!file" class="up-f">未选择文件</span>
            <span class="spacer" />
            <el-button type="primary" :disabled="!file || !!why" @click="doImport">开始导入</el-button>
          </div>
          <p v-if="why" class="blocked-why up-why" role="status">{{ why }}。换一个文件或月份后可再导入</p>
        </div>
      </div>

      <div class="card">
        <div class="card__hd"><h3>表格格式</h3></div>
        <div class="card__bd">
          <table class="fmt">
            <thead><tr><th>列</th><th>内容</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td class="code">A</td><td>手机号</td><td>无工号时必填</td></tr>
              <tr><td class="code">B</td><td>工号</td><td>优先按工号匹配</td></tr>
              <tr><td class="code">C</td><td>应发</td><td>必填，≥ 0</td></tr>
              <tr><td class="code">D</td><td>社保</td><td>个人部分，可空</td></tr>
              <tr><td class="code">E</td><td>个税</td><td>可空</td></tr>
              <tr><td class="code">F</td><td>其他扣款</td><td>可空</td></tr>
            </tbody>
          </table>
          <div class="notice-bar formula">
            <IconInfo :size="16" class="notice-bar-i" />
            <span>实发 = 应发 − 社保 − 个税 − 其他扣款 − <b>预支抵扣</b>。预支欠款按先到先还自动从实发中扣除。</span>
          </div>
          <dl class="desc-list rules">
            <div><dt>员工匹配</dt><dd>该月在本公司有任职记录</dd></div>
            <div><dt>重复导入</dt><dd>同一员工同一月份仅一次</dd></div>
            <div><dt>逐行处理</dt><dd>失败行不影响其他行</dd></div>
            <div><dt>员工端</dt><dd>导入成功即生成工资条</dd></div>
          </dl>
        </div>
      </div>
    </div>

    <div v-if="result" class="card result">
      <div class="card__hd">
        <h3>本次导入结果 · {{ result.payMonth }}</h3>
        <span class="sub tnum">{{ result.batchId ? `批次 ${result.batchId}` : '全部失败，未生成批次' }}</span>
      </div>
      <div class="card__bd">
        <div class="sum">
          <div class="sum-i"><span>总行数</span><b class="tnum">{{ result.rows.length }}</b></div>
          <div class="sum-i"><span>成功</span><b class="tnum">{{ result.rows.length - failed.length }}<small> 条</small></b></div>
          <div class="sum-i" :class="{ bad: failed.length > 0 }"><span>失败</span><b class="tnum">{{ failed.length }}<small> 条</small></b></div>
          <div class="sum-i"><span>应发合计</span><b class="money">{{ fmtYuan(result.grossTotal) }}</b></div>
          <div class="sum-i"><span>预支抵扣合计</span><b class="money">{{ fmtYuan(result.advanceDeductTotal) }}</b></div>
          <div class="sum-i"><span>实发合计</span><b class="money net">{{ fmtYuan(result.netTotal) }}</b></div>
          <span class="spacer" />
          <el-button v-if="failed.length" @click="downloadFailed"><IconDownload :size="16" class="btn-i" />下载失败行</el-button>
        </div>
        <div v-if="failed.length === 0" class="notice-bar notice-bar--ok res-tip">
          <IconCircleCheck :size="16" class="notice-bar-i" />
          <span>全部导入成功，工资条已推送员工。</span>
        </div>
        <div v-else class="notice-bar notice-bar--warn res-tip">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>失败行请修改后<b>只保留失败行</b>重新上传；已成功的员工再次导入同一月份会被拒绝。</span>
        </div>
        <div class="filter-tabs res-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="rowFilter === 'all'" :class="{ on: rowFilter === 'all' }" @click="rowFilter = 'all'">全部<span class="n">{{ result.rows.length }}</span></button>
          <button type="button" role="tab" :aria-selected="rowFilter === 'ok'" :class="{ on: rowFilter === 'ok' }" @click="rowFilter = 'ok'">成功<span class="n">{{ result.rows.length - failed.length }}</span></button>
          <button type="button" role="tab" :aria-selected="rowFilter === 'fail'" :class="{ on: rowFilter === 'fail' }" @click="rowFilter = 'fail'">失败<span class="n">{{ failed.length }}</span></button>
        </div>
        <el-table class="row-tbl" :data="pageRows" row-key="rowNo" :row-class-name="rowClass">
          <el-table-column label="行号" width="80" align="right"><template #default="{ row }"><span class="tnum">{{ row.rowNo }}</span></template></el-table-column>
          <el-table-column label="结果" width="90">
            <template #default="{ row }">
              <span class="status-tag" :class="row.success ? 'status-tag--success' : 'status-tag--danger'">{{ row.success ? '成功' : '失败' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="失败原因 / 工资条" min-width="240">
            <template #default="{ row }">
              <span v-if="row.success" class="code">{{ row.payslipId }}</span>
              <span v-else class="why-t">{{ row.error || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="员工" width="180">
            <template #default="{ row }"><span class="tnum">{{ row.phoneMasked || '—' }}</span><span v-if="row.employeeNo" class="sub"> · {{ row.employeeNo }}</span></template>
          </el-table-column>
          <el-table-column label="预支抵扣" width="120" align="right">
            <template #default="{ row }"><span v-if="row.success" class="money">{{ fmtYuan(row.advanceDeduct) }}</span><span v-else class="sub">—</span></template>
          </el-table-column>
          <el-table-column label="实发" width="130" align="right">
            <template #default="{ row }"><span v-if="row.success" class="money">{{ fmtYuan(row.netPay) }}</span><span v-else class="sub">—</span></template>
          </el-table-column>
        </el-table>
        <div v-if="shownRows.length > rowPage.pageSize" class="pager">
          <el-pagination v-model:current-page="rowPage.page" :page-size="rowPage.pageSize" :total="shownRows.length" layout="total, prev, pager, next" background size="small" />
        </div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="card__hd"><h3>导入记录</h3><el-button size="small" @click="loadBatches">刷新</el-button></div>
      <el-table v-loading="batchesLoading" :data="batches" row-key="batchId">
        <el-table-column label="批次" min-width="150"><template #default="{ row }"><span class="code">{{ row.batchId }}</span></template></el-table-column>
        <el-table-column label="工资月份" width="100"><template #default="{ row }"><span class="tnum strong-t">{{ row.payMonth }}</span></template></el-table-column>
        <el-table-column label="成功人数" width="90" align="right"><template #default="{ row }"><span class="tnum">{{ row.headcount }}</span></template></el-table-column>
        <el-table-column label="应发合计" min-width="120" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.grossTotal) }}</span></template></el-table-column>
        <el-table-column label="预支抵扣" min-width="110" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.advanceDeductTotal) }}</span></template></el-table-column>
        <el-table-column label="实发合计" min-width="120" align="right"><template #default="{ row }"><span class="money">{{ fmtYuan(row.netTotal) }}</span></template></el-table-column>
        <el-table-column label="操作人" width="100"><template #default="{ row }">{{ memberName(row.operatorId) }}</template></el-table-column>
        <el-table-column label="导入时间" width="150"><template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
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
            <p>按上面的步骤选择月份、上传工资表，导入记录会出现在这里</p>
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
.hint { margin-left: var(--space-3); font-size: var(--font-size-min); color: var(--text-3); }
/* 上传区：虚线边框（Element 拖拽区默认就是虚线），可拖拽或点击 */
.up { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); color: var(--text-1); }
.up-i { color: var(--primary); margin-bottom: var(--space-1); }
.up p { font-size: var(--font-size-min); color: var(--text-3); }
.up-ft { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
.up-f { font-size: var(--font-size-aux); color: var(--text-2); }
.up-why { margin-top: var(--space-2); }
.fmt { width: 100%; border-collapse: collapse; font-size: var(--font-size-aux); }
.fmt th { text-align: left; font-weight: var(--font-weight-medium); color: var(--text-2); background: var(--bg-fill); padding: var(--space-1) var(--space-2); }
.fmt td { padding: var(--space-2); border-bottom: 1px solid var(--divider); color: var(--text-1); }
.fmt td:last-child { color: var(--text-3); }
.formula { margin-top: var(--space-3); }
.rules { margin-top: var(--space-4); }
.result, .tbl-card { margin-top: var(--space-gap); }
.sum { display: flex; align-items: center; gap: var(--space-8); margin-bottom: var(--space-4); flex-wrap: wrap; }
.sum-i { display: flex; flex-direction: column; gap: var(--space-1); }
.sum-i > span:first-child { font-size: var(--font-size-aux); color: var(--text-2); }
.sum-i b { font-size: var(--font-size-metric); font-weight: var(--font-weight-semibold); color: var(--text-1); line-height: 1.2; }
.sum-i b.money { font-size: var(--font-size-title); }
.sum-i b.net { color: var(--primary-text); }
.sum-i b small { font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--text-3); }
.sum-i.bad b { color: var(--danger-text); }
.res-tip { margin-bottom: var(--space-3); }
.res-tabs { margin-bottom: var(--space-2); }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-1); white-space: nowrap; }
.strong-t { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.sub { font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.why-t { color: var(--danger-text); }
</style>
