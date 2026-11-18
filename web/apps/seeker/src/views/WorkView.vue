<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type MyApplication, type MyWork } from '@shitu/api-client'
import { IconCheck, IconChevronRight, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import InterviewNoticeCard from '@/components/InterviewNoticeCard.vue'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { amapLink } from '@/utils/map'
import { STATUS_TONE } from '@/utils/status'
import { formatServerTime, parseServerTime } from '@/utils/time'

/**
 * S-30 / S-31 我的工作（C-505）：唯一展示所属劳务公司的入口。按状态四种形态：
 *   在岗（S-30）/ 待面试·待确权（形态 A）/ 公域求职·私域待匹配（形态 B）/ 已离职（形态 C，最近一段任职）。
 */
const router = useRouter()
const auth = useAuthStore()
const journey = useJourney()
const { label } = useDict()

const profile = computed(() => auth.profile)
const status = computed(() => profile.value?.status)
const work = ref<MyWork | null>(null)
const app = ref<MyApplication | null>(null)
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

const APPLIED: ApplicationStatus[] = ['PENDING_INTERVIEW', 'PENDING_CONFIRM']

async function load() {
  loadError.value = ''
  try {
    const p = await auth.loadProfile()
    const applied = p.status === 'PENDING_INTERVIEW' || p.status === 'PENDING_CONFIRM'
    const [w, apps] = await Promise.all([
      seekerApi.work(),
      applied ? seekerApi.myApplications() : Promise.resolve([] as MyApplication[]),
      p.status === 'PENDING_CONFIRM' ? journey.loadPending().catch(() => null) : Promise.resolve(null),
      p.domainTag === 'PRIVATE' && !applied ? journey.loadRecs().catch(() => []) : Promise.resolve([]),
    ])
    work.value = w ?? null
    app.value = apps.find((a) => a.status === p.status) ?? apps.find((a) => APPLIED.includes(a.status)) ?? null
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  await load()
  refreshing.value = false
}

/** 当前在岗 = 档案状态在岗且任职未结束 */
const employed = computed(() => status.value === 'EMPLOYED' && !!work.value && !work.value.endDate)
const applied = computed(() => status.value === 'PENDING_INTERVIEW' || status.value === 'PENDING_CONFIRM')
/** 最近一段已结束的任职 */
const past = computed(() => (work.value?.endDate ? work.value : null))

const nav = computed(() => {
  const w = work.value
  const addr = [w?.city, w?.address].filter(Boolean).join(' ')
  return addr ? amapLink({ address: addr, name: w?.projectName || addr }) : null
})
const workAddress = computed(() => [work.value?.city, work.value?.address].filter(Boolean).join(' · '))

/** 已离职：在职天数 = 入职到离职（含首尾） */
function spanDays(w: MyWork): number {
  const a = parseServerTime(w.startDate)
  const b = parseServerTime(w.endDate)
  if (a == null || b == null) return w.dutyDays
  return Math.max(1, Math.round((b - a) / 86400_000) + 1)
}
function dot(s: string | undefined) {
  return formatServerTime(s, false).replace(/-/g, '.')
}

const STEP_TEXT = { done: '已完成', now: '进行中', todo: '未开始' }
const formBSteps = computed(() => {
  const s = status.value
  const idx = s === 'PRIVATE_PENDING' || s === 'PUBLIC_SEEKING' ? 1 : 0
  return ['注册', s === 'PRIVATE_PENDING' ? label('UserStatus', 'PRIVATE_PENDING') : '待匹配', '报名', '入职'].map((t, i) => ({
    t,
    cls: i < idx ? ('done' as const) : i === idx ? ('now' as const) : ('todo' as const),
  }))
})

/** 页面底部通栏的主动作：待签约时去签合同；还没报名时去问薪 */
const cta = computed(() => {
  if (!profile.value || employed.value) return null
  if (applied.value) return status.value === 'PENDING_CONFIRM' && journey.pending ? { text: '去签署劳动合同', path: '/contracts/sign' } : null
  return profile.value.canStartMatching ? { text: past.value ? '重新求职 · 去 AI 问薪' : '前往 AI 问薪匹配', path: '/match' } : null
})
</script>

<template>
  <div class="work">
    <AppBar title="我的工作" fallback="/me" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !profile" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div v-if="loadError" class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="retry">重新加载</van-button>
    </div>

    <template v-else>
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- S-30 在岗 -->
        <div v-if="employed && work" class="pad stack">
          <section class="acard">
            <div class="item-hd">
              <div class="flex1">
                <p class="top-l">所属劳务公司</p>
                <h1>{{ work.companyName || '—' }}</h1>
              </div>
              <span class="status-tag" :class="STATUS_TONE[profile.status]">{{ label('UserStatus', profile.status) }}</span>
            </div>
            <div class="home-tags">
              <span class="status-tag status-tag--info">{{ label('DomainTag', profile.domainTag) }}</span>
            </div>
            <dl class="home-meta">
              <div><dt>当前项目</dt><dd>{{ work.projectName || '—' }}</dd></div>
              <div><dt>在岗天数</dt><dd>第 {{ work.dutyDays }} 天</dd></div>
            </dl>
          </section>

          <section class="acard">
            <div class="acard-hd"><h4>岗位信息</h4></div>
            <dl class="facts">
              <div class="kv"><dt>工号</dt><dd class="code">{{ work.employeeNo || '—' }}</dd></div>
              <div class="kv"><dt>入职日期</dt><dd>{{ formatServerTime(work.startDate, false) }}</dd></div>
              <div class="kv"><dt>在岗天数</dt><dd>{{ work.dutyDays }} 天</dd></div>
              <div class="kv"><dt>在岗岗位</dt><dd>{{ work.jobTitle || '—' }}</dd></div>
              <div class="kv top">
                <dt>工作地点</dt>
                <dd>
                  {{ workAddress || '—' }}
                  <a v-if="nav" :href="nav" class="nav-link" target="_blank" rel="noopener">高德地图导航</a>
                </dd>
              </div>
            </dl>
          </section>

          <section class="acard list">
            <router-link to="/contracts" class="lrow">
              <div class="lt"><b>我的合同</b><span>查看劳动合同与签署记录</span></div>
              <IconChevronRight :size="20" class="chev" />
            </router-link>
            <router-link to="/payslips" class="lrow">
              <div class="lt"><b>我的工资</b><span>按月工资条与预支抵扣明细</span></div>
              <IconChevronRight :size="20" class="chev" />
            </router-link>
            <router-link to="/advance" class="lrow">
              <div class="lt"><b>薪资预支</b><span>每满 7 个在岗日获得一次机会</span></div>
              <IconChevronRight :size="20" class="chev" />
            </router-link>
            <router-link to="/reports" class="lrow">
              <div class="lt"><b>我的报备</b><span>报名 / 面试 / 入职记录</span></div>
              <IconChevronRight :size="20" class="chev" />
            </router-link>
          </section>

          <section class="acard">
            <div class="acard-hd"><h4>考勤说明</h4></div>
            <p class="para">请假或旷工由驻场老师登记，会扣减预支所需的在岗日。</p>
          </section>

          <section class="tipbar tipbar--warn">
            <IconTriangleExclamationPoint :size="20" />
            <div class="flex1">
              <div class="tipbar-t">如需离职，请联系驻场老师办理。</div>
              <div class="tipbar-d">离职确认后：当前归属清空 → 变为「{{ label('DomainTag', 'PUBLIC') }}」→ 匹配范围恢复全平台。</div>
            </div>
          </section>
          <div class="page-bottom-gap"></div>
        </div>

        <div v-else class="pad stack">
          <!-- 形态 A · 待面试 / 待签约入职 -->
          <section v-if="applied" class="acard">
            <div class="acard-hd">
              <h4>{{ status === 'PENDING_CONFIRM' ? '面试已通过 · 等待入职' : '已报名 · 等待面试' }}</h4>
              <span class="status-tag" :class="STATUS_TONE[profile.status]">{{ label('UserStatus', profile.status) }}</span>
            </div>
            <template v-if="app">
              <dl class="facts">
                <div class="kv"><dt>应聘岗位</dt><dd>{{ app.jobTitle || '—' }}</dd></div>
                <div class="kv"><dt>应聘公司</dt><dd>{{ app.companyName || profile.boundCompanyName || '—' }}</dd></div>
                <div v-if="app.projectName" class="kv"><dt>项目</dt><dd>{{ app.projectName }}</dd></div>
              </dl>
              <template v-if="status === 'PENDING_INTERVIEW'">
                <div class="divider"></div>
                <InterviewNoticeCard v-if="app.notice" :notice="app.notice" />
                <p v-else class="para">驻场老师将尽快联系你，并推送面试时间、集合地点和所需证件。</p>
                <van-button block class="mt" @click="router.push(app.notice ? `/reports/${app.applicationId}` : '/reports')">
                  {{ app.notice ? '查看面试须知' : '查看我的报备' }}
                </van-button>
              </template>
            </template>
            <p v-else class="para">报名信息加载中或已变更，请到「我的报备」查看。</p>

            <template v-if="status === 'PENDING_CONFIRM'">
              <div class="divider"></div>
              <p v-if="journey.pending" class="para">劳务公司已发起电子签约，签署劳动合同后即正式入职在岗。</p>
              <p v-else class="para">驻场老师正在办理入职，完成后会推送电子合同供你签署。</p>
            </template>
          </section>

          <!-- 形态 B · 求职中 / 顾问跟进中 -->
          <section v-else class="acard">
            <div class="acard-hd">
              <h4>{{ profile.status === 'PRIVATE_PENDING' ? '顾问跟进中' : '求职中' }}</h4>
              <span class="status-tag" :class="STATUS_TONE[profile.status]">{{ label('UserStatus', profile.status) }}</span>
            </div>
            <ol class="wsteps">
              <li v-for="(s, i) in formBSteps" :key="s.t" :class="s.cls">
                <i><IconCheck v-if="s.cls === 'done'" :size="14" :stroke-width="2.5" /><template v-else>{{ i + 1 }}</template></i>
                <b>{{ s.t }}</b>
                <span>{{ STEP_TEXT[s.cls] }}</span>
              </li>
            </ol>
            <p class="para">你当前尚未入职任何项目。完成 AI 问薪匹配后，可从推荐岗位中选择 1 个报名。</p>
            <p v-if="profile.status === 'PRIVATE_PENDING' && profile.boundCompanyName" class="para">归属公司：<b class="strong">{{ profile.boundCompanyName }}</b></p>
            <router-link v-if="journey.pendingRecs.length" to="/recommendations" class="link more">
              专属顾问为你推荐了 {{ journey.pendingRecs.length }} 个岗位<IconChevronRight :size="16" />
            </router-link>
          </section>

          <!-- 形态 C · 已离职 -->
          <section v-if="past" class="acard">
            <div class="acard-hd"><h4>历史任职</h4><span class="status-tag">已离职</span></div>
            <p class="h-t">{{ [past.companyName, past.projectName].filter(Boolean).join(' · ') || '—' }}</p>
            <p class="item-meta">{{ dot(past.startDate) }} – {{ dot(past.endDate) }}</p>
            <p v-if="past.jobTitle || past.employeeNo" class="item-meta">{{ past.jobTitle || '' }}<template v-if="past.jobTitle && past.employeeNo"> · </template><span v-if="past.employeeNo" class="nowrap">工号 {{ past.employeeNo }}</span></p>
            <dl class="home-meta g3">
              <div><dt>在职天数</dt><dd>{{ spanDays(past) }}</dd></div>
              <div><dt>入职</dt><dd>{{ formatServerTime(past.startDate, false).slice(5) }}</dd></div>
              <div><dt>离职</dt><dd>{{ formatServerTime(past.endDate, false).slice(5) }}</dd></div>
            </dl>
            <p v-if="!applied" class="note after">
              离职后你已转为「{{ label('DomainTag', profile.domainTag) }}」，{{ profile.domainTag === 'PUBLIC' ? '可匹配全平台所有劳务公司岗位。' : '可重新匹配岗位。' }}
            </p>
            <router-link to="/contracts" class="link more">查看历史合同<IconChevronRight :size="16" /></router-link>
          </section>
          <div :class="cta ? 'bottom-bar-gap' : 'page-bottom-gap'"></div>
        </div>
      </van-pull-refresh>

      <!-- 通栏放在下拉刷新外面：下拉时内容整体位移，固定定位的元素不能跟着动 -->
      <div v-if="cta" class="bottom-bar">
        <van-button type="primary" size="large" block @click="router.push(cta.path)">{{ cta.text }}</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.work { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.top-l { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.item-hd h1 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); overflow-wrap: anywhere; }
.home-meta dt { font-size: var(--font-size-aux); color: var(--text-3); }
.home-meta dd { margin-top: 2px; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); overflow-wrap: anywhere; }
.g3 { grid-template-columns: repeat(3, 1fr); }
/* 长地址折行时两行尽量等长，不留孤字 */
.facts dd { word-break: normal; overflow-wrap: anywhere; text-wrap: balance; }
.kv.top { align-items: flex-start; }
.code { font-family: var(--font-mono); }
/* 导航链接单独占一行，上下各撑 12 凑够 44 的点击区 */
.nav-link { display: block; margin: calc(var(--space-3) * -1) 0; padding: var(--space-3) 0; font-size: var(--font-size-aux); line-height: 20px; font-weight: var(--font-weight-medium); color: var(--primary-text); text-decoration: none; }
.list { padding: 0; overflow: hidden; }
.list .lrow { text-decoration: none; color: inherit; }
.mt { margin-top: var(--space-3); }
.wsteps { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: var(--space-4); }
.wsteps li { position: relative; display: flex; flex-direction: column; align-items: center; min-width: 0; text-align: center; }
.wsteps li + li::before { content: ""; position: absolute; top: 12px; right: calc(50% + 16px); width: calc(100% - 32px); height: 1px; background: var(--border); }
.wsteps i { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--bg-fill); font-size: var(--font-size-min); font-style: normal; font-weight: var(--font-weight-medium); color: var(--text-3); }
.wsteps b { margin-top: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); line-height: 20px; color: var(--text-2); }
.wsteps span { font-size: var(--font-size-min); line-height: 18px; color: var(--text-3); }
.wsteps .done i { background: var(--success-text); color: var(--text-on-primary); }
.wsteps .done span { color: var(--success-text); }
.wsteps .now i { background: var(--primary); color: var(--text-on-primary); }
.wsteps .now b { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.wsteps .now span { color: var(--primary-text); }
.para + .para { margin-top: var(--space-2); }
.more { display: flex; justify-content: center; min-height: 44px; margin: var(--space-2) 0 calc(var(--space-3) * -1); }
.h-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.after { margin-top: var(--space-3); }
.nowrap { white-space: nowrap; }
</style>
