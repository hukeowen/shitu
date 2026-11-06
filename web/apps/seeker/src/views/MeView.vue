<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type KycView, type LaborContractView, type MyWork } from '@shitu/api-client'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { STATUS_TAG_CLASS } from '@/utils/status'
import { formatServerTime } from '@/utils/time'

/**
 * S-26 我的（C-502）：身份卡只展示头像、姓名（实名后脱敏姓名）与状态标签，点击进入「我的工作」；
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

const contractDesc = computed(() => {
  const list = contracts.value?.filter((c) => c.status !== 'VOIDED')
  if (!list) return '电子合同永久留存'
  if (!list.length) return '暂无合同'
  if (list.some((c) => c.status === 'PENDING_SIGN')) return '有 1 份合同待你签署'
  const eff = list.filter((c) => c.status === 'EFFECTIVE').length
  return `${list.length} 份${eff ? ` · ${eff} 份生效中` : ''}`
})
const workDesc = computed(() => {
  const w = work.value
  if (w && !w.endDate && profile.value?.status === 'EMPLOYED') return `${w.projectName || w.jobTitle || '在岗'} · 在岗 ${w.dutyDays} 天`
  const s = profile.value?.status
  if (s === 'PENDING_INTERVIEW' || s === 'PENDING_CONFIRM') return `${label('UserStatus', s)} · 查看应聘信息`
  if (w?.endDate) return `已离职 · ${formatServerTime(w.endDate, false)}`
  return '尚未入职 · 所属公司在这里展示'
})
const pendingRecs = computed(() => journey.pendingRecs.length)
const pendingSign = computed(() => contracts.value?.some((c) => c.status === 'PENDING_SIGN') ?? false)

const rows = [
  { key: 'reports', title: '我的报备', desc: '报名 / 面试进度', to: '/reports' },
  { key: 'messages', title: '消息中心', desc: '面试 / 合同 / 状态变更通知', to: '/messages' },
  { key: 'kyc', title: '实名认证', desc: '报名前需完成，提交后不可修改', to: '/kyc' },
  { key: 'feedback', title: '问题反馈', desc: '投诉、建议、维权求助', to: '/feedback' },
]
const soon = [
  { key: 'resume', title: '我的简历', desc: '完善基础信息', pill: '即将上线' },
  { key: 'refer', title: '推荐裂变', desc: '推荐工友入职得奖励', pill: '预留' },
]

async function onLogout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？', confirmButtonText: '退出' })
  } catch {
    return
  }
  try {
    await auth.logout()
  } catch {
    /* 服务端吊销失败也已清空本地登录态 */
  }
  showToast('已退出登录')
  await router.replace('/')
}
</script>

