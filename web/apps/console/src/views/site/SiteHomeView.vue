<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type ApplicationInsight, type SiteApplication, type SiteApplicationAction, type SiteWorkbench } from '@shitu/api-client'
import { IconCalendar, IconCircleExclamationPoint, IconClock, IconInbox, IconShieldCheck, IconUsers } from '@shitu/ui-icons'
import AppActionButtons, { ACTION_LABEL } from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import DictTag from '@/components/DictTag.vue'
import { loadOpenApplications, stageText } from '@/composables/openApplications'
import { useNow } from '@/composables/useNow'
import { useMeStore } from '@/stores/me'
import { fmtDateTime, fmtPhone } from '@/utils/format'
import { countdownTone, fmtRemain, remainMs } from '@/utils/time'

/**
 * A-01 驻场工作台（T-101）：指标卡 + 左「今日待办」（按响应剩余排序、可按阶段筛选）+ 右选中人详情（进度、报名信息、
 * 匹配记录、求职画像、处理记录、操作按钮）。操作严格按 allowedActions，弹窗由 AppActionDialogs 统一处理。
 */
const router = useRouter()
const meStore = useMeStore()
const now = useNow()

const SHOW = 8
const wb = ref<SiteWorkbench | null>(null)
const wbError = ref('')
const list = ref<SiteApplication[]>([])
const loading = ref(false)
const todoError = ref('')
/** 待办拿到过数据（没拿到时阶段计数、「N 紧急」不显示数字） */
const ready = ref(false)
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)
/** 后端拒绝过的操作：这条报名的按钮置灰、原因留在详情里，刷新后重新判断 */
const blocked = reactive<Record<string, { action: SiteApplicationAction; text: string }>>({})

async function load() {
  loading.value = true
  wbError.value = ''
  todoError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  const [w, t] = await Promise.allSettled([tenantApi.siteWorkbench(), loadOpenApplications()])
  if (w.status === 'fulfilled') wb.value = w.value
  else {
    wb.value = null
    wbError.value = errorMessage(w.reason, '工作台数据加载失败')
  }
  if (t.status === 'fulfilled') {
    list.value = t.value.list
    ready.value = true
  } else {
    ready.value = false
    todoError.value = errorMessage(t.reason, '待办加载失败')
    list.value = []
  }
  loading.value = false
}
onMounted(load)

function go(path: string, query?: Record<string, string>) {
  router.push({ path, query })
}

// ---------------------------------------------------------------- 左列表：阶段筛选
// 与列表里每条的阶段文字（stageText）一一对应：报名后未推送 / 已推送待到厂 / 已到厂待面试结果 / 面试通过待确权
type Stage = 'all' | 'ack' | 'pushed' | 'arrived' | 'confirm'
function stageOf(a: SiteApplication): Exclude<Stage, 'all'> {
  if (a.status === 'PENDING_CONFIRM') return 'confirm'
  if (a.arrivedAt) return 'arrived'
  return a.acknowledgedAt ? 'pushed' : 'ack'
}
const STAGES: { key: Stage; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ack', label: '待知悉' },
  { key: 'pushed', label: '已推送' },
  { key: 'arrived', label: '已到厂' },
  { key: 'confirm', label: '待确权' },
]
const stage = ref<Stage>('all')
const stageCount = computed(() => {
  const c: Record<Stage, number> = { all: list.value.length, ack: 0, pushed: 0, arrived: 0, confirm: 0 }
  list.value.forEach((a) => c[stageOf(a)]++)
  return c
})
const filtered = computed(() => (stage.value === 'all' ? list.value : list.value.filter((a) => stageOf(a) === stage.value)))
const shown = computed(() => filtered.value.slice(0, SHOW))
/** 「N 紧急」：最紧急的 8 条里响应剩余不到 6 小时的（与改版前的今日待办表格一致，不随阶段筛选变） */
const urgent = computed(() => list.value.slice(0, SHOW).filter((a) => (remainMs(a.responseDeadline, now.value) ?? Infinity) < 6 * 3600_000).length)

