<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, opsApi, useDict } from '@shitu/api-client'
import { fmtDate, fmtDateTime, yesNo } from '@/utils/format'

/** P-08 归属治理：按手机号 / 用户 ID 查用户当前状态、来源与当前归属、状态迁移日志、报名与任职 */
interface StatusLogRow {
  event: string
  fromStatus?: string
  toStatus?: string
  boundBefore?: string
  boundAfter?: string
  releaseReason?: string
  actorRole?: string
  actorId?: string
  actorCompanyId?: string
  remark?: string
  createdAt: string
}
interface ApplicationRow {
  applicationId: string
  companyId: string
  jobId: string
  status: string
  createdAt: string
  endedAt?: string
  endReason?: string
}
interface EmploymentRow {
  employmentId: string
  companyId: string
  projectId?: string
  startDate: string
  endDate?: string
  endReason?: string
  sourceCompanyIdSnapshot?: string
  isTransfer?: boolean | number
  origin?: string
}
interface Attribution {
  userId: string
  phoneMasked: string
  realNameMasked?: string | null
  userStatus: string
  sourceCompanyId?: string
  boundCompanyId?: string
  lastReleaseReason?: string
  kycStatus?: string
  registerChannelType?: string
  registerChannelCode?: string
  registeredAt?: string
  matchCycleCount?: number
  blacklistFlag?: boolean | number
  statusLog: StatusLogRow[]
  applications: ApplicationRow[]
  employments: EmploymentRow[]
}

const route = useRoute()
const router = useRouter()
const { label } = useDict()

const mode = ref<'phone' | 'userId'>(typeof route.query.userId === 'string' ? 'userId' : 'phone')
const keyword = ref(typeof route.query.userId === 'string' ? route.query.userId : '')
const data = shallowRef<Attribution | null>(null)
const loading = ref(false)
const error = ref('')
const tab = ref<'log' | 'apps' | 'emps'>('log')

async function search() {
  const k = keyword.value.trim()
  if (!k) {
    error.value = mode.value === 'phone' ? '请输入手机号' : '请输入用户 ID'
    return
  }
  if (mode.value === 'phone' && !/^1\d{10}$/.test(k)) {
    error.value = '请输入 11 位手机号'
    return
  }
  loading.value = true
  error.value = ''
  try {
    data.value = (await opsApi.attribution(mode.value === 'phone' ? { phone: k } : { userId: k })) as unknown as Attribution
    tab.value = 'log'
    if (mode.value === 'userId') void router.replace({ query: { userId: k } })
  } catch (e) {
    data.value = null
    error.value = errorMessage(e, '查询失败')
  } finally {
    loading.value = false
  }
}
if (keyword.value) void search()

