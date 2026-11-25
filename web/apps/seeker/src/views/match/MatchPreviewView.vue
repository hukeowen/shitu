<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { IconBuildingComplex, IconCircleExclamationPoint, IconInbox, IconLock, IconMapPin } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useMatchSession } from '@/composables/useMatchSession'
import { useChannelStore } from '@/stores/channel'
import { fmtSalary } from '@/utils/format'

/**
 * 游客预览结果（D-62 先答题后登录）：只给看岗位名、工资、吃住、城市和推荐理由，公司名、地址、名额登录后才显示。
 * 点「看完整岗位 / 报名」→ 手机号登录 → /match/continue 用同一份答案跑正式匹配 → 正常的匹配结果页。
 */
const router = useRouter()
const { auth, match } = useMatchSession()
const channel = useChannelStore()

// 已登录的人不看预览，直接看正式结果
if (auth.isLoggedIn) void router.replace('/match/result')

const preview = computed(() => match.preview)
const results = computed(() => (preview.value?.results ?? []).slice(0, 3))
/** 扫公司二维码进来的人本来就知道是哪家公司：卡片直接写这家公司，只把地址、名额留到登录后 */
const knownFirm = computed(() => (preview.value?.privateScope ? channel.inviter ?? null : null))
const scopeText = computed(() => (preview.value?.privateScope ? `${channel.inviter ?? '邀请你的劳务公司'}在招的岗位` : '全平台在招的岗位'))

const perk = (j: { mealProvided: boolean; dormProvided: boolean }) =>
  j.mealProvided && j.dormProvided ? '包吃包住' : j.mealProvided ? '包吃' : j.dormProvided ? '包住' : ''

function goLogin() {
  match.keepForLogin()
  void router.push({ path: '/login', query: { redirect: '/match/continue' } })
}
function retry() {
  match.setStep(0)
  void router.replace('/match/quiz')
}
</script>

<template>
  <div class="preview">
    <AppBar title="先看看有哪些活" fallback="/" :on-back="() => router.replace('/')" />

    <div v-if="!preview" class="state-block">
      <IconInbox :size="48" :stroke-width="1.5" />
      <div class="state-block-t">还没有结果</div>
      <div class="state-block-d">先答 7 道题，看看有哪些活</div>
      <van-button type="primary" @click="router.replace('/match')">开始答题</van-button>
    </div>

    <div v-else-if="preview.matched && results.length" class="pad stack">
      <header class="hd">
        <h1>有 {{ results.length }} 个活跟你对得上</h1>
        <p>找的是{{ scopeText }} · 登录后看完整信息再报名</p>
      </header>

      <article v-for="j in results" :key="j.rank" class="acard jc">
        <div class="jc-hd">
          <h3>{{ j.title }}</h3>
          <span v-if="j.rank === 1" class="status-tag status-tag--info">最对得上</span>
        </div>
        <p class="salary"><b>{{ fmtSalary(j.salaryMin, j.salaryMax) }}</b><span>元/月（综合）</span></p>
        <p v-if="perk(j)" class="perk"><span class="chip-perk">{{ perk(j) }}</span></p>
        <ul class="facts">
          <li v-if="j.city"><IconMapPin :size="18" />{{ j.city }}<template v-if="j.district"> {{ j.district }}</template></li>
        </ul>
        <div v-if="j.reason" class="reason">
          <b>推荐理由</b>
          <p>{{ j.reason }}</p>
        </div>
        <p class="firm">
          <IconBuildingComplex :size="16" />
          <span>{{ knownFirm ?? j.companyHint }}<span class="lock"><IconLock :size="12" />{{ knownFirm ? '地址、名额登录后显示' : '公司名、地址、名额登录后显示' }}</span></span>
        </p>
        <van-button block :type="j.rank === 1 ? 'primary' : 'default'" :class="{ second: j.rank !== 1 }" @click="goLogin">看完整岗位 / 报名</van-button>
      </article>

      <p v-if="preview.salaryByRank" class="fine">没问你想要多少工资，工资是按到手工资高低帮你排的：条件差不多的岗位，工资高的排前面。</p>
      <p class="fine">登录后会按你的账号重新确认岗位和名额，结果可能略有不同。</p>
      <van-button block @click="retry">不满意，换个条件再答</van-button>
      <div class="page-bottom-gap"></div>
    </div>

    <div v-else class="pad stack">
      <section class="acard">
        <div class="state-block none">
          <IconCircleExclamationPoint :size="48" :stroke-width="1.5" />
          <div class="state-block-t">暂时没有特别合适的岗位</div>
          <div class="state-block-d">放宽地域、工种或班次要求，再试一次。</div>
          <div class="state-block-d">也可以登录，让专属顾问帮你找。</div>
        </div>
      </section>
      <van-button type="primary" block @click="retry">换个条件再答</van-button>
      <van-button block @click="goLogin">登录 / 注册</van-button>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.preview { min-height: 100vh; }
.hd h1 { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.hd p { margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.jc-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.jc-hd h3 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.jc-hd .status-tag { flex: none; margin-top: 2px; }
.facts { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-5); margin-top: var(--space-3); font-size: var(--font-size-body); color: var(--text-1); }
.facts li { display: flex; align-items: center; gap: var(--space-1); }
.facts svg { flex: none; color: var(--text-3); }
.reason { margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--primary-bg); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.reason b { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--primary-text); }
.firm { display: flex; align-items: flex-start; gap: var(--space-2); margin: var(--space-3) 0; padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-2); }
.firm svg { flex: none; margin-top: 2px; color: var(--text-3); }
.lock { display: flex; align-items: center; gap: 2px; color: var(--text-3); }
.second { border-color: var(--primary-line); color: var(--primary-text); }
.fine { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.none { padding: var(--space-4) 0; }
.none > svg { color: var(--warning-text); }
</style>
