<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, tenantApi, type ApplicationStatus, type SiteApplication, type SiteApplicationAction, type SiteWorkbench } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInbox } from '@shitu/ui-icons'
import AppActionButtons, { ACTION_LABEL, actionsColWidth } from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import ApplicantInsightDrawer from '@/components/site/ApplicantInsightDrawer.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useNow } from '@/composables/useNow'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { fmtDateTime, fmtPhone } from '@/utils/format'
import { remainMs } from '@/utils/time'

/** A-02 待办清单（T-101）：待知悉 / 待面试 / 今日到厂 / 待确权。行操作严格按 allowedActions */
type Tab = 'ack' | 'interview' | 'arrived' | 'confirm'
const TABS: { key: Tab; label: string; status: ApplicationStatus; unack?: boolean; arrivedToday?: boolean; count: keyof SiteWorkbench }[] = [
  { key: 'ack', label: '待知悉', status: 'PENDING_INTERVIEW', unack: true, count: 'pendingAck' },
  { key: 'interview', label: '待面试', status: 'PENDING_INTERVIEW', count: 'pendingInterview' },
  { key: 'arrived', label: '今日到厂', status: 'PENDING_INTERVIEW', arrivedToday: true, count: 'arrivedToday' },
  { key: 'confirm', label: '待确权', status: 'PENDING_CONFIRM', count: 'pendingConfirm' },
]

const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
const now = useNow()
const { projects } = useProjects()
const isSite = computed(() => meStore.hasRole('SITE'))

