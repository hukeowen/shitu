<script setup lang="ts">
import RowActions from '@/components/RowActions.vue'
import { opsColWidth, type RowAction } from '@/utils/rowActions'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, useDict, type PayslipAppealRow, type PayslipAppealStatus } from '@shitu/api-client'
import { fmtDateTime, fmtYuan } from '@/utils/format'

/** 工资申诉（C-702 / D-28）：员工对某张工资条提出疑问，项目经理 / 老板核对后回复，结果通知本人 */
const { label } = useDict()
const TABS: { key: PayslipAppealStatus | ''; label: string }[] = [
  { key: 'OPEN', label: '待处理' },
  { key: 'RESOLVED', label: '已受理' },
  { key: 'REJECTED', label: '未受理' },
  { key: '', label: '全部' },
]
const TAG: Record<PayslipAppealStatus, string> = { OPEN: 'tag--warn', RESOLVED: 'tag--ok', REJECTED: 'tag--danger' }

const tab = ref<PayslipAppealStatus | ''>('OPEN')
const rows = ref<PayslipAppealRow[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await tenantApi.payslipAppeals(tab.value ? { status: tab.value } : undefined)
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '工资申诉加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(tab, load)

const dlg = reactive({ open: false, row: null as PayslipAppealRow | null, reply: '', saving: false })
function openHandle(row: PayslipAppealRow) {
  dlg.row = row
  dlg.reply = ''
  dlg.open = true
}
async function submit(accept: boolean) {
  if (!dlg.row) return
  const text = dlg.reply.trim()
  if (text.length < 2) return void ElMessage.warning('请填写处理说明')
  dlg.saving = true
  try {
    await tenantApi.handlePayslipAppeal(dlg.row.id, { accept, reply: text })
    ElMessage.success('已处理，员工会收到通知')
    dlg.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
  } finally {
    dlg.saving = false
  }
}

/** 只有待处理的申诉有操作；已处理页签不渲染操作列 */
const rowActions = (r: PayslipAppealRow): RowAction[] => (r.status === 'OPEN' ? [{ key: 'handle', label: '处理', type: 'primary' }] : [])
const opsWidth = computed(() => opsColWidth(rows.value.map(rowActions)))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>工资申诉</h2>
        <p>员工对工资条提出的疑问 · 核对后回复，结果会通知员工本人</p>
      </div>
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px" />

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
        </div>
      </div>
      <el-table v-loading="loading" :data="rows" row-key="id">
        <el-table-column label="提交时间" min-width="156">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="员工" min-width="190">
          <template #default="{ row }">
            <div class="nowrap"><b>{{ row.seekerName }}</b><span v-if="row.employeeNo" class="t-xs mono"> · {{ row.employeeNo }}</span></div>
            <div class="t-xs ellip" :title="row.projectName ?? ''">{{ row.projectName || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="工资月份" min-width="100">
          <template #default="{ row }"><span class="mono">{{ row.payMonth }}</span></template>
        </el-table-column>
        <el-table-column label="实发" min-width="110" align="right">
          <template #default="{ row }"><b class="num">{{ fmtYuan(row.netPay) }}</b></template>
        </el-table-column>
        <el-table-column label="申诉内容" min-width="300">
          <template #default="{ row }">
            <span v-if="row.itemCode" class="tag" style="margin-right: 6px">{{ label('PayslipAppealItem', row.itemCode) }}</span>
            <span class="content">{{ row.content }}</span>
            <div v-if="row.reply" class="reply"><b>处理说明</b>{{ row.reply }}<span class="t-xs"> · {{ row.handledByName }} {{ fmtDateTime(row.handledAt) }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="100">
          <template #default="{ row }"><span class="tag" :class="TAG[row.status as PayslipAppealStatus]">{{ label('PayslipAppealStatus', row.status) }}</span></template>
        </el-table-column>
        <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
          <template #default="{ row }"><RowActions :actions="rowActions(row)" @act="openHandle(row)" /></template>
        </el-table-column>
        <template #empty><el-empty :description="loadError ? '加载失败' : '暂无工资申诉'" :image-size="80" /></template>
      </el-table>
    </div>

    <el-dialog v-model="dlg.open" title="处理工资申诉" width="580px" destroy-on-close>
      <template v-if="dlg.row">
        <div class="t-sm" style="margin-bottom: 8px"><b>{{ dlg.row.seekerName }}</b> · {{ dlg.row.payMonth }} 工资条 <span class="mono t-xs">{{ dlg.row.payslipId }}</span></div>
        <div class="grid g-3 slip">
          <div><span>应发</span><b class="num">{{ fmtYuan(dlg.row.grossPay) }}</b></div>
          <div><span>社保</span><b class="num">{{ fmtYuan(dlg.row.socialInsurance) }}</b></div>
          <div><span>个税</span><b class="num">{{ fmtYuan(dlg.row.incomeTax) }}</b></div>
          <div><span>其他扣款</span><b class="num">{{ fmtYuan(dlg.row.otherDeduct) }}</b></div>
          <div><span>预支抵扣</span><b class="num">{{ fmtYuan(dlg.row.advanceDeduct) }}</b></div>
          <div><span>实发</span><b class="num">{{ fmtYuan(dlg.row.netPay) }}</b></div>
        </div>
        <div class="content box">{{ dlg.row.content }}</div>
        <el-input v-model="dlg.reply" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="写明核对结果；如需补发或更正，请说明处理方式与时间" style="margin-top: 12px" />
        <div class="note" style="margin-top: 10px">工资条导入后不能在系统内修改金额。确需更正的，请线下补发 / 扣回并在这里写明。</div>
      </template>
      <template #footer>
        <el-button :loading="dlg.saving" @click="submit(false)">不受理</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="submit(true)">受理并回复</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
.box { margin-top: 10px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); max-height: 200px; overflow: auto; }
.reply { margin-top: 6px; padding: 6px 10px; border-left: 3px solid var(--ok); background: var(--surface-2); border-radius: var(--r-xs); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.reply b { color: var(--ok); margin-right: 6px; font-size: 12px; }
.slip { gap: 8px; }
.slip div { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-radius: var(--r-xs); background: var(--surface-2); font-size: 12.5px; }
.slip span { color: var(--ink-500); }
</style>