function level(a: SiteApplication) {
  return countdownTone(remainMs(a.responseDeadline, now.value))
}
/** 窗口已用时长占比（24h 窗口），公域用户没有窗口 */
function used(a: SiteApplication): number {
  const ms = remainMs(a.responseDeadline, now.value)
  if (ms == null) return 0
  return Math.min(100, Math.max(2, Math.round((1 - ms / (24 * 3600_000)) * 100)))
}
function meta(a: SiteApplication) {
  return [a.jobTitle ?? '—', a.interviewAt ? `面试 ${fmtDateTime(a.interviewAt).slice(5)}` : '', stageText(a)].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------- 右详情
const selectedId = ref('')
const selected = computed(() => shown.value.find((a) => a.applicationId === selectedId.value) ?? shown.value[0] ?? null)
const insight = ref<ApplicationInsight | null>(null)
const insightLoading = ref(false)
const insightError = ref('')
async function loadInsight(id: string) {
  insight.value = null
  insightError.value = ''
  insightLoading.value = true
  try {
    const r = await tenantApi.applicationInsight(id)
    if (selected.value?.applicationId === id) insight.value = r
  } catch (e) {
    if (selected.value?.applicationId === id) insightError.value = errorMessage(e, '匹配记录加载失败')
  } finally {
    if (selected.value?.applicationId === id) insightLoading.value = false
  }
}
watch(() => selected.value?.applicationId, (id) => {
  if (id) void loadInsight(id)
  else insight.value = null
})

/** 进度：报名 → 知悉推送 → 到厂确认 → 面试通过 → 入职确权 → 电子签约；完成的写时间，进行中写「进行中」 */
const steps = computed(() => {
  const a = selected.value
  if (!a) return []
  const signing = !!a.contract || a.allowedActions.includes('RESEND_CONTRACT')
  const raw: { title: string; done: boolean; at?: string }[] = [
    { title: '报名', done: true, at: a.createdAt },
    { title: '知悉推送', done: !!a.acknowledgedAt, at: a.acknowledgedAt },
    { title: '到厂确认', done: !!a.arrivedAt, at: a.arrivedAt },
    { title: '面试通过', done: a.status === 'PENDING_CONFIRM' },
    // 报名上没有确权时间（合同是最近一份，重发后时间会变），完成只写「已完成」
    { title: '入职确权', done: signing },
    { title: '电子签约', done: !!a.contract?.signedAt, at: a.contract?.signedAt },
  ]
  const cur = raw.reduce((last, s, i) => (s.done ? i : last), 0) + 1
  return raw.map((s, i) => ({
    title: s.title,
    status: s.done ? ('success' as const) : i === cur ? ('process' as const) : ('wait' as const),
    desc: s.done ? (s.at ? fmtDateTime(s.at).slice(5) : '已完成') : i === cur ? '进行中' : '',
  }))
})

/** 处理记录：报名上记下的各个时间点，新的在上 */
const logs = computed(() => {
  const a = selected.value
  if (!a) return []
  const rows: { at: string; text: string }[] = [{ at: a.createdAt, text: '报名成功' }]
  if (a.acknowledgedAt) rows.push({ at: a.acknowledgedAt, text: '驻场知悉并推送面试信息' })
  if (a.notice?.pushedAt && a.acknowledgedAt && a.notice.pushedAt > a.acknowledgedAt) rows.push({ at: a.notice.pushedAt, text: '修改面试信息并重新推送' })
  if (a.arrivedAt) rows.push({ at: a.arrivedAt, text: '到厂确认' })
  // 和确权页一样，合同时间只说「发起」：重发签约后这是最近一次发起的时间和合同号
  if (a.contract) rows.push({ at: a.contract.createdAt, text: `发起电子签约（${a.contract.contractNo}）` })
  if (a.contract?.signedAt) rows.push({ at: a.contract.signedAt, text: '求职者完成电子签约' })
  return rows.sort((x, y) => (x.at < y.at ? 1 : -1))
})

function onRejected(action: SiteApplicationAction, app: SiteApplication, reason: string) {
  blocked[app.applicationId] = { action, text: `暂时不能${ACTION_LABEL[action]}：${reason}` }
}
</script>

<template>
  <div class="wb">
    <div class="page-hd">
      <div>
        <h2>驻场工作台</h2>
        <p>{{ meStore.me?.company.shortName || meStore.me?.company.name }} · {{ meStore.me?.name }}</p>
      </div>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
      <el-button type="primary" @click="go('/site/todo')">处理待办</el-button>
    </div>

    <!-- 失败只有一个「重新加载」：待办也失败时按钮在左列表的失败态里，这里只写原因 -->
    <div v-if="wbError" class="notice-bar notice-bar--danger wb-err" role="alert">
      <IconCircleExclamationPoint :size="16" class="notice-bar-i" />
      <span class="spacer">{{ wbError }}</span>
      <el-button v-if="!todoError" size="small" @click="load">重新加载</el-button>
    </div>
    <!-- 指标和分栏共用一个加载遮罩 -->
    <div v-loading="loading" class="wb-body">
    <div class="kpis">
      <button type="button" class="stat stat--link kpi" @click="go('/site/todo', { tab: 'ack' })">
        <IconInbox :size="20" class="kpi-i" />
        <div class="stat-l">待知悉</div>
        <div class="stat-v">{{ wb?.pendingAck ?? '—' }}</div>
        <div class="stat-d">新报名 · 需推送面试信息</div>
      </button>
      <button type="button" class="stat stat--link kpi" @click="go('/site/todo', { tab: 'interview' })">
        <IconCalendar :size="20" class="kpi-i" />
        <div class="stat-l">待面试</div>
        <div class="stat-v">{{ wb?.pendingInterview ?? '—' }}</div>
        <div class="stat-d">含待知悉</div>
      </button>
      <button type="button" class="stat stat--link kpi" @click="go('/site/onboard')">
        <IconShieldCheck :size="20" class="kpi-i" />
        <div class="stat-l">待确权</div>
        <div class="stat-v">{{ wb?.pendingConfirm ?? '—' }}</div>
        <div class="stat-d">面试通过 · 待签约</div>
      </button>
      <button type="button" class="stat stat--link kpi" :class="{ 'stat--danger kpi--alert': (wb?.windowsDueIn4h ?? 0) > 0 }" @click="go('/site/follow')">
        <IconClock :size="20" class="kpi-i" />
        <div class="stat-l">4 小时内到期</div>
        <div class="stat-v">{{ wb?.windowsDueIn4h ?? '—' }}</div>
        <div class="stat-d">24h 窗口 · 超时系统释放至公域</div>
      </button>
      <button type="button" class="stat stat--link kpi" @click="go('/site/follow')">
        <IconUsers :size="20" class="kpi-i" />
        <div class="stat-l">私域待匹配</div>
        <div class="stat-v">{{ wb?.privatePending ?? '—' }}</div>
        <div class="stat-d">注册后未报名 · 需跟进</div>
      </button>
    </div>

    <div class="work">
      <!-- 左：今日待办。面板高度跟着内容走，不撑到和右侧一样高（原型那处留白） -->
      <section class="card queue" aria-label="今日待办">
        <div class="q-hd">
          <h3>今日待办</h3>
          <span class="q-sub">按响应剩余时间排序</span>
          <span v-if="ready && urgent" class="status-tag status-tag--danger q-urgent">{{ urgent }} 紧急</span>
        </div>
        <div class="filter-tabs q-tabs" role="tablist">
          <button v-for="s in STAGES" :key="s.key" type="button" role="tab" :aria-selected="stage === s.key" :class="{ on: stage === s.key }" @click="stage = s.key">
            {{ s.label }}<span class="n">{{ ready ? stageCount[s.key] : '' }}</span>
          </button>
        </div>
        <div v-if="todoError" class="state">
          <IconCircleExclamationPoint :size="48" class="state-i" />
          <h4 class="state-t">{{ todoError }}</h4>
          <p class="state-d">请检查网络后重新加载</p>
          <el-button @click="load">重新加载</el-button>
        </div>
        <div v-else-if="!shown.length && !loading" class="state">
          <IconInbox :size="48" class="state-i" />
          <h4 class="state-t">{{ list.length ? '这个阶段没有待办' : '暂无待办，干得漂亮' }}</h4>
          <p class="state-d">新报名需在 24 小时内知悉，有新报名会出现在这里</p>
        </div>
        <ul v-else class="q-list">
          <li v-for="a in shown" :key="a.applicationId">
            <button type="button" class="q-item" :class="[{ on: selected?.applicationId === a.applicationId }, `lvl-${level(a)}`]" :aria-pressed="selected?.applicationId === a.applicationId" @click="selectedId = a.applicationId">
              <span class="who">
                <b class="who-n">{{ a.seekerName }}</b>
                <span class="status-tag" :class="a.fromPublic ? 'status-tag--public' : 'status-tag--private'">{{ a.fromPublic ? '公域' : '私域' }}</span>
                <span class="who-p">{{ a.phone ? fmtPhone(a.phone) : '—' }}</span>
              </span>
              <span class="meta">{{ meta(a) }}</span>
              <span class="time">
                <b>{{ a.responseDeadline ? fmtRemain(remainMs(a.responseDeadline, now)) : '—' }}</b>
                <span class="q-bar"><i :style="{ width: `${used(a)}%` }" /></span>
              </span>
            </button>
          </li>
        </ul>
        <div v-if="list.length" class="q-ft">
          <span>共 {{ filtered.length }} 条{{ filtered.length > SHOW ? `，显示最紧急的 ${SHOW} 条` : '' }}</span>
          <router-link to="/site/todo" class="q-all">查看全部 {{ list.length }} 条</router-link>
        </div>
      </section>

      <!-- 右：选中人详情 -->
      <section class="card detail" aria-label="报名详情">
        <!-- 加载中不下结论；待办加载失败时不说成「没有选中的报名」 -->
        <div v-if="todoError" class="state">
          <h4 class="state-t">暂时看不到报名详情</h4>
          <p class="state-d">待办没有加载出来，重新加载后点左侧一个人查看进度和处理</p>
        </div>
        <div v-else-if="!selected && !loading" class="state">
          <IconClock :size="48" class="state-i" />
          <h4 class="state-t">没有选中的报名</h4>
          <p class="state-d">左侧有待办时，点一个人在这里查看进度和处理</p>
        </div>
        <template v-else-if="selected">
          <!-- 详情内容自己滚动，操作区固定在卡片底部，不盖住内容 -->
          <div class="d-body">
          <div class="d-hd">
            <h3>{{ selected.seekerName }}</h3>
            <span class="d-phone">{{ selected.phone ? fmtPhone(selected.phone) : '—' }}</span>
            <span class="status-tag" :class="selected.fromPublic ? 'status-tag--public' : 'status-tag--private'">{{ selected.fromPublic ? '公域' : '私域' }}</span>
            <DictTag type="ApplicationStatus" :value="selected.status" />
            <span class="spacer" />
            <span class="d-left"><span class="d-left-l">响应剩余</span><RemainTag :deadline="selected.responseDeadline" :now="now" /></span>
          </div>
          <el-steps class="d-steps" align-center>
            <el-step v-for="s in steps" :key="s.title" :title="s.title" :status="s.status" :description="s.desc" />
          </el-steps>

          <div class="d-cols">
            <div class="d-blk">
              <h4>报名信息</h4>
              <dl class="dl">
                <dt>应聘岗位</dt><dd>{{ selected.jobTitle ?? '—' }}</dd>
                <dt>所属项目</dt><dd>{{ selected.projectName ?? '—' }}</dd>
                <dt>报名时间</dt><dd>{{ fmtDateTime(selected.createdAt) }}</dd>
                <dt>面试时间</dt><dd>{{ selected.interviewAt ? fmtDateTime(selected.interviewAt) : '未推送' }}</dd>
                <dt>面试地点</dt><dd>{{ selected.notice?.address || '—' }}</dd>
                <dt>当前阶段</dt><dd>{{ stageText(selected) || '—' }}</dd>
                <template v-if="selected.contract">
                  <dt>电子合同</dt><dd><DictTag type="ContractStatus" :value="selected.contract.status" /></dd>
                </template>
              </dl>
            </div>
            <div v-loading="insightLoading" class="d-blk">
              <h4>匹配记录</h4>
              <p v-if="insightError" class="hint">{{ insightError }} <el-button link type="primary" @click="loadInsight(selected.applicationId)">重新加载</el-button></p>
              <p v-else-if="insight && !insight.matchRecords.length" class="hint">没有匹配到本公司岗位的记录</p>
              <table v-else-if="insight" class="mini">
                <template v-for="(m, i) in insight.matchRecords" :key="i">
                  <tr v-for="j in m.jobs" :key="j.jobId">
                    <td><span :class="{ strong: j.appliedJob }">{{ j.title }}</span> · 匹配度 {{ Number(j.matchScore).toFixed(0) }}%</td>
                    <td>{{ fmtDateTime(m.matchedAt).slice(5) }}</td>
                  </tr>
                </template>
              </table>
            </div>
          </div>

          <div class="d-blk">
            <h4>求职画像</h4>
            <p v-if="insightError" class="hint">求职画像和匹配记录是一起取的，没有加载出来 <el-button link type="primary" @click="loadInsight(selected.applicationId)">重新加载</el-button></p>
            <p v-else-if="!insight" class="hint">—</p>
            <div v-else-if="insight.profileTags.length" class="chips"><span v-for="t in insight.profileTags" :key="t" class="status-tag">{{ t }}</span></div>
            <p v-else class="hint">没有答题记录（由驻场 / 经纪人推荐报名）</p>
          </div>

          <div class="d-blk">
            <h4>处理记录</h4>
            <ul class="log">
              <li v-for="(l, i) in logs" :key="i"><time>{{ fmtDateTime(l.at) }}</time><span>{{ l.text }}</span></li>
            </ul>
          </div>
          </div>

          <div class="d-acts">
            <p v-if="blocked[selected.applicationId]" class="blocked-why" role="status">{{ blocked[selected.applicationId].text }}</p>
            <AppActionButtons :app="selected" size="default" :blocked="blocked[selected.applicationId]?.action" @action="(a, r) => dialogs?.run(a, r)" />
          </div>
        </template>
      </section>
    </div>
    </div>

    <div class="extra">
      <div class="card">
        <div class="card__hd"><h3>快捷操作</h3></div>
        <div class="card__bd quick">
          <el-button @click="go('/site/todo', { tab: 'ack' })">知悉推送</el-button>
          <el-button @click="go('/site/todo', { tab: 'interview' })">到厂 / 面试结果</el-button>
          <el-button @click="go('/site/onboard')">入职确权</el-button>
          <el-button @click="go('/site/follow')">响应监控</el-button>
          <el-button @click="go('/broker/pool')">流转池</el-button>
          <el-button @click="go('/pm/staff')">人员管理</el-button>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>处理时限</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>新报名知悉</dt><dd>24 小时内</dd></dl>
          <dl class="kv"><dt>面试通过 → 确权</dt><dd>24 小时内</dd></dl>
          <dl class="kv"><dt>超时后果</dt><dd class="danger">系统释放至公域</dd></dl>
          <p class="hint limits-note">公域用户不触发 24 小时响应窗口；倒计时以系统记录的截止时间为准。</p>
        </div>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.wb-err { align-items: center; margin-bottom: var(--space-4); }
.wb-body { position: relative; }

/* 指标卡：标题、26px 大数字、一行说明，右上角图标；异常卡数字和图标用危险色 */
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: auto auto auto; gap: 0 var(--space-gap); }
/* 每张卡占三行并继承外层行高（subgrid）：1280 宽下某张卡的标题折成两行时，各卡的大数字仍在同一条线上 */
.kpi { position: relative; display: grid; grid-row: span 3; grid-template-rows: subgrid; align-content: start; width: 100%; padding: var(--space-4); text-align: left; font: inherit; cursor: pointer; min-width: 0; }
.kpi:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
/* 给右上角 20px 的图标让位 */
.kpi .stat-l { padding-right: var(--space-6); }
/* 说明放不下时折行，不截断（subgrid 让各卡的说明行一样高） */
.kpi .stat-d { min-width: 0; }
.kpi-i { position: absolute; top: var(--space-4); right: var(--space-4); color: var(--primary); }
.kpi--alert .kpi-i { color: var(--danger-text); }

