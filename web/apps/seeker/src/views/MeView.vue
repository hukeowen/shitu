<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type KycView, type LaborContractView, type MyWork } from '@shitu/api-client'
import {
  IconBell, IconBookOpen, IconBriefcase, IconChevronRight, IconClipboardList, IconFilePenLine, IconFileText, IconHeadset, IconIdCard,
  IconMessageSquare, IconReceipt, IconShieldCheck, IconTriangleExclamationPoint, IconWallet,
} from '@shitu/ui-icons'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { STATUS_TONE } from '@/utils/status'
import { formatServerTime } from '@/utils/time'

/**
 * S-26 我的（C-502）：资料卡展示头像、姓名（实名后脱敏姓名）、打码的手机号与状态标签，点击进入「我的工作」；
 * 所属劳务公司按原型只在「我的工作」中展示（隐私设计）。
 */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const inbox = useInboxStore()
const journey = useJourney()
void inbox.refresh()
const profile = computed(() => auth.profile)
const loading = ref(false)
const loadError = ref('')

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    await auth.loadProfile()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
if (!auth.profile) void reload()

// 入口摘要（失败不影响页面）
const kyc = ref<KycView | null>(null)
const contracts = ref<LaborContractView[] | null>(null)
const work = ref<MyWork | null | undefined>(undefined)
void seekerApi.kyc().then((k) => (kyc.value = k)).catch(() => undefined)
void seekerApi.contracts().then((c) => (contracts.value = c)).catch(() => undefined)
void seekerApi.work().then((w) => (work.value = w ?? null)).catch(() => undefined)
void journey.loadRecs().catch(() => undefined)

const displayName = computed(() => (kyc.value?.kycStatus === 'VERIFIED' && kyc.value.realNameMasked ? kyc.value.realNameMasked : profile.value?.phoneMasked ?? ''))
const avatarText = computed(() => (kyc.value?.kycStatus === 'VERIFIED' && kyc.value.realNameMasked ? kyc.value.realNameMasked.slice(0, 1) : '我'))

// 资料没加载到（加载中、失败）时，和身份有关的几行不下「暂无合同」「尚未入职」这类结论
const BLANK = '—'
const contractDesc = computed(() => {
  if (!profile.value) return BLANK
  const list = contracts.value?.filter((c) => c.status !== 'VOIDED')
  if (!list) return '电子合同永久留存'
  if (!list.length) return '暂无合同'
  if (list.some((c) => c.status === 'PENDING_SIGN')) return '有 1 份合同待你签署'
  const eff = list.filter((c) => c.status === 'EFFECTIVE').length
  return `${list.length} 份${eff ? ` · ${eff} 份生效中` : ''}`
})
const workDesc = computed(() => {
  if (!profile.value) return BLANK
  const w = work.value
  if (w && !w.endDate && profile.value?.status === 'EMPLOYED') return `${w.projectName || w.jobTitle || '在岗'} · 在岗 ${w.dutyDays} 天`
  const s = profile.value?.status
  if (s === 'PENDING_INTERVIEW' || s === 'PENDING_CONFIRM') return `${label('UserStatus', s)} · 查看应聘信息`
  if (w?.endDate) return `已离职 · ${formatServerTime(w.endDate, false)}`
  return '尚未入职 · 所属公司在这里展示'
})
const advanceDesc = computed(() => {
  if (!profile.value) return BLANK
  return profile.value.status === 'EMPLOYED' ? '预支申请、审批进度与还款' : '历史预支与欠款流水'
})
const pendingRecs = computed(() => journey.pendingRecs.length)
/** 专属顾问推荐入口的说明：只有专属顾问跟进中的求职者才说「正在挑选」 */
const recDesc = computed(() => {
  if (pendingRecs.value) return `${pendingRecs.value} 个岗位待你确认`
  if (journey.recs.length) return `顾问推荐过 ${journey.recs.length} 个岗位`
  const p = profile.value
  const busy = p?.status === 'PENDING_INTERVIEW' || p?.status === 'PENDING_CONFIRM' || p?.status === 'EMPLOYED'
  if (p?.boundCompanyName && p.domainTag === 'PRIVATE' && !busy) return '专属顾问为你人工挑选的岗位'
  if (!p?.boundCompanyName) return '有劳务公司顾问为你推荐岗位时会显示在这里'
  return '暂无推荐 · 顾问挑选岗位后在这里展示'
})
/** 身份卡入口按状态区分：在岗 → 我的工作；有进行中的报名 → 报名进度；其余 → 简历（不提「所属劳务公司」） */
const idEntry = computed<{ chip: string; to: string; tip: string }>(() => {
  const s = profile.value?.status
  if (s === 'EMPLOYED') return { chip: '进入我的工作', to: '/work', tip: '所属劳务公司信息在「我的工作」中展示' }
  if (s === 'PENDING_INTERVIEW' || s === 'PENDING_CONFIRM') return { chip: '查看报名进度', to: '/reports', tip: '面试与入职办理进度在「我的报备」中查看' }
  return { chip: '完善我的简历', to: '/resume', tip: '入职后，在岗信息会在「我的工作」中展示' }
})
const pendingSign = computed(() => contracts.value?.some((c) => c.status === 'PENDING_SIGN') ?? false)

