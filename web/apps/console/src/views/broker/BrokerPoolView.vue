<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type BrokerCaseRow } from '@shitu/api-client'
import { IconChevronDown, IconCircleExclamationPoint, IconClock, IconInbox, IconInfo, IconPhone, IconSparkles } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import { boxSubmit } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { useNow } from '@/composables/useNow'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'
import { enumOptions } from '@/utils/labels'
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
/** 工单拿到过数据（没拿到时指标和页签不显示数字） */
const ready = ref(false)
/** 后端拒绝过「标记已联系」的工单：只置灰这一条的这个按钮，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<number, { name: string; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  ready.value = false
  Object.keys(blocked).forEach((k) => delete blocked[Number(k)])
  try {
    list.value = await tenantApi.brokerCases(status.value || undefined)
    ready.value = true
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
/** 指标只按「处理中」页签的数据算；别的页签或没拿到数据时显示「—」 */
const kpiReady = computed(() => ready.value && status.value === '')
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
const canContact = (c: BrokerCaseRow) => c.allowedActions.includes('CONTACT') && !c.contactedAt
async function contact(c: BrokerCaseRow) {
  const s = boxSubmit(`确认已电话联系 ${c.seekerName}（${c.phoneMasked ?? ''}）？`, '标记已联系', () => tenantApi.brokerContact(c.id), (why) => {
    blocked[c.id] = { name: c.seekerName, text: why }
  })
  try {
    await ElMessageBox.confirm(s.message, '标记已联系', { confirmButtonText: '已联系', cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('已标记联系')
  load()
}

/** 操作列：文字按钮平铺「标记已联系 / AI 报告 / 推荐岗位」，「释放」收进「更多」（规范第 2 类：最多平铺 3 个）；列宽按本页实际按钮算 */
function tiled(c: BrokerCaseRow): string[] {
  return [canContact(c) ? '标记已联系' : '', 'AI 报告', c.allowedActions.includes('RECOMMEND') ? '推荐岗位' : ''].filter(Boolean)
}
const opsWidth = computed(() => actionsColWidth(rows.value.map((c) => ({ labels: tiled(c), more: c.allowedActions.includes('RELEASE') }))))

const drawer = reactive({ visible: false, row: null as BrokerCaseRow | null, tab: 'report' as CaseTab })
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

    <div v-if="route.path !== '/broker/pool'" class="notice-bar entry">
      <IconInfo :size="16" class="notice-bar-i" />
      <span>{{ route.path === '/broker/report' ? 'AI 分析报告' : '二次匹配与释放' }}在工单详情中操作：点击下方工单的「{{ route.path === '/broker/report' ? 'AI 报告' : '推荐岗位' }}」即可打开。</span>
    </div>

    <div v-loading="loading" class="kpis">
      <div class="stat stat--icon">
        <IconInbox :size="20" class="stat-i" />
        <div class="stat-l">待联系</div><div class="stat-v">{{ kpiReady ? kpi.pending : '—' }}</div><div class="stat-d">新流转工单</div>
      </div>
      <!-- 只有异常卡（已有超时未联系的）数字用危险色 -->
      <div class="stat stat--icon" :class="{ 'stat--danger': kpiReady && kpi.contactOverdue > 0 }">
        <IconPhone :size="20" class="stat-i" />
        <div class="stat-l">超过 2h 未联系</div><div class="stat-v">{{ kpiReady ? kpi.contactOverdue : '—' }}</div><div class="stat-d">联系时限已过</div>
      </div>
      <div class="stat stat--icon">
        <IconClock :size="20" class="stat-i" />
        <div class="stat-l">6h 内需出结果</div><div class="stat-v">{{ kpiReady ? kpi.resolveSoon : '—' }}</div><div class="stat-d">超时自动释放至公域</div>
      </div>
      <div class="stat stat--icon">
        <IconSparkles :size="20" class="stat-i" />
        <div class="stat-l">已推荐待用户确认</div><div class="stat-v">{{ kpiReady ? kpi.recommended : '—' }}</div><div class="stat-d">用户在 C 端确认后报名</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in STATUS_TABS" :key="t.key" type="button" role="tab" :aria-selected="status === t.key" :class="{ on: status === t.key }" @click="status = t.key">
            {{ t.label }}<span v-if="status === t.key && ready" class="n">{{ list.length }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="trigger" placeholder="全部流转原因" clearable style="width: 170px">
          <el-option v-for="o in enumOptions('BrokerTriggerType')" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ b.name }}（工单 #{{ id }}）{{ b.text }}。刷新后重新判断</p>
      <el-table v-loading="loading" :data="rows" row-key="id" :row-class-name="rowClass">
        <el-table-column label="求职者" min-width="136">
          <template #default="{ row }"><PersonCell :name="row.seekerName" :sub="row.phoneMasked" accent /></template>
        </el-table-column>
        <el-table-column label="流转原因" width="140">
          <template #default="{ row }">
            <DictTag type="BrokerTriggerType" :value="row.triggerType" />
            <div class="t-xs sub">流转于 {{ fmtDateTime(row.createdAt).slice(5) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="画像摘要" min-width="100">
          <template #default="{ row }">
            <el-tooltip :content="row.profileSummary" placement="top" :show-after="300">
              <div class="summary">{{ row.profileSummary }}</div>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="匹配次数" width="76" align="right">
          <template #default="{ row }">{{ row.matchCount }}</template>
        </el-table-column>
        <el-table-column label="状态" width="88">
          <template #default="{ row }"><DictTag type="BrokerCaseStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="联系 2h / 出结果 24h" width="196">
          <template #default="{ row }">
            <div class="due">
              <span class="due-k">联系</span>
              <span v-if="row.contactedAt" class="t-xs">已联系 {{ fmtDateTime(row.contactedAt).slice(5) }}</span>
              <RemainTag v-else-if="row.allowedActions.length" :deadline="row.contactDueAt" :now="now" />
              <span v-else class="t-xs">—</span>
            </div>
            <div class="due">
              <span class="due-k">出结果</span>
              <RemainTag v-if="['OPEN', 'CONTACTED', 'RECOMMENDED'].includes(row.status)" :deadline="row.resolveDueAt" :now="now" />
              <span v-else class="t-xs">—</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <el-button v-if="canContact(row)" size="small" link type="primary" :disabled="!!blocked[row.id]" @click="contact(row)">标记已联系</el-button>
              <el-button size="small" link type="primary" @click="open(row, 'report')">AI 报告</el-button>
              <el-button v-if="row.allowedActions.includes('RECOMMEND')" size="small" link type="primary" @click="open(row, 'recommend')">推荐岗位</el-button>
              <el-dropdown v-if="row.allowedActions.includes('RELEASE')" trigger="click" @command="() => open(row, 'release')">
                <el-button size="small" link type="primary">更多<IconChevronDown :size="14" class="more-i" /></el-button>
                <template #dropdown>
                  <el-dropdown-menu><el-dropdown-item command="release"><span class="danger">释放</span></el-dropdown-item></el-dropdown-menu>
                </template>
              </el-dropdown>
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
            <IconInbox :size="48" />
            <h4>流转池暂无工单</h4>
            <p>驻场流转、匹配度不足 80% 或多次匹配未报名的求职者会进入这里</p>
          </div>
          <span v-else />
        </template>
      </el-table>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>流转触发路径</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>匹配度不足</dt><dd>AI 问薪匹配度 &lt;80% 自动转入</dd></dl>
          <dl class="kv"><dt>多次匹配未报名</dt><dd>重新匹配达到上限仍未报名</dd></dl>
          <dl class="kv"><dt>驻场流转</dt><dd>驻场一键流转私域待匹配用户</dd></dl>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>释放的底线原则</h3></div>
        <div class="card__bd">
          <p class="para"><b>只有劳务公司（驻场 / 经纪人）可操作释放，用户不能主动切换身份。</b>释放只清空当前归属，来源归属永久保留 —— 该用户后续入职任何公司，本公司仍得流转费 8 元/人/天。</p>
          <p v-if="!isBroker" class="hint">当前为只读视图：联系、生成报告、二次推荐由人才经纪人操作。</p>
        </div>
      </div>
    </div>

    <BrokerCaseDrawer v-model="drawer.visible" :row="drawer.row" :tab="drawer.tab" :now="now" @changed="load" />
  </div>
</template>

<style scoped>
.entry { margin-bottom: var(--space-gap); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.sub { margin-top: var(--space-1); white-space: nowrap; }
/* 1280 宽下手机号不折行 */
:deep(.person .t-xs) { white-space: nowrap; }
.summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.6; color: var(--text-2); }
.due { display: flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
.due + .due { margin-top: var(--space-1); }
.due-k { width: 36px; flex: none; font-size: var(--font-size-min); color: var(--text-3); }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.more-i { margin-left: var(--space-1); }
.danger { color: var(--danger-text); }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.para { margin: 0; font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.para b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.hint { margin: var(--space-2) 0 0; font-size: var(--font-size-aux); color: var(--text-3); }
</style>
