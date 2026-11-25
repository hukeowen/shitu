<script setup lang="ts">
import { shNow, ym } from '@/utils/time'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type AdvanceRow, type AdvanceStatus } from '@shitu/api-client'
import { IconBanknote, IconCheck, IconCircleExclamationPoint, IconClock, IconInfo, IconUserCheck, IconWallet } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { boxSubmit } from '@/composables/boxSubmit'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { fmtDateTime, fmtYuan, toNum } from '@/utils/format'
import { enumLabel } from '@/utils/labels'

/**
 * A-17 薪酬预支审批（T-309 / M-11，D-25 双级）：员工发起 → 驻场初审 → 项目经理终审 → 登记拨款（线下转账后登记，记入欠款）。
 * 行操作严格按后端 allowedActions：SITE_APPROVE / SITE_REJECT / PM_APPROVE / PM_REJECT / PAYOUT；驳回必须填写意见。
 * 后端列表最多返回 200 条（按申请时间倒序），这里一次取回后在前端分页签。
 */
type Tab = 'todo' | 'flow' | 'paid' | 'rejected' | 'all'
type Action = 'SITE_APPROVE' | 'SITE_REJECT' | 'PM_APPROVE' | 'PM_REJECT' | 'PAYOUT'

const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
const { projects } = useProjects()

/** 能审核的角色（驻场初审 / 项目经理终审）；老板只能查看和登记拨款 */
const canReview = meStore.hasRole('SITE', 'PM')
const TABS: { key: Tab; label: string; match: (a: AdvanceRow) => boolean }[] = [
  // 第一个页签 = 当前登录人自己能操作的单子：审核角色叫「待我处理」，老板只有登记拨款，如实叫「待登记拨款」
  { key: 'todo', label: canReview ? '待我处理' : '待登记拨款', match: (a) => a.allowedActions.length > 0 },
  { key: 'flow', label: '审批中', match: (a) => ['SUBMITTED', 'SITE_APPROVED', 'PM_APPROVED'].includes(a.status) },
  { key: 'paid', label: '已拨款', match: (a) => ['PAID', 'PARTIALLY_REPAID', 'REPAID'].includes(a.status) },
  { key: 'rejected', label: '已驳回', match: (a) => a.status === 'REJECTED' },
  { key: 'all', label: '全部', match: () => true },
]

const tab = ref<Tab>(TABS.some((t) => t.key === route.query.tab) ? (route.query.tab as Tab) : canReview ? 'todo' : 'all')
const projectId = ref('')
const all = ref<AdvanceRow[]>([])
const loading = ref(false)
const loadError = ref('')
/** 拿到过数据才显示指标和页签计数（加载中、失败时显示「—」，规范 Page States） */
const ready = computed(() => !loading.value && !loadError.value)

