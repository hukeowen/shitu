<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { errorMessage, tenantApi, type SiteApplication, type SiteApplicationAction, type SiteWorkbench, type TimeoutReleases } from '@shitu/api-client'
import { IconCircleCheck, IconCircleExclamationPoint, IconClock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppActionButtons, { ACTION_LABEL, actionsColWidth } from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { loadOpenApplications, stageText } from '@/composables/openApplications'
import { useNow } from '@/composables/useNow'
import { useProjects } from '@/composables/useProjects'
import { fmtDateTime, fmtPhone } from '@/utils/format'
import { remainMs } from '@/utils/time'

/**
 * A-03 24 小时响应监控（T-102）：按 SiteApplication.responseDeadline 分档 <1h / 1–6h / 6–24h。
 * 只有私域用户有响应窗口；尚未报名的「私域待匹配」用户当前接口不返回明细，只显示工作台汇总数。
 */
type Bucket = '' | 'h1' | 'h6' | 'h24'
const H = 3600_000
const now = useNow(15_000)
const { projects } = useProjects()

const projectId = ref('')
const bucket = ref<Bucket>('')
const all = ref<SiteApplication[]>([])
const truncated = ref(false)
const wb = ref<SiteWorkbench | null>(null)
const loading = ref(false)
const loadError = ref('')
/** 报名明细拿到过数据（没拿到时分档卡和页签不显示数字，超时释放条也不下结论） */
const ready = ref(false)
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)
/** 后端拒绝过的操作：这条报名被拒的那个按钮置灰、原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, { name: string; action: SiteApplicationAction; text: string }>>({})
function onRejected(action: SiteApplicationAction, app: SiteApplication, reason: string) {
  blocked[app.applicationId] = { name: app.seekerName, action, text: `暂时不能${ACTION_LABEL[action]}：${reason}` }
}

/** 有窗口的报名（公域用户没有 responseDeadline） */
const windowed = computed(() => all.value.filter((a) => a.responseDeadline))
function bucketOf(a: SiteApplication): Bucket {
  const ms = remainMs(a.responseDeadline, now.value) ?? Infinity
  if (ms < H) return 'h1'
  if (ms < 6 * H) return 'h6'
  return 'h24'
}
const counts = computed(() => {
  const c = { h1: 0, h6: 0, h24: 0 }
  windowed.value.forEach((a) => {
    const b = bucketOf(a)
    if (b) c[b]++
  })
  return c
})
const rows = computed(() => (bucket.value ? windowed.value.filter((a) => bucketOf(a) === bucket.value) : windowed.value))
const opsWidth = computed(() => actionsColWidth(rows.value))

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    const [r, w] = await Promise.all([loadOpenApplications(projectId.value), tenantApi.siteWorkbench().catch(() => null)])
    all.value = r.list
    ready.value = true
    truncated.value = r.truncated
    wb.value = w
  } catch (e) {
    loadError.value = errorMessage(e, '响应窗口加载失败')
    ready.value = false
    all.value = []
  } finally {
    loading.value = false
  }
}
watch(projectId, load)
onMounted(load)

/** 本月超时释放与获客损失（T-102） */
const timeouts = ref<TimeoutReleases | null>(null)
onMounted(async () => {
  try {
    timeouts.value = await tenantApi.timeoutReleases()
  } catch {
    timeouts.value = null
  }
})