const tab = ref<Tab>(TABS.some((t) => t.key === route.query.tab) ? (route.query.tab as Tab) : 'ack')
const projectId = ref<string>(typeof route.query.projectId === 'string' ? route.query.projectId : '')
const page = reactive({ page: 1, pageSize: 20, total: 0 })
const list = ref<SiteApplication[]>([])
const loading = ref(false)
const loadError = ref('')
/** 列表拿到过数据（没拿到时页签不显示计数） */
const ready = ref(false)
const wb = ref<SiteWorkbench | null>(null)
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)
/** 后端拒绝过的操作：这条报名被拒的那个按钮置灰、原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, { name: string; action: SiteApplicationAction; text: string }>>({})
function onRejected(action: SiteApplicationAction, app: SiteApplication, reason: string) {
  blocked[app.applicationId] = { name: app.seekerName, action, text: `暂时不能${ACTION_LABEL[action]}：${reason}` }
}

const current = computed(() => TABS.find((t) => t.key === tab.value) ?? TABS[0])
const opsWidth = computed(() => actionsColWidth(list.value))

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    const r = await tenantApi.applications({
      status: current.value.status,
      unacknowledged: current.value.unack || undefined,
      arrivedToday: current.value.arrivedToday || undefined,
      projectId: projectId.value || undefined,
      page: page.page,
      pageSize: page.pageSize,
      // 响应窗口最紧的在前（公域用户无窗口，按报名时间排在后面）
      sort: 'DEADLINE',
    })
    list.value = r.records
    page.total = r.total
    ready.value = true
  } catch (e) {
    loadError.value = errorMessage(e, '待办加载失败')
    ready.value = false
    list.value = []
    page.total = 0
  } finally {
    loading.value = false
  }
}
async function loadCounts() {
  try {
    wb.value = await tenantApi.siteWorkbench()
  } catch {
    wb.value = null
  }
}
function refresh() {
  load()
  loadCounts()
}
function setTab(t: Tab) {
  tab.value = t
  page.page = 1
}
watch([tab, projectId], () => {
  page.page = 1
  router.replace({ query: { ...route.query, tab: tab.value, projectId: projectId.value || undefined } })
  load()
})
onMounted(refresh)

function rowClass({ row }: { row: SiteApplication }) {
  const ms = remainMs(row.responseDeadline, now.value)
  return ms != null && ms < 3600_000 ? 'row-danger' : ''
}

const insight = reactive({ open: false, app: null as SiteApplication | null })
function openInsight(row: SiteApplication) {
  insight.app = row
  insight.open = true
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>待办清单</h2>
        <p>待知悉 / 待面试 / 待确权 · 电脑端与驻场手机端同步</p>
      </div>
      <span class="spacer" />
      <el-button @click="refresh">刷新</el-button>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="setTab(t.key)">
            {{ t.label }}<span class="n">{{ wb && ready ? wb[t.count] : '' }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ b.name }}（{{ id }}）{{ b.text }}。刷新后重新判断</p>
      <el-table v-loading="loading" :data="loadError ? [] : list" row-key="applicationId" :row-class-name="rowClass">
        <el-table-column label="求职者 / 来源" min-width="136">
          <template #default="{ row }">
            <button type="button" class="person-btn" title="查看画像、匹配记录与历史报名" @click="openInsight(row)">
              <PersonCell :name="row.seekerName" :accent="!row.fromPublic">
                <span class="status-tag src-tag" :class="row.fromPublic ? 'status-tag--public' : 'status-tag--private'">{{ row.fromPublic ? '公域' : '私域' }}</span>
              </PersonCell>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="手机号 / 报名编号" width="136">
          <template #default="{ row }">
            <div v-if="row.phone" class="nowrap">{{ fmtPhone(row.phone) }}</div>
            <div v-else class="t-xs">{{ isSite ? '—' : '仅驻场可见' }}</div>
            <div class="t-xs nowrap">{{ row.applicationId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="应聘岗位" min-width="120">
          <template #default="{ row }">
            <div class="strong-14">{{ row.jobTitle ?? '—' }}</div>
            <div class="t-xs">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="报名 / 面试时间" width="120">
          <template #default="{ row }">
            <div class="t-xs nowrap" :title="fmtDateTime(row.createdAt)">报 {{ fmtDateTime(row.createdAt).slice(5) }}</div>
            <div class="nowrap" :class="row.interviewAt ? 'strong-14' : 't-sm'" :title="fmtDateTime(row.interviewAt)">面 {{ row.interviewAt ? fmtDateTime(row.interviewAt).slice(5) : '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <DictTag type="ApplicationStatus" :value="row.status" />
            <div v-if="row.arrivedAt" class="t-xs ok">已到厂 {{ fmtDateTime(row.arrivedAt).slice(5) }}</div>
            <div v-else class="t-xs">{{ row.status === 'PENDING_INTERVIEW' ? (row.acknowledgedAt ? '已推送面试信息' : '未知悉') : row.contract?.status === 'PENDING_SIGN' || row.allowedActions.includes('RESEND_CONTRACT') ? '待求职者签署' : row.status === 'PENDING_CONFIRM' ? '待发起签约' : '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="响应剩余" width="112">
          <template #default="{ row }"><RemainTag :deadline="row.responseDeadline" :now="now" /></template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }"><AppActionButtons :app="row" link :blocked="blocked[row.applicationId]?.action" @action="(a, r) => dialogs?.run(a, r)" /></template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="tbl-state">
            <IconCircleExclamationPoint :size="48" class="tbl-state-i" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="tbl-state">
            <IconInbox :size="48" class="tbl-state-i" />
            <h4>暂无{{ current.label }}</h4>
            <p>新报名、面试结果和待确权会出现在这里，按响应剩余时间排序</p>
          </div>
        </template>
      </el-table>
      <ApplicantInsightDrawer v-model="insight.open" :app="insight.app" />
      <div v-if="page.total > 0" class="pager">
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          :total="page.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @current-change="load"
          @size-change="load"
        />
      </div>
    </div>

    <div class="rules">
      <section class="card card__bd">
        <h3>脱敏与权限</h3>
        <p>姓名默认脱敏；<b>仅驻场角色可见完整手机号</b>。项目经理端自动隐藏手机号与证件号，「爽约」只能由驻场标记。</p>
      </section>
      <section class="card card__bd">
        <h3>取消权限</h3>
        <p>用户<b>无法自行取消报名</b>。误操作或需更换岗位时由驻场 / 项目经理在后台取消（必填原因），取消后用户可重新进入 AI 问薪。</p>
      </section>
      <section class="card card__bd">
        <h3>面试未通过</h3>
        <p>报名前为本公司私域 → 回到「私域待匹配」并重开 24h 窗口；报名前为公域 → 回公域。爽约、超时一律释放到公域。</p>
      </section>
    </div>

    <AppActionDialogs ref="dialogs" @done="refresh" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.person-btn { all: unset; cursor: pointer; display: block; border-radius: var(--radius-tag); }
.person-btn:hover { opacity: 0.8; }
.person-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.strong-14 { font-size: var(--font-size-aux); color: var(--text-1); font-weight: var(--font-weight-medium); }
.ok { color: var(--success-text); }
.src-tag { margin-left: var(--space-2); vertical-align: 1px; }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.tbl-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) 0; line-height: 1.6; }
.tbl-state-i { color: var(--text-3); }
.tbl-state h4 { margin: var(--space-2) 0 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tbl-state p { margin: 0 0 var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.rules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); }
.rules h3 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.rules p { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.rules b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
</style>