<template>
  <div class="me">
    <header class="hero">
      <div class="hero-row"><span class="ttl">我的</span></div>
      <button v-if="profile" type="button" class="idcard" @click="router.push('/work')">
        <div class="avatar avatar--o avatar--lg">{{ avatarText }}</div>
        <div class="flex1">
          <div class="name" :class="{ num: displayName === profile.phoneMasked }">{{ displayName }}</div>
          <div class="row" style="gap: 6px; margin-top: 5px; flex-wrap: wrap">
            <span class="tag" :class="STATUS_TAG_CLASS[profile.status]"><i class="dot"></i>{{ label('UserStatus', profile.status) }}</span>
            <span class="tag tag--glass">进入我的工作 ›</span>
          </div>
        </div>
      </button>
      <p class="hero-tip">所属劳务公司信息在「我的工作」中展示</p>
    </header>

    <div class="pad stack">
      <div v-if="!profile && loading" class="acard"><van-loading size="22" vertical>加载中…</van-loading></div>
      <section v-else-if="!profile" class="acard">
        <van-empty image="error" image-size="72" :description="loadError || '加载失败'">
          <van-button round size="small" type="primary" @click="reload">重新加载</van-button>
        </van-empty>
      </section>

      <section class="acard list">
        <router-link to="/contracts" class="lrow">
          <div class="ic ic--info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /><path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
          </div>
          <div class="lt"><b>我的合同</b><span>{{ contractDesc }}</span></div>
          <span v-if="pendingSign" class="tag tag-warn">待签署</span>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <router-link to="/work" class="lrow">
          <div class="ic ic--ok">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.9" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" stroke="currentColor" stroke-width="1.9" /></svg>
          </div>
          <div class="lt"><b>我的工作</b><span>{{ workDesc }}</span></div>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <router-link to="/payslips" class="lrow">
          <div class="ic ic--warn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.9" /><path d="M3 10h18M7 15h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
          </div>
          <div class="lt"><b>我的工资</b><span>按月工资条 · 应发 / 扣款 / 实发</span></div>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <router-link to="/advance/records" class="lrow">
          <div class="ic ic--sig">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9" /><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.6.8-2.6 1.9 0 2.6 5.4 1.3 5.4 4 0 1.2-1.1 2.1-2.8 2.1-1.3 0-2.3-.5-2.8-1.4M12 6.2v11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </div>
          <div class="lt"><b>预支记录</b><span>{{ profile?.status === 'EMPLOYED' ? '预支申请、审批进度与还款' : '历史预支与欠款流水' }}</span></div>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <router-link to="/recommendations" class="lrow">
          <div class="ic ic--sig">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.6" stroke="currentColor" stroke-width="1.9" /><path d="M4.5 20c0-3.6 3.4-5.6 7.5-5.6s7.5 2 7.5 5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
          </div>
          <div class="lt"><b>专属顾问推荐</b><span>{{ pendingRecs ? `${pendingRecs} 个岗位待你确认` : '人才经纪人为你挑选的岗位' }}</span></div>
          <i v-if="pendingRecs" class="badge num">{{ pendingRecs }}</i>
          <van-icon name="arrow" class="chev" />
        </router-link>
      </section>

      <section class="acard list">
        <router-link v-for="r in rows" :key="r.key" :to="r.to" class="lrow">
          <div class="lt"><b>{{ r.title }}</b><span>{{ r.key === 'kyc' && profile?.kycStatus === 'VERIFIED' ? '已完成实名认证' : r.desc }}</span></div>
          <i v-if="r.key === 'messages' && inbox.unread > 0" class="badge num">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</i>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <button v-for="r in soon" :key="r.key" type="button" class="lrow" @click="showToast('即将上线')">
          <div class="lt"><b>{{ r.title }}</b><span>{{ r.desc }}</span></div>
          <span class="tag">{{ r.pill }}</span>
        </button>
      </section>

      <section v-if="profile" class="acard">
        <div class="acard-hd"><h4>身份档案</h4></div>
        <dl>
          <div class="kv"><dt>用户 ID</dt><dd class="num">{{ profile.userId }}</dd></div>
          <div class="kv"><dt>手机号</dt><dd class="num">{{ profile.phoneMasked }}</dd></div>
          <div class="kv"><dt>匹配范围</dt><dd>{{ label('MatchScope', profile.matchScope) }}</dd></div>
          <div class="kv"><dt>来源</dt><dd>{{ profile.sourceIsPlatform ? '平台自主注册' : '渠道注册' }}</dd></div>
          <div class="kv"><dt>注册时间</dt><dd class="num">{{ formatServerTime(profile.registeredAt) }}</dd></div>
        </dl>
      </section>

      <van-button block class="btn-cta logout" @click="onLogout">退出登录</van-button>

      <p class="t-xs foot">
        <template v-if="profile">用户 ID {{ profile.userId }} · </template>仕兔 V1.0.0<br />平台仅提供匹配服务，不直接雇佣
      </p>
    </div>
  </div>
</template>

<style scoped>
.hero { padding-bottom: 22px; }
.hero-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.ttl { font-size: 15px; font-weight: 700; }
.idcard { display: flex; align-items: center; gap: 12px; width: 100%; padding: 0; background: none; border: 0; text-align: left; color: #fff; }
.name { font-size: 18px; font-weight: 700; }
.hero-tip { font-size: 11px; color: rgba(255, 255, 255, .42); margin-top: 12px; }
.list { padding: 0; overflow: hidden; }
.list .lrow { text-decoration: none; color: inherit; border-left: 0; border-right: 0; border-top: 0; }
.ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex: none; }
.ic--info { background: var(--info-bg); color: var(--info); }
.ic--ok { background: var(--ok-bg); color: var(--ok); }
.ic--sig { background: var(--signal-50); color: var(--signal); }
.ic--warn { background: var(--warn-bg); color: var(--warn); }
.badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--danger); color: #fff; font-size: 10.5px; font-style: normal; line-height: 18px; text-align: center; box-sizing: border-box; flex: none; }
.logout { color: var(--danger); border-color: var(--danger-line); }
.foot { text-align: center; padding: 6px 0 16px; line-height: 1.7; }
</style>
