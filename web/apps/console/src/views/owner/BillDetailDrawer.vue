<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { errorMessage, tenantApi, type BillDayLine, type BillDetail } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import { fmtDate, fmtDateTime, fmtYuan, toNum } from '@/utils/format'

/** 账单详情：每日计费明细（在岗 / 存量 / 增量 / 费用、免费期）+ 异议记录 */
const props = defineProps<{ billId: string | null; canDispute: boolean }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ dispute: [] }>()

const detail = ref<BillDetail | null>(null)
const loading = ref(false)
const error = ref('')

async function load(id: string) {
  loading.value = true
  error.value = ''
  try {
    detail.value = await tenantApi.bill(id)
  } catch (e) {
    detail.value = null
    error.value = errorMessage(e, '账单详情加载失败')
  } finally {
    loading.value = false
  }
}
watch(
  () => [visible.value, props.billId] as const,
  ([v, id]) => {
    if (v && id) load(id)
  },
  { immediate: true },
)
defineExpose({ reload: () => props.billId && load(props.billId) })

const days = computed(() => [...(detail.value?.days ?? [])].sort((a, b) => a.bizDate.localeCompare(b.bizDate)))
const freeDays = computed(() => days.value.filter((d) => d.inFreePeriod).length)

type SummaryParam = { columns: { property?: string }[]; data: BillDayLine[] }
const MONEY = new Set(['serviceFee', 'transferPayable', 'transferReceivable'])
function summary({ columns, data }: SummaryParam): string[] {
  return columns.map((c, i) => {
    if (i === 0) return '合计'
    const p = c.property as keyof BillDayLine | undefined
    if (p && MONEY.has(p)) return fmtYuan(data.reduce((s, d) => s + toNum(d[p]), 0))
    if (p === 'incrementCount') return `${data.reduce((s, d) => s + toNum(d.incrementCount), 0)} 人天`
    return ''
  })
}
</script>