/** 进度条：窗口已用时长占比（24h 窗口） */
function used(a: SiteApplication): number {
  const ms = remainMs(a.responseDeadline, now.value) ?? 24 * H
  return Math.min(100, Math.max(2, Math.round((1 - ms / (24 * H)) * 100)))
}
function barClass(a: SiteApplication) {
  const b = bucketOf(a)
  return b === 'h1' ? 'danger' : b === 'h6' ? 'warn' : 'sig'
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>24 小时响应监控</h2>
        <p>私域用户专属转化窗口 · 超时系统被动释放至公域</p>
      </div>
      <span class="spacer" />
      <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
        <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
      </el-select>
      <el-button @click="load">刷新</el-button>
    </div>

    <div v-loading="loading" class="stats">
      <!-- 只有异常卡（有不到 1 小时的）数字用危险色，为 0 不算异常 -->
      <button type="button" class="stat stat--link st" :class="{ 'stat--danger': ready && counts.h1 > 0 }" @click="bucket = 'h1'">
        <div class="stat-l">&lt; 1 小时（含已超时）</div>
        <div class="stat-v">{{ ready ? counts.h1 : '—' }}</div>
        <div class="stat-d">立即处理</div>
      </button>
      <button type="button" class="stat stat--link st" @click="bucket = 'h6'">
        <div class="stat-l">1–6 小时</div>
        <div class="stat-v">{{ ready ? counts.h6 : '—' }}</div>
        <div class="stat-d">优先跟进</div>
      </button>
      <button type="button" class="stat stat--link st" @click="bucket = 'h24'">
        <div class="stat-l">6–24 小时</div>
        <div class="stat-v">{{ ready ? counts.h24 : '—' }}</div>
        <div class="stat-d">正常窗口</div>
      </button>
      <div class="stat st">
        <div class="stat-l">私域待匹配（未报名）</div>
        <div class="stat-v">{{ wb?.privatePending ?? '—' }}</div>
        <div class="stat-d">4 小时内到期窗口 {{ wb?.windowsDueIn4h ?? '—' }} 个（全公司）</div>
      </div>
    </div>

    <div v-if="timeouts && ready" class="notice-bar released" :class="timeouts.released > 0 ? 'notice-bar--warn' : 'notice-bar--ok'">
      <template v-if="timeouts.released > 0">
        <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
        <span>本月已有 <b>{{ timeouts.released }}</b> 人因超时被释放到公域（上月 {{ timeouts.releasedLastMonth }} 人），其中 <b>{{ timeouts.ownLeadsLost }}</b> 人是本公司自己引流来的 —— 释放后其他公司可以直接匹配。</span>
      </template>
      <template v-else><IconCircleCheck :size="16" class="notice-bar-i" /><span>本月还没有人因超时被释放（上月 {{ timeouts.releasedLastMonth }} 人）。</span></template>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="bucket === ''" :class="{ on: bucket === '' }" @click="bucket = ''">全部<span class="n">{{ ready ? windowed.length : '' }}</span></button>
          <button type="button" role="tab" :aria-selected="bucket === 'h1'" :class="{ on: bucket === 'h1' }" @click="bucket = 'h1'">&lt;1h<span class="n">{{ ready ? counts.h1 : '' }}</span></button>
          <button type="button" role="tab" :aria-selected="bucket === 'h6'" :class="{ on: bucket === 'h6' }" @click="bucket = 'h6'">1–6h<span class="n">{{ ready ? counts.h6 : '' }}</span></button>
          <button type="button" role="tab" :aria-selected="bucket === 'h24'" :class="{ on: bucket === 'h24' }" @click="bucket = 'h24'">6–24h<span class="n">{{ ready ? counts.h24 : '' }}</span></button>
        </div>
        <span class="spacer" />
        <span class="t-sm">按剩余时长升序</span>
      </div>
      <div v-if="truncated" class="notice-bar notice-bar--warn tbl-tip"><IconTriangleExclamationPoint :size="16" class="notice-bar-i" /><span>报名较多，每个状态仅显示响应窗口最紧的 100 条</span></div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ b.name }}（{{ id }}）{{ b.text }}。刷新后重新判断</p>
      <el-table v-loading="loading" :data="rows" row-key="applicationId">
        <el-table-column label="求职者" min-width="148">
          <template #default="{ row }"><PersonCell :name="row.seekerName" accent :sub="row.phone ? fmtPhone(row.phone) : undefined" /></template>
        </el-table-column>
        <el-table-column label="阶段" min-width="150">
          <template #default="{ row }">
            <DictTag type="ApplicationStatus" :value="row.status" />
            <div class="t-xs">{{ stageText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="岗位" min-width="140">
          <template #default="{ row }"><span class="job-t">{{ row.jobTitle }}</span><div class="t-xs">{{ row.projectName }}</div></template>
        </el-table-column>
        <el-table-column label="剩余" width="112">
          <template #default="{ row }"><RemainTag :deadline="row.responseDeadline" :now="now" /></template>
        </el-table-column>
        <el-table-column label="窗口进度" width="128">
          <template #default="{ row }">
            <div class="bar"><i :class="barClass(row)" :style="{ width: `${used(row)}%` }" /></div>
            <div class="t-xs due">截止 {{ fmtDateTime(row.responseDeadline).slice(5) }}</div>
          </template>
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
            <IconClock :size="48" class="tbl-state-i" />
            <h4>没有进行中的响应窗口</h4>
            <p>私域用户报名后的 24 小时窗口会出现在这里，按剩余时长升序</p>
          </div>
        </template>
      </el-table>
      <div class="card__ft t-xs">
        尚未报名的「私域待匹配」用户（当前 {{ wb?.privatePending ?? '—' }} 人）也有 24h 窗口，请在驻场手机端「私域待匹配」里查看并拨打 / 流转经纪人。
      </div>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>机制说明</h3></div>
        <div class="card__bd">
          <p class="para">劳务公司获客成本 <b>300–800 元/人</b>。蓝领求职者 1–2 天必须定去向，超 24 小时无人联系大概率流失。</p>
          <dl class="kv"><dt>适用范围</dt><dd>仅私域用户</dd></dl>
          <dl class="kv"><dt>时间窗口</dt><dd>每阶段完成后 24 小时内</dd></dl>
          <dl class="kv"><dt>匹配范围锁定</dt><dd>仅本公司岗位</dd></dl>
          <dl class="kv"><dt>推送对象</dt><dd>驻场 / 项目经理 / 老板</dd></dl>
          <dl class="kv"><dt>超时后果</dt><dd class="danger">系统被动释放为公域</dd></dl>
          <p class="hint">公域用户不触发 24 小时响应 —— 不属于任何公司，无需保护特定公司权益。</p>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>释放后的权益保留</h3></div>
        <div class="card__bd">
          <p class="para">释放只清空当前归属（bound），<b>来源归属（source）永久不变</b>。该用户后续入职任意公司，本公司仍得人才流转费 8 元/人/天。</p>
        </div>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.st { display: block; width: 100%; padding: var(--space-4); text-align: left; font: inherit; min-width: 0; }
button.st:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.released { margin-top: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.job-t { font-size: var(--font-size-aux); color: var(--text-1); }
.due { margin-top: var(--space-1); }
.tbl-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) 0; line-height: 1.6; }
.tbl-state-i { color: var(--text-3); }
.tbl-state h4 { margin: var(--space-2) 0 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tbl-state p { margin: 0 0 var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.para { margin-bottom: var(--space-3); font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-2); }
.para b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.danger { color: var(--danger-text); }
.hint { margin-top: var(--space-3); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
</style>