const rows = [
  { key: 'reports', title: '我的报备', desc: '报名 / 面试进度', to: '/reports', icon: IconClipboardList },
  { key: 'resume', title: '我的简历', desc: '期望工种、技能、紧急联系人与用工档案', to: '/resume', icon: IconFilePenLine },
  { key: 'ledger', title: '我的台账', desc: '报名、面试、入职、工资的全部记录', to: '/ledger', icon: IconBookOpen },
  { key: 'messages', title: '消息中心', desc: '面试 / 合同 / 状态变更通知', to: '/messages', icon: IconBell },
  { key: 'kyc', title: '实名认证', desc: '报名前需完成，提交后不可修改', to: '/kyc', icon: IconIdCard },
  { key: 'appeals', title: '我的申诉', desc: '身份证被占用 / 账号受限的申诉进度', to: '/kyc/appeals', icon: IconShieldCheck },
  { key: 'feedback', title: '问题反馈', desc: '投诉、建议、维权求助', to: '/feedback', icon: IconMessageSquare },
]

const loggingOut = ref(false)
async function onLogout() {
  if (loggingOut.value) return
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？', confirmButtonText: '退出' })
  } catch {
    return
  }
  loggingOut.value = true
  try {
    await auth.logout()
  } catch {
    /* 服务端吊销失败也已清空本地登录态 */
  }
  loggingOut.value = false
  showToast('已退出登录')
  await router.replace('/')
}
</script>

