<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDict } from '@shitu/api-client'
import { useMatchSession } from '@/composables/useMatchSession'

/** S-11 问薪开场（C-301）：展示匹配范围；报名锁定期不可进入；可选授权定位 */
const router = useRouter()
const { label } = useDict()
const { auth, match, profile, locked, appliedLock, lockText } = useMatchSession()

// 进入时静默刷新档案，确保锁定态 / 匹配范围是最新的
void auth.loadProfile().catch(() => undefined)
// 预取题库，开场页显示题量
const total = ref(7)
void match
  .loadQuiz()
  .then((q) => (total.value = q.questions.length || 7))
  .catch(() => undefined)

const company = computed(() => profile.value?.boundCompanyName ?? '')
const scope = computed(() => profile.value?.matchScope ?? 'NONE')
const isOwn = computed(() => scope.value === 'OWN_COMPANY' || scope.value === 'INTERNAL_TRANSFER_ONLY')
const scopeTitle = computed(() => {
  if (scope.value === 'OWN_COMPANY') return company.value ? `本公司（${company.value}）岗位` : '本公司岗位'
  if (scope.value === 'ALL_PLATFORM') return '全平台岗位'
  return label('MatchScope', scope.value)
})
const scopeDesc = computed(() => {
  if (scope.value === 'OWN_COMPANY') return '由你的服务公司提供岗位，将在该公司全部项目中为你匹配'
  if (scope.value === 'ALL_PLATFORM') return '将在平台全部劳务公司的岗位中为你匹配，按匹配度排序'
  if (scope.value === 'INTERNAL_TRANSFER_ONLY') return '在岗期间仅可匹配本公司内部调岗岗位'
  return ''
})
const hasAnswers = computed(() => Object.keys(match.answers).length > 0)

/** 可选定位：用于优先推荐离你近的岗位；拒绝不影响匹配 */
type GeoState = 'idle' | 'locating' | 'ok' | 'denied' | 'unsupported'
const geo = ref<GeoState>(match.location ? 'ok' : 'idle')
function locate() {
  if (!('geolocation' in navigator)) {
    geo.value = 'unsupported'
    return
  }
  geo.value = 'locating'
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      match.location = { lng: Number(pos.coords.longitude.toFixed(6)), lat: Number(pos.coords.latitude.toFixed(6)) }
      geo.value = 'ok'
    },
    () => {
      match.location = null
      geo.value = 'denied'
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
  )
}

function start() {
  match.setStep(0)
  void router.push('/match/quiz')
}
</script>

