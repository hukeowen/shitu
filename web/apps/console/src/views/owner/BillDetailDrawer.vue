<script setup lang="ts">
import { computed, h, ref, watch, type VNode } from 'vue'
import { errorMessage, tenantApi, type BillDayLine, type TenantBillDetail } from '@shitu/api-client'
import { IconCircleExclamationPoint } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import FileLink from '@/components/FileLink.vue'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtDate, fmtDateTime, fmtSigned, fmtYuan, toNum } from '@/utils/format'
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from './billPayment'

/**
 * 账单详情：每日计费明细（在岗 / 存量 / 增量 / 费用、免费期）+ 付款记录 + 异议记录。
 * blockedWhy：这张账单的异议被后端拒绝过的原因（置灰「提出异议」）；canPay / payLabel：能不能提交付款凭证、按钮文字（由列表页判断）
 */
const props = defineProps<{ billId: string | null; canDispute: boolean; blockedWhy?: string; canPay?: boolean; payLabel?: string }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ dispute: []; pay: [] }>()

const detail = ref<TenantBillDetail | null>(null)
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

/** 导出每日计费明细（抽屉里已经拿到的整月数据）；金额写正数，应付 / 应收看列名 */
const DAY_COLUMNS: CsvColumn<BillDayLine>[] = [
  { header: '日期', value: (d) => d.bizDate, kind: 'date' },
  { header: '免费期', value: (d) => (d.inFreePeriod ? '是' : '') },
  { header: '在岗', value: (d) => d.employedCount },
  { header: '存量', value: (d) => d.stockBase },
  { header: '增量', value: (d) => d.incrementCount },
  { header: '服务费', value: (d) => d.serviceFee, kind: 'money' },
  { header: '流转应付', value: (d) => d.transferPayable, kind: 'money' },
  { header: '流转应收', value: (d) => d.transferReceivable, kind: 'money' },
]
function exportDays() {
  if (detail.value) exportList({ name: `账单每日明细-${detail.value.bill.billMonth}`, columns: DAY_COLUMNS, rows: days.value })
}

type SummaryParam = { columns: { property?: string }[]; data: BillDayLine[] }
/** 合计行：应付的两列带「−」，应收带「+」，和明细行一致 */
const MONEY: Record<string, 'in' | 'out'> = { serviceFee: 'out', transferPayable: 'out', transferReceivable: 'in' }
function summary({ columns, data }: SummaryParam): (string | VNode)[] {
  return columns.map((c, i) => {
    if (i === 0) return '合计'
    const p = c.property as keyof BillDayLine | undefined
    if (p && MONEY[p]) return h('span', { class: 'money' }, fmtSigned(data.reduce((s, d) => s + toNum(d[p]), 0), MONEY[p]))
    if (p === 'incrementCount') return `${data.reduce((s, d) => s + toNum(d.incrementCount), 0)} 人天`
    return ''
  })
}
</script>

