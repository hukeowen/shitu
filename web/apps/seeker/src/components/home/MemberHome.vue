<script setup lang="ts">
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import { DomainTag } from '@shitu/ui-mobile'
import { errorMessage, useDict } from '@shitu/api-client'
import QuadGrid from '@/components/QuadGrid.vue'
import type { QuadItem } from '@/components/quad'
import { useCountdown } from '@/composables/useCountdown'
import { useAuthStore } from '@/stores/auth'
import { parseServerTime } from '@/utils/time'
import { STATUS_TAG_CLASS, heroClass } from '@/utils/status'

/** 登录后首页（C-201 Sprint 1 范围）：S-06 公域求职 / S-07 私域待匹配（24h 专属跟进窗口） */
const auth = useAuthStore()
const { label } = useDict()

const profile = computed(() => auth.profile)
const loading = ref(false)
const loadError = ref('')
const refreshing = ref(false)

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

async function onPullRefresh() {
  await reload()
  refreshing.value = false
}

const isPrivate = computed(() => profile.value?.domainTag === 'PRIVATE' || profile.value?.domainTag === 'TEMP_PRIVATE')
const company = computed(() => profile.value?.boundCompanyName ?? '')

const WINDOW_MS = 24 * 3600 * 1000
const deadline = computed(() => parseServerTime(profile.value?.responseDeadline))
// 到期后后端会把用户被动释放为公域，重新拉取档案
const cd = useCountdown(deadline, () => setTimeout(() => void reload(), 1500))
const ringDash = computed(() => {
  const C = 138
  const frac = Math.min(1, cd.remaining.value / WINDOW_MS)
  return `${(C * frac).toFixed(1)} ${C}`
})

const scopeText = computed(() => {
  const p = profile.value
  if (!p) return ''
  if (p.matchScope === 'OWN_COMPANY' && company.value) return `仅${company.value}岗位`
  return `匹配范围：${label('MatchScope', p.matchScope)}`
})

const quad = computed<QuadItem[]>(() => {
  const employed = profile.value?.status === 'EMPLOYED'
  return [
    { key: 'match', title: 'AI 问薪', desc: isPrivate.value && company.value ? `匹配${company.value}岗位` : '7 题定岗' },
    { key: 'refer', title: '推荐裂变', desc: '推荐工友得奖励', pill: '预留' },
    { key: 'advance', title: '薪资预支', desc: '需已入职在岗', off: !employed },
    { key: 'points', title: '工分变现', desc: '需已入职在岗', off: !employed, pill: 'V1.5' },
  ]
})

function startMatch() {
  // TODO(Sprint 2): 进入 AI 问薪（C-2xx），canStartMatching=false 时按后端提示禁用
  if (profile.value && !profile.value.canStartMatching) {
    showToast('当前状态暂不能发起匹配')
    return
  }
  showToast('AI 问薪即将上线')
}

function onQuad(it: QuadItem) {
  if (it.key === 'match') return startMatch()
  if (it.off) return showToast('入职在岗后可用')
  showToast('即将上线')
}
</script>

<template>
  <van-pull-refresh v-model="refreshing" class="member" @refresh="onPullRefresh">
    <template v-if="profile">
      <header class="hero" :class="heroClass(profile.domainTag)">
        <div class="hero-top">
          <div class="avatar" :class="isPrivate ? 'avatar--o' : 'avatar--t'">我</div>
          <div class="who"><b>{{ profile.phoneMasked }}</b><span>{{ profile.userId }}</span></div>
          <DomainTag :domain="profile.domainTag" />
        </div>
        <div class="hero-state">
          <span class="tag tag--lg" :class="STATUS_TAG_CLASS[profile.status]"><i class="dot"></i>{{ label('UserStatus', profile.status) }}</span>
          <span class="tag tag--glass">{{ scopeText }}</span>
        </div>
        <div v-if="isPrivate" class="hero-meta">
          <div>归属公司<b>{{ company || '—' }}</b></div>
          <div v-if="cd.active.value">专属跟进剩余<b class="num">{{ cd.text.value }}</b></div>
        </div>
        <p v-else class="hero-desc">当前无归属公司，可匹配平台全部劳务公司岗位</p>
      </header>

      <div class="pad stack">
        <!-- S-07 24h 专属跟进窗口 -->
        <section v-if="isPrivate && cd.active.value" class="acard warn">
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
        <section v-else-if="isPrivate && company" class="note">
          你的专属顾问来自 <b>{{ company }}</b>，匹配范围为该公司旗下岗位。
        </section>

        <section class="acard cta">
          <div class="row" style="gap: 12px">
            <div class="flex1">
              <div class="cta-t">{{ isPrivate ? '先说说你想要什么活儿' : '还没找到活儿？' }}</div>
              <div class="t-sm" style="margin-top: 3px">7 道题，1 分钟，出 3 个岗位</div>
            </div>
          </div>
          <van-button type="primary" block class="btn-cta" style="margin-top: 12px" @click="startMatch">开始 AI 问薪</van-button>
        </section>

        <QuadGrid :items="quad" @tap="onQuad" />

        <section class="acard">
          <div class="acard-hd"><h4>动态提醒</h4></div>
          <div class="empty-box">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.8" /><path d="M3 10h18M8 3v4m8-4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            <div class="t-sm">暂无面试或在岗提醒</div>
            <div class="t-xs" style="margin-top: 4px">完成 AI 问薪后，报名进度将在此展示</div>
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
.warn { border-color: var(--warn-line); background: var(--warn-bg); }
.warn-t { font-size: 13.5px; font-weight: 700; color: var(--warn); }
.warn-d { color: var(--warn); margin-top: 3px; line-height: 1.6; }
.cta { border-color: var(--signal-300); background: linear-gradient(180deg, var(--signal-50), var(--surface)); }
.cta-t { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.state { padding-top: calc(80px + env(safe-area-inset-top)); }
</style>
