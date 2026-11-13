<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type BrokerCaseRow } from '@shitu/api-client'
import CountdownTag from '@/components/CountdownTag.vue'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import RowActions from '@/components/RowActions.vue'
import { useNow } from '@/composables/useNow'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'
import { enumOptions } from '@/utils/labels'
import { opsColWidth, type RowAction } from '@/utils/rowActions'
import { remainMs } from '@/utils/time'
import BrokerCaseDrawer from './BrokerCaseDrawer.vue'

/**
 * A-05 流转池（T-201）。A-06 AI 分析报告 / A-07 二次匹配与释放合并到工单抽屉：
 * 从「AI 分析报告」「二次匹配 / 释放」菜单进入时，打开工单默认定位到对应页签。
 */
type CaseTab = 'report' | 'recommend' | 'release'
type StatusTab = '' | 'APPLIED' | 'RELEASED' | 'CLOSED'

const route = useRoute()
const meStore = useMeStore()
const now = useNow(15_000)
const isBroker = computed(() => meStore.hasRole('BROKER'))

const entryTab = computed<CaseTab>(() => (route.path === '/broker/rematch' ? 'recommend' : 'report'))
const pageTitle = computed(() =>
  route.path === '/broker/report' ? 'AI 分析报告' : route.path === '/broker/rematch' ? '二次匹配与释放' : '流转池 · 接收流转',
)

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: '', label: '处理中' },
  { key: 'APPLIED', label: '已报名' },
  { key: 'RELEASED', label: '已释放' },
  { key: 'CLOSED', label: '已结束' },
]
const status = ref<StatusTab>('')
const trigger = ref('')
const list = ref<BrokerCaseRow[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    list.value = await tenantApi.brokerCases(status.value || undefined)
  } catch (e) {
    loadError.value = errorMessage(e, '流转池加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}
watch(status, load)
onMounted(load)

const rows = computed(() => (trigger.value ? list.value.filter((c) => c.triggerType === trigger.value) : list.value))
const kpi = computed(() => {
  const open = status.value === '' ? list.value : []
  return {
    pending: open.filter((c) => c.status === 'OPEN').length,
    contactOverdue: open.filter((c) => !c.contactedAt && (remainMs(c.contactDueAt, now.value) ?? 1) < 0).length,
    resolveSoon: open.filter((c) => (remainMs(c.resolveDueAt, now.value) ?? Infinity) < 6 * 3600_000).length,
    recommended: open.filter((c) => c.status === 'RECOMMENDED').length,
  }
})

function rowClass({ row }: { row: BrokerCaseRow }) {
  const overdue = (!row.contactedAt && (remainMs(row.contactDueAt, now.value) ?? 1) < 0) || (remainMs(row.resolveDueAt, now.value) ?? 1) < 0
  return overdue && row.allowedActions.length ? 'row-danger' : ''
}

// ---------------------------------------------------------------- 操作
async function contact(c: BrokerCaseRow) {
  try {
    await ElMessageBox.confirm(`确认已电话联系 ${c.seekerName}（${c.phoneMasked ?? ''}）？`, '标记已联系', { confirmButtonText: '已联系', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    await tenantApi.brokerContact(c.id)
    ElMessage.success('已标记联系')
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

const drawer = reactive({ visible: false, row: null as BrokerCaseRow | null, tab: 'report' as CaseTab })
/** 行操作：从「二次匹配 / 释放」进入时把推荐岗位排在 AI 报告前面；释放收进「更多」。只读角色只有 AI 报告 */
function rowActions(c: BrokerCaseRow): RowAction[] {
  const a: RowAction[] = []
  if (c.allowedActions.includes('CONTACT') && !c.contactedAt) a.push({ key: 'contact', label: '标记已联系', type: 'primary' })
  const report: RowAction = { key: 'report', label: 'AI 报告' }
  const recommend: RowAction[] = c.allowedActions.includes('RECOMMEND') ? [{ key: 'recommend', label: '推荐岗位' }] : []
  a.push(...(entryTab.value === 'recommend' ? [...recommend, report] : [report, ...recommend]))
  if (c.allowedActions.includes('RELEASE')) a.push({ key: 'release', label: '释放', type: 'danger', more: true })
  return a
}
const opsWidth = computed(() => opsColWidth(rows.value.map(rowActions)))
function onAct(key: string, c: BrokerCaseRow) {
  if (key === 'contact') contact(c)
  else open(c, key as CaseTab)
}
function open(c: BrokerCaseRow, tab?: CaseTab) {
  drawer.row = c
  drawer.tab = tab ?? entryTab.value
  drawer.visible = true
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>{{ pageTitle }}</h2>
        <p>驻场流转、匹配度不足 80% 自动转入、多次匹配未报名 · 2 小时内联系、24 小时内出结果，超时自动释放</p>
      </div>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
    </div>

    <div v-if="route.path !== '/broker/pool'" class="note note--info" style="margin-bottom: 14px">
      {{ route.path === '/broker/report' ? 'AI 分析报告' : '二次匹配与释放' }}在工单详情中操作：点击下方工单的「{{ route.path === '/broker/report' ? 'AI 报告' : '推荐岗位' }}」即可打开。
    </div>

    <div class="grid g-4">
      <div class="stat"><div class="stat-l">待联系</div><div class="stat-v">{{ status === '' ? kpi.pending : '—' }}</div><div class="stat-d">新流转工单</div></div>
      <div class="stat" :class="{ 'stat--danger': kpi.contactOverdue > 0 }"><div class="stat-l">超过 2h 未联系</div><div class="stat-v">{{ status === '' ? kpi.contactOverdue : '—' }}</div><div class="stat-d">联系时限已过</div></div>
      <div class="stat" :class="{ 'stat--warn': kpi.resolveSoon > 0 }"><div class="stat-l">6h 内需出结果</div><div class="stat-v">{{ status === '' ? kpi.resolveSoon : '—' }}</div><div class="stat-d">超时自动释放至公域</div></div>
      <div class="stat"><div class="stat-l">已推荐待用户确认</div><div class="stat-v">{{ status === '' ? kpi.recommended : '—' }}</div><div class="stat-d">用户在 C 端确认后报名</div></div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in STATUS_TABS" :key="t.key" :class="{ on: status === t.key }" @click="status = t.key">
            {{ t.label }}<span v-if="status === t.key" class="n">{{ list.length }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="trigger" placeholder="全部流转原因" clearable style="width: 170px">
          <el-option v-for="o in enumOptions('BrokerTriggerType')" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="rows" row-key="id" :row-class-name="rowClass">
        <el-table-column label="求职者" min-width="160">
          <template #default="{ row }"><PersonCell :name="row.seekerName" mono :sub="row.phoneMasked" accent /></template>
        </el-table-column>
        <el-table-column label="流转原因" min-width="130">
          <template #default="{ row }"><DictTag type="BrokerTriggerType" :value="row.triggerType" /></template>
        </el-table-column>
        <el-table-column label="画像摘要" min-width="220">
          <template #default="{ row }">
            <el-tooltip :content="row.profileSummary" placement="top" :show-after="300">
              <div class="summary t-sm">{{ row.profileSummary }}</div>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="匹配次数" min-width="86" align="center">
          <template #default="{ row }"><span class="num">{{ row.matchCount }}</span></template>
        </el-table-column>
        <el-table-column label="状态" min-width="96">
          <template #default="{ row }"><DictTag type="BrokerCaseStatus" :value="row.status" pill /></template>
        </el-table-column>
        <el-table-column label="联系时限 2h" min-width="116">
          <template #default="{ row }">
            <template v-if="row.contactedAt">
              <div class="t-xs nowrap" style="color: var(--ok)">已联系</div>
              <div class="mono t-xs">{{ fmtDateTime(row.contactedAt).slice(5) }}</div>
            </template>
            <CountdownTag v-else-if="row.allowedActions.length" :deadline="row.contactDueAt" :now="now" />
            <span v-else class="t-xs">—</span>
          </template>
        </el-table-column>
        <el-table-column label="出结果 24h" min-width="112">
          <template #default="{ row }">
            <CountdownTag v-if="['OPEN', 'CONTACTED', 'RECOMMENDED'].includes(row.status)" :deadline="row.resolveDueAt" :now="now" />
            <span v-else class="t-xs">—</span>
          </template>
        </el-table-column>
        <el-table-column label="流转时间" min-width="112">
          <template #default="{ row }"><span class="mono t-xs">{{ fmtDateTime(row.createdAt).slice(5) }}</span></template>
        </el-table-column>
        <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
          <template #default="{ row }"><RowActions :actions="rowActions(row)" @act="(k) => onAct(k, row)" /></template>
        </el-table-column>
        <template #empty><el-empty :image-size="80" :description="loadError ? '加载失败' : '流转池暂无工单'" /></template>
      </el-table>
    </div>

    <div class="grid g-2" style="margin-top: 14px">
      <div class="card"><div class="card__hd"><h3>流转触发路径</h3></div><div class="card__bd">
        <dl class="kv"><dt>匹配度不足</dt><dd>AI 问薪匹配度 &lt;80% 自动转入</dd></dl>
        <dl class="kv"><dt>多次匹配未报名</dt><dd>重新匹配达到上限仍未报名</dd></dl>
        <dl class="kv"><dt>驻场流转</dt><dd>驻场一键流转私域待匹配用户</dd></dl>
      </div></div>
      <div class="card"><div class="card__hd"><h3>释放的底线原则</h3></div><div class="card__bd">
        <p class="t-sm" style="line-height: 1.9"><b class="strong">只有劳务公司（驻场 / 经纪人）可操作释放，用户不能主动切换身份。</b>释放只清空当前归属，来源归属永久保留 —— 该用户后续入职任何公司，本公司仍得流转费 8 元/人/天。</p>
        <p v-if="!isBroker" class="t-xs" style="margin-top: 6px">当前为只读视图：联系、生成报告、二次推荐由人才经纪人操作。</p>
      </div></div>
    </div>

    <BrokerCaseDrawer v-model="drawer.visible" :row="drawer.row" :tab="drawer.tab" :now="now" @changed="load" />
  </div>
</template>

<style scoped>
.summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.6; color: var(--ink-700); }
</style>
