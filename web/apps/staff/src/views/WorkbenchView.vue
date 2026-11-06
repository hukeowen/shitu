<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type SiteApplication, type SiteWorkbench } from '@shitu/api-client'
import { useNow } from '@/composables/useNow'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { fmtTime } from '@/utils/time'

/** M-01 驻场工作台：24h 超时告警、待办数字（待知悉 / 待面试 / 待确权 / 私域待匹配）、今日待办、消息入口 */
const auth = useAuthStore()
const inbox = useInboxStore()
const router = useRouter()
const now = useNow(60_000)
const { label } = useDict()
const me = computed(() => auth.me)
const loading = ref(false)
const loadError = ref('')

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    const m = await auth.loadMe()
    if (!m.operational) await router.replace('/notice')
    else void loadData()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const roleText = computed(() => (me.value?.roles ?? []).map((r) => label('ActorRole', r)).join(' / '))
const companyName = computed(() => me.value?.company.shortName || me.value?.company.name || '')
const canMyCode = computed(() => auth.can('CHANNEL_MINE'))
/** 报名列表接口只对驻场 / 项目经理开放 */
const canApps = computed(() => (me.value?.roles ?? []).some((r) => r === 'SITE' || r === 'PM'))

const greeting = computed(() => {
  const h = new Date(now.value).getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

// ---------- 数据 ----------
const wb = ref<SiteWorkbench | null>(null)
const wbError = ref('')
const todayList = shallowRef<SiteApplication[]>([])
const todayLoaded = ref(false)
const refreshing = ref(false)

async function loadData() {
  void inbox.refresh()
  const tasks: Promise<unknown>[] = [
    tenantApi
      .siteWorkbench()
      .then((w) => {
        wb.value = w
        wbError.value = ''
      })
      .catch((e: unknown) => {
        wbError.value = isApiError(e) && e.status === 403 ? '' : errorMessage(e, '待办数字加载失败')
      }),
  ]
  if (canApps.value) {
    tasks.push(
      tenantApi
        .applications({ status: 'PENDING_INTERVIEW', unacknowledged: true, page: 1, pageSize: 3 })
        .then((r) => (todayList.value = r.records))
        .catch(() => (todayList.value = []))
        .finally(() => (todayLoaded.value = true)),
    )
  }
  await Promise.all(tasks)
}

async function onRefresh() {
  try {
    if (!auth.me) await reload()
    else await loadData()
  } finally {
    refreshing.value = false
  }
}

if (!auth.me) void reload()
else if (auth.operational) void loadData()

const n = (v: number | undefined) => (wb.value ? String(v ?? 0) : '—')

interface Kpi {
  key: string
  title: string
  value: string
  to?: string
  hint?: string
}
const kpis = computed<Kpi[]>(() => [
  { key: 'ack', title: '待知悉', value: n(wb.value?.pendingAck), to: '/todo?tab=ack' },
  { key: 'interview', title: '待面试', value: n(wb.value?.pendingInterview), to: '/todo?tab=interview' },
  { key: 'confirm', title: '待确权', value: n(wb.value?.pendingConfirm), to: '/todo?tab=confirm' },
  { key: 'private', title: '私域待匹配', value: n(wb.value?.privatePending), hint: '私域待匹配名单即将上线' },
])

function goKpi(k: Kpi) {
  if (!k.to) {
    showToast(k.hint ?? '即将上线')
    return
  }
  if (!canApps.value) {
    showToast('报名待办仅对驻场 / 项目经理开放')
    return
  }
  void router.push(k.to)
}

const due = computed(() => wb.value?.windowsDueIn4h ?? 0)

interface Entry {
  key: string
  title: string
  desc: string
  icon: string
  to?: string
  count?: number
}
const entries = computed<Entry[]>(() => [
  { key: 'interview', title: '待面试', desc: '已报名待面试', icon: 'calendar-o', to: '/todo?tab=interview', count: wb.value?.pendingInterview },
  { key: 'confirm', title: '待确权', desc: '已到厂待确权', icon: 'passed', to: '/todo?tab=confirm', count: wb.value?.pendingConfirm },
  { key: 'arrive', title: '今日到厂', desc: '到厂确认', icon: 'location-o' },
  { key: 'advance', title: '预支初审', desc: '待你初审', icon: 'balance-o' },
])

function goEntry(e: Entry) {
  if (!e.to) {
    showToast('即将上线')
    return
  }
  if (!canApps.value) {
    showToast('报名待办仅对驻场 / 项目经理开放')
    return
  }
  void router.push(e.to)
}

const nowDate = computed(() => new Date(now.value))
</script>

<template>
  <div class="wb">
    <van-pull-refresh v-if="me" v-model="refreshing" @refresh="onRefresh">
      <header class="hero">
        <div class="hero-top">
          <div class="avatar avatar--o">{{ me.name.slice(0, 1) }}</div>
          <div class="who">
            <b>{{ greeting }}，{{ me.name }}</b>
            <span class="sub">{{ companyName }}<template v-if="roleText"> · {{ roleText }}</template></span>
          </div>
          <router-link to="/messages" class="bell" aria-label="消息通知">
            <van-badge :content="inbox.unread > 0 ? inbox.unread : undefined" :max="99">
              <van-icon name="bell" size="22" />
            </van-badge>
          </router-link>
        </div>
        <div class="hero-meta kpis">
          <button v-for="k in kpis" :key="k.key" type="button" class="kpi" @click="goKpi(k)">
            {{ k.title }}<b class="num">{{ k.value }}<small v-if="wb"> 人</small></b>
          </button>
        </div>
      </header>

      <div class="pad stack">
        <p v-if="wbError" class="note err">{{ wbError }}，下拉可重试</p>

        <section v-if="due > 0" class="acard alarm">
          <div class="row" style="gap: 11px">
            <div class="ring">
              <svg width="52" height="52" aria-hidden="true">
                <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(174,43,34,.16)" stroke-width="5" />
                <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="26 138" stroke-linecap="round" />
              </svg>
              <div class="rv">4<small>H</small></div>
            </div>
            <div class="flex1">
              <b class="alarm-t">{{ due }} 人即将超时释放</b>
              <p class="t-xs alarm-d">24 小时响应窗口剩余不足 4 小时。超时后系统将被动释放至公域，该用户可被全平台其他公司匹配。</p>
            </div>
          </div>
          <van-button block size="small" type="danger" class="alarm-btn" @click="goKpi(kpis[0])">立即跟进</van-button>
        </section>
        <section v-else class="acard info">
          <b>24 小时响应窗口</b>
          <p>私域用户每个阶段完成后 24 小时内必须跟进，超时系统将被动释放至公域。<template v-if="wb">当前没有 4 小时内即将超时的用户。</template></p>
        </section>

        <router-link v-if="canMyCode" to="/my-code" class="acard mycode">
          <div class="qr-ic"><van-icon name="qr" size="26" /></div>
          <div class="flex1">
            <b>我的专属码</b>
            <span>求职者扫码注册即成为本公司私域用户</span>
          </div>
          <van-icon name="arrow" class="chev" />
        </router-link>

        <div class="quad">
          <button v-for="e in entries" :key="e.key" type="button" class="quad-i has-pill" :class="{ off: !e.to }" @click="goEntry(e)">
            <div class="ic"><van-icon :name="e.icon" size="18" /></div>
            <div class="flex1"><b>{{ e.title }}</b><span>{{ e.desc }}</span></div>
            <i v-if="!e.to" class="pill">即将上线</i>
            <i v-else-if="e.count" class="pill pill--n">{{ e.count > 99 ? '99+' : e.count }}</i>
          </button>
        </div>

        <section v-if="canApps" class="acard">
          <div class="acard-hd">
            <h4>待知悉报名</h4>
            <router-link to="/todo?tab=ack" class="more">全部 ›</router-link>
          </div>
          <template v-if="todayList.length">
            <router-link v-for="a in todayList" :key="a.applicationId" :to="`/applications/${a.applicationId}`" class="lrow trow">
              <div class="avatar avatar--sm" :class="a.fromPublic ? 'avatar--t' : 'avatar--o'">{{ a.seekerName.slice(0, 1) }}</div>
              <div class="lt">
                <b>{{ a.seekerName }} · {{ a.jobTitle ?? '—' }}</b>
                <span>{{ fmtTime(a.createdAt, nowDate) }} 报名<template v-if="a.phone"> · {{ a.phone }}</template></span>
              </div>
              <span class="tag" :class="a.fromPublic ? 'tag-public' : 'tag-private'">{{ label('DomainTag', a.fromPublic ? 'PUBLIC' : 'PRIVATE') }}</span>
            </router-link>
          </template>
          <div v-else-if="todayLoaded" class="empty-box">
            <van-icon name="todo-list-o" size="32" class="empty-ic" />
            <div class="t-sm">暂无待知悉的报名</div>
            <div class="t-xs" style="margin-top: 4px">求职者报名后会在此提醒你，请在 24 小时内推送面试信息</div>
          </div>
          <div v-else class="empty-box"><van-loading size="20" /></div>
        </section>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>

    <div v-else-if="loading" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else class="state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="reload">重新加载</van-button>
      </van-empty>
    </div>
  </div>
</template>

<style scoped>
.hero-top .who .sub { font-family: var(--f-cn); }
.bell { color: rgba(255, 255, 255, .85); display: grid; place-items: center; width: 36px; height: 36px; flex: none; }
.bell :deep(.van-badge) { border-color: transparent; }
.kpis .kpi { border: 0; background: transparent; padding: 0; text-align: left; font-size: 11.5px; color: rgba(255, 255, 255, .55); }
.kpis .kpi b { display: block; font-size: 18px; color: #fff; font-weight: 700; margin-top: 2px; }
.kpis .kpi b small { font-size: 11px; font-weight: 500; color: rgba(255, 255, 255, .55); font-family: var(--f-cn); }
.kpis .kpi:active { opacity: .7; }
.alarm { border-color: var(--danger-line); background: var(--danger-bg); color: var(--danger); }
.alarm .rv { color: var(--danger); }
.alarm-t { font-size: 13.5px; font-weight: 700; }
.alarm-d { color: var(--danger); margin-top: 3px; line-height: 1.6; }
.alarm-btn { margin-top: 10px; border-radius: var(--r-sm); }
.err { border-left-color: var(--danger); background: var(--danger-bg); color: var(--danger); }
.mycode { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; border-color: var(--signal-300); background: linear-gradient(180deg, var(--signal-50), var(--surface)); }
.qr-ic { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--signal); color: #fff; }
.mycode b { display: block; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.mycode span { display: block; font-size: 12px; color: var(--ink-500); margin-top: 2px; }
.mycode .chev { color: var(--ink-300); }
.info { border-color: var(--warn-line); background: var(--warn-bg); color: var(--warn); }
.info b { font-size: 13.5px; }
.info p { margin-top: 4px; font-size: 12px; line-height: 1.6; }
.quad-i .pill { font-family: var(--f-cn); }
.quad-i .pill--n { font-family: var(--f-mono); background: var(--ink-900); font-size: 10px; }
.more { font-size: 11.5px; color: var(--ink-400); text-decoration: none; }
.trow { padding: 10px 0; text-decoration: none; color: inherit; border-left: 0; border-right: 0; border-top: 0; }
.empty-ic { display: block; margin-bottom: 8px; opacity: .5; }
.state { padding-top: calc(80px + env(safe-area-inset-top)); }
</style>
