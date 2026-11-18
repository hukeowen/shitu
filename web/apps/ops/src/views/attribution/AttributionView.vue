<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, opsApi, useDict } from '@shitu/api-client'
import { IconInbox, IconSearch, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { isNetwork } from '@/composables/boxSubmit'
import { fmtDate, fmtDateTime, yesNo } from '@/utils/format'
import AttributionDisputes from './AttributionDisputes.vue'

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
/** 条件没填对（查询卡片里字段下方） */
const inputError = ref('')
/** 查询结果区的三种情况之外：查不到（写明原因）、加载失败（断网与否分文案） */
const notFound = ref('')
const error = ref('')
const offline = ref(false)
/** 最近一次发出的查询，「重新加载」照它再查 */
const asked = ref<{ mode: 'phone' | 'userId'; k: string } | null>(null)
const tab = ref<'log' | 'apps' | 'emps'>('log')

function search() {
  const k = keyword.value.trim()
  if (!k) {
    inputError.value = mode.value === 'phone' ? '请输入手机号' : '请输入用户 ID'
    return
  }
  if (mode.value === 'phone' && !/^1\d{10}$/.test(k)) {
    inputError.value = '请输入 11 位手机号'
    return
  }
  void run({ mode: mode.value, k })
}

async function run(q: { mode: 'phone' | 'userId'; k: string }) {
  asked.value = q
  loading.value = true
  inputError.value = ''
  notFound.value = ''
  error.value = ''
  offline.value = false
  // 换了条件就不留上一次的结果，加载中只显示遮罩
  data.value = null
  try {
    data.value = (await opsApi.attribution(q.mode === 'phone' ? { phone: q.k } : { userId: q.k })) as unknown as Attribution
    tab.value = 'log'
    if (q.mode === 'userId') void router.replace({ query: { userId: q.k } })
  } catch (e) {
    if (isApiError(e, 'SYS_4040')) notFound.value = q.mode === 'phone' ? `手机号 ${q.k} 没有注册过求职者账号，请核对号码是否完整` : `用户 ID「${q.k}」不存在，请核对后再查`
    else {
      error.value = errorMessage(e, '查询失败')
      offline.value = isNetwork(e)
    }
  } finally {
    loading.value = false
  }
}
if (keyword.value) search()

function retry() {
  if (asked.value) void run(asked.value)
}

/** 从待处理争议列表点用户 ID：直接按用户 ID 查询 */
function openUser(userId: string) {
  mode.value = 'userId'
  keyword.value = userId
  search()
}

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
        <p>查询求职者当前状态、来源公司 / 当前归属公司与完整的状态迁移日志，登记归属争议并记录核查结论（查询行为写入审计日志）</p>
      </div>
    </div>

    <div class="card query">
      <div class="query-row">
        <el-radio-group v-model="mode" @change="inputError = ''">
          <el-radio-button value="phone">手机号</el-radio-button>
          <el-radio-button value="userId">用户 ID</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          clearable
          class="query-input"
          :placeholder="mode === 'phone' ? '完整 11 位手机号' : '用户 ID，如 U10001'"
          @input="inputError = ''"
          @keyup.enter="search"
        />
        <el-button type="primary" :loading="loading" @click="search">查询</el-button>
      </div>
      <p v-if="inputError" class="form-err query-err" role="alert">{{ inputError }}</p>
    </div>

    <div v-loading="loading" class="card result">
      <div v-if="loading" class="result-wait" />
      <div v-else-if="notFound" class="state-box">
        <IconInbox :size="48" />
        <h4>没有找到这个求职者</h4>
        <p>{{ notFound }}</p>
      </div>
      <div v-else-if="error" class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>查询失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" @click="retry">重新加载</el-button>
      </div>
      <div v-else-if="!data" class="state-box">
        <IconSearch :size="48" />
        <h4>输入手机号或用户 ID 查询归属</h4>
        <p>查到后显示当前状态、来源公司与当前归属、状态迁移日志、报名与任职记录</p>
      </div>

      <div v-else class="card__bd">
        <section class="blk">
          <div class="who">
            <b>{{ data.realNameMasked ?? '未实名' }}</b>
            <span class="who-m">{{ data.phoneMasked }}</span>
            <span class="who-m">{{ data.userId }}</span>
            <span class="status-tag status-tag--info">{{ label('UserStatus', data.userStatus) }}</span>
            <span v-if="truthy(data.blacklistFlag)" class="status-tag status-tag--danger">平台级失信</span>
          </div>
          <dl class="desc-list">
            <div><dt>当前归属公司</dt><dd>{{ data.boundCompanyId ?? '公域（无归属）' }}</dd></div>
            <div><dt>来源公司</dt><dd>{{ data.sourceCompanyId ?? '—' }}</dd></div>
            <div><dt>最近释放原因</dt><dd>{{ data.lastReleaseReason ? label('ReleaseReason', data.lastReleaseReason) : '—' }}</dd></div>
            <div><dt>实名状态</dt><dd>{{ data.kycStatus ?? '—' }}</dd></div>
            <div>
              <dt>注册渠道</dt>
              <dd>{{ data.registerChannelType ? label('ChannelType', data.registerChannelType) : '—' }}<span v-if="data.registerChannelCode" class="dim"> · {{ data.registerChannelCode }}</span></dd>
            </div>
            <div><dt>注册时间</dt><dd>{{ fmtDateTime(data.registeredAt) }}</dd></div>
            <div><dt>匹配轮次</dt><dd>{{ data.matchCycleCount ?? 0 }}</dd></div>
          </dl>
        </section>

        <section class="blk">
          <div class="filter-tabs tabs">
            <button type="button" :class="{ on: tab === 'log' }" @click="tab = 'log'">状态迁移日志<span class="n">{{ counts.log }}</span></button>
            <button type="button" :class="{ on: tab === 'apps' }" @click="tab = 'apps'">报名记录<span class="n">{{ counts.apps }}</span></button>
            <button type="button" :class="{ on: tab === 'emps' }" @click="tab = 'emps'">任职记录<span class="n">{{ counts.emps }}</span></button>
          </div>

          <template v-if="tab === 'log'">
            <div v-if="data.statusLog.length === 0" class="state-box">
              <IconInbox :size="48" />
              <h4>暂无状态迁移记录</h4>
              <p>这个求职者注册后状态还没有变化过</p>
            </div>
            <ul v-else class="tl">
              <li v-for="(r, i) in data.statusLog" :key="i" :class="i === 0 ? 'now' : 'done'">
                <div class="tl-t">
                  <span class="ev">{{ r.event }}</span>
                  {{ r.fromStatus ? label('UserStatus', r.fromStatus) : '—' }} → {{ r.toStatus ? label('UserStatus', r.toStatus) : '—' }}
                  <span v-if="bindChanged(r)" class="status-tag status-tag--warning">归属 {{ r.boundBefore ?? '公域' }} → {{ r.boundAfter ?? '公域' }}</span>
                  <span v-if="r.releaseReason" class="status-tag">{{ label('ReleaseReason', r.releaseReason) }}</span>
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

          <el-table v-else-if="tab === 'apps'" :data="data.applications" class="ops-table tbl-48" row-key="applicationId">
            <el-table-column label="报名单" min-width="150"><template #default="{ row }">{{ row.applicationId }}</template></el-table-column>
            <el-table-column label="公司 / 岗位" min-width="150">
              <template #default="{ row }">{{ row.companyId }}<div class="t-xs">{{ row.jobId }}</div></template>
            </el-table-column>
            <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag type="ApplicationStatus" :value="row.status" /></template></el-table-column>
            <el-table-column label="报名时间" width="150"><template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template></el-table-column>
            <el-table-column label="结束" min-width="180">
              <template #default="{ row }">
                {{ fmtDateTime(row.endedAt) }}
                <div v-if="row.endReason" class="t-xs">{{ row.endReason }}</div>
              </template>
            </el-table-column>
            <template #empty><div class="state-box"><IconInbox :size="48" /><h4>暂无报名记录</h4><p>这个求职者还没有报过名</p></div></template>
          </el-table>

          <el-table v-else :data="data.employments" class="ops-table tbl-48" row-key="employmentId">
            <el-table-column label="任职" min-width="150"><template #default="{ row }">{{ row.employmentId }}</template></el-table-column>
            <el-table-column label="公司 / 项目" min-width="140">
              <template #default="{ row }">{{ row.companyId }}<div class="t-xs">{{ row.projectId ?? '' }}</div></template>
            </el-table-column>
            <el-table-column label="在职期间" min-width="200">
              <template #default="{ row }">
                {{ fmtDate(row.startDate) }} ~ {{ row.endDate ? fmtDate(row.endDate) : '至今' }}
                <div v-if="row.endReason" class="t-xs">{{ row.endReason }}</div>
              </template>
            </el-table-column>
            <el-table-column label="来源公司（快照）" min-width="140"><template #default="{ row }">{{ row.sourceCompanyIdSnapshot ?? '—' }}</template></el-table-column>
            <el-table-column label="流转" width="70"><template #default="{ row }">{{ yesNo(truthy(row.isTransfer)) }}</template></el-table-column>
            <el-table-column label="来源" width="100"><template #default="{ row }">{{ row.origin ? label('EmploymentOrigin', row.origin) : '—' }}</template></el-table-column>
            <template #empty><div class="state-box"><IconInbox :size="48" /><h4>暂无任职记录</h4><p>这个求职者还没有入职过</p></div></template>
          </el-table>
        </section>
      </div>
    </div>

    <AttributionDisputes :user-id="data?.userId" @open="openUser" />
  </div>
</template>

<style scoped>
.query { padding: var(--space-4); }
.query-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.query-input { width: 260px; }
.query-err { margin-top: var(--space-2); }
.result { margin-top: var(--space-gap); }
/* 加载中给遮罩留出高度 */
.result-wait { height: 240px; }
.who { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4); }
.who b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.who-m { font-size: var(--font-size-aux); color: var(--text-2); font-variant-numeric: tabular-nums; }
.tabs { margin-bottom: var(--space-3); }
.ev { font-size: var(--font-size-min); font-weight: var(--font-weight-regular); color: var(--text-3); margin-right: var(--space-1); }
.tl-t .status-tag { margin-left: var(--space-1); }
</style>
