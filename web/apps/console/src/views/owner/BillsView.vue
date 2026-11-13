<script setup lang="ts">
import { shNowMs } from '@/utils/time'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type MonthlyBill } from '@shitu/api-client'
import { IconArrowLeftRight, IconBanknote, IconCircleExclamationPoint, IconInfo, IconReceipt, IconWallet } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { boxSubmit } from '@/composables/boxSubmit'
import { fmtDate, fmtSigned, fmtYuan } from '@/utils/format'
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
/** 后端拒绝过异议的账单：只置灰这张账单的「提出异议」，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, string>>({})

const selected = computed(() => list.value.find((b) => b.billId === selectedId.value) ?? list.value[0] ?? null)

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
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
  // 确认框里提交：框不关、「提交异议」转圈；被拒时原因写在框里，页面上也留原因并置灰这张账单的「提出异议」
  const s = boxSubmit(`对 ${b.billMonth} 账单提出异议，平台将复核并回复。异议截止 ${fmtDate(b.disputeDeadline)}。`, '提出异议', (content) => tenantApi.disputeBill(b.billId, content), (why) => {
    blocked[b.billId] = why
  })
  try {
    await ElMessageBox.prompt(s.message, '提出异议', {
      confirmButtonText: '提交异议',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请说明有异议的日期、人数或金额（必填）',
      inputValidator: (v: string) => (v && v.trim().length >= 5) || '请至少填写 5 个字',
      beforeClose: s.beforeClose,
    })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('异议已提交，平台将在 5 个工作日内复核')
  load()
  drawerRef.value?.reload()
}

const drawer = reactive({ visible: false, billId: null as string | null })
const drawerRef = ref<InstanceType<typeof BillDetailDrawer> | null>(null)
const drawerBill = computed(() => list.value.find((b) => b.billId === drawer.billId) ?? null)
function openDetail(b: MonthlyBill) {
  drawer.billId = b.billId
  drawer.visible = true
}
/** 操作列宽按这一页实际会出的按钮算（本页实测：文字按钮每个字约 16px、按钮间距 8px、格子内边距 24px），1280 宽不横向滚动 */
const opsWidth = computed(() => Math.max(80, ...list.value.map((b) => 24 + 2 * 16 + (canDispute(b) ? 8 + 4 * 16 : 0))))
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
      <el-button v-if="canDispute(selected)" :disabled="!!(selected && blocked[selected.billId])" @click="selected && dispute(selected)">提出异议</el-button>
    </div>

    <template v-if="selected">
      <div class="kpis">
        <div class="stat stat--icon">
          <IconReceipt :size="20" class="stat-i" />
          <div class="stat-l">增长技术服务费</div>
          <div class="stat-v money">{{ fmtSigned(selected.serviceFee, 'out') }}</div>
          <div class="stat-d">应付 · 按日累计 · 增量人员计费</div>
        </div>
        <div class="stat stat--icon">
          <IconWallet :size="20" class="stat-i" />
          <div class="stat-l">人才流转费（应付）</div>
          <div class="stat-v money">{{ fmtSigned(selected.transferPayable, 'out') }}</div>
          <div class="stat-d">流入人员 · 10 元/人/天</div>
        </div>
        <div class="stat stat--icon">
          <IconArrowLeftRight :size="20" class="stat-i" />
          <div class="stat-l">人才流转费（应收）</div>
          <div class="stat-v money">{{ fmtSigned(selected.transferReceivable, 'in') }}</div>
          <div class="stat-d">流出人员 · 8 元/人/天 · 平台另行结算</div>
        </div>
        <div class="stat stat--icon stat--signal">
          <IconBanknote :size="20" class="stat-i" />
          <div class="stat-l">本月应付合计</div>
          <div class="stat-v money total">{{ fmtYuan(selected.payable) }}</div>
          <div class="stat-d">服务费 + 应付流转费 · 结算截止 {{ fmtDate(selected.settleDeadline) }}</div>
        </div>
      </div>
      <div class="notice-bar netting">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>
          <b>应收与应付不轧差：</b>应付合计只含服务费与应付流转费；作为来源方的应收流转费单独结算到账，不抵扣本月应付。
          <el-button link type="primary" class="to-ledger" @click="router.push({ path: '/circulation/ledger', query: { month: selected.billMonth } })">查看流转账本 →</el-button>
        </span>
      </div>
    </template>

    <div class="card tbl-card">
      <div class="card__hd"><h3>月度账单</h3><span class="hint">每月最后一天自动生成，平台下发后进入 5 个工作日异议期</span></div>
      <p v-for="(why, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ list.find((b) => b.billId === id)?.billMonth ?? id }} 账单{{ why }}。刷新后重新判断</p>
      <el-table v-loading="loading" :data="list" row-key="billId" :row-class-name="rowClass" @row-click="(r: MonthlyBill) => (selectedId = r.billId)">
        <el-table-column label="账单月份" width="96">
          <template #default="{ row }"><b class="code">{{ row.billMonth }}</b></template>
        </el-table-column>
        <el-table-column label="增长服务费" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fmtSigned(row.serviceFee, 'out') }}</span></template>
        </el-table-column>
        <el-table-column label="流转费应付" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fmtSigned(row.transferPayable, 'out') }}</span></template>
        </el-table-column>
        <el-table-column label="流转费应收" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fmtSigned(row.transferReceivable, 'in') }}</span></template>
        </el-table-column>
        <el-table-column label="应付合计" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fmtYuan(row.payable) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><DictTag type="BillStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="异议截止" width="104">
          <template #default="{ row }"><span class="code" :class="{ due: canDispute(row) }">{{ fmtDate(row.disputeDeadline) }}</span></template>
        </el-table-column>
        <el-table-column label="结算截止" width="104">
          <template #default="{ row }"><span class="code">{{ fmtDate(row.settleDeadline) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <el-button size="small" link type="primary" @click.stop="openDetail(row)">明细</el-button>
              <el-button v-if="canDispute(row)" size="small" link type="primary" :disabled="!!blocked[row.billId]" @click.stop="dispute(row)">提出异议</el-button>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconReceipt :size="48" />
            <h4>暂无账单</h4>
            <p>每月最后一天自动生成，平台下发后会出现在这里</p>
          </div>
        </template>
      </el-table>
      <div v-if="page.total > page.pageSize" class="pager">
        <el-pagination v-model:current-page="page.page" :page-size="page.pageSize" :total="page.total" layout="total, prev, pager, next" background size="small" @current-change="load" />
      </div>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>计费规则</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>增长技术服务费</dt><dd>max(在岗 − 存量基数, 0) × 单价 / 天</dd></dl>
          <dl class="kv"><dt>人才流转费（应付）</dt><dd>来源为其他公司的在岗员工 10 元/人/天</dd></dl>
          <dl class="kv"><dt>人才流转费（应收）</dt><dd>本公司来源的员工在别家在岗 8 元/人/天</dd></dl>
          <p class="para">存量人员<b>永久免费且不受离职影响</b>；三个月免费期内导入的员工计入存量。</p>
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

    <BillDetailDrawer
      ref="drawerRef"
      v-model="drawer.visible"
      :bill-id="drawer.billId"
      :can-dispute="canDispute(drawerBill)"
      :blocked-why="drawer.billId ? blocked[drawer.billId] : undefined"
      @dispute="drawerBill && dispute(drawerBill)"
    />
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.total { color: var(--primary-text); }
.netting { margin-top: var(--space-gap); }
.to-ledger { margin-left: var(--space-2); vertical-align: baseline; }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); color: var(--text-1); white-space: nowrap; }
b.code { font-weight: var(--font-weight-semibold); }
.due { color: var(--warning-text); }
.acts { display: inline-flex; gap: var(--space-2); justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.para { margin: var(--space-3) 0 0; font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.para b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
:deep(.row-sel) { --el-table-tr-bg-color: var(--primary-bg); }
:deep(.el-table__row) { cursor: pointer; }
/* 表格行高约 48（规范 Key Components 表格） */
.tbl-card :deep(.el-table__body .el-table__cell) { height: 48px; }
</style>
