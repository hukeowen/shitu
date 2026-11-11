<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, tenantApi, type ApplicationStatus, type SiteApplication, type SiteWorkbench } from '@shitu/api-client'
import AppActionButtons from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import ApplicantInsightDrawer from '@/components/site/ApplicantInsightDrawer.vue'
import CountdownTag from '@/components/CountdownTag.vue'
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
const wb = ref<SiteWorkbench | null>(null)
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)

const current = computed(() => TABS.find((t) => t.key === tab.value) ?? TABS[0])

async function load() {
  loading.value = true
  loadError.value = ''
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
  } catch (e) {
    loadError.value = errorMessage(e, '待办加载失败')
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
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="setTab(t.key)">
            {{ t.label }}<span class="n">{{ wb ? wb[t.count] : '' }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
          <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
        </el-select>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="list" row-key="applicationId" :row-class-name="rowClass">
        <el-table-column label="#" width="48">
          <template #default="{ $index }"><span class="mono t-xs">{{ String((page.page - 1) * page.pageSize + $index + 1).padStart(2, '0') }}</span></template>
        </el-table-column>
        <el-table-column label="求职者" min-width="130">
          <template #default="{ row }">
            <button type="button" class="person-btn" title="查看画像、匹配记录与历史报名" @click="openInsight(row)">
              <PersonCell :name="row.seekerName" :accent="!row.fromPublic" :sub="row.applicationId" />
            </button>
          </template>
        </el-table-column>
        <el-table-column label="手机号" width="130">
          <template #default="{ row }">
            <span v-if="row.phone" class="mono t-sm">{{ fmtPhone(row.phone) }}</span>
            <span v-else class="t-xs">{{ isSite ? '—' : '仅驻场可见' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="应聘岗位" min-width="180">
          <template #default="{ row }">
            <div class="t-sm strong">{{ row.jobTitle ?? '—' }}</div>
            <div class="t-xs">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }"><span class="tag" :class="row.fromPublic ? 'tag--public' : 'tag--private'">{{ row.fromPublic ? '公域' : '私域' }}</span></template>
        </el-table-column>
        <el-table-column label="报名 / 面试时间" width="172">
          <template #default="{ row }">
            <div class="mono t-xs">报 {{ fmtDateTime(row.createdAt) }}</div>
            <div class="mono t-sm" :class="row.interviewAt ? 'strong' : 'dim'">面 {{ fmtDateTime(row.interviewAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <DictTag type="ApplicationStatus" :value="row.status" pill />
            <div v-if="row.arrivedAt" class="t-xs" style="color: var(--ok)">已到厂 {{ fmtDateTime(row.arrivedAt).slice(5) }}</div>
            <div v-else class="t-xs">{{ row.status === 'PENDING_INTERVIEW' ? (row.acknowledgedAt ? '已推送面试信息' : '未知悉') : row.contract?.status === 'PENDING_SIGN' || row.allowedActions.includes('RESEND_CONTRACT') ? '待求职者签署' : row.status === 'PENDING_CONFIRM' ? '待发起签约' : '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="响应剩余" width="110">
          <template #default="{ row }"><CountdownTag :deadline="row.responseDeadline" :now="now" /></template>
        </el-table-column>
        <el-table-column label="操作" min-width="230" align="right" fixed="right">
          <template #default="{ row }"><AppActionButtons :app="row" @action="(a, r) => dialogs?.run(a, r)" /></template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" :description="loadError ? '加载失败' : `暂无${current.label}`" />
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

    <div class="grid g-3" style="margin-top: 14px">
      <div class="card"><div class="card__bd">
        <div class="eyebrow">脱敏与权限</div>
        <p class="t-sm" style="margin-top: 6px; line-height: 1.8">姓名默认脱敏；<b class="strong">仅驻场角色可见完整手机号</b>。项目经理端自动隐藏手机号与证件号，「爽约」只能由驻场标记。</p>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="eyebrow">取消权限</div>
        <p class="t-sm" style="margin-top: 6px; line-height: 1.8">用户<b class="strong">无法自行取消报名</b>。误操作或需更换岗位时由驻场 / 项目经理在后台取消（必填原因），取消后用户可重新进入 AI 问薪。</p>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="eyebrow">面试未通过</div>
        <p class="t-sm" style="margin-top: 6px; line-height: 1.8">报名前为本公司私域 → 回到「私域待匹配」并重开 24h 窗口；报名前为公域 → 回公域。爽约、超时一律释放到公域。</p>
      </div></div>
    </div>

    <AppActionDialogs ref="dialogs" @done="refresh" />
  </div>
</template>

<style scoped>
.person-btn { all: unset; cursor: pointer; display: block; border-radius: var(--r-xs); }
.person-btn:hover { opacity: 0.8; }
.person-btn:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
</style>
