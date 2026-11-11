<script setup lang="ts">
import { shNowMs } from '@/utils/time'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type MonthlyBill } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import { fmtDate, fmtYuan } from '@/utils/format'
import { parseLocal } from '@/utils/time'
import BillDetailDrawer from './BillDetailDrawer.vue'

/**
 * A-16 费用账单（T-403，老板）：增长技术服务费 + 人才流转费应付 / 应收分开展示（不轧差）。
 * 账单下发后 5 个工作日内可提出异议（D-23，按节假日日历，截止日以后端 disputeDeadline 为准）。
 */
const router = useRouter()
const page = reactive({ page: 1, pageSize: 12, total: 0 })
const list = ref<MonthlyBill[]>([])
const loading = ref(false)
const loadError = ref('')
const selectedId = ref<string>('')

const selected = computed(() => list.value.find((b) => b.billId === selectedId.value) ?? list.value[0] ?? null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await tenantApi.bills(page.page, page.pageSize)
    list.value = [...r.records].sort((a, b) => b.billMonth.localeCompare(a.billMonth))
    page.total = r.total
    if (!list.value.some((b) => b.billId === selectedId.value)) selectedId.value = list.value[0]?.billId ?? ''
  } catch (e) {
    loadError.value = errorMessage(e, '账单加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 已下发且未过异议截止日（截止日当天仍可提） */
function canDispute(b: MonthlyBill | null): boolean {
  if (!b || b.status !== 'ISSUED' || !b.disputeDeadline) return false
  const end = parseLocal(b.disputeDeadline.slice(0, 10))
  if (!end) return false
  end.setHours(23, 59, 59, 999)
  return shNowMs() <= end.getTime()
}

async function dispute(b: MonthlyBill) {
  let content = ''
  try {
    const r = await ElMessageBox.prompt(`对 ${b.billMonth} 账单提出异议，平台将复核并回复。异议截止 ${fmtDate(b.disputeDeadline)}。`, '提出异议', {
      confirmButtonText: '提交异议',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请说明有异议的日期、人数或金额（必填）',
      inputValidator: (v: string) => (v && v.trim().length >= 5) || '请至少填写 5 个字',
    })
    content = r.value.trim()
  } catch {
    return
  }
  try {
    await tenantApi.disputeBill(b.billId, content)
    ElMessage.success('异议已提交，平台将在 5 个工作日内复核')
    load()
    drawerRef.value?.reload()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

const drawer = reactive({ visible: false, billId: null as string | null })
const drawerRef = ref<InstanceType<typeof BillDetailDrawer> | null>(null)
const drawerBill = computed(() => list.value.find((b) => b.billId === drawer.billId) ?? null)
function openDetail(b: MonthlyBill) {
  drawer.billId = b.billId
  drawer.visible = true
}
function rowClass({ row }: { row: MonthlyBill }) {
  return row.billId === selected.value?.billId ? 'row-sel' : ''
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>费用账单</h2>
        <p>增长技术服务费 + 人才流转费 · 按月出账，次月 15 日前完成结算</p>
      </div>
      <span class="spacer" />
      <el-select v-if="list.length" v-model="selectedId" style="width: 140px">
        <el-option v-for="b in list" :key="b.billId" :label="b.billMonth" :value="b.billId" />
      </el-select>
      <el-button v-if="selected" @click="openDetail(selected)">账单明细</el-button>
      <el-button v-if="canDispute(selected)" type="warning" plain @click="selected && dispute(selected)">提出异议</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="load">重试</el-button>
    </el-alert>

    <template v-if="selected">
      <div class="grid g-4">
        <div class="stat">
          <div class="stat-l">增长技术服务费</div>
          <div class="stat-v">{{ fmtYuan(selected.serviceFee) }}</div>
          <div class="stat-d">按日累计 · 增量人员计费</div>
        </div>
        <div class="stat">
          <div class="stat-l">人才流转费（应付）</div>
          <div class="stat-v" style="color: var(--danger)">{{ fmtYuan(selected.transferPayable) }}</div>
          <div class="stat-d">流入人员 · 10 元/人/天</div>
        </div>
        <div class="stat">
          <div class="stat-l">人才流转费（应收）</div>
          <div class="stat-v" style="color: var(--ok)">{{ fmtYuan(selected.transferReceivable) }}</div>
          <div class="stat-d">流出人员 · 8 元/人/天 · 平台另行结算</div>
        </div>
        <div class="stat stat--signal">
          <div class="stat-l">本月应付合计</div>
          <div class="stat-v">{{ fmtYuan(selected.payable) }}</div>
          <div class="stat-d">服务费 + 应付流转费 · 结算截止 {{ fmtDate(selected.settleDeadline) }}</div>
        </div>
      </div>
      <div class="note note--info" style="margin-top: 10px">
        <b>应收与应付不轧差：</b>应付合计只含服务费与应付流转费；作为来源方的应收流转费单独结算到账，不抵扣本月应付。
        <el-button link type="primary" style="margin-left: 6px" @click="router.push({ path: '/circulation/ledger', query: { month: selected.billMonth } })">查看流转账本 →</el-button>
      </div>
    </template>

    <div class="card" style="margin-top: 14px">
      <div class="card__hd"><h3>月度账单</h3><span class="t-xs">每月最后一天自动生成，平台下发后进入 5 个工作日异议期</span></div>
      <el-table v-loading="loading" :data="list" row-key="billId" :row-class-name="rowClass" @row-click="(r: MonthlyBill) => (selectedId = r.billId)">
        <el-table-column label="账单月份" width="110">
          <template #default="{ row }"><b class="mono">{{ row.billMonth }}</b></template>
        </el-table-column>
        <el-table-column label="增长服务费" min-width="120" align="right">
          <template #default="{ row }"><span class="num">{{ fmtYuan(row.serviceFee) }}</span></template>
        </el-table-column>
        <el-table-column label="流转费应付" min-width="120" align="right">
          <template #default="{ row }"><span class="num" style="color: var(--danger)">{{ fmtYuan(row.transferPayable) }}</span></template>
        </el-table-column>
        <el-table-column label="流转费应收" min-width="120" align="right">
          <template #default="{ row }"><span class="num" style="color: var(--ok)">{{ fmtYuan(row.transferReceivable) }}</span></template>
        </el-table-column>
        <el-table-column label="应付合计" min-width="120" align="right">
          <template #default="{ row }"><b class="num">{{ fmtYuan(row.payable) }}</b></template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><DictTag type="BillStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="异议截止" width="110">
          <template #default="{ row }">
            <span class="mono t-sm" :style="{ color: canDispute(row) ? 'var(--warn)' : undefined }">{{ fmtDate(row.disputeDeadline) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结算截止" width="110">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDate(row.settleDeadline) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click.stop="openDetail(row)">明细</el-button>
            <el-button v-if="canDispute(row)" size="small" link type="warning" @click.stop="dispute(row)">提出异议</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无账单 · 每月最后一天自动生成'" />
        </template>
      </el-table>
      <div v-if="page.total > page.pageSize" class="pager">
        <el-pagination v-model:current-page="page.page" :page-size="page.pageSize" :total="page.total" layout="total, prev, pager, next" background size="small" @current-change="load" />
      </div>
    </div>

    <div class="grid g-2" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>计费规则</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>增长技术服务费</dt><dd>max(在岗 − 存量基数, 0) × 单价 / 天</dd></dl>
          <dl class="kv"><dt>人才流转费（应付）</dt><dd>来源为其他公司的在岗员工 10 元/人/天</dd></dl>
          <dl class="kv"><dt>人才流转费（应收）</dt><dd>本公司来源的员工在别家在岗 8 元/人/天</dd></dl>
          <div class="note" style="margin-top: 10px">存量人员<b>永久免费且不受离职影响</b>；三个月免费期内导入的员工计入存量。</div>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>对账与结算</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>结算周期</dt><dd>按月对账</dd></dl>
          <dl class="kv"><dt>账单生成</dt><dd>每月最后一天自动生成</dd></dl>
          <dl class="kv"><dt>结算截止</dt><dd>次月 15 日前</dd></dl>
          <dl class="kv"><dt>异议期</dt><dd>下发后 5 个工作日内（节假日顺延）</dd></dl>
        </div>
      </div>
    </div>

    <BillDetailDrawer ref="drawerRef" v-model="drawer.visible" :bill-id="drawer.billId" :can-dispute="canDispute(drawerBill)" @dispute="drawerBill && dispute(drawerBill)" />
  </div>
</template>

<style scoped>
:deep(.row-sel) { --el-table-tr-bg-color: var(--signal-50); }
:deep(.el-table__row) { cursor: pointer; }
</style>
