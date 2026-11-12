<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, useDict } from '@shitu/api-client'
import { IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { CONTRACT_TONE, signTarget, termMonths, termText } from '@/utils/contract'
import { formatServerTime } from '@/utils/time'

/**
 * 待签署劳动合同（S-09 入口 → e签宝）：面试通过后驻场发起入职确权，系统生成合同并给出签署链接。
 * 签署在 e签宝完成，结果以 e签宝服务端回调为准；签完回到本页（或切回前台）时自动刷新状态。
 */
const router = useRouter()
const auth = useAuthStore()
const journey = useJourney()
const { label } = useDict()

const loading = ref(!journey.pendingLoaded)
const loadError = ref('')
const checking = ref(false)
/** 点了「刷新状态」但还没签完：原因留在按钮下方，轻提示两秒就没了 */
const notYet = ref('')
const c = computed(() => journey.pending)

async function load(silent = false) {
  if (!silent) loading.value = !journey.pendingLoaded
  loadError.value = ''
  try {
    const p = await journey.loadPending()
    if (!p) await afterSigned()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

/** 没有待签合同：已签完则进「我的工作」，否则停在空状态 */
async function afterSigned() {
  try {
    const p = await auth.loadProfile()
    if (p.status === 'EMPLOYED') {
      showToast({ type: 'success', message: '签署完成，已入职在岗' })
      await router.replace('/work')
    }
  } catch {
    /* 空状态页仍可返回 */
  }
}

function retry() {
  loading.value = true
  void load(true)
}

async function recheck() {
  if (checking.value) return
  checking.value = true
  notYet.value = ''
  try {
    await load(true)
    if (journey.pending) notYet.value = '还未检测到签署结果，签署完成后可能需要几秒钟同步'
  } finally {
    checking.value = false
  }
  if (notYet.value) showToast(notYet.value)
}

function openSign() {
  // 没有链接时按钮是置灰的，点不到这里
  const url = c.value?.signUrl
  if (!url) return
  const t = signTarget(url)
  if ('internal' in t) void router.push(t.internal)
  else window.location.href = t.external
}

// 从 e签宝 返回（或切回微信前台）时刷新
function onVisible() {
  if (document.visibilityState === 'visible' && journey.pending) void load(true)
}
onMounted(() => {
  void load()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

const months = computed(() => (c.value ? termMonths(c.value) : null))
</script>

<template>
  <div class="sign">
    <AppBar title="签署劳动合同" fallback="/" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="retry">重新加载</van-button>
    </div>
    <div v-else-if="!c" class="state-block">
      <IconInbox :size="48" :stroke-width="1.5" />
      <div class="state-block-t">当前没有待签署的合同</div>
      <div class="state-block-d">面试通过、驻场办理入职后，合同会出现在这里</div>
      <van-button type="primary" @click="router.replace('/work')">我的工作</van-button>
      <van-button class="second" @click="router.replace('/contracts')">我的合同</van-button>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard">
          <div class="item-hd">
            <h1>{{ c.title }}</h1>
            <span class="status-tag" :class="CONTRACT_TONE[c.status]">{{ label('ContractStatus', c.status) }}</span>
          </div>
          <p class="item-meta code">{{ c.contractNo }}</p>
          <p class="item-meta">电子签名 · 签署后永久留存于「我的合同」</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>合同摘要</h4></div>
          <dl class="facts">
            <div class="kv top"><dt>签约公司</dt><dd>{{ c.companyName || '—' }}</dd></div>
            <div class="kv"><dt>派遣岗位</dt><dd>{{ c.jobTitle || '—' }}</dd></div>
            <div v-if="c.projectName" class="kv"><dt>用工项目</dt><dd>{{ c.projectName }}</dd></div>
            <div class="kv top"><dt>合同期限</dt><dd>{{ termText(c) }}<span v-if="months" class="sub">共 {{ months }} 个月</span></dd></div>
            <div class="kv"><dt>发起时间</dt><dd>{{ formatServerTime(c.createdAt) }}</dd></div>
          </dl>
        </section>

        <section class="tipbar tipbar--warn">
          <IconTriangleExclamationPoint :size="20" />
          <div class="flex1">
            <div class="tipbar-t">请本人签署</div>
            <div class="tipbar-d">签署将跳转至第三方电子签平台（e签宝）完成，需本人实名认证与短信验证。签署完成并由劳务公司盖章后，你的状态将变为「{{ label('UserStatus', 'EMPLOYED') }}」。</div>
            <div class="tipbar-d">如合同信息有误（岗位、期限等），请先不要签署，联系驻场老师修改后重新发送。</div>
          </div>
        </section>

        <section class="acard">
          <p class="para">已经在电子签平台签完？结果同步可能需要几秒钟。</p>
          <van-button block class="mt" :loading="checking" loading-text="正在查询…" @click="recheck">我已完成签署，刷新状态</van-button>
          <p v-if="notYet" class="miss" role="status"><IconTriangleExclamationPoint :size="16" />{{ notYet }}</p>
        </section>
        <div class="bottom-bar-gap" :class="{ tall: !c.signUrl }"></div>
      </div>

      <div class="bottom-bar">
        <p v-if="!c.signUrl" class="why">签署链接暂不可用，请联系驻场老师重新发送</p>
        <van-button type="primary" size="large" block :disabled="!c.signUrl" @click="openSign">去签署</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sign { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.item-hd h1 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); overflow-wrap: anywhere; }
.code { font-family: var(--font-mono); overflow-wrap: anywhere; }
.facts dd { word-break: normal; overflow-wrap: anywhere; }
.kv.top { align-items: flex-start; }
.sub { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); line-height: 20px; color: var(--text-3); }
/* 折行时不留孤字 */
.para, .tipbar-d { text-wrap: pretty; }
.mt { margin-top: var(--space-3); }
.state-block .second { margin-top: var(--space-2); }
.miss { display: flex; align-items: flex-start; gap: var(--space-1); margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--warning-text); }
.miss svg { flex: none; margin-top: 3px; }
.why { margin-bottom: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--warning-text); text-align: center; }
.bottom-bar-gap.tall { height: calc(108px + env(safe-area-inset-bottom)); }
</style>
