<script setup lang="ts">
import { shNow, ym } from '@/utils/time'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type AdvanceRow, type AdvanceStatus } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { fmtDateTime, fmtYuan, toNum } from '@/utils/format'

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

const TABS: { key: Tab; label: string; match: (a: AdvanceRow) => boolean }[] = [
  { key: 'todo', label: '待我处理', match: (a) => a.allowedActions.length > 0 },
  { key: 'flow', label: '审批中', match: (a) => ['SUBMITTED', 'SITE_APPROVED', 'PM_APPROVED'].includes(a.status) },
  { key: 'paid', label: '已拨款', match: (a) => ['PAID', 'PARTIALLY_REPAID', 'REPAID'].includes(a.status) },
  { key: 'rejected', label: '已驳回', match: (a) => a.status === 'REJECTED' },
  { key: 'all', label: '全部', match: () => true },
]

const tab = ref<Tab>(TABS.some((t) => t.key === route.query.tab) ? (route.query.tab as Tab) : 'todo')
const projectId = ref('')
const all = ref<AdvanceRow[]>([])
const loading = ref(false)
const loadError = ref('')
const busy = ref('')

const scoped = computed(() => (projectId.value ? all.value.filter((a) => a.projectId === projectId.value) : all.value))
const rows = computed(() => scoped.value.filter((TABS.find((t) => t.key === tab.value) ?? TABS[0]).match))
const tabCount = (t: (typeof TABS)[number]) => scoped.value.filter(t.match).length

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