<template>
  <div class="me">
    <van-nav-bar title="我的" fixed placeholder safe-area-inset-top z-index="50" />

    <div class="pad stack">
      <button v-if="profile" type="button" class="acard me-card" @click="router.push(idEntry.to)">
        <span class="me-top">
          <span class="avatar avatar--lg">{{ avatarText }}</span>
          <span class="flex1">
            <b class="me-name">{{ displayName }}</b>
            <span v-if="displayName !== profile.phoneMasked" class="me-phone">{{ profile.phoneMasked }}</span>
            <span class="me-tags"><span class="status-tag" :class="STATUS_TONE[profile.status]">{{ label('UserStatus', profile.status) }}</span></span>
          </span>
          <span class="link">{{ idEntry.chip }}<IconChevronRight :size="16" /></span>
        </span>
        <span class="me-tip">{{ idEntry.tip }}</span>
      </button>
      <div v-else-if="loading" class="acard page-state in-card"><van-loading size="28" vertical>加载中…</van-loading></div>
      <section v-else class="acard">
        <div class="state-block state-block--sm">
          <IconTriangleExclamationPoint :size="32" :stroke-width="1.5" />
          <div class="state-block-t">{{ loadError || '加载失败' }}</div>
          <van-button @click="reload">重新加载</van-button>
        </div>
      </section>

      <section class="acard me-group">
        <router-link to="/contracts" class="lrow">
          <IconFileText :size="20" class="ic" />
          <div class="lt"><b>我的合同</b><span>{{ contractDesc }}</span></div>
          <span v-if="pendingSign" class="status-tag status-tag--warning">待签署</span>
          <IconChevronRight :size="16" class="chev" />
        </router-link>
        <router-link to="/work" class="lrow">
          <IconBriefcase :size="20" class="ic" />
          <div class="lt"><b>我的工作</b><span>{{ workDesc }}</span></div>
          <IconChevronRight :size="16" class="chev" />
        </router-link>
        <router-link to="/payslips" class="lrow">
          <IconReceipt :size="20" class="ic" />
          <div class="lt"><b>我的工资</b><span>按月工资条 · 应发 / 扣款 / 实发</span></div>
          <IconChevronRight :size="16" class="chev" />
        </router-link>
        <router-link to="/advance/records" class="lrow">
          <IconWallet :size="20" class="ic" />
          <div class="lt"><b>预支记录</b><span>{{ advanceDesc }}</span></div>
          <IconChevronRight :size="16" class="chev" />
        </router-link>
        <router-link to="/recommendations" class="lrow">
          <IconHeadset :size="20" class="ic" />
          <div class="lt"><b>{{ profile?.boundCompanyName ? '专属顾问推荐' : '顾问推荐' }}</b><span>{{ recDesc }}</span></div>
          <i v-if="pendingRecs" class="cnt">{{ pendingRecs }}</i>
          <IconChevronRight :size="16" class="chev" />
        </router-link>
      </section>

      <section class="acard me-group">
        <router-link v-for="r in rows" :key="r.key" :to="r.to" class="lrow">
          <component :is="r.icon" :size="20" class="ic" />
          <div class="lt"><b>{{ r.title }}</b><span>{{ r.key === 'kyc' && profile?.kycStatus === 'VERIFIED' ? '已完成实名认证' : r.desc }}</span></div>
          <i v-if="r.key === 'messages' && inbox.unread > 0" class="cnt">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</i>
          <IconChevronRight :size="16" class="chev" />
        </router-link>
      </section>

      <section v-if="profile" class="acard">
        <div class="acard-hd"><h4>身份档案</h4></div>
        <dl>
          <div class="kv"><dt>用户 ID</dt><dd>{{ profile.userId }}</dd></div>
          <div class="kv"><dt>手机号</dt><dd>{{ profile.phoneMasked }}</dd></div>
          <div class="kv"><dt>匹配范围</dt><dd>{{ label('MatchScope', profile.matchScope) }}</dd></div>
          <div class="kv"><dt>来源</dt><dd>{{ profile.sourceIsPlatform ? '平台自主注册' : '渠道注册' }}</dd></div>
          <div class="kv"><dt>注册时间</dt><dd>{{ formatServerTime(profile.registeredAt) }}</dd></div>
        </dl>
      </section>

      <van-button block plain type="danger" :loading="loggingOut" loading-text="退出登录" @click="onLogout">退出登录</van-button>

      <p class="foot">
        <template v-if="profile">用户 ID {{ profile.userId }} · </template>仕兔 V1.0.0<br />平台仅提供匹配服务，不直接雇佣
      </p>
    </div>
  </div>
</template>

<style scoped>
.me { min-height: 100vh; }
.me-card { display: block; width: 100%; border: 0; text-align: left; }
.me-card:active { background: var(--bg-hover); }
.me-top { display: flex; align-items: center; gap: var(--space-3); }
.me-name { display: block; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); overflow-wrap: anywhere; }
.me-phone { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.me-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.me-top .link { flex: none; align-self: center; min-height: 44px; }
.me-tip { display: block; margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.in-card { padding: var(--space-6) 0; }
.me-group { padding: 0; overflow: hidden; }
.me-group .lrow { text-decoration: none; color: inherit; }
.ic { flex: none; color: var(--text-2); }
/* 数字角标：危险文字色底配白字（和首页铃铛上的角标同一种用法） */
.cnt { flex: none; min-width: 18px; height: 18px; padding: 0 var(--space-1); border-radius: 9px; background: var(--danger-text); color: var(--text-on-primary); font-size: var(--font-size-min); font-style: normal; line-height: 18px; text-align: center; box-sizing: border-box; }
.foot { padding: var(--space-1) 0 var(--space-4); font-size: var(--font-size-min); line-height: 20px; color: var(--text-3); text-align: center; }
</style>
