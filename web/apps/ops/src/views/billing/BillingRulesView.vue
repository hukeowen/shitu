<script setup lang="ts">
import { IconInbox, IconCircleExclamationPoint } from '@shitu/ui-icons'
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type BillingRuleRow } from '@shitu/api-client'
import { confirmInBox } from '@/composables/boxSubmit'
import { BILLING_SUPER_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDate, fmtDateTime, fmtMoney, fmtOperator, fmtPct, todayStr } from '@/utils/format'

/** P-09 计费规则：版本化（生效日期），只能从明天及以后生效；新增仅超管 */
const auth = useAuthStore()
const canAdd = computed(() => auth.hasAnyRole(BILLING_SUPER_ROLES))

const rows = shallowRef<BillingRuleRow[]>([])
const loading = ref(false)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await opsApi.billingRules()
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

const today = todayStr()
/** 当前生效：生效日期 ≤ 今天中最晚的一条（列表按生效日期倒序） */
const current = computed(() => loading.value || error.value ? null : rows.value.find((r) => fmtDate(r.effectiveFrom) <= today) ?? null)
function stateOf(r: BillingRuleRow): { label: string; cls: string } {
  if (fmtDate(r.effectiveFrom) > today) return { label: '待生效', cls: 'status-tag--info' }
  if (current.value && r.version === current.value.version) return { label: '生效中', cls: 'status-tag--success' }
  return { label: '已失效', cls: '' }
}
const pct = fmtPct
const toPct = (v: number | string) => Math.round(Number(v) * 10000) / 100

const page = ref(1)
const pageRows = computed(() => rows.value.slice((page.value - 1) * 20, page.value * 20))
watch(rows, () => { page.value = 1 })

