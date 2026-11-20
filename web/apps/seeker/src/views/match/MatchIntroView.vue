<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, useDict } from '@shitu/api-client'
import { IconChevronRight, IconCircleCheck, IconLock, IconMapPin, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useMatchSession } from '@/composables/useMatchSession'

/** S-11 问薪开场（C-301）：展示匹配范围；报名锁定期不可进入；可选授权定位 */
const router = useRouter()
const { label } = useDict()
const { auth, match, profile, locked, appliedLock, lockText } = useMatchSession()

// 进入时刷新档案（锁定态 / 匹配范围要是最新的）并取题库（显示题量）；题库已在本次会话里取过就不再转圈
const total = ref(match.quiz?.questions.length || 7)
const loading = ref(!match.quiz)
const loadError = ref('')
async function load() {
  loading.value = !match.quiz
  loadError.value = ''
  try {
    const [, q] = await Promise.all([auth.loadProfile(), match.loadQuiz()])
    total.value = q.questions.length || 7
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

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
    <AppBar title="AI 问薪" :on-back="() => router.replace('/')" />

    <div v-if="locked" class="state-block">
      <IconLock :size="48" :stroke-width="1.5" />
      <div class="state-block-t">暂不能重新匹配</div>
      <div class="state-block-d">{{ lockText }}。</div>
      <div v-if="appliedLock" class="state-block-d">如需更换岗位，可在「我的报备」里<span class="nw">申请取消报名，</span><span class="nw">驻场老师同意后即可重新匹配。</span></div>
      <template v-if="appliedLock">
        <van-button type="primary" @click="router.push('/reports')">查看我的报备</van-button>
        <button type="button" class="link home" @click="router.replace('/')">返回首页<IconChevronRight :size="16" /></button>
      </template>
      <van-button v-else @click="router.replace('/')">返回首页</van-button>
    </div>

    <div v-else-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard lead">
          <h2>{{ total }} 道题，给你最多 3 个岗位</h2>
          <p class="lead-sub">不用打字，全程点选。回答完成后，系统生成你的求职画像并进行岗位匹配。</p>
        </section>

        <section class="acard">
          <div class="acard-hd">
            <h4>本次匹配范围</h4>
            <span class="status-tag status-tag--info">{{ label('DomainTag', isOwn ? 'PRIVATE' : 'PUBLIC') }}</span>
          </div>
          <div class="sc-t">{{ scopeTitle }}</div>
          <p v-if="scopeDesc" class="sc-d">{{ scopeDesc }}</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>会问你什么</h4></div>
          <dl>
            <div class="ask"><dt class="status-tag">先定方向</dt><dd>是否接受进厂 · 是否锁定地域</dd></div>
            <div class="ask"><dt class="status-tag">再选细节</dt><dd>期望工种 · 薪资 · 班次 · 住宿 · 从业经验</dd></div>
          </dl>
          <div class="note rule">报名前可无限次重新匹配；<b>报名后不可再匹配、不可再报名</b>，直到面试结果产生。</div>
        </section>

        <section class="acard geo">
          <IconMapPin :size="24" class="geo-ic" />
          <div class="flex1">
            <div class="sc-t">使用当前位置（可选）</div>
            <p class="sc-d">
              <template v-if="geo === 'ok'">已获取位置，将优先推荐离你近的岗位</template>
              <template v-else-if="geo === 'denied'">未获取到位置，不影响匹配</template>
              <template v-else-if="geo === 'unsupported'">当前浏览器不支持定位，不影响匹配</template>
              <template v-else>用于优先推荐离你近的岗位，<span class="nw">不授权也能匹配</span></template>
            </p>
          </div>
          <van-button v-if="geo === 'idle' || geo === 'denied'" class="geo-btn" @click="locate">{{ geo === 'denied' ? '重试' : '允许定位' }}</van-button>
          <van-loading v-else-if="geo === 'locating'" size="20" />
          <IconCircleCheck v-else-if="geo === 'ok'" :size="24" class="geo-ok" />
        </section>
        <div class="bottom-bar-gap"></div>
      </div>

      <div class="bottom-bar">
        <van-button type="primary" size="large" block @click="start">
          {{ hasAnswers ? '开始回答（可沿用上次答案）' : `开始回答（第 1 / ${total} 题）` }}
        </van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro { min-height: 100vh; }
.home { margin-top: var(--space-2); min-height: 44px; }
.sc-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.sc-d { margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.ask { display: flex; align-items: flex-start; gap: var(--space-3); }
.ask + .ask { margin-top: var(--space-2); }
.ask dt { flex: none; }
.ask dd { min-width: 0; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.rule { margin-top: var(--space-3); }
.geo { display: flex; align-items: center; gap: var(--space-3); }
.geo-ic { flex: none; color: var(--primary); }
.geo-btn { flex: none; }
.geo-ok { flex: none; color: var(--success-text); }
</style>