<template>
  <el-drawer v-model="visible" size="760px" :title="detail ? `${detail.bill.billMonth} 月度账单` : '账单详情'">
    <div v-loading="loading" style="min-height: 200px">
      <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
      <template v-else-if="detail">
        <div class="row-wrap" style="margin-bottom: 12px">
          <DictTag type="BillStatus" :value="detail.bill.status" lg />
          <span class="mono t-xs">{{ detail.bill.billId }}</span>
          <span class="spacer" />
          <el-button v-if="canDispute" size="small" type="warning" plain @click="emit('dispute')">提出异议</el-button>
        </div>
        <div class="grid g-4" style="gap: 10px">
          <div class="stat"><div class="stat-l">增长技术服务费</div><div class="stat-v money">{{ fmtYuan(detail.bill.serviceFee) }}</div></div>
          <div class="stat"><div class="stat-l">流转费 · 应付</div><div class="stat-v money" style="color: var(--danger)">{{ fmtYuan(detail.bill.transferPayable) }}</div></div>
          <div class="stat"><div class="stat-l">流转费 · 应收</div><div class="stat-v money" style="color: var(--ok)">{{ fmtYuan(detail.bill.transferReceivable) }}</div></div>
          <div class="stat stat--signal"><div class="stat-l">应付合计</div><div class="stat-v money">{{ fmtYuan(detail.bill.payable) }}</div></div>
        </div>
        <div class="t-xs" style="margin-top: 6px">应付合计 = 服务费 + 应付流转费；应收流转费由平台另行结算，<b class="strong">不与应付轧差</b>。</div>

        <div class="grid g-2" style="gap: 0 20px; margin-top: 12px">
          <div>
            <dl class="kv"><dt>下发时间</dt><dd class="mono">{{ fmtDateTime(detail.bill.issuedAt) }}</dd></dl>
            <dl class="kv"><dt>异议截止</dt><dd class="mono">{{ fmtDate(detail.bill.disputeDeadline) }}</dd></dl>
          </div>
          <div>
            <dl class="kv"><dt>结算截止</dt><dd class="mono">{{ fmtDate(detail.bill.settleDeadline) }}</dd></dl>
            <dl class="kv"><dt>结算时间</dt><dd class="mono">{{ fmtDateTime(detail.bill.settledAt) }}</dd></dl>
          </div>
        </div>

        <div class="form-sec" style="margin-top: 18px">每日计费明细<span class="t-xs" style="font-weight: 400">（{{ days.length }} 天{{ freeDays ? `，其中免费期 ${freeDays} 天` : '' }}）</span></div>
        <el-table :data="days" size="small" max-height="380" show-summary :summary-method="summary" row-key="bizDate">
          <el-table-column label="日期" min-width="90" prop="bizDate">
            <template #default="{ row }"><span class="mono">{{ row.bizDate.slice(5) }}</span></template>
          </el-table-column>
          <el-table-column label="" min-width="76">
            <template #default="{ row }"><span v-if="row.inFreePeriod" class="tag tag--ok">免费期</span></template>
          </el-table-column>
          <el-table-column label="在岗" min-width="64" align="right" prop="employedCount">
            <template #default="{ row }"><span class="num">{{ row.employedCount }}</span></template>
          </el-table-column>
          <el-table-column label="存量" min-width="64" align="right" prop="stockBase">
            <template #default="{ row }"><span class="num dim">{{ row.stockBase }}</span></template>
          </el-table-column>
          <el-table-column label="增量" min-width="64" align="right" prop="incrementCount">
            <template #default="{ row }"><span class="num" style="color: var(--signal)">{{ row.incrementCount }}</span></template>
          </el-table-column>
          <el-table-column label="服务费" min-width="104" align="right" prop="serviceFee">
            <template #default="{ row }"><span class="num">{{ fmtYuan(row.serviceFee) }}</span></template>
          </el-table-column>
          <el-table-column label="流转应付" min-width="104" align="right" prop="transferPayable">
            <template #default="{ row }"><span class="num">{{ fmtYuan(row.transferPayable) }}</span></template>
          </el-table-column>
          <el-table-column label="流转应收" min-width="104" align="right" prop="transferReceivable">
            <template #default="{ row }"><span class="num">{{ fmtYuan(row.transferReceivable) }}</span></template>
          </el-table-column>
          <template #empty><span class="t-xs">暂无每日明细</span></template>
        </el-table>
        <div class="note" style="margin-top: 10px">增长服务费 = max(当日在岗人数 − 存量基数, 0) × 单价；免费期内不计费，存量基数在免费期满次日锁定。</div>

        <div class="form-sec" style="margin-top: 18px">异议记录</div>
        <div v-if="!detail.disputes.length" class="t-sm dim">暂无异议</div>
        <div v-for="d in detail.disputes" :key="d.id" class="dispute">
          <div class="row">
            <DictTag type="DisputeStatus" :value="d.status" />
            <span class="mono t-xs">{{ fmtDateTime(d.createdAt) }}</span>
          </div>
          <p class="t-sm" style="margin-top: 6px; color: var(--ink-800)">{{ d.content }}</p>
          <div v-if="d.reply" class="note note--info" style="margin-top: 8px"><b>平台回复：</b>{{ d.reply }}<span class="mono t-xs" style="margin-left: 8px">{{ fmtDateTime(d.repliedAt) }}</span></div>
        </div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.money { font-size: 20px; white-space: nowrap; }
/* 合计行：与正文同字号并加粗，金额不折行 */
:deep(.el-table__footer-wrapper td.el-table__cell) { background: var(--surface-2); border-top: 1px solid var(--line-2); }
:deep(.el-table__footer-wrapper td.el-table__cell .cell) { font-size: 13.5px; font-weight: 650; color: var(--ink-900); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dispute { border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 12px; margin-bottom: 8px; }
</style>