.work { display: grid; grid-template-columns: 400px minmax(0, 1fr); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }

/* 左列表 */
.queue { display: flex; flex-direction: column; min-width: 0; }
.q-hd { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-4) var(--space-4) 0; }
.q-hd h3 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.q-sub { font-size: var(--font-size-aux); color: var(--text-3); }
.q-urgent { margin-left: auto; align-self: center; }
.q-tabs { flex-wrap: nowrap; margin: var(--space-3) var(--space-4) 0; padding-bottom: var(--space-3); border-bottom: 1px solid var(--divider); }
.q-list { list-style: none; margin: 0; padding: 0; }
.q-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2) var(--space-3); width: 100%; padding: var(--space-3) var(--space-4); border: 0; border-bottom: 1px solid var(--divider); background: var(--bg-card); text-align: left; font: inherit; color: var(--text-1); cursor: pointer; }
.q-item:hover { background: var(--bg-hover); }
.q-item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.q-item.on { background: var(--primary-bg); }
.q-item.on .who-n { color: var(--primary-text); }
.who { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.who-n { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); white-space: nowrap; }
.who-p { font-size: var(--font-size-aux); color: var(--text-2); white-space: nowrap; }
.meta { grid-column: 1; font-size: var(--font-size-aux); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time { grid-row: 1 / span 2; grid-column: 2; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: var(--space-2); }
.time b { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); white-space: nowrap; }
.q-bar { width: 64px; height: 4px; border-radius: 2px; background: var(--bg-fill); overflow: hidden; }
.q-bar i { display: block; height: 100%; border-radius: 2px; background: var(--chart-6); }
.lvl-danger .time b { color: var(--danger-text); }
.lvl-danger .q-bar i { background: var(--danger-solid); }
.lvl-warn .time b { color: var(--warning-text); }
.lvl-warn .q-bar i { background: var(--warning-solid); }
.q-ft { display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); font-size: var(--font-size-aux); color: var(--text-3); }
.q-all { color: var(--primary-text); font-weight: var(--font-weight-medium); }
.q-all:hover { text-decoration: underline; }

