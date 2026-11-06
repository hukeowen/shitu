<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { DomainTag } from '@shitu/ui-mobile'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type MyApplication } from '@shitu/api-client'
import InterviewNoticeCard from '@/components/InterviewNoticeCard.vue'
import QuadGrid from '@/components/QuadGrid.vue'
import type { QuadItem } from '@/components/quad'
import { useCountdown } from '@/composables/useCountdown'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { formatServerTime, formatShort, parseServerTime } from '@/utils/time'
import { STATUS_TAG_CLASS, heroClass } from '@/utils/status'

/**
 * 登录后首页（C-201~C-203）：S-06 公域求职 / S-07 私域待匹配（24h 专属跟进）/ S-08 待面试 / S-09 待确权 / S-10 在岗。
 * 四宫格（C-202）：AI 问薪全状态可点（报名锁定期给出锁定说明，R-03）、推荐裂变预留、薪资预支仅在岗、工分变现 V1.5。
 */
const auth = useAuthStore()
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
  await loadApplication()
  refreshing.value = false
}

const status = computed(() => profile.value?.status)
const isPrivate = computed(() => profile.value?.domainTag === 'PRIVATE' || profile.value?.domainTag === 'TEMP_PRIVATE')
const company = computed(() => profile.value?.boundCompanyName ?? '')
const appliedLock = computed(() => status.value === 'PENDING_INTERVIEW' || status.value === 'PENDING_CONFIRM')
const matchLocked = computed(() => !!profile.value && !profile.value.canStartMatching)

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

// 24h 响应窗口：私域待匹配 = 专属跟进；待面试 = 驻场联系；待确权 = 确权
const WINDOW_MS = 24 * 3600 * 1000
const deadline = computed(() => parseServerTime(profile.value?.responseDeadline))
const cd = useCountdown(deadline, () => setTimeout(() => void reload(), 1500))
const ringDash = computed(() => {
  const C = 138
  const frac = Math.min(1, cd.remaining.value / WINDOW_MS)
  return `${(C * frac).toFixed(1)} ${C}`
})

const scopeText = computed(() => {
  const p = profile.value
  if (!p) return ''
  if (appliedLock.value) return `${label('DomainTag', p.domainTag)} · 不可再匹配`
  if (p.matchScope === 'OWN_COMPANY' && company.value) return `仅${company.value}岗位`
  return `匹配范围：${label('MatchScope', p.matchScope)}`
})
const appCompany = computed(() => app.value?.companyName || company.value || '—')

const quad = computed<QuadItem[]>(() => {
  const employed = status.value === 'EMPLOYED'
  let matchDesc = '7 题定岗'
  if (appliedLock.value) matchDesc = '面试结果出来前不能重新匹配'
  else if (matchLocked.value) matchDesc = '当前不可匹配'
  else if (employed) matchDesc = '公司内部调岗'
  else if (isPrivate.value && company.value) matchDesc = `匹配${company.value}岗位`
  return [
    { key: 'match', title: 'AI 问薪', desc: matchDesc, off: matchLocked.value, pill: matchLocked.value ? '锁定' : undefined },
    { key: 'refer', title: '推荐裂变', desc: '推荐工友得奖励', pill: '预留' },
    { key: 'advance', title: '薪资预支', desc: employed ? '在岗员工可申请' : '需已入职在岗', off: !employed },
    { key: 'points', title: '工分变现', desc: '在岗积累工分兑换', off: true, pill: 'V1.5' },
  ]
})