async function load() {
  loading.value = true
  loadError.value = ''
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

async function run(action: Action, a: AdvanceRow) {
  const reject = action === 'SITE_REJECT' || action === 'PM_REJECT'
  let opinion: string | undefined
  try {
    if (reject) {
      const r = await ElMessageBox.prompt(`驳回 ${who(a)} 的预支申请。驳回后本次机会退回员工，并通知员工驳回原因。`, '驳回预支', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请填写驳回意见（必填，员工可见）',
        inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写驳回意见',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      })
      opinion = r.value.trim()
    } else if (action === 'PAYOUT') {
      await ElMessageBox.confirm(
        `确认已线下向 ${who(a)} 完成转账？登记后计入员工欠款，次月发薪时工资表导入自动抵扣，此操作不可撤销。`,
        '登记拨款',
        { confirmButtonText: '已转账，登记拨款', cancelButtonText: '取消', type: 'warning' },
      )
    } else {
      const r = await ElMessageBox.prompt(
        action === 'SITE_APPROVE' ? `初审通过 ${who(a)}，流转至项目经理终审。` : `终审通过 ${who(a)}，进入待拨款。`,
        action === 'SITE_APPROVE' ? '驻场初审' : '项目经理终审',
        { confirmButtonText: LABEL[action], cancelButtonText: '取消', inputPlaceholder: '审批意见（选填）' },
      )
      opinion = r.value?.trim() || undefined
    }
  } catch {
    return
  }
  busy.value = a.advanceId
  try {
    if (action === 'SITE_APPROVE' || action === 'SITE_REJECT') await tenantApi.siteReviewAdvance(a.advanceId, !reject, opinion)
    else if (action === 'PM_APPROVE' || action === 'PM_REJECT') await tenantApi.pmReviewAdvance(a.advanceId, !reject, opinion)
    else await tenantApi.payoutAdvance(a.advanceId)
    ElMessage.success(reject ? '已驳回，机会已退回员工' : action === 'PAYOUT' ? '已登记拨款' : action === 'SITE_APPROVE' ? '初审通过，已流转项目经理' : '终审通过，待拨款')
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    load()
  } finally {
    busy.value = ''
  }
}

const roleHint = computed(() => {
  const r: string[] = []
  if (meStore.hasRole('SITE')) r.push('驻场：初审「待驻场初审」')
  if (meStore.hasRole('PM')) r.push('项目经理：终审「待经理终审」并登记拨款')
  if (meStore.hasRole('OWNER')) r.push('老板：查看全公司并可登记拨款')
  return r.join(' · ')
})
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>薪酬预支审批</h2>
        <p>员工本人发起 → 驻场初审 → 项目经理终审 → 登记拨款（<b>双级审核</b>）</p>
      </div>
      <span class="spacer" />
      <span class="ref">功能 <b>T-309</b></span>
      <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
        <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
      </el-select>
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="grid g-4">
      <div class="stat" :class="{ 'stat--warn': stats.s1.length > 0 }">
        <div class="stat-l">待驻场初审</div>
        <div class="stat-v">{{ stats.s1.length }}</div>
        <div class="stat-d">{{ fmtYuan(sum(stats.s1)) }}</div>
      </div>
      <div class="stat" :class="{ 'stat--warn': stats.s2.length > 0 }">
        <div class="stat-l">待项目经理终审</div>
        <div class="stat-v">{{ stats.s2.length }}</div>
        <div class="stat-d">{{ fmtYuan(sum(stats.s2)) }}</div>
      </div>
      <div class="stat" :class="{ 'stat--signal': stats.s3.length > 0 }">
        <div class="stat-l">待拨款</div>
        <div class="stat-v">{{ stats.s3.length }}</div>
        <div class="stat-d">{{ fmtYuan(sum(stats.s3)) }} · 审批已完成</div>
      </div>
      <div class="stat">
        <div class="stat-l">本月已拨款</div>
        <div class="stat-v">{{ stats.paid.length }}</div>
        <div class="stat-d">{{ fmtYuan(sum(stats.paid)) }} · 未还欠款 {{ fmtYuan(stats.outstanding) }}</div>
      </div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="setTab(t.key)">
            {{ t.label }}<span class="n">{{ tabCount(t) }}</span>
          </button>
        </div>
        <span class="spacer" />
        <span class="t-xs">{{ roleHint }}</span>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-alert v-if="all.length >= 200" type="warning" title="仅显示最近 200 笔申请" show-icon :closable="false" />
      <el-table v-loading="loading" :data="rows" row-key="advanceId">
        <el-table-column label="申请单号" width="170">
          <template #default="{ row }">
            <div class="mono t-xs">{{ row.advanceId }}</div>
            <div class="mono t-xs dim">{{ fmtDateTime(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="员工" min-width="100">
          <template #default="{ row }"><PersonCell :name="row.seekerName ?? '—'" /></template>
        </el-table-column>
        <el-table-column label="项目" min-width="130">
          <template #default="{ row }"><span class="t-sm">{{ projectName(row.projectId) }}</span></template>
        </el-table-column>
        <el-table-column label="金额 / 月份" width="110" align="right">
          <template #default="{ row }">
            <b class="num">{{ fmtYuan(row.amount) }}</b>
            <div class="mono t-xs">{{ row.bizMonth }}</div>
          </template>
        </el-table-column>
        <el-table-column label="已还 / 拨款时间" width="130">
          <template #default="{ row }">
            <template v-if="row.paidAt">
              <div class="num t-sm">{{ fmtYuan(row.repaidAmount) }}</div>
              <div class="mono t-xs">{{ fmtDateTime(row.paidAt) }}</div>
            </template>
            <span v-else class="t-xs">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态 / 审批链" min-width="300">
          <template #default="{ row }">
            <DictTag type="AdvanceStatus" :value="row.status" pill />
            <div class="chain" style="margin-top: 4px">
              <template v-for="(s, i) in chainSteps(row)" :key="s">
                <span v-if="i > 0" class="ar">→</span>
                <span class="cn" :class="stepClass(row, i)">{{ s }}</span>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="right" fixed="right">
          <template #default="{ row }">
            <div class="acts">
              <el-button
                v-for="a in acts(row)"
                :key="a"
                size="small"
                :type="a.endsWith('REJECT') ? 'danger' : 'primary'"
                :plain="a.endsWith('REJECT')"
                :loading="busy === row.advanceId"
                @click="run(a, row)"
              >
                {{ LABEL[a] }}
              </el-button>
              <span v-if="!acts(row).length" class="t-xs">—</span>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" :description="loadError ? '加载失败' : tab === 'todo' ? '暂无需要你处理的预支申请' : '暂无记录'" />
        </template>
      </el-table>
    </div>

    <div class="grid g-3" style="margin-top: 14px">
      <div class="card"><div class="card__bd">
        <div class="eyebrow">准入条件</div>
        <ul class="t-sm rules">
          <li>· 状态为「已入职在岗」，身份已绑定本公司</li>
          <li>· <b class="strong">入职满 7 个在岗日</b>方可发起首次预支</li>
          <li>· 请假 / 旷工日不计入在岗日</li>
        </ul>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="eyebrow">额度规则</div>
        <ul class="t-sm rules">
          <li>· 单次固定金额，每满 7 个在岗日获得 1 次机会</li>
          <li>· 每月有次数上限，机会当月末清空，<b class="strong">不结转下月</b></li>
          <li>· 驳回后本次机会退回员工</li>
        </ul>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="eyebrow">拨款与还款</div>
        <ul class="t-sm rules">
          <li>· 终审通过后<b class="strong">线下转账</b>，再在此登记拨款</li>
          <li>· 登记后计入欠款，导入工资表时<b class="strong">自动抵扣</b></li>
          <li>· 员工无需主动还款</li>
        </ul>
      </div></div>
    </div>
  </div>
</template>

<style scoped>
.chain { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; font-size: 11.5px; }
.chain .cn { padding: 1px 6px; border-radius: 3px; color: var(--ink-400); background: var(--surface-2); border: 1px solid var(--line); }
.chain .cn.done { color: var(--ok); border-color: transparent; background: var(--ok-bg, var(--surface-2)); }
.chain .cn.now { color: #fff; background: var(--signal); border-color: var(--signal); font-weight: 600; }
.chain .cn.rej { color: #fff; background: var(--danger); border-color: var(--danger); font-weight: 600; }
.chain .ar { color: var(--ink-300, var(--ink-400)); }
.acts { display: inline-flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.acts .el-button + .el-button { margin-left: 0; }
.rules { margin-top: 8px; line-height: 1.95; list-style: none; padding: 0; }
</style>
