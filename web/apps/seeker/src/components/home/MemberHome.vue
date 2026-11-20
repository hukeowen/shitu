<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type InboxItem, type KycView, type MyApplication, type MyWork } from '@shitu/api-client'
import { BrandMark, IconBell, IconCheck, IconCircleCheck, IconChevronRight, IconClock, IconFilePenLine, IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import InterviewNoticeCard from '@/components/InterviewNoticeCard.vue'
import QuadGrid from '@/components/QuadGrid.vue'
import type { QuadItem } from '@/components/quad'
import { useCountdown } from '@/composables/useCountdown'
import { useJourney } from '@/composables/useJourney'
import { useMatchSession } from '@/composables/useMatchSession'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { formatRelative, formatServerTime, formatShort, parseServerTime } from '@/utils/time'
import { STATUS_TONE } from '@/utils/status'

/**
 * 登录后首页（C-201~C-203）：S-06 公域求职 / S-07 私域待匹配（24h 专属跟进）/ S-08 待面试 / S-09 待确权 / S-10 在岗。
 * 四宫格（C-202）：AI 问薪全状态可点（报名锁定期给出锁定说明，R-03）、我的报备、薪资预支仅在岗、我的合同。
 * 动态提醒（C-203）：待面试 → 面试信息卡；待确权 → 待签署合同卡；在岗 → 最新通知。专属顾问推荐（T-203）有待确认时展示横幅。
 */
const auth = useAuthStore()
const journey = useJourney()
const inbox = useInboxStore()
const router = useRouter()
const { label } = useDict()

const profile = computed(() => auth.profile)
const loading = ref(false)
const loadError = ref('')
const refreshing = ref(false)

async function reload() {
  loading.value = !auth.profile
  loadError.value = ''
  try {
    await auth.loadProfile()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
// 每次回到首页静默刷新档案（驻场推送 / 释放等会改变状态）与未读数
void reload()
void inbox.refresh()

async function onPullRefresh() {
  await Promise.all([reload(), inbox.refresh()])
  await Promise.all([loadApplication(), loadExtras()])
  refreshing.value = false
}

const status = computed(() => profile.value?.status)
const isPrivate = computed(() => profile.value?.domainTag === 'PRIVATE' || profile.value?.domainTag === 'TEMP_PRIVATE')
const company = computed(() => profile.value?.boundCompanyName ?? '')
const appliedLock = computed(() => status.value === 'PENDING_INTERVIEW' || status.value === 'PENDING_CONFIRM')
/** 面试已通过、办理入职 / 待签合同：文案与「待面试」区分 */
const onboarding = computed(() => status.value === 'PENDING_CONFIRM')
const matchLocked = computed(() => !!profile.value && !profile.value.canStartMatching)

/** 头部称呼：实名后用脱敏姓名（与「我的」一致），否则用脱敏手机号 */
const kyc = ref<KycView | null>(null)
watch(
  () => (profile.value?.kycStatus === 'VERIFIED' ? profile.value.userId : ''),
  (id) => {
    kyc.value = null
    if (id) void seekerApi.kyc().then((k) => (kyc.value = k)).catch(() => undefined)
  },
  { immediate: true },
)
const realName = computed(() => (kyc.value?.kycStatus === 'VERIFIED' && kyc.value.realNameMasked ? kyc.value.realNameMasked : ''))
const displayName = computed(() => realName.value || profile.value?.phoneMasked || '')

/** 「查看上次匹配结果」只在确实有上一次结果时展示 */
const { match } = useMatchSession()
const hasLastMatch = computed(() => !!match.outcome)
watch(
  () => !!profile.value && !matchLocked.value && status.value !== 'EMPLOYED',
  (show) => {
    if (show) void match.loadLatest().catch(() => undefined)
  },
  { immediate: true },
)

/** 当前报名（待面试 / 待确权 / 在岗时展示面试信息卡与在岗信息） */
const ACTIVE: ApplicationStatus[] = ['PENDING_INTERVIEW', 'PENDING_CONFIRM', 'EMPLOYED']
const app = ref<MyApplication | null>(null)
const appLoading = ref(false)
async function loadApplication() {
  const s = status.value
  if (!s || !ACTIVE.includes(s as ApplicationStatus)) {
    app.value = null
    return
  }
  appLoading.value = true
  try {
    const list = await seekerApi.myApplications()
    app.value = list.find((a) => a.status === s) ?? list.find((a) => ACTIVE.includes(a.status)) ?? null
  } catch {
    app.value = null
  } finally {
    appLoading.value = false
  }
}
watch(status, () => void loadApplication(), { immediate: true })

/** 按状态加载动态提醒数据：待确权 → 待签合同；在岗 → 任职信息与最新通知；其余 → 顾问推荐 */
const work = ref<MyWork | null>(null)
const latest = ref<InboxItem[]>([])
const latestLoaded = ref(false)
async function loadExtras() {
  const s = status.value
  if (!s) return
  const jobs: Promise<unknown>[] = []
  if (s === 'PENDING_CONFIRM') jobs.push(journey.loadPending().catch(() => null))
  if (s === 'EMPLOYED') {
    jobs.push(seekerApi.work().then((w) => (work.value = w ?? null)).catch(() => undefined))
    jobs.push(
      seekerApi
        .messages({ page: 1, pageSize: 3 })
        .then((r) => (latest.value = r.records.slice(0, 3)))
        .catch(() => undefined)
        .finally(() => (latestLoaded.value = true)),
    )
  }
  if (s !== 'PENDING_INTERVIEW' && s !== 'PENDING_CONFIRM') jobs.push(journey.loadRecs().catch(() => []))
  await Promise.all(jobs)
}
watch(status, () => void loadExtras(), { immediate: true })
const pendingSign = computed(() => (status.value === 'PENDING_CONFIRM' ? journey.pending : null))
const showRecs = computed(() => !appliedLock.value && journey.pendingRecs.length > 0)
function msgTag(m: InboxItem): { t: string; cls: string } {
  const c = m.templateCode.toUpperCase()
  if (c.includes('CONTRACT')) return { t: '合同', cls: 'status-tag--info' }
  if (m.priority >= 2) return { t: '重要', cls: 'status-tag--danger' }
  return { t: '通知', cls: 'status-tag--warning' }
}
function openMsg(m: InboxItem) {
  if (!m.read) {
    m.read = true
    inbox.decrement()
    void seekerApi.markRead([m.id]).catch(() => undefined)
  }
  const r = m.link && m.link.startsWith('/') && !m.link.startsWith('//') ? router.resolve(m.link) : null
  void router.push(r && r.matched.length && !r.matched.some((x) => x.path === '/:pathMatch(.*)*') ? r.fullPath : '/messages')
}

// 24h 响应窗口：私域待匹配 = 专属跟进；待面试 = 驻场联系；待确权 = 确权
const deadline = computed(() => parseServerTime(profile.value?.responseDeadline))
const cd = useCountdown(deadline, () => setTimeout(() => void reload(), 1500))

const scopeText = computed(() => {
  const p = profile.value
  if (!p) return ''
  if (onboarding.value) return '办理入职中 · 不可再匹配'
  if (appliedLock.value) return `${label('DomainTag', p.domainTag)} · 不可再匹配`
  if (p.matchScope === 'OWN_COMPANY' && company.value) return `仅${company.value}岗位`
  return `匹配范围：${label('MatchScope', p.matchScope)}`
})
/** 身份头第二个标签：身份加匹配范围（报名锁定期 scopeText 里已带身份） */
const identityText = computed(() => {
  const p = profile.value
  if (!p) return ''
  return appliedLock.value ? scopeText.value : `${label('DomainTag', p.domainTag)} · ${scopeText.value}`
})
const appCompany = computed(() => app.value?.companyName || company.value || '—')
/** 待签合同卡：合同名里已带岗位名时不再重复一行岗位 */
const signJob = computed(() => {
  const c = pendingSign.value
  return c?.jobTitle && !c.title.includes(c.jobTitle) ? c.jobTitle : ''
})

const quad = computed<QuadItem[]>(() => {
  const employed = status.value === 'EMPLOYED'
  let matchDesc = '7 题定岗'
  if (onboarding.value) matchDesc = '办理入职期间不能重新匹配'
  else if (appliedLock.value) matchDesc = '面试结果出来前不能重新匹配'
  else if (matchLocked.value) matchDesc = employed ? '在岗期间不可匹配' : '当前不可匹配'
  else if (employed) matchDesc = '公司内部调岗'
  else if (isPrivate.value && company.value) matchDesc = '匹配本公司岗位'
  return [
    { key: 'match', title: 'AI 问薪', desc: matchDesc, off: matchLocked.value },
    { key: 'reports', title: '我的报备', desc: onboarding.value ? '报名与入职进度' : '报名与面试进度' },
    { key: 'advance', title: '薪资预支', desc: employed ? '在岗员工可申请' : '需已入职在岗', off: !employed },
    { key: 'contracts', title: '我的合同', desc: '电子合同随时查看' },
  ]
})

async function startMatch() {
  if (matchLocked.value) {
    const msg = onboarding.value
      ? '你已通过面试，办理入职期间不能重新匹配，也不能报名其他岗位。如不想入职，可在「我的报备」里申请取消报名，由驻场老师处理。'
      : appliedLock.value
        ? '面试结果出来前不能重新匹配，也不能报名其他岗位。如需更换岗位，可在「我的报备」里申请取消报名，驻场老师同意后即可重新匹配。'
        : status.value === 'EMPLOYED'
        ? '你已入职在岗，当前不能发起匹配。'
        : '当前状态暂不能发起匹配。'
    try {
      await showConfirmDialog({ title: 'AI 问薪已锁定', message: msg, confirmButtonText: appliedLock.value ? '查看我的报备' : '知道了', showCancelButton: appliedLock.value, cancelButtonText: '知道了' })
      if (appliedLock.value) void router.push('/reports')
    } catch {
      /* 关闭 */
    }
    return
  }
  void router.push('/match')
}

function onQuad(it: QuadItem) {
  if (it.key === 'match') return void startMatch()
  if (it.key === 'reports') return void router.push('/reports')
  if (it.key === 'advance') return it.off ? showToast('入职在岗后可申请薪资预支') : void router.push('/advance')
  void router.push('/contracts')
}

const progress = computed(() => {
  const s = status.value
  const idx = s === 'PENDING_INTERVIEW' ? 1 : s === 'PENDING_CONFIRM' ? 2 : s === 'EMPLOYED' ? 3 : 0
  return ['报名', label('UserStatus', 'PENDING_INTERVIEW'), label('UserStatus', 'PENDING_CONFIRM'), '在岗'].map((t, i) => ({
    t,
    cls: i < idx ? 'done' : i === idx ? 'now' : '',
  }))
})
</script>

<template>
  <van-pull-refresh v-model="refreshing" class="member" @refresh="onPullRefresh">
    <template v-if="profile">
      <header class="home-head">
        <div class="home-brand">
          <BrandMark :size="24" /><span class="flex1">仕兔</span>
          <button type="button" class="bell" aria-label="消息中心" @click="router.push('/messages')">
            <IconBell :size="22" />
            <i v-if="inbox.unread > 0" class="badge">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</i>
          </button>
        </div>
        <h1>{{ displayName }}</h1>
        <p class="home-sub">{{ company ? `${company} 为你服务` : '欢迎使用仕兔求职' }}</p>
        <div class="home-tags">
          <span class="status-tag" :class="STATUS_TONE[profile.status]"><i class="dot"></i>{{ label('UserStatus', profile.status) }}</span>
          <span class="status-tag ell">{{ identityText }}</span>
        </div>

        <div v-if="status === 'PENDING_INTERVIEW'" class="home-meta">
          <div>应聘公司<b>{{ appCompany }}</b></div>
          <div>面试时间<b>{{ app?.notice ? formatShort(app.notice.interviewAt) : '待驻场通知' }}</b></div>
        </div>
        <div v-else-if="status === 'PENDING_CONFIRM'" class="home-meta">
          <div>应聘公司<b>{{ appCompany }}</b></div>
          <div>入职办理剩余<b>{{ cd.active.value ? cd.text.value : '—' }}</b></div>
        </div>
        <div v-else-if="status === 'EMPLOYED'" class="home-meta">
          <div>所属公司<b>{{ work?.companyName || appCompany }}</b></div>
          <div>当前项目<b>{{ work?.projectName || app?.projectName || '—' }}</b></div>
          <div>在岗岗位<b>{{ work?.jobTitle || app?.jobTitle || '—' }}</b></div>
          <div v-if="work && !work.endDate">入职时间<b>{{ formatServerTime(work.startDate, false) }} · 第 {{ work.dutyDays }} 天</b></div>
          <div v-else>报名时间<b>{{ app ? formatServerTime(app.createdAt, false) : '—' }}</b></div>
        </div>
        <div v-else-if="isPrivate" class="home-meta">
          <div>服务公司<b>{{ company || '—' }}</b></div>
          <div v-if="cd.active.value">顾问联系剩余<b>{{ cd.text.value }}</b></div>
        </div>
        <p v-else class="home-desc">当前无归属公司，可匹配平台全部劳务公司岗位</p>
      </header>

      <div class="pad stack">
        <!-- S-07 24h 专属跟进窗口 -->
        <template v-if="status === 'PRIVATE_PENDING'">
          <section v-if="cd.active.value" class="tipbar tipbar--warn">
            <IconClock :size="20" />
            <div class="flex1">
              <div class="tipbar-t">{{ company }}专属跟进期 · {{ cd.text.value }}</div>
              <p class="tipbar-d">你的专属顾问来自 {{ company }}，窗口内驻场老师将主动联系你。若 24 小时内无人联系你，你可以自由匹配全平台岗位。</p>
            </div>
          </section>
          <section v-else-if="company" class="note">
            你的专属顾问来自 <b>{{ company }}</b>，匹配范围为该公司旗下岗位。
          </section>
        </template>

        <!-- S-08 待面试：面试提醒 -->
        <template v-if="status === 'PENDING_INTERVIEW'">
          <section class="acard">
            <div class="acard-hd">
              <h4>面试提醒</h4>
              <span v-if="!app?.notice" class="status-tag status-tag--pending">等待驻场联系</span>
            </div>
            <van-loading v-if="appLoading && !app" size="20" />
            <template v-else>
              <div class="jt">{{ app?.jobTitle || '已报名岗位' }}</div>
              <div class="t-sm">{{ [app?.projectName, app?.companyName].filter(Boolean).join(' · ') }}</div>
              <div class="divider"></div>
              <template v-if="app?.notice">
                <InterviewNoticeCard :notice="app.notice" />
                <van-button block class="mt12" @click="router.push(`/reports/${app.applicationId}`)">查看完整面试须知</van-button>
              </template>
              <template v-else>
                <p class="wait">
                  驻场老师会在 <b class="strong">{{ formatServerTime(profile.responseDeadline) }}</b> 前联系你，并推送面试时间、集合地点和所需证件。
                </p>
                <p v-if="cd.active.value" class="t-sm wait-d">剩余 {{ cd.text.value }}，超时未联系你可以重新选择岗位</p>
                <dl v-if="app?.address" class="wait-kv">
                  <div class="kv"><dt>面试地点</dt><dd>{{ app.address }}</dd></div>
                </dl>
              </template>
            </template>
          </section>
        </template>

        <!-- S-09 待确权 -->
        <template v-if="status === 'PENDING_CONFIRM'">
          <!-- 驻场已完成入职确权、合同待签：最显眼的入口 -->
          <button v-if="pendingSign" type="button" class="acard signc" @click="router.push('/contracts/sign')">
            <div class="sign-hd">
              <IconFilePenLine :size="24" />
              <div class="flex1">
                <div class="sign-t"><span class="flex1">请签署劳动合同</span><span class="status-tag status-tag--warning">待签署</span></div>
                <div class="t-sm">{{ pendingSign.title }}<template v-if="pendingSign.companyName"> · {{ pendingSign.companyName }}</template></div>
                <div v-if="signJob" class="t-sm">{{ signJob }}</div>
                <div class="t-sm sign-term"><span>{{ formatServerTime(pendingSign.termStart, false) }}</span><template v-if="pendingSign.termEnd"> → <span>{{ formatServerTime(pendingSign.termEnd, false) }}</span></template><template v-else> 起 · 无固定期限</template></div>
              </div>
            </div>
            <div class="sign-btn">立即签署<IconChevronRight :size="18" /></div>
          </button>
        </template>

        <!-- T-203 专属顾问推荐 -->
        <button v-if="showRecs" type="button" class="tipbar recb" @click="router.push('/recommendations')">
          <div class="avatar">{{ (company || '顾').slice(0, 1) }}</div>
          <div class="flex1">
            <div class="tipbar-t">专属顾问为你推荐了 {{ journey.pendingRecs.length }} 个岗位</div>
            <div class="tipbar-d">{{ journey.pendingRecs[0]?.jobTitle || '人工挑选' }}<template v-if="journey.pendingRecs.length > 1"> 等</template> · 确认后即可报名</div>
          </div>
          <IconChevronRight :size="20" class="chev" />
        </button>

        <!-- 报名后锁定说明 -->
        <div v-if="appliedLock" class="tipbar" :class="onboarding ? 'tipbar--ok' : 'tipbar--warn'">
          <component :is="onboarding ? IconCircleCheck : IconTriangleExclamationPoint" :size="20" />
          <div class="flex1">
            <!-- 面试已通过、办理入职中：不再提「取消面试」，说明超时自动解除与找谁处理 -->
            <template v-if="onboarding">
              <div class="tipbar-t">面试已通过</div>
              <div class="tipbar-d">{{ pendingSign ? '签署劳动合同并由劳务公司盖章后，即正式入职在岗' : `等待驻场为你办理${app?.jobTitle ? `「${app.jobTitle}」的` : ''}入职并发起电子签约` }}。办理入职期间不能重新匹配，也不能报名其他岗位。</div>
              <div class="tipbar-d">若劳务公司 24 小时内未办完入职，本次报名会自动解除，之后你可以匹配全平台岗位。信息有误请联系驻场老师；如不想入职，可以申请取消报名。</div>
              <button type="button" class="link lock-link" @click="router.push(app ? `/reports/${app.applicationId}` : '/reports')">申请取消报名<IconChevronRight :size="16" /></button>
            </template>
            <template v-else>
              <div class="tipbar-t">报名后不可再匹配、不可再报名。</div>
              <div class="tipbar-d">你不能直接取消报名。如需更换岗位或不去面试了，可以提交取消申请，驻场老师同意后报名就会取消。</div>
              <button type="button" class="link lock-link" @click="router.push(app ? `/reports/${app.applicationId}` : '/reports')">申请取消报名<IconChevronRight :size="16" /></button>
            </template>
          </div>
        </div>

        <!-- 匹配入口 CTA -->
        <section v-if="!matchLocked && status !== 'EMPLOYED'" class="acard lead">
          <h2>{{ isPrivate ? '先说说你想要什么活儿' : '还没找到活儿？' }}</h2>
          <p class="lead-sub">7 道题，1 分钟，最多出 3 个岗位</p>
          <van-button type="primary" block @click="startMatch">开始 AI 问薪</van-button>
          <button v-if="hasLastMatch" type="button" class="link last" @click="router.push('/match/result')">查看上次匹配结果<IconChevronRight :size="16" /></button>
        </section>

        <QuadGrid :items="quad" @tap="onQuad" />

        <!-- S-10 在岗：动态提醒 = 最新通知 -->
        <section v-if="status === 'EMPLOYED'" class="acard">
          <div class="acard-hd">
            <h4>动态提醒</h4>
            <router-link to="/messages" class="link">消息中心<template v-if="inbox.unread"> · {{ inbox.unread }} 条未读</template><IconChevronRight :size="16" /></router-link>
          </div>
          <template v-if="latest.length">
            <button v-for="m in latest" :key="m.id" type="button" class="lrow msg" @click="openMsg(m)">
              <i class="unread-dot" :class="{ on: !m.read }"></i>
              <div class="lt"><b :class="{ unreadt: !m.read }">{{ m.title }}</b><span>{{ m.content }}</span></div>
              <div class="mside"><span class="status-tag" :class="msgTag(m).cls">{{ msgTag(m).t }}</span><span class="t-xs">{{ formatRelative(m.createdAt) }}</span></div>
            </button>
          </template>
          <div v-else-if="latestLoaded" class="t-sm">暂无新通知，排班、合同、工资等通知会在这里提醒你</div>
          <van-loading v-else size="20" />
        </section>
        <section v-if="status === 'EMPLOYED'" class="acard list">
          <router-link to="/work" class="lrow">
            <div class="lt"><b>我的工作</b><span>{{ work && !work.endDate ? `${work.projectName || work.jobTitle || '在岗'} · 工号 ${work.employeeNo || '—'}` : '岗位信息、工作地点' }}</span></div>
            <IconChevronRight :size="20" class="chev" />
          </router-link>
          <router-link to="/contracts" class="lrow">
            <div class="lt"><b>我的合同</b><span>劳动合同与签署记录</span></div>
            <IconChevronRight :size="20" class="chev" />
          </router-link>
          <router-link to="/payslips" class="lrow">
            <div class="lt"><b>我的工资</b><span>工资条 · 应发 / 扣款 / 实发</span></div>
            <IconChevronRight :size="20" class="chev" />
          </router-link>
        </section>

        <section v-if="appliedLock" class="acard">
          <div class="acard-hd"><h4>报名进度</h4><router-link to="/reports" class="link">我的报备<IconChevronRight :size="16" /></router-link></div>
          <div class="steps">
            <template v-for="(s, i) in progress" :key="s.t">
              <div class="st" :class="s.cls"><i><IconCheck v-if="s.cls === 'done'" :size="12" :stroke-width="2.5" /><template v-else>{{ i + 1 }}</template></i>{{ s.t }}</div>
              <div v-if="i < progress.length - 1" class="ln"></div>
            </template>
          </div>
        </section>
        <section v-else-if="status !== 'EMPLOYED'" class="acard">
          <div class="acard-hd"><h4>动态提醒</h4><router-link to="/messages" class="link">消息中心<IconChevronRight :size="16" /></router-link></div>
          <div class="state-block state-block--sm">
            <IconInbox :size="32" :stroke-width="1.5" />
            <div class="state-block-t">暂无面试或在岗提醒</div>
            <div class="state-block-d">完成 AI 问薪并报名后，面试信息将在此展示</div>
          </div>
        </section>
      </div>
    </template>

    <div v-else-if="loading" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else class="state state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError || '请检查网络后重试' }}</div>
      <van-button type="primary" @click="reload">重新加载</van-button>
    </div>
  </van-pull-refresh>
</template>

<style scoped>
.sign-term { margin-top: var(--space-2); }
.sign-term span { white-space: nowrap; }
.member { min-height: var(--page-h-tabbar); }
.bell { position: relative; flex: none; width: 44px; height: 44px; margin-right: calc(var(--space-3) * -1); display: grid; place-items: center; color: var(--text-1); background: transparent; border: 0; padding: 0; }
.bell .badge { position: absolute; top: 4px; right: 2px; min-width: 18px; height: 18px; padding: 0 var(--space-1); border-radius: 9px; background: var(--danger-text); color: var(--text-on-primary); font-size: var(--font-size-min); font-style: normal; line-height: 18px; text-align: center; }
.jt { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.mt12 { margin-top: var(--space-3); }
.wait { font-size: var(--font-size-body); line-height: 24px; color: var(--text-2); }
.wait-d { margin-top: var(--space-1); }
.wait-kv { margin-top: var(--space-2); }
.state { padding-top: calc(80px + env(safe-area-inset-top)); }
button.acard { display: block; width: 100%; border: 0; text-align: left; font: inherit; }
.sign-hd { display: flex; gap: var(--space-3); align-items: flex-start; }
.sign-hd > svg { flex: none; margin-top: 2px; color: var(--primary); }
.sign-t { display: flex; align-items: center; gap: var(--space-2); margin-bottom: 2px; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); line-height: 24px; color: var(--text-1); }
/* 整张卡是一个按钮，里面这块只是画成主按钮的样子 */
.sign-btn { display: flex; align-items: center; justify-content: center; gap: 2px; margin-top: var(--space-4); height: var(--control-height); border-radius: var(--radius-control); background: var(--primary); color: var(--text-on-primary); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); }
.signc:active .sign-btn { background: var(--primary-hover); }
.recb { width: 100%; align-items: center; border: 0; text-align: left; }
.recb .avatar { background: var(--bg-card); }
.recb .chev { margin-top: 0; }
.last { margin: var(--space-3) auto 0; display: flex; min-height: 44px; }
/* 锁定说明里的「申请取消报名」：次要入口，点击区撑够 44 */
.lock-link { min-height: 44px; margin-bottom: calc(var(--space-3) * -1); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); }
.lead .last { margin-bottom: calc(var(--space-3) * -1); }
.list { padding: 0; overflow: hidden; }
.list .lrow { text-decoration: none; color: inherit; }
.msg { min-width: 0; padding: var(--space-3) 0; border-left: 0; border-right: 0; border-top: 0; background: transparent; align-items: flex-start; }
.msg .lt b { font-weight: var(--font-weight-regular); }
.msg .lt b.unreadt { font-weight: var(--font-weight-medium); }
.msg .lt span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unread-dot { flex: none; width: 8px; height: 8px; margin-top: 7px; border-radius: 50%; }
.unread-dot.on { background: var(--primary); }
.mside { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); }
</style>