<template>
  <el-drawer v-model="visible" size="720px" class="bill-drawer" :title="detail ? `${detail.bill.billMonth} 月度账单` : '账单详情'">
    <div v-loading="loading" class="wrap">
      <div v-if="error" class="state-box">
        <IconCircleExclamationPoint :size="48" />
        <h4>{{ error }}</h4>
        <p>请检查网络后重新加载</p>
        <el-button @click="billId && load(billId)">重新加载</el-button>
      </div>
      <template v-else-if="detail">
        <div class="hd">
          <DictTag type="BillStatus" :value="detail.bill.status" />
          <span class="code hint">{{ detail.bill.billId }}</span>
          <span class="spacer" />
          <el-button :disabled="!days.length" @click="exportDays">导出明细</el-button>
          <el-button v-if="canDispute" :disabled="!!blockedWhy" @click="emit('dispute')">提出异议</el-button>
          <el-button v-if="canPay" type="primary" @click="emit('pay')">{{ payLabel || '提交付款凭证' }}</el-button>
        </div>
        <p v-if="blockedWhy" class="blocked-why hd-why" role="status">{{ blockedWhy }}</p>

        <section class="blk">
          <h4 class="blk-t">金额</h4>
          <dl class="desc-list">
            <div><dt>增长技术服务费（应付）</dt><dd class="money">{{ fmtSigned(detail.bill.serviceFee, 'out') }}</dd></div>
            <div><dt>流转费 · 应付</dt><dd class="money">{{ fmtSigned(detail.bill.transferPayable, 'out') }}</dd></div>
            <div><dt>流转费 · 应收</dt><dd class="money">{{ fmtSigned(detail.bill.transferReceivable, 'in') }}</dd></div>
            <div><dt>应付合计</dt><dd class="money total">{{ fmtSigned(detail.bill.payable, 'out') }}</dd></div>
          </dl>
          <p class="hint fine">应付合计 = 服务费 + 应付流转费；应收流转费由平台另行结算，<b>不与应付轧差</b>。</p>
        </section>

        <section class="blk">
          <h4 class="blk-t">时间</h4>
          <dl class="desc-list">
            <div><dt>下发时间</dt><dd>{{ fmtDateTime(detail.bill.issuedAt) }}</dd></div>
            <div><dt>异议截止</dt><dd>{{ fmtDate(detail.bill.disputeDeadline) }}</dd></div>
            <div><dt>结算截止</dt><dd>{{ fmtDate(detail.bill.settleDeadline) }}<span v-if="detail.bill.overdueDays > 0" class="overdue">已逾期 {{ detail.bill.overdueDays }} 天</span></dd></div>
            <div><dt>结算时间</dt><dd>{{ fmtDateTime(detail.bill.settledAt) }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <h4 class="blk-t">每日计费明细<small>{{ days.length }} 天{{ freeDays ? `，其中免费期 ${freeDays} 天` : '' }}</small></h4>
          <el-table class="days" :data="days" max-height="380" show-summary :summary-method="summary" row-key="bizDate">
            <el-table-column label="日期" width="72" prop="bizDate">
              <template #default="{ row }"><span class="code">{{ row.bizDate.slice(5) }}</span></template>
            </el-table-column>
            <el-table-column label="" width="84">
              <template #default="{ row }"><span v-if="row.inFreePeriod" class="status-tag status-tag--success">免费期</span></template>
            </el-table-column>
            <el-table-column label="在岗" width="60" align="right" prop="employedCount" />
            <el-table-column label="存量" width="60" align="right" prop="stockBase">
              <template #default="{ row }"><span class="hint">{{ row.stockBase }}</span></template>
            </el-table-column>
            <el-table-column label="增量" width="84" align="right" prop="incrementCount" />
            <el-table-column label="服务费" min-width="96" align="right" prop="serviceFee">
              <template #default="{ row }"><span class="money">{{ fmtSigned(row.serviceFee, 'out') }}</span></template>
            </el-table-column>
            <el-table-column label="流转应付" min-width="96" align="right" prop="transferPayable">
              <template #default="{ row }"><span class="money">{{ fmtSigned(row.transferPayable, 'out') }}</span></template>
            </el-table-column>
            <el-table-column label="流转应收" min-width="96" align="right" prop="transferReceivable">
              <template #default="{ row }"><span class="money">{{ fmtSigned(row.transferReceivable, 'in') }}</span></template>
            </el-table-column>
            <template #empty><span class="hint">暂无每日明细</span></template>
          </el-table>
          <p class="hint fine">增长技术服务费 = max(当日在岗人数 − 存量基数, 0) × 单价；免费期内不计费，存量基数在免费期满次日锁定。</p>
        </section>

        <section class="blk">
          <h4 class="blk-t">付款记录<small v-if="detail.payments.length">{{ detail.payments.length }} 笔</small></h4>
          <p v-if="!detail.payments.length" class="hint">暂无付款记录。对公转账后提交付款凭证，平台确认到账后账单结清</p>
          <div v-for="p in detail.payments" :key="p.id" class="dispute">
            <div class="dispute-hd">
              <span class="status-tag" :class="`status-tag--${PAYMENT_STATUS_TONE[p.status]}`">{{ PAYMENT_STATUS_LABEL[p.status] }}</span>
              <span class="hint">{{ fmtDateTime(p.createdAt) }} 提交</span>
              <span class="spacer" />
              <FileLink :file-key="p.voucherKey" label="查看凭证" />
            </div>
            <dl class="desc-list pay-desc">
              <div><dt>付款金额</dt><dd class="money">{{ fmtYuan(toNum(p.amount)) }}</dd></div>
              <div><dt>付款日期</dt><dd>{{ fmtDate(p.paidDate) }}</dd></div>
              <div><dt>付款户名</dt><dd>{{ p.payerName }}</dd></div>
              <div><dt>银行流水号</dt><dd class="code">{{ p.bankRef || '—' }}</dd></div>
            </dl>
            <p v-if="p.remark" class="hint pay-remark">备注：{{ p.remark }}</p>
            <div v-if="p.status === 'REJECTED'" class="reply reply--bad"><b>退回原因：</b>{{ p.reviewRemark || '—' }}<span class="hint reply-at">{{ fmtDateTime(p.reviewedAt) }}</span></div>
            <div v-else-if="p.status === 'CONFIRMED'" class="reply"><b>平台已确认到账</b>{{ p.reviewRemark ? `：${p.reviewRemark}` : '' }}<span class="hint reply-at">{{ fmtDateTime(p.reviewedAt) }}</span></div>
          </div>
        </section>

        <section class="blk">
          <h4 class="blk-t">异议记录</h4>
          <p v-if="!detail.disputes.length" class="hint">暂无异议</p>
          <div v-for="d in detail.disputes" :key="d.id" class="dispute">
            <div class="dispute-hd">
              <DictTag type="DisputeStatus" :value="d.status" />
              <span class="hint">{{ fmtDateTime(d.createdAt) }}</span>
            </div>
            <p class="dispute-t">{{ d.content }}</p>
            <div v-if="d.reply" class="reply"><b>平台回复：</b>{{ d.reply }}<span class="hint reply-at">{{ fmtDateTime(d.repliedAt) }}</span></div>
          </div>
        </section>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.wrap { min-height: 200px; }
.hd { display: flex; align-items: center; gap: var(--space-2); }
.hd-why { margin-top: var(--space-2); }
.hd + .blk, .hd-why + .blk { margin-top: var(--space-6); }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.code { font-family: var(--font-mono); }
/* 合计行：600 字重、一级文字（Element 默认比正文还淡） */
.days :deep(.el-table__footer .cell) { font-weight: var(--font-weight-semibold); color: var(--text-1); white-space: nowrap; }
.total { font-size: var(--font-size-section); color: var(--primary-text); }
.fine { margin: var(--space-3) 0 0; line-height: 1.6; }
.fine b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.dispute { border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-2); }
.dispute-hd { display: flex; align-items: center; gap: var(--space-2); }
.dispute-t { margin: var(--space-2) 0 0; font-size: var(--font-size-body); line-height: 1.6; color: var(--text-1); }
.reply { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-1); }
.reply b { font-weight: var(--font-weight-semibold); }
.reply-at { margin-left: var(--space-2); }
.reply--bad { background: var(--danger-soft); }
.pay-desc { margin-top: var(--space-3); }
.pay-desc dd { word-break: break-all; }
.pay-remark { margin: var(--space-2) 0 0; line-height: 1.6; }
.overdue { margin-left: var(--space-2); font-size: var(--font-size-aux); color: var(--danger-text); }
</style>

<style>
/* 抽屉挂在 body 上：标题用区块标题样式（同消息抽屉），标题下不留大块空白 */
.bill-drawer .el-drawer__title { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.bill-drawer .el-drawer__header { margin-bottom: 0; }
</style>