async function startMatch() {
  if (matchLocked.value) {
    const msg = appliedLock.value
      ? '面试结果出来前不能重新匹配，也不能报名其他岗位。如需更换岗位，请联系驻场老师在后台取消报名。'
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
  if (it.key === 'refer') return showToast('推荐裂变即将上线')
  if (it.key === 'advance') return showToast(it.off ? '入职在岗后可申请薪资预支' : '薪资预支即将上线')
  showToast('工分变现将在 V1.5 上线')
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
      <header class="hero" :class="heroClass(profile.domainTag)">
        <div class="hero-top">
          <div class="avatar" :class="isPrivate ? 'avatar--o' : 'avatar--t'">我</div>
          <div class="who"><b>{{ profile.phoneMasked }}</b><span>{{ profile.userId }}</span></div>
          <DomainTag :domain="profile.domainTag" />
          <button type="button" class="bell" aria-label="消息中心" @click="router.push('/messages')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5M10 20a2.2 2.2 0 0 0 4 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <i v-if="inbox.unread > 0" class="badge num">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</i>
          </button>
        </div>
        <div class="hero-state">
          <span class="tag tag--lg" :class="STATUS_TAG_CLASS[profile.status]"><i class="dot"></i>{{ label('UserStatus', profile.status) }}</span>
          <span class="tag tag--glass">{{ scopeText }}</span>
        </div>

        <div v-if="status === 'PENDING_INTERVIEW'" class="hero-meta">
          <div>应聘公司<b>{{ appCompany }}</b></div>
          <div>面试时间<b :class="{ num: !!app?.notice }">{{ app?.notice ? formatShort(app.notice.interviewAt) : '待驻场通知' }}</b></div>
        </div>
        <div v-else-if="status === 'PENDING_CONFIRM'" class="hero-meta">
          <div>应聘公司<b>{{ appCompany }}</b></div>
          <div>确权剩余<b class="num">{{ cd.active.value ? cd.text.value : '—' }}</b></div>
        </div>
        <div v-else-if="status === 'EMPLOYED'" class="hero-meta">
          <div>所属公司<b>{{ appCompany }}</b></div>
          <div>当前项目<b>{{ app?.projectName || '—' }}</b></div>
          <div>在岗岗位<b>{{ app?.jobTitle || '—' }}</b></div>
          <div>报名时间<b class="num">{{ app ? formatServerTime(app.createdAt, false) : '—' }}</b></div>
        </div>
        <div v-else-if="isPrivate" class="hero-meta">
          <div>归属公司<b>{{ company || '—' }}</b></div>
          <div v-if="cd.active.value">专属跟进剩余<b class="num">{{ cd.text.value }}</b></div>
        </div>
        <p v-else class="hero-desc">当前无归属公司，可匹配平台全部劳务公司岗位</p>
      </header>

      <div class="pad stack">
        <!-- S-07 24h 专属跟进窗口 -->
        <template v-if="status === 'PRIVATE_PENDING'">
          <section v-if="cd.active.value" class="acard warn">
            <div class="row" style="gap: 12px; align-items: flex-start">
              <div class="ring">
                <svg width="52" height="52" aria-hidden="true">
                  <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(168,91,0,.18)" stroke-width="5" />
                  <circle cx="26" cy="26" r="22" fill="none" stroke="#A85B00" stroke-width="5" :stroke-dasharray="ringDash" stroke-linecap="round" />
                </svg>
                <div class="rv" style="color: var(--warn)">{{ cd.hours.value }}<small>H</small></div>
              </div>
              <div class="flex1">
                <div class="warn-t">{{ company }}专属跟进期 · <span class="num">{{ cd.text.value }}</span></div>
                <p class="t-xs warn-d">你的专属顾问来自 {{ company }}，窗口内驻场老师将主动联系你。若 24 小时内无人跟进，系统将自动把你释放至公域，届时可匹配全平台岗位。</p>
              </div>
            </div>
          </section>
          <section v-else-if="company" class="note">
            你的专属顾问来自 <b>{{ company }}</b>，匹配范围为该公司旗下岗位。
          </section>
        </template>

        <!-- S-08 待面试：面试提醒 -->
        <template v-if="status === 'PENDING_INTERVIEW'">
          <section class="acard tempc">
            <div class="acard-hd">
              <h4 class="temp-h">面试提醒</h4>
              <span v-if="!app?.notice" class="tag tag-temp">等待驻场联系</span>
            </div>
            <van-loading v-if="appLoading && !app" size="20" />
            <template v-else>
              <div class="jt">{{ app?.jobTitle || '已报名岗位' }}</div>
              <div class="t-sm" style="margin-top: 2px">{{ [app?.projectName, app?.companyName].filter(Boolean).join(' · ') }}</div>
              <div class="divider tempd"></div>
              <template v-if="app?.notice">
                <InterviewNoticeCard :notice="app.notice" />
                <van-button block size="small" class="mt12" @click="router.push(`/reports/${app.applicationId}`)">查看完整面试须知</van-button>
              </template>
              <template v-else>
                <p class="t-sm" style="line-height: 1.7">
                  驻场老师会在 <b class="num strong">{{ formatServerTime(profile.responseDeadline) }}</b> 前联系你，并推送面试时间、集合地点和所需证件。
                </p>
                <p v-if="cd.active.value" class="t-xs" style="margin-top: 4px">剩余 <span class="num">{{ cd.text.value }}</span>，超时未联系系统会自动释放你的报名</p>
                <dl v-if="app?.address" style="margin-top: 6px">
                  <div class="kv"><dt>面试地点</dt><dd>{{ app.address }}</dd></div>
                </dl>
              </template>
            </template>
          </section>
        </template>

        <!-- S-09 待确权 -->
        <template v-if="status === 'PENDING_CONFIRM'">
          <section class="acard okc">
            <div class="row" style="gap: 11px">
              <div class="ok-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
              <div class="flex1">
                <div class="ok-t">面试已通过</div>
                <div class="t-xs" style="color: var(--ok)">等待驻场完成入职确权与电子签约<template v-if="app?.jobTitle"> · {{ app.jobTitle }}</template></div>
              </div>
            </div>
          </section>
          <div class="note note--warn">
            <b>确权超时保护：</b>若劳务公司 24 小时内未完成入职确权，系统将自动清空当前归属，你将回到公域并可重新匹配全平台岗位。
          </div>
        </template>

        <!-- S-10 在岗（V1.0 Sprint 2 仅展示基础信息） -->
        <section v-if="status === 'EMPLOYED'" class="acard">
          <div class="acard-hd"><h4>在岗服务</h4><span class="tag">即将上线</span></div>
          <p class="t-sm" style="line-height: 1.7">考勤、工资条、电子合同、薪资预支等在岗功能将陆续开放。如有问题请联系驻场老师或通过「问题反馈」告诉我们。</p>
        </section>

        <!-- 报名后锁定说明 -->
        <div v-if="appliedLock" class="note note--warn">
          <b>报名后不可再匹配、不可再报名。</b><br />如需更换岗位或取消面试，请联系驻场老师在后台操作取消 —— 你无法自行取消报名。
        </div>

        <!-- 匹配入口 CTA -->
        <section v-if="!matchLocked && status !== 'EMPLOYED'" class="acard cta">
          <div class="cta-t">{{ isPrivate ? '先说说你想要什么活儿' : '还没找到活儿？' }}</div>
          <div class="t-sm" style="margin-top: 3px">7 道题，1 分钟，出 3 个岗位</div>
          <van-button type="primary" block class="btn-cta" style="margin-top: 12px" @click="startMatch">开始 AI 问薪</van-button>
          <button type="button" class="last" @click="router.push('/match/result')">查看上次匹配结果 ›</button>
        </section>

        <QuadGrid :items="quad" @tap="onQuad" />

        <section v-if="appliedLock || status === 'EMPLOYED'" class="acard">
          <div class="acard-hd"><h4>{{ status === 'EMPLOYED' ? '入职进度' : '报名进度' }}</h4><router-link to="/reports" class="more">我的报备 ›</router-link></div>
          <div class="steps">
            <template v-for="(s, i) in progress" :key="s.t">
              <div class="st" :class="s.cls"><i>{{ s.cls === 'done' ? '✓' : i + 1 }}</i>{{ s.t }}</div>
              <div v-if="i < progress.length - 1" class="ln"></div>
            </template>
          </div>
        </section>
        <section v-else class="acard">
          <div class="acard-hd"><h4>动态提醒</h4><router-link to="/messages" class="more">消息中心 ›</router-link></div>
          <div class="empty-box">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.8" /><path d="M3 10h18M8 3v4m8-4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            <div class="t-sm">暂无面试或在岗提醒</div>
            <div class="t-xs" style="margin-top: 4px">完成 AI 问薪并报名后，面试信息将在此展示</div>
          </div>
        </section>
      </div>
    </template>

    <div v-else-if="loading" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else class="state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="reload">重新加载</van-button>
      </van-empty>
    </div>
  </van-pull-refresh>
</template>

<style scoped>
.member { min-height: 100vh; }
.hero-top :deep(.tag-domain) { flex: none; }
.bell { position: relative; flex: none; width: 32px; height: 32px; display: grid; place-items: center; color: rgba(255, 255, 255, .85); background: transparent; border: 0; padding: 0; }
.bell .badge { position: absolute; top: 0; right: -2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--danger); color: #fff; font-size: 10px; font-style: normal; line-height: 16px; text-align: center; box-sizing: border-box; }
.warn { border-color: var(--warn-line); background: var(--warn-bg); }
.warn-t { font-size: 13.5px; font-weight: 700; color: var(--warn); }
.warn-d { color: var(--warn); margin-top: 3px; line-height: 1.6; }
.cta { border-color: var(--signal-300); background: linear-gradient(180deg, var(--signal-50), var(--surface)); }
.cta-t { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.last { display: block; margin: 10px auto 0; background: none; border: 0; font-size: 12px; color: var(--ink-500); }
.tempc { border-color: var(--temp-line); background: var(--temp-bg); }
.temp-h { color: var(--temp) !important; }
.tempd { margin: 10px 0; background: var(--temp-line); }
.jt { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.mt12 { margin-top: 12px; }
.okc { border-color: var(--ok-line); background: var(--ok-bg); }
.ok-ic { width: 36px; height: 36px; border-radius: 11px; background: var(--ok); display: grid; place-items: center; flex: none; }
.ok-t { font-size: 14px; font-weight: 700; color: var(--ok); }
.more { font-size: 11.5px; color: var(--ink-400); text-decoration: none; }
.state { padding-top: calc(80px + env(safe-area-inset-top)); }
</style>
