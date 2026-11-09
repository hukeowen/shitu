<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type BillDetail, type BillDispute } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { confirmAction } from '@/composables/useRemark'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '@/utils/format'

const props = defineProps<{ billId: string | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const visible = computed({
  get: () => props.billId != null,
  set: (v) => {
    if (!v) emit('close')
  },
})

const detail = ref<BillDetail | null>(null)
const loading = ref(false)
const error = ref('')
const acting = ref(false)

async function load() {
  if (!props.billId) return
  loading.value = true
  error.value = ''
  try {
    detail.value = await opsApi.bill(props.billId)
  } catch (e) {
    error.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(
  () => props.billId,
  (id) => {
    detail.value = null
    if (id) void load()
  },
  { immediate: true },
)

const b = computed(() => detail.value?.bill)
const canSettle = computed(() => b.value?.status === 'ISSUED' || b.value?.status === 'CONFIRMED')
const totals = computed(() => {
  const days = detail.value?.days ?? []
  return {
    service: days.reduce((a, d) => a + Number(d.serviceFee), 0),
    increment: days.reduce((a, d) => a + d.incrementCount, 0),
    freeDays: days.filter((d) => d.inFreePeriod).length,
  }
})

async function settle() {
  if (!b.value) return
  const ok = await confirmAction('登记结算', `确认已收到 ${b.value.companyId} ${b.value.billMonth} 账单款项 ${fmtMoney(b.value.payable)} 元？登记后账单状态变为「已结算」，不可撤销。`, true)
  if (!ok) return
  acting.value = true
  try {
    await opsApi.settleBill(b.value.billId)
    ElMessage.success('已登记结算')
    emit('changed')
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = false
  }
}

// ---------- 异议复核
const reply = reactive({ visible: false, dispute: null as BillDispute | null, accept: false, text: '', error: '', loading: false })
function openReply(d: BillDispute, accept: boolean) {
  Object.assign(reply, { visible: true, dispute: d, accept, text: '', error: '' })
}
async function submitReply() {
  if (!reply.dispute) return
  const text = reply.text.trim()
  if (!text) {
    reply.error = '请填写处理说明（将回复给企业）'
    return
  }
  reply.loading = true
  try {
    await opsApi.replyDispute(reply.dispute.id, reply.accept, text)
    ElMessage.success(reply.accept ? '已采纳异议，账单退回「已生成」待修正后重新下发' : '已驳回异议，账单恢复「已下发」')
    reply.visible = false
    emit('changed')
    await load()
  } catch (e) {
    reply.error = errorMessage(e)
  } finally {
    reply.loading = false
  }
}
</script>

<template>
  <el-drawer v-model="visible" size="820px" destroy-on-close class="ops-drawer">
    <template #header>
      <div class="dh">
        <h3>账单 <span class="mono">{{ billId }}</span></h3>
        <StatusTag v-if="b" type="BillStatus" :value="b.status" />
      </div>
    </template>

    <div v-loading="loading" class="body">
      <el-empty v-if="error && !detail" :image-size="64" :description="error"><el-button size="small" @click="load">重试</el-button></el-empty>
      <template v-else-if="detail && b">
        <div v-if="b.status === 'DISPUTED'" class="notice notice--danger top-tip">企业对该账单提出了异议，请在下方「异议记录」中复核处理。</div>

        <div class="grid g-4 sum">
          <div class="stat"><div class="stat-l">增长技术服务费</div><div class="stat-v sm">{{ fmtMoney(b.serviceFee) }}</div></div>
          <div class="stat"><div class="stat-l">应付流转费</div><div class="stat-v sm">{{ fmtMoney(b.transferPayable) }}</div></div>
          <div class="stat"><div class="stat-l">应付合计</div><div class="stat-v sm pay">{{ fmtMoney(b.payable) }}</div></div>
          <div class="stat"><div class="stat-l">应收流转费</div><div class="stat-v sm dim">{{ fmtMoney(b.transferReceivable) }}</div><div class="stat-d">不与应付轧差</div></div>
        </div>

        <dl class="kv-grid">
          <div class="kv"><dt>公司</dt><dd class="mono">{{ b.companyId }}</dd></div>
          <div class="kv"><dt>账单月份</dt><dd class="mono">{{ b.billMonth }}</dd></div>
          <div class="kv"><dt>下发时间</dt><dd class="mono">{{ fmtDateTime(b.issuedAt) }}</dd></div>
          <div class="kv"><dt>异议截止</dt><dd class="mono">{{ fmtDate(b.disputeDeadline) }}</dd></div>
          <div class="kv"><dt>结算截止</dt><dd class="mono">{{ fmtDate(b.settleDeadline) }}</dd></div>
          <div class="kv"><dt>结算时间</dt><dd class="mono">{{ fmtDateTime(b.settledAt) }}</dd></div>
        </dl>

        <div class="sec-title">异议记录 <small>{{ detail.disputes.length }} 条</small></div>
        <el-empty v-if="detail.disputes.length === 0" :image-size="48" description="无异议" />
        <ul v-else class="tl">
          <li v-for="d in detail.disputes" :key="d.id" :class="d.status === 'OPEN' ? 'now' : d.status === 'ACCEPTED' ? 'done' : 'fail'">
            <div class="tl-t">
              <StatusTag type="DisputeStatus" :value="d.status" variant="tag" />
              <span class="t-sm"> 企业异议 · {{ d.raisedBy }}</span>
            </div>
            <div class="tl-m">{{ fmtDateTime(d.createdAt) }}</div>
            <div class="tl-r">{{ d.content }}</div>
            <div v-if="d.reply" class="reply">
              <span class="t-xs">平台回复 · {{ fmtDateTime(d.repliedAt) }}</span>
              <div class="tl-r">{{ d.reply }}</div>
            </div>
            <div v-if="d.status === 'OPEN'" class="d-acts">
              <el-button size="small" type="danger" plain @click="openReply(d, false)">驳回异议</el-button>
              <el-button size="small" type="primary" @click="openReply(d, true)">采纳异议</el-button>
            </div>
          </li>
        </ul>

        <div class="sec-title">
          每日明细 <small>{{ detail.days.length }} 天 · 增量合计 {{ fmtNum(totals.increment) }} 人·天 · 免费期 {{ totals.freeDays }} 天</small>
        </div>
        <el-table :data="detail.days" class="ops-table" size="small" max-height="360" row-key="bizDate">
          <el-table-column label="日期" width="110"><template #default="{ row }"><span class="mono">{{ fmtDate(row.bizDate) }}</span></template></el-table-column>
          <el-table-column label="在岗" width="80" align="right"><template #default="{ row }"><span class="mono">{{ fmtNum(row.employedCount) }}</span></template></el-table-column>
          <el-table-column label="存量基数" width="90" align="right"><template #default="{ row }"><span class="mono dim">{{ fmtNum(row.stockBase) }}</span></template></el-table-column>
          <el-table-column label="增量" width="80" align="right"><template #default="{ row }"><span class="mono strong">{{ fmtNum(row.incrementCount) }}</span></template></el-table-column>
          <el-table-column label="服务费" min-width="100" align="right">
            <template #default="{ row }">
              <span v-if="row.inFreePeriod" class="tag tag--ok">免费期</span>
              <span v-else class="mono">{{ fmtMoney(row.serviceFee) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="应付流转" min-width="100" align="right"><template #default="{ row }"><span class="mono">{{ fmtMoney(row.transferPayable) }}</span></template></el-table-column>
          <el-table-column label="应收流转" min-width="100" align="right"><template #default="{ row }"><span class="mono dim">{{ fmtMoney(row.transferReceivable) }}</span></template></el-table-column>
          <template #empty><el-empty :image-size="48" description="无每日明细" /></template>
        </el-table>
      </template>
    </div>

    <template #footer>
      <div class="drawer-actions">
        <el-button @click="visible = false">关闭</el-button>
        <el-button v-if="canSettle" type="primary" :loading="acting" @click="settle">登记结算</el-button>
      </div>
    </template>

    <el-dialog v-model="reply.visible" :title="reply.accept ? '采纳异议' : '驳回异议'" width="480px" append-to-body :close-on-click-modal="false">
      <div class="notice gap" :class="reply.accept ? 'notice--warn' : 'notice--info'">
        {{ reply.accept ? '采纳后账单退回「已生成」，需重算相关日计费后重新下发。' : '驳回后账单恢复「已下发」，企业需按原账单结算。' }}
      </div>
      <div v-if="reply.dispute" class="quote t-sm">{{ reply.dispute.content }}</div>
      <el-input v-model="reply.text" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="处理说明（必填，将回复给企业）" @input="reply.error = ''" />
      <div v-if="reply.error" class="notice notice--danger err">{{ reply.error }}</div>
      <template #footer>
        <el-button @click="reply.visible = false">取消</el-button>
        <el-button :type="reply.accept ? 'primary' : 'danger'" :loading="reply.loading" @click="submitReply">{{ reply.accept ? '采纳' : '驳回' }}</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
.dh { display: flex; align-items: center; gap: 10px; }
.dh h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.body { min-height: 200px; }
.top-tip { margin-bottom: 14px; }
.sum { margin-bottom: 12px; }
.stat-v.sm { font-size: 18px; }
.stat-v.pay { color: var(--signal-700); }
.reply { margin-top: 6px; padding: 6px 10px; background: var(--surface-2); border-radius: var(--r-xs); }
.d-acts { margin-top: 8px; display: flex; gap: 6px; }
.gap { margin-bottom: 12px; }
.quote { padding: 8px 10px; border-left: 3px solid var(--line-2); background: var(--surface-2); margin-bottom: 10px; color: var(--ink-700); white-space: pre-wrap; }
.err { margin-top: 10px; }
</style>