// ---------- 新增
function tomorrow(): string {
  const d = new Date(`${today}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const dlg = reactive({
  visible: false,
  loading: false,
  error: '',
  /** supplySharePct：界面按百分比录入（80 = 80%），提交时换算成后端的小数比例 */
  form: { effectiveFrom: '', serviceUnitPrice: 0.1, transferUnitPrice: 10, supplySharePct: 80, freeMonths: 3 },
})
function openAdd() {
  const c = current.value
  dlg.form = {
    effectiveFrom: tomorrow(),
    serviceUnitPrice: c ? Number(c.serviceUnitPrice) : 0.1,
    transferUnitPrice: c ? Number(c.transferUnitPrice) : 10,
    supplySharePct: c ? toPct(c.supplyShare) : 80,
    freeMonths: c ? c.freeMonths : 3,
  }
  dlg.error = ''
  dlg.visible = true
}
const platformPct = computed(() => Math.round((100 - (dlg.form.supplySharePct ?? 0)) * 100) / 100)
const disableDate = (d: Date) => d.getTime() < new Date(`${tomorrow()}T00:00:00`).getTime()
async function submit() {
  const f = dlg.form
  if (!f.effectiveFrom) {
    dlg.error = '请选择生效日期'
    return
  }
  if (dlg.loading) return
  dlg.loading = true
  dlg.error = ''
  try {
    const ok = await confirmInBox({
      title: '新增计费规则版本', action: '新增',
      text: `自 ${f.effectiveFrom} 起：服务费 ${fmtMoney(f.serviceUnitPrice)} 元/人/天、流转费 ${fmtMoney(f.transferUnitPrice)} 元/人/天、供给方分成 ${f.supplySharePct}%（平台抽佣 ${platformPct.value}%）、免费期 ${f.freeMonths} 个月。历史计费不受影响，确定新增？`,
      api: async () => {
        const v = await opsApi.addBillingRule({
          effectiveFrom: f.effectiveFrom,
          serviceUnitPrice: f.serviceUnitPrice,
          transferUnitPrice: f.transferUnitPrice,
          supplyShare: Math.round((f.supplySharePct ?? 0) * 100) / 10000,
          freeMonths: f.freeMonths,
        })
        ElMessage.success(`已新增规则 v${v}`)
      },
    })
    if (!ok) return
    dlg.visible = false
    await load()
  } finally {
    dlg.loading = false
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>计费规则</h2>
        <p>增长技术服务费单价、人才流转费单价、流转费分账比例、新入驻免费期 · 版本化，按生效日期适用，历史计费不受影响</p>
      </div>
      <div class="spacer" />

    </div>

    <div class="card version-bar">
      <div><span class="t-sm dim">当前生效版本</span><b>{{ current ? `v${current.version}` : '—' }}</b>
        <span class="t-sm dim">待生效版本</span><b>{{ loading || error ? '—' : rows.filter((r) => fmtDate(r.effectiveFrom) > today).map((r) => `v${r.version}`).join('、') || '无' }}</b>
        <p class="t-xs">按生效日期自动启用；新增版本最早明天生效。</p>
      </div>
      <el-button v-if="canAdd" class="btn-steady" type="primary" :disabled="loading || !!error" @click="openAdd">新增规则版本</el-button>
    </div>

    <div class="grid g-4 stats">
      <div class="stat">
        <div class="stat-l">增长技术服务费</div>
        <div class="stat-v">{{ current ? fmtMoney(current.serviceUnitPrice) : '—' }}<small class="u">元/人/天</small></div>
        <div class="stat-d">按存量基数外的增量在岗人数计</div>
      </div>
      <div class="stat">
        <div class="stat-l">人才流转费</div>
        <div class="stat-v">{{ current ? fmtMoney(current.transferUnitPrice) : '—' }}<small class="u">元/人/天</small></div>
        <div class="stat-d">接收方按流转人员在岗天数支付</div>
      </div>
      <div class="stat">
        <div class="stat-l">流转费分账</div>
        <div class="stat-v">{{ current ? pct(current.supplyShare) : '—' }}</div>
        <div class="stat-d">{{ current ? `供给方分成，平台抽佣 ${pct(1 - Number(current.supplyShare))}` : '—' }}</div>
      </div>
      <div class="stat">
        <div class="stat-l">新入驻免费期</div>
        <div class="stat-v">{{ current ? current.freeMonths : '—' }}<small class="u">个月</small></div>
        <div class="stat-d">{{ current ? `当前版本 v${current.version} · ${fmtDate(current.effectiveFrom)} 起` : loading || error ? '—' : '暂无生效规则' }}</div>
      </div>
    </div>

    <div class="card">
      <div class="card__hd">
        <h3>规则版本</h3>
        <span v-if="!canAdd" class="t-xs">新增规则需超级管理员操作</span>
      </div>
      <el-table v-loading="loading" :data="loading ? [] : pageRows" class="tbl-48" row-key="version">
        <el-table-column label="版本" width="80"><template #default="{ row }"><span class="mono strong">v{{ row.version }}</span></template></el-table-column>
        <el-table-column label="生效日期" width="120"><template #default="{ row }"><span class="tnum">{{ fmtDate(row.effectiveFrom) }}</span></template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><span class="status-tag" :class="stateOf(row).cls">{{ stateOf(row).label }}</span></template>
        </el-table-column>
        <el-table-column label="服务费（元/人/天）" min-width="140" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.serviceUnitPrice) }}</span></template></el-table-column>
        <el-table-column label="流转费（元/人/天）" min-width="140" align="right"><template #default="{ row }"><span class="money">{{ fmtMoney(row.transferUnitPrice) }}</span></template></el-table-column>
        <el-table-column label="供给方分成" width="110" align="right"><template #default="{ row }"><span class="tnum">{{ pct(row.supplyShare) }}</span></template></el-table-column>
        <el-table-column label="免费期" width="90" align="right"><template #default="{ row }"><span class="tnum">{{ row.freeMonths }} 个月</span></template></el-table-column>
        <el-table-column label="创建" min-width="160">
          <template #default="{ row }"><span class="tnum t-sm">{{ fmtDateTime(row.createdAt) }}</span><div class="t-xs">{{ fmtOperator(row.createdBy) }}</div></template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="!loading && error" :image-size="48" :description="error"><template #image><IconCircleExclamationPoint :size="48" /></template><el-button size="small" @click="load">重新加载</el-button></el-empty>
          <el-empty v-else-if="!loading" :image-size="48"><template #image><IconInbox :size="48" /></template><template #description><h3>暂无计费规则</h3><p>尚无规则版本，可新增规则或刷新列表。</p></template><el-button v-if="canAdd" type="primary" @click="openAdd">新增规则版本</el-button><el-button v-else type="primary" @click="load">刷新</el-button></el-empty>
        </template>
      </el-table>
      <div v-if="!loading && rows.length" class="pager"><el-pagination v-model:current-page="page" :page-size="20" :total="rows.length" layout="total, prev, pager, next" /></div>
    </div>

    <el-dialog class="dlg-16" v-model="dlg.visible" title="新增计费规则版本" width="480px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!dlg.loading" :show-close="!dlg.loading">
      <div class="notice notice--info gap">新规则最早从明天生效；已发生的日计费按当时的规则版本，不会被改写。</div>
      <el-form :disabled="dlg.loading" label-width="130px" @submit.prevent>
        <el-form-item label="生效日期" required>
          <el-date-picker v-model="dlg.form.effectiveFrom" type="date" value-format="YYYY-MM-DD" :disabled-date="disableDate" :clearable="false" />
        </el-form-item>
        <el-form-item label="服务费单价" required>
          <el-input-number v-model="dlg.form.serviceUnitPrice" :min="0" :max="99.99" :step="0.01" :precision="2" />
          <span class="unit">元/人/天</span>
        </el-form-item>
        <el-form-item label="流转费单价" required>
          <el-input-number v-model="dlg.form.transferUnitPrice" :min="0" :max="999.99" :step="1" :precision="2" />
          <span class="unit">元/人/天</span>
        </el-form-item>
        <el-form-item label="供给方分成比例" required>
          <el-input-number v-model="dlg.form.supplySharePct" :min="0" :max="100" :step="5" :precision="0" />
          <span class="unit">%　平台抽佣 {{ platformPct }}%</span>
        </el-form-item>
        <el-form-item label="新入驻免费期" required>
          <el-input-number v-model="dlg.form.freeMonths" :min="0" :max="24" :step="1" />
          <span class="unit">个月</span>
        </el-form-item>
      </el-form>
      <div v-if="dlg.error" class="notice notice--danger">{{ dlg.error }}</div>
      <template #footer>
        <el-button :disabled="dlg.loading" @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.loading" @click="submit">新增</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.version-bar { position: sticky; top: var(--layout-top-height); z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4); margin-bottom: var(--space-4); min-height: 80px; }
.version-bar > div { min-width: 0; }
.version-bar b { margin: 0 var(--space-6) 0 var(--space-2); }
.version-bar p { margin: var(--space-2) 0 0; }
.stats { margin-bottom: 14px; }
.u { font-size: 12px; font-weight: 400; color: var(--text-3); margin-left: 4px; font-family: var(--font-sans, inherit); }
.unit { margin-left: 8px; font-size: 12px; color: var(--text-3); }
.gap { margin-bottom: 14px; }
</style>
