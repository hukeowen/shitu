<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox, genFileId, type UploadFile, type UploadInstance, type UploadRawFile } from 'element-plus'
import { errorMessage, tenantApi, type MemberView, type PayrollBatchResult } from '@shitu/api-client'
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
const importing = ref(false)
const result = ref<PayrollBatchResult | null>(null)
const rowFilter = ref<'all' | 'ok' | 'fail'>('all')
const batches = ref<BatchRow[]>([])
const batchesLoading = ref(false)
const batchesError = ref('')
const members = ref<MemberView[]>([])

function prevMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function rowClass({ row }: { row: { success: boolean } }) {
  return row.success ? '' : 'row-danger'
}
function disabledMonth(d: Date) {
  return d.getTime() > Date.now()
}

const failed = computed(() => result.value?.rows.filter((r) => !r.success) ?? [])
const shownRows = computed(() => {
  const rs = result.value?.rows ?? []
  if (rowFilter.value === 'ok') return rs.filter((r) => r.success)
  if (rowFilter.value === 'fail') return rs.filter((r) => !r.success)
  return rs
})
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
    batches.value = (await tenantApi.payrollBatches()).map(toBatch)
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
  if (!f) return ElMessage.warning('请先选择工资表 .xlsx 文件')
  if (!month.value) return ElMessage.warning('请选择工资所属月份')
  const dup = batches.value.filter((b) => b.payMonth === month.value).length
  try {
    await ElMessageBox.confirm(
      `导入 ${month.value} 工资表「${f.name}」？成功的行会生成工资条推送员工，并自动抵扣预支欠款，不可撤销。` +
        (dup ? `\n该月份已有 ${dup} 个批次，已导入过的员工会被拒绝（防重复抵扣）。` : ''),
      '导入工资表',
      { confirmButtonText: '开始导入', cancelButtonText: '取消', type: dup ? 'warning' : 'info' },
    )
  } catch {
    return
  }
  importing.value = true
  try {
    const r = await tenantApi.importPayroll(f, month.value)
    result.value = r
    rowFilter.value = 'all'
    const bad = r.rows.filter((x) => !x.success).length
    if (bad === 0) ElMessage.success(`导入完成：${r.headcount} 人全部成功`)
    else ElMessage.warning(`导入完成：成功 ${r.headcount} 人，失败 ${bad} 行`)
    uploadRef.value?.clearFiles()
    file.value = null
    loadBatches()
  } catch (e) {
    ElMessage.error(errorMessage(e, '导入失败'))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>工资表导入</h2>
        <p>按月导入工资表 → 自动抵扣预支欠款 → 生成员工工资条（核算与代发审批 V1.5 上线）</p>
      </div>
      <span class="spacer" />
      <span class="ref">决策 <b>D-28</b></span>
    </div>

    <div class="grid g-32">
      <div class="card">
        <div class="card__hd"><h3>上传工资表</h3><span class="t-xs">.xlsx · 第一行为表头 · 单次最多 5000 行 · 5MB 以内</span></div>
        <div class="card__bd">
          <el-form label-width="90px" @submit.prevent>
            <el-form-item label="工资月份" required>
              <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" :disabled-date="disabledMonth" style="width: 160px" />
              <span class="t-xs" style="margin-left: 10px">按员工在该月是否在本公司任职匹配</span>
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
              <b>将 .xlsx 工资表拖到此处，或点击选择</b>
              <div class="t-xs" style="margin-top: 4px">列顺序：手机号 / 工号 / 应发 / 社保 / 个税 / 其他扣款（工号优先，无工号按手机号匹配）</div>
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
              <span class="form-sec" style="margin: 0; flex: 1">本次导入结果 · {{ result.payMonth }}</span>
              <span class="mono t-xs">批次 {{ result.batchId }}</span>
            </div>
            <div class="grid g-4" style="gap: 10px">
              <div class="stat">
                <div class="stat-l">成功人数</div>
                <div class="stat-v" style="color: var(--ok)">{{ result.headcount }}</div>
                <div class="stat-d" :style="{ color: failed.length ? 'var(--danger)' : undefined }">失败 {{ failed.length }} 行</div>
              </div>
              <div class="stat"><div class="stat-l">应发合计</div><div class="stat-v sm">{{ fmtYuan(result.grossTotal) }}</div></div>
              <div class="stat stat--signal"><div class="stat-l">预支抵扣合计</div><div class="stat-v sm">{{ fmtYuan(result.advanceDeductTotal) }}</div></div>
              <div class="stat"><div class="stat-l">实发合计</div><div class="stat-v sm">{{ fmtYuan(result.netTotal) }}</div></div>
            </div>
            <div class="row" style="margin: 14px 0 8px">
              <div class="filter-tabs">
                <button :class="{ on: rowFilter === 'all' }" @click="rowFilter = 'all'">全部<span class="n">{{ result.rows.length }}</span></button>
                <button :class="{ on: rowFilter === 'ok' }" @click="rowFilter = 'ok'">成功<span class="n">{{ result.rows.length - failed.length }}</span></button>
                <button :class="{ on: rowFilter === 'fail' }" @click="rowFilter = 'fail'">失败<span class="n">{{ failed.length }}</span></button>
              </div>
            </div>
            <el-table :data="shownRows" size="small" max-height="360" row-key="rowNo" :row-class-name="rowClass">
              <el-table-column label="行号" width="70"><template #default="{ row }"><span class="mono">{{ row.rowNo }}</span></template></el-table-column>
              <el-table-column label="结果" width="80">
                <template #default="{ row }"><span class="tag" :class="row.success ? 'tag--ok' : 'tag--danger'">{{ row.success ? '成功' : '失败' }}</span></template>
              </el-table-column>
              <el-table-column label="预支抵扣" width="110" align="right">
                <template #default="{ row }"><span class="num" :style="{ color: toNum(row.advanceDeduct) > 0 ? 'var(--signal-700)' : undefined }">{{ row.success ? fmtYuan(row.advanceDeduct) : '—' }}</span></template>
              </el-table-column>
              <el-table-column label="实发" width="120" align="right">
                <template #default="{ row }"><b class="num">{{ row.success ? fmtYuan(row.netPay) : '—' }}</b></template>
              </el-table-column>
              <el-table-column label="工资条 / 失败原因" min-width="220">
                <template #default="{ row }">
                  <span v-if="row.success" class="mono t-xs">{{ row.payslipId }}</span>
                  <span v-else class="t-sm" style="color: var(--danger)">{{ row.error || '—' }}</span>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="failed.length" class="note note--warn" style="margin-top: 10px">失败行请修改后<b>只保留失败行</b>重新上传；已成功的员工再次导入同一月份会被拒绝。</div>
          </div>
        </template>
      </div>

      <div class="grid" style="gap: 14px; align-content: start">
        <div class="card">
          <div class="card__hd"><h3>表格格式</h3></div>
          <div class="card__bd">
            <table class="fmt">
              <thead><tr><th>列</th><th>内容</th><th>说明</th></tr></thead>
              <tbody>
                <tr><td class="mono">A</td><td>手机号</td><td class="t-xs">无工号时必填</td></tr>
                <tr><td class="mono">B</td><td>工号</td><td class="t-xs">优先按工号匹配</td></tr>
                <tr><td class="mono">C</td><td>应发</td><td class="t-xs">必填，≥ 0</td></tr>
                <tr><td class="mono">D</td><td>社保</td><td class="t-xs">个人部分，可空</td></tr>
                <tr><td class="mono">E</td><td>个税</td><td class="t-xs">可空</td></tr>
                <tr><td class="mono">F</td><td>其他扣款</td><td class="t-xs">可空</td></tr>
              </tbody>
            </table>
            <div class="note" style="margin-top: 10px">实发 = 应发 − 社保 − 个税 − 其他扣款 − <b>预支抵扣</b>。预支欠款按先到先还自动从实发中扣除。</div>
          </div>
        </div>
        <div class="card">
          <div class="card__hd"><h3>规则</h3></div>
          <div class="card__bd">
            <dl class="kv"><dt>员工匹配</dt><dd>该月在本公司有任职记录</dd></dl>
            <dl class="kv"><dt>重复导入</dt><dd>同一员工同一月份仅一次</dd></dl>
            <dl class="kv"><dt>逐行处理</dt><dd>失败行不影响其他行</dd></dl>
            <dl class="kv"><dt>员工端</dt><dd>导入成功即生成工资条</dd></dl>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="card__hd"><h3>导入记录</h3><el-button size="small" @click="loadBatches">刷新</el-button></div>
      <el-alert v-if="batchesError" type="error" :title="batchesError" show-icon :closable="false" />
      <el-table v-loading="batchesLoading" :data="batches" row-key="batchId">
        <el-table-column label="批次" min-width="160"><template #default="{ row }"><span class="mono t-sm">{{ row.batchId }}</span></template></el-table-column>
        <el-table-column label="工资月份" width="100"><template #default="{ row }"><b class="mono">{{ row.payMonth }}</b></template></el-table-column>
        <el-table-column label="成功人数" width="90" align="center"><template #default="{ row }"><span class="num">{{ row.headcount }}</span></template></el-table-column>
        <el-table-column label="应发合计" min-width="120" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.grossTotal) }}</span></template></el-table-column>
        <el-table-column label="预支抵扣" min-width="110" align="right"><template #default="{ row }"><span class="num" style="color: var(--signal-700)">{{ fmtYuan(row.advanceDeductTotal) }}</span></template></el-table-column>
        <el-table-column label="实发合计" min-width="120" align="right"><template #default="{ row }"><b class="num">{{ fmtYuan(row.netTotal) }}</b></template></el-table-column>
        <el-table-column label="操作人" width="100"><template #default="{ row }"><span class="t-sm">{{ memberName(row.operatorId) }}</span></template></el-table-column>
        <el-table-column label="导入时间" width="150"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <template #empty><el-empty :image-size="70" :description="batchesError ? '加载失败' : '暂无导入记录'" /></template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.up { padding: 6px 0; color: var(--ink-700); }
.stat-v.sm { font-size: 20px; }
.fmt { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.fmt th { text-align: left; font-weight: 600; color: var(--ink-500); font-size: 11.5px; padding: 4px 6px; border-bottom: 1px solid var(--line); }
.fmt td { padding: 6px; border-bottom: 1px solid var(--line); color: var(--ink-800); }
</style>