const truthy = (v: unknown) => v === true || v === 1
const bindChanged = (r: StatusLogRow) => (r.boundBefore ?? '') !== (r.boundAfter ?? '')
const counts = computed(() => ({
  log: data.value?.statusLog.length ?? 0,
  apps: data.value?.applications.length ?? 0,
  emps: data.value?.employments.length ?? 0,
}))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>归属治理</h2>
        <p>查询求职者当前状态、来源公司 / 当前归属公司，以及完整的状态迁移日志 —— 用于归属争议的事实核查（查询行为写入审计日志）</p>
      </div>
      <div class="spacer" />
      <span class="ref">原型 <b>P-08</b></span>
    </div>

    <div class="card">
      <div class="toolbar">
        <el-radio-group v-model="mode" size="default">
          <el-radio-button value="phone">手机号</el-radio-button>
          <el-radio-button value="userId">用户 ID</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          clearable
          :placeholder="mode === 'phone' ? '完整 11 位手机号' : '用户 ID，如 U10001'"
          style="width: 260px"
          @keyup.enter="search"
        />
        <el-button type="primary" :loading="loading" @click="search">查询</el-button>
        <span v-if="error" class="err">{{ error }}</span>
      </div>

      <div v-if="!data" class="card__bd">
        <el-empty :image-size="64" description="输入手机号或用户 ID 查询归属" />
      </div>

      <div v-else class="card__bd">
        <div class="sum">
          <div class="who">
            <b>{{ data.realNameMasked ?? '未实名' }}</b>
            <span class="mono">{{ data.phoneMasked }}</span>
            <span class="mono dim">{{ data.userId }}</span>
            <span class="tag tag--signal">{{ label('UserStatus', data.userStatus) }}</span>
            <span v-if="truthy(data.blacklistFlag)" class="tag tag--danger">平台级失信</span>
          </div>
          <dl class="kv-grid">
            <div class="kv"><dt>当前归属公司</dt><dd class="mono">{{ data.boundCompanyId ?? '公域（无归属）' }}</dd></div>
            <div class="kv"><dt>来源公司</dt><dd class="mono">{{ data.sourceCompanyId ?? '—' }}</dd></div>
            <div class="kv"><dt>最近释放原因</dt><dd>{{ data.lastReleaseReason ? label('ReleaseReason', data.lastReleaseReason) : '—' }}</dd></div>
            <div class="kv"><dt>实名状态</dt><dd>{{ data.kycStatus ?? '—' }}</dd></div>
            <div class="kv">
              <dt>注册渠道</dt>
              <dd>{{ data.registerChannelType ? label('ChannelType', data.registerChannelType) : '—' }}<span v-if="data.registerChannelCode" class="mono dim"> · {{ data.registerChannelCode }}</span></dd>
            </div>
            <div class="kv"><dt>注册时间</dt><dd class="mono">{{ fmtDateTime(data.registeredAt) }}</dd></div>
            <div class="kv"><dt>匹配轮次</dt><dd class="mono">{{ data.matchCycleCount ?? 0 }}</dd></div>
          </dl>
        </div>

        <div class="filter-tabs tabs">
          <button type="button" :class="{ on: tab === 'log' }" @click="tab = 'log'">状态迁移日志<span class="n">{{ counts.log }}</span></button>
          <button type="button" :class="{ on: tab === 'apps' }" @click="tab = 'apps'">报名记录<span class="n">{{ counts.apps }}</span></button>
          <button type="button" :class="{ on: tab === 'emps' }" @click="tab = 'emps'">任职记录<span class="n">{{ counts.emps }}</span></button>
        </div>

        <template v-if="tab === 'log'">
          <el-empty v-if="data.statusLog.length === 0" :image-size="56" description="暂无状态迁移记录" />
          <ul v-else class="tl">
            <li v-for="(r, i) in data.statusLog" :key="i" :class="i === 0 ? 'now' : 'done'">
              <div class="tl-t">
                <span class="mono ev">{{ r.event }}</span>
                {{ r.fromStatus ? label('UserStatus', r.fromStatus) : '—' }} → {{ r.toStatus ? label('UserStatus', r.toStatus) : '—' }}
                <span v-if="bindChanged(r)" class="tag tag--warn">归属 {{ r.boundBefore ?? '公域' }} → {{ r.boundAfter ?? '公域' }}</span>
                <span v-if="r.releaseReason" class="tag">{{ label('ReleaseReason', r.releaseReason) }}</span>
              </div>
              <div class="tl-m">
                {{ fmtDateTime(r.createdAt) }} · {{ r.actorRole ? label('ActorRole', r.actorRole) : '系统' }}
                <template v-if="r.actorId"> {{ r.actorId }}</template>
                <template v-if="r.actorCompanyId"> @ {{ r.actorCompanyId }}</template>
              </div>
              <div v-if="r.remark" class="tl-r">{{ r.remark }}</div>
            </li>
          </ul>
        </template>

        <el-table v-else-if="tab === 'apps'" :data="data.applications" class="ops-table" row-key="applicationId">
          <el-table-column label="报名单" min-width="150"><template #default="{ row }"><span class="mono t-sm">{{ row.applicationId }}</span></template></el-table-column>
          <el-table-column label="公司 / 岗位" min-width="180">
            <template #default="{ row }"><span class="mono t-sm">{{ row.companyId }}</span><div class="t-xs mono">{{ row.jobId }}</div></template>
          </el-table-column>
          <el-table-column label="状态" width="110"><template #default="{ row }">{{ label('ApplicationStatus', row.status) }}</template></el-table-column>
          <el-table-column label="报名时间" width="150"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
          <el-table-column label="结束" min-width="180">
            <template #default="{ row }">
              <span class="mono t-sm">{{ fmtDateTime(row.endedAt) }}</span>
              <div v-if="row.endReason" class="t-xs">{{ row.endReason }}</div>
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="56" description="暂无报名记录" /></template>
        </el-table>

        <el-table v-else :data="data.employments" class="ops-table" row-key="employmentId">
          <el-table-column label="任职" min-width="150"><template #default="{ row }"><span class="mono t-sm">{{ row.employmentId }}</span></template></el-table-column>
          <el-table-column label="公司 / 项目" min-width="160">
            <template #default="{ row }"><span class="mono t-sm">{{ row.companyId }}</span><div class="t-xs mono">{{ row.projectId ?? '' }}</div></template>
          </el-table-column>
          <el-table-column label="在职期间" min-width="190">
            <template #default="{ row }">
              <span class="mono t-sm">{{ fmtDate(row.startDate) }} ~ {{ row.endDate ? fmtDate(row.endDate) : '至今' }}</span>
              <div v-if="row.endReason" class="t-xs">{{ row.endReason }}</div>
            </template>
          </el-table-column>
          <el-table-column label="来源公司（快照）" min-width="130"><template #default="{ row }"><span class="mono t-sm">{{ row.sourceCompanyIdSnapshot ?? '—' }}</span></template></el-table-column>
          <el-table-column label="流转" width="70"><template #default="{ row }">{{ yesNo(truthy(row.isTransfer)) }}</template></el-table-column>
          <el-table-column label="来源" width="100"><template #default="{ row }">{{ row.origin ? label('EmploymentOrigin', row.origin) : '—' }}</template></el-table-column>
          <template #empty><el-empty :image-size="56" description="暂无任职记录" /></template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.err { color: var(--danger); font-size: 12.5px; }
.sum { margin-bottom: 16px; }
.who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.who b { font-size: 16px; color: var(--ink-900); }
.tabs { margin-bottom: 12px; }
.ev { font-size: 11px; color: var(--ink-500); margin-right: 6px; }
.tl-t .tag { margin-left: 6px; }
</style>