const scoped = computed(() => (projectId.value ? all.value.filter((a) => a.projectId === projectId.value) : all.value))
const rows = computed(() => scoped.value.filter((TABS.find((t) => t.key === tab.value) ?? TABS[0]).match))
const tabCount = (t: (typeof TABS)[number]) => scoped.value.filter(t.match).length
const EMPTY_TEXT: Record<Tab, string> = {
  todo: canReview ? '暂无需要你处理的预支申请' : '暂无待登记拨款的预支申请',
  flow: '没有审批中的预支申请',
  paid: '还没有已拨款的预支',
  rejected: '还没有被驳回的预支申请',
  all: '还没有预支申请',
}
/** 接口一次返回全部（最多 200 条），表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => rows.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))
watch([tab, projectId], () => (pg.page = 1))

function sum(list: AdvanceRow[]) {
  return list.reduce((s, a) => s + toNum(a.amount), 0)
}
function byStatus(...st: AdvanceStatus[]) {
  return scoped.value.filter((a) => st.includes(a.status))
}
const thisMonth = ym(shNow())
const stats = computed(() => {
  const s1 = byStatus('SUBMITTED')
  const s2 = byStatus('SITE_APPROVED')
  const s3 = byStatus('PM_APPROVED')
  const paid = scoped.value.filter((a) => a.paidAt && a.paidAt.slice(0, 7) === thisMonth)
  const outstanding = byStatus('PAID', 'PARTIALLY_REPAID').reduce((s, a) => s + toNum(a.amount) - toNum(a.repaidAmount), 0)
  return { s1, s2, s3, paid, outstanding }
})

const projectName = (id: string) => projects.value.find((p) => p.projectId === id)?.name ?? id

/** 导出：当前页签、当前项目下的全部申请（接口一次返回，不只是表格这一页） */
const EXPORT_COLUMNS: CsvColumn<AdvanceRow>[] = [
  { header: '申请单号', value: (a) => a.advanceId, kind: 'text' },
  { header: '申请时间', value: (a) => a.createdAt, kind: 'datetime' },
  { header: '员工', value: (a) => a.seekerName },
  { header: '项目', value: (a) => projectName(a.projectId) },
  { header: '金额', value: (a) => a.amount, kind: 'money' },
  { header: '预支月份', value: (a) => a.bizMonth, kind: 'text' },
  { header: '已还金额', value: (a) => (a.paidAt ? a.repaidAmount : ''), kind: 'money' },
  { header: '拨款时间', value: (a) => a.paidAt, kind: 'datetime' },
  { header: '状态', value: (a) => enumLabel('AdvanceStatus', a.status) },
]
function doExport() {
  exportList({ name: `薪酬预支-${TABS.find((t) => t.key === tab.value)?.label ?? '全部'}`, columns: EXPORT_COLUMNS, rows: rows.value })
}

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    all.value = await tenantApi.advances()
  } catch (e) {
    loadError.value = errorMessage(e, '预支申请加载失败')
    all.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

function setTab(t: Tab) {
  tab.value = t
  router.replace({ query: { ...route.query, tab: t } })
}
/** 项目选了就在前端筛（同改版前）；「查询」重新拉取，「重置」清回全部项目再查（规范 Page States「console 列表页筛选栏」） */
function reset() {
  projectId.value = ''
  load()
}

/** 审批链：发起 → 驻场初审 → 经理终审 → 拨款 → 还清。驳回节点未知（列表不含审批记录），只标记为驳回 */
const STEPS = ['发起', '驻场初审', '经理终审', '拨款', '还清'] as const
const DONE_UPTO: Record<AdvanceStatus, number> = {
  SUBMITTED: 0,
  SITE_APPROVED: 1,
  PM_APPROVED: 2,
  PAID: 3,
  PARTIALLY_REPAID: 3,
  REPAID: 4,
  REJECTED: 0,
}
function stepClass(a: AdvanceRow, i: number) {
  const done = DONE_UPTO[a.status]
  if (a.status === 'REJECTED') return i === 0 ? 'done' : i === 1 ? 'rej' : ''
  if (i <= done) return 'done'
  if (i === done + 1) return 'now'
  return ''
}
function chainSteps(a: AdvanceRow) {
  return a.status === 'REJECTED' ? ['发起', '已驳回'] : STEPS
}

const LABEL: Record<Action, string> = {
  SITE_APPROVE: '初审通过',
  SITE_REJECT: '驳回',
  PM_APPROVE: '终审通过',
  PM_REJECT: '驳回',
  PAYOUT: '登记拨款',
}
function acts(a: AdvanceRow): Action[] {
  const order: Action[] = ['SITE_REJECT', 'PM_REJECT', 'SITE_APPROVE', 'PM_APPROVE', 'PAYOUT']
  return order.filter((x) => a.allowedActions.includes(x))
}
function who(a: AdvanceRow) {
  return `${a.seekerName ?? '员工'}（${projectName(a.projectId)}）${fmtYuan(a.amount)}`
}

/**
 * 在岗核对（后端只给还没拨款的单子附上）：已不在岗 / 已提交离职 / 离职已批 → 红色，后端不让通过、不让拨款；
 * 本月旷工、最近两周旷工、欠款没扣完 → 橙色，只提醒
 */
function checkTags(a: AdvanceRow): { text: string; tone: 'danger' | 'warning' }[] {
  const c = a.check
  if (!c) return []
  const t: { text: string; tone: 'danger' | 'warning' }[] = []
  if (!c.onDuty) t.push({ text: '已不在岗', tone: 'danger' })
  if (c.resignStatus === 'PENDING') t.push({ text: '已提交离职', tone: 'danger' })
  else if (c.resignStatus === 'SCHEDULED') t.push({ text: c.resignDate ? `${c.resignDate} 离职` : '离职已批', tone: 'danger' })
  if (c.absentThisMonth > 0) t.push({ text: `本月旷工 ${c.absentThisMonth} 天`, tone: 'warning' })
  else if (c.warnings.some((w) => w.startsWith('最近两周有旷工'))) t.push({ text: '最近两周有旷工', tone: 'warning' })
  if (toNum(c.debt ?? 0) > 0) t.push({ text: '预支欠款未扣完', tone: 'warning' })
  return t
}
/** 在岗核对不过关时，通过 / 登记拨款按钮置灰的原因；驳回不受影响 */
function checkBlockText(a: AdvanceRow, act: Action): string {
  if (!a.check?.blocking || act.endsWith('REJECT')) return ''
  return act === 'PAYOUT' ? '这个人已离职或正在办离职，不能登记拨款，请先不要转账' : '这个人已离职或正在办离职，不能通过，请驳回'
}
/** 确认框里附上的提醒，让审批人点确认那一刻也看得到 */
function warnText(a: AdvanceRow) {
  const w = a.check?.warnings ?? []
  return w.length ? ` 请注意：${w.join('；')}。` : ''
}

/** 后端拒绝过的操作：只置灰这一条的这个操作，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, { name: string; act: Action; text: string }>>({})

async function run(action: Action, a: AdvanceRow) {
  const reject = action === 'SITE_REJECT' || action === 'PM_REJECT'
  const api = (opinion: string) => {
    if (action === 'SITE_APPROVE' || action === 'SITE_REJECT') return tenantApi.siteReviewAdvance(a.advanceId, !reject, opinion || undefined)
    if (action === 'PM_APPROVE' || action === 'PM_REJECT') return tenantApi.pmReviewAdvance(a.advanceId, !reject, opinion || undefined)
    return tenantApi.payoutAdvance(a.advanceId)
  }
  const onBlocked = (why: string) => (blocked[a.advanceId] = { name: a.seekerName ?? '员工', act: action, text: why })
  // 确认框里提交（规范 Page States「后台确认框一律在框内提交」）：提交中框不关、确认按钮转圈，被拒原因留在框里
  try {
    if (reject) {
      const s = boxSubmit(`驳回 ${who(a)} 的预支申请。驳回后本次机会退回员工，并通知员工驳回原因。`, '驳回', api, onBlocked)
      await ElMessageBox.prompt(s.message, '驳回预支', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请填写驳回意见（必填，员工可见）',
        inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写驳回意见',
        type: 'warning',
        confirmButtonClass: 'el-button--danger is-plain btn-reject',
        beforeClose: s.beforeClose,
      })
    } else if (action === 'PAYOUT') {
      const s = boxSubmit(`确认已线下向 ${who(a)} 完成转账？登记后计入员工欠款，次月发薪时工资表导入自动抵扣，此操作不可撤销。${warnText(a)}`, '登记拨款', api, onBlocked)
      await ElMessageBox.confirm(s.message, '登记拨款', { confirmButtonText: '已转账，登记拨款', cancelButtonText: '取消', type: 'warning', beforeClose: s.beforeClose })
    } else {
      const s = boxSubmit(
        (action === 'SITE_APPROVE' ? `初审通过 ${who(a)}，流转至项目经理终审。` : `终审通过 ${who(a)}，进入待拨款。`) + warnText(a),
        LABEL[action],
        api,
        onBlocked,
      )
      await ElMessageBox.prompt(s.message, action === 'SITE_APPROVE' ? '驻场初审' : '项目经理终审', {
        confirmButtonText: LABEL[action],
        cancelButtonText: '取消',
        inputPlaceholder: '审批意见（选填）',
        beforeClose: s.beforeClose,
      })
    }
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success(reject ? '已驳回，机会已退回员工' : action === 'PAYOUT' ? '已登记拨款' : action === 'SITE_APPROVE' ? '初审通过，已流转项目经理' : '终审通过，待拨款')
  load()
}

const roleHint = computed(() => {
  const r: string[] = []
  if (meStore.hasRole('SITE')) r.push('驻场：初审「待驻场初审」')
  if (meStore.hasRole('PM')) r.push('项目经理：终审「待经理终审」并登记拨款')
  if (meStore.hasRole('OWNER')) r.push('老板：查看全公司并可登记拨款')
  return r.join(' · ')
})

/** 操作列宽按本页实际出现的按钮算：审核按钮是带边框的小号按钮（规范第 8 类：驳回危险色描边在左、通过主色实心在右） */
const opsWidth = computed(() => actionsColWidth(rows.value.map((a) => ({ labels: acts(a).map((x) => LABEL[x]) })), 96, true))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>薪酬预支审批</h2>
        <p>员工本人发起 → 驻场初审 → 项目经理终审 → 登记拨款（<b>双级审核</b>）<template v-if="roleHint"> · {{ roleHint }}</template></p>
      </div>
      <span class="spacer" />
      <el-button :disabled="loading || !rows.length" @click="doExport">导出</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="kpis">
      <div class="stat stat--icon">
        <IconClock :size="20" class="stat-i" />
        <div class="stat-l">待驻场初审</div>
        <div class="stat-v">{{ ready ? stats.s1.length : '—' }}</div>
        <div class="stat-d">{{ ready ? fmtYuan(sum(stats.s1)) : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconUserCheck :size="20" class="stat-i" />
        <div class="stat-l">待项目经理终审</div>
        <div class="stat-v">{{ ready ? stats.s2.length : '—' }}</div>
        <div class="stat-d">{{ ready ? fmtYuan(sum(stats.s2)) : '—' }}</div>
      </div>
      <div class="stat stat--icon" :class="{ 'stat--signal': ready && stats.s3.length > 0 }">
        <IconWallet :size="20" class="stat-i" />
        <div class="stat-l">待拨款</div>
        <div class="stat-v">{{ ready ? stats.s3.length : '—' }}</div>
        <div class="stat-d">{{ ready ? `${fmtYuan(sum(stats.s3))} · 审批已完成` : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconBanknote :size="20" class="stat-i" />
        <div class="stat-l">本月已拨款</div>
        <div class="stat-v">{{ ready ? stats.paid.length : '—' }}</div>
        <div class="stat-d">{{ ready ? `${fmtYuan(sum(stats.paid))} · 未还欠款 ${fmtYuan(stats.outstanding)}` : '—' }}</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="setTab(t.key)">
            {{ t.label }}<span v-if="ready" class="n">{{ tabCount(t) }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
        <el-button @click="load">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <div v-if="ready && all.length >= 200" class="notice-bar notice-bar--warn tbl-tip">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>仅显示最近 200 笔申请</span>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.name }}」{{ b.text }}{{ b.text.includes('刷新') ? '' : '。刷新后重新判断' }}</p>
      <el-table v-loading="loading" :data="pageRows" row-key="advanceId">
        <el-table-column label="申请单号" width="140">
          <template #default="{ row }">
            <div class="code">{{ row.advanceId }}</div>
            <div class="sub tnum">{{ fmtDateTime(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="员工" min-width="96">
          <template #default="{ row }"><PersonCell :name="row.seekerName ?? '—'" /></template>
        </el-table-column>
        <el-table-column label="项目" min-width="130">
          <template #default="{ row }">{{ projectName(row.projectId) }}</template>
        </el-table-column>
        <el-table-column label="金额 / 月份" width="100" align="right">
          <template #default="{ row }">
            <div class="money">{{ fmtYuan(row.amount) }}</div>
            <div class="sub tnum">{{ row.bizMonth }}</div>
          </template>
        </el-table-column>
        <el-table-column label="已还 / 拨款时间" width="140" align="right">
          <template #default="{ row }">
            <template v-if="row.paidAt">
              <div class="money">{{ fmtYuan(row.repaidAmount) }}</div>
              <div class="sub tnum">{{ fmtDateTime(row.paidAt) }}</div>
            </template>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态 / 审批链" min-width="296">
          <template #default="{ row }">
            <DictTag type="AdvanceStatus" :value="row.status" />
            <div class="chain">
              <!-- 箭头和后一步连在一起折行，行尾不留单独的箭头 -->
              <span v-for="(s, i) in chainSteps(row)" :key="s" class="st">
                <span v-if="i > 0" class="ar" aria-hidden="true">›</span>
                <span class="cn" :class="stepClass(row, i)"><IconCheck v-if="stepClass(row, i) === 'done'" :size="10" />{{ s }}</span>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="在岗情况" min-width="180">
          <template #default="{ row }">
            <template v-if="row.check">
              <div class="duty">
                <template v-if="row.check.onDuty">在岗 {{ row.check.dutyDays }} 天</template>
                <span v-else class="bad">已不在岗</span>
              </div>
              <div class="sub tnum">
                <template v-if="row.check.startDate">入职 {{ row.check.startDate }} · </template>本月请假 {{ row.check.leaveThisMonth }} / 旷工 {{ row.check.absentThisMonth }} 天
              </div>
              <el-tooltip v-if="checkTags(row).length" placement="top" :show-after="200">
                <template #content>
                  <div v-for="w in row.check.warnings" :key="w">· {{ w }}</div>
                </template>
                <div class="ck-tags" tabindex="0">
                  <span v-for="t in checkTags(row)" :key="t.text" class="status-tag" :class="`status-tag--${t.tone}`">{{ t.text }}</span>
                </div>
              </el-tooltip>
            </template>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div v-if="acts(row).length" class="acts">
              <el-tooltip v-for="a in acts(row)" :key="a" :content="checkBlockText(row, a)" :disabled="!checkBlockText(row, a)" placement="top">
                <span class="act-wrap">
                  <el-button
                    size="small"
                    :type="a.endsWith('REJECT') ? 'danger' : 'primary'"
                    :plain="a.endsWith('REJECT')"
                    :class="{ 'btn-reject': a.endsWith('REJECT') }"
                    :disabled="blocked[row.advanceId]?.act === a || !!checkBlockText(row, a)"
                    @click="run(a, row)"
                  >
                    {{ LABEL[a] }}
                  </el-button>
                </span>
              </el-tooltip>
            </div>
            <span v-else class="sub">—</span>
            <div v-if="row.check?.blocking && acts(row).some((a: Action) => checkBlockText(row, a))" class="ops-why">
              {{ acts(row).includes('PAYOUT') ? '已离职或在办离职，先别转账' : '已离职或在办离职，请驳回' }}
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
            <IconWallet :size="48" />
            <h4>{{ EMPTY_TEXT[tab] }}</h4>
            <p>员工在求职者端发起预支、驻场初审通过后，申请会按审批进度出现在这里</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="rows.length > 0" class="pager">
        <el-pagination
          v-model:current-page="pg.page"
          v-model:page-size="pg.pageSize"
          :total="rows.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @size-change="pg.page = 1"
        />
      </div>
    </div>

    <div class="rules">
      <div class="card">
        <div class="card__hd"><h3>准入条件</h3></div>
        <div class="card__bd">
          <ul class="rule-list">
            <li>状态为「已入职在岗」，身份已绑定本公司</li>
            <li><b>入职满 7 个在岗日</b>方可发起首次预支</li>
            <li>请假 / 旷工日不计入在岗日</li>
          </ul>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>额度规则</h3></div>
        <div class="card__bd">
          <ul class="rule-list">
            <li>单次固定金额，每满 7 个在岗日获得 1 次机会</li>
            <li>每月有次数上限，机会当月末清空，<b>不结转下月</b></li>
            <li>驳回后本次机会退回员工</li>
          </ul>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>拨款与还款</h3></div>
        <div class="card__bd">
          <ul class="rule-list">
            <li>终审通过后<b>线下转账</b>，再在此登记拨款</li>
            <li>登记后计入欠款，导入工资表时<b>自动抵扣</b></li>
            <li>员工无需主动还款</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-1); white-space: nowrap; }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 审批链：一行放下（不折行）；完成的带勾、进行中主色加粗、驳回危险色加粗，不只靠颜色区分（规范 Page States 时间线、步骤条） */
.chain { display: flex; align-items: center; gap: var(--space-1); margin-top: var(--space-1); font-size: var(--font-size-min); line-height: 20px; white-space: nowrap; color: var(--text-3); }
.chain .st { display: inline-flex; align-items: center; gap: var(--space-1); }
.chain .cn { display: inline-flex; align-items: center; }
.chain .cn.done { color: var(--success-text); }
.chain .cn.now { color: var(--primary-text); font-weight: var(--font-weight-semibold); }
.chain .cn.rej { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.act-wrap { display: inline-flex; }
.duty { font-size: var(--font-size-aux); color: var(--text-1); white-space: nowrap; }
.bad { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
.ck-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-1); }
.ck-tags .status-tag { white-space: nowrap; }
.ops-why { margin-top: var(--space-1); font-size: var(--font-size-min); line-height: 18px; color: var(--danger-text); white-space: normal; text-align: right; }
.rules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.rule-list { margin: 0; padding-left: var(--space-4); font-size: var(--font-size-aux); line-height: 1.9; color: var(--text-2); }
.rule-list b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
</style>