/* 第 13 类：空 / 失败 */
.state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) var(--space-4); text-align: center; }
.state-i { color: var(--text-3); }
.state-t { margin: var(--space-2) 0 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.state-d { margin: 0 0 var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }

/* 右详情 */
/* 详情卡高度到可视区底部为止（294 = 详情卡上沿约 270 + 底部留 24），内容在 .d-body 里滚动，操作区固定在卡片底部 */
.detail { display: flex; flex-direction: column; min-width: 0; max-height: max(440px, calc(100vh - 294px)); }
.d-body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-5) var(--space-6) var(--space-6); }
.d-hd { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
.d-hd h3 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.d-phone { font-size: var(--font-size-body); color: var(--text-2); }
.d-left { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); }
.d-left-l { color: var(--text-3); }
.d-steps { margin: var(--space-6) 0 var(--space-2); }
.d-steps :deep(.el-step__title) { font-size: var(--font-size-aux); }
.d-steps :deep(.el-step__description) { font-size: var(--font-size-min); white-space: nowrap; padding: 0; margin-top: var(--space-1); }
.d-steps :deep(.el-step__title.is-process), .d-steps :deep(.el-step__description.is-process) { color: var(--primary-text); font-weight: var(--font-weight-medium); }
.d-steps :deep(.el-step__head.is-process) { color: var(--primary); border-color: var(--primary); }
.d-steps :deep(.el-step__title.is-wait), .d-steps :deep(.el-step__head.is-wait) { color: var(--text-3); border-color: var(--border); }
.d-cols { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: var(--space-8); }
.d-blk { margin-top: var(--space-6); min-width: 0; }
.d-blk h4 { margin: 0 0 var(--space-3); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.dl { display: grid; grid-template-columns: 72px minmax(0, 1fr); row-gap: var(--space-2); column-gap: var(--space-3); margin: 0; font-size: var(--font-size-body); }
.dl dt { color: var(--text-2); }
.dl dd { margin: 0; color: var(--text-1); }
.hint { margin: 0; font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
.mini { width: 100%; border-collapse: collapse; font-size: var(--font-size-aux); }
.mini td { padding: var(--space-2) 0; border-bottom: 1px solid var(--divider); color: var(--text-2); }
.mini td:last-child { text-align: right; color: var(--text-3); white-space: nowrap; padding-left: var(--space-3); }
.mini .strong { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.log { list-style: none; margin: 0; padding: 0; }
.log li { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-1) 0; font-size: var(--font-size-body); color: var(--text-2); }
.log time { color: var(--text-3); }
/* 底部操作区：在详情卡底部，不随内容滚动 */
.d-acts { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-2); padding: var(--space-4) var(--space-6); border-top: 1px solid var(--divider); }

/* 快捷操作、处理时限 */
.extra { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); }
.quick { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.quick .el-button + .el-button { margin-left: 0; }
.danger { color: var(--danger-text); }
.limits-note { margin-top: var(--space-3); }
</style>