<template>
  <div class="intro">
    <van-nav-bar title="AI 问薪" left-arrow fixed placeholder safe-area-inset-top :border="false" class="dark-bar" @click-left="router.replace('/')" />
    <div class="top">
      <div class="big">{{ total }} 道题<br />给你 <span>3 个岗位</span></div>
      <p>不用打字，全程点选。<br />回答完成后，系统生成你的求职画像并进行岗位匹配。</p>
    </div>

    <div class="pad-x stack body">
      <template v-if="locked">
        <section class="acard lock">
          <div class="big-ic lock-ic">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="2" /></svg>
          </div>
          <h3>暂不能重新匹配</h3>
          <p class="t-sm">{{ lockText }}。</p>
          <p v-if="appliedLock" class="t-xs" style="margin-top: 6px">如需更换岗位，请联系驻场老师在后台取消报名 —— 你不能自行取消。</p>
          <van-button v-if="appliedLock" type="primary" block class="btn-cta" style="margin-top: 14px" @click="router.push('/reports')">查看我的报备</van-button>
          <van-button block class="btn-cta" style="margin-top: 10px" @click="router.replace('/')">返回首页</van-button>
        </section>
      </template>

      <template v-else>
        <section class="acard">
          <div class="acard-hd"><h4>本次匹配范围</h4></div>
          <div class="row" style="gap: 10px">
            <div class="avatar avatar--sm" :class="isOwn ? 'avatar--o' : 'avatar--t'">{{ isOwn ? (company || '本').slice(0, 1) : '全' }}</div>
            <div class="flex1">
              <div class="sc-t">{{ scopeTitle }}</div>
              <div class="t-xs">{{ scopeDesc }}</div>
            </div>
            <span class="tag" :class="isOwn ? 'tag-private' : 'tag-public'">{{ label('DomainTag', isOwn ? 'PRIVATE' : 'PUBLIC') }}</span>
          </div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>会问你什么</h4></div>
          <div class="stack-sm">
            <div class="row"><span class="tag tag-ink">先定方向</span><span class="t-sm">是否接受进厂 · 是否锁定地域</span></div>
            <div class="row" style="align-items: flex-start"><span class="tag">再选细节</span><span class="t-sm">期望工种 · 薪资 · 班次 · 住宿 · 从业经验</span></div>
          </div>
          <div class="note note--info" style="margin-top: 11px">报名前可无限次重新匹配；<b>报名后不可再匹配、不可再报名</b>，直到面试结果产生。</div>
        </section>

        <section class="acard geo">
          <div class="row" style="gap: 10px">
            <div class="geo-ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><circle cx="12" cy="10" r="2.6" fill="currentColor" /></svg>
            </div>
            <div class="flex1">
              <b class="geo-t">使用当前位置（可选）</b>
              <div class="t-xs">
                <template v-if="geo === 'ok'">已获取位置，将优先推荐离你近的岗位</template>
                <template v-else-if="geo === 'denied'">未获取到位置，不影响匹配</template>
                <template v-else-if="geo === 'unsupported'">当前浏览器不支持定位，不影响匹配</template>
                <template v-else>用于优先推荐离你近的岗位，不授权也能匹配</template>
              </div>
            </div>
            <van-button v-if="geo === 'idle' || geo === 'denied'" size="small" round @click="locate">{{ geo === 'denied' ? '重试' : '允许定位' }}</van-button>
            <van-loading v-else-if="geo === 'locating'" size="18" />
            <van-icon v-else-if="geo === 'ok'" name="success" class="geo-ok" />
          </div>
        </section>

        <van-button type="primary" block class="btn-cta start" @click="start">
          {{ hasAnswers ? '开始回答（可沿用上次答案）' : `开始回答（第 1 / ${total} 题）` }}
        </van-button>
      </template>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.intro { min-height: 100vh; background: linear-gradient(180deg, #0d1117 0, #0d1117 300px, var(--surface-2) 300px); }
.dark-bar :deep(.van-nav-bar) { background: #0d1117; }
.dark-bar :deep(.van-nav-bar__title) { color: #fff; font-weight: 700; }
.dark-bar :deep(.van-nav-bar__left .van-icon) { color: #fff; }
.top { padding: 8px 18px 0; color: #fff; }
.big { font-family: var(--f-dis); font-size: 30px; font-weight: 700; line-height: 1.15; }
.big span { color: var(--signal-300); }
.top p { font-size: 13px; color: rgba(255, 255, 255, .6); margin-top: 10px; line-height: 1.7; }
.body { margin-top: 18px; }
.sc-t { font-size: 13.5px; font-weight: 700; color: var(--ink-900); }
.tag-ink { background: var(--ink-900); color: #fff; }
.geo-ic { width: 34px; height: 34px; border-radius: 10px; background: var(--info-bg); color: var(--info); display: grid; place-items: center; flex: none; }
.geo-t { font-size: 13.5px; color: var(--ink-900); display: block; }
.geo-ok { color: var(--ok); font-size: 20px; }
.start { height: 48px !important; }
.lock { text-align: center; padding: 22px 16px; }
.lock-ic { background: var(--temp-bg); color: var(--temp); }
.lock h3 { font-size: 17px; font-weight: 700; color: var(--ink-900); margin-bottom: 6px; }
</style>
