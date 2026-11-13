<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, useDict } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { CONTRACT_TAG_CLASS, signTarget, termMonths, termText } from '@/utils/contract'
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

async function recheck() {
  if (checking.value) return
  checking.value = true
  try {
    await load(true)
    if (journey.pending) showToast('还未检测到签署结果，签署完成后可能需要几秒钟同步')
  } finally {
    checking.value = false
  }
}

function openSign() {
  const url = c.value?.signUrl
  if (!url) {
    showToast('签署链接暂不可用，请联系驻场老师重新发送')
    return
  }
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
    <div v-else-if="loadError" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round type="primary" size="small" @click="load()">重新加载</van-button>
      </van-empty>
    </div>
    <div v-else-if="!c" class="page-state">
      <van-empty description="当前没有待签署的合同">
        <div class="row" style="justify-content: center; gap: 10px">
          <van-button round size="small" @click="router.replace('/contracts')">我的合同</van-button>
          <van-button round type="primary" size="small" @click="router.replace('/work')">我的工作</van-button>
        </div>
      </van-empty>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard head">
          <div class="row-b" style="margin-bottom: 12px">
            <span class="tag tag--lg" :class="CONTRACT_TAG_CLASS[c.status]"><i class="dot"></i>{{ label('ContractStatus', c.status) }}</span>
            <span class="mono t-xs">{{ c.contractNo }}</span>
          </div>
          <div class="doc">
            <div class="doc-ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /><path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </div>
            <div class="flex1">
              <div class="doc-t">{{ c.title }}</div>
              <div class="t-xs">电子签名 · 签署后永久留存于「我的合同」</div>
            </div>
          </div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>合同摘要</h4></div>
          <dl>
            <div class="kv"><dt>签约公司</dt><dd>{{ c.companyName || '—' }}</dd></div>
            <div class="kv"><dt>岗位</dt><dd>{{ c.jobTitle || '—' }}</dd></div>
            <div v-if="c.projectName" class="kv"><dt>用工项目</dt><dd>{{ c.projectName }}</dd></div>
            <div class="kv"><dt>合同期限</dt><dd class="num">{{ termText(c) }}<template v-if="months">（{{ months }} 个月）</template></dd></div>
            <div class="kv"><dt>发起时间</dt><dd class="num">{{ formatServerTime(c.createdAt) }}</dd></div>
          </dl>
        </section>

        <div class="note note--warn">
          <b>请本人签署。</b>签署将跳转至第三方电子签平台（e签宝）完成，需本人实名认证与短信验证。签署完成并由劳务公司盖章后，你的状态将变为「{{ label('UserStatus', 'EMPLOYED') }}」。
        </div>
        <div class="note note--info">
          如合同信息有误（岗位、期限等），<b>请先不要签署</b>，联系驻场老师修改后重新发送。
        </div>
        <div class="bottom-bar-gap"></div>
      </div>

      <div class="bottom-bar">
        <van-button type="primary" block class="btn-cta" @click="openSign">去签署</van-button>
        <button type="button" class="recheck" :disabled="checking" @click="recheck">{{ checking ? '正在查询…' : '我已完成签署，刷新状态' }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sign { min-height: 100vh; background: var(--surface-2); }
.head { border-color: var(--warn-line); }
.doc { display: flex; align-items: center; gap: 12px; }
.doc-ic { width: 38px; height: 46px; border: 1px solid var(--line-2); border-radius: 5px; display: grid; place-items: center; background: var(--surface-2); color: var(--ink-600); flex: none; }
.doc-t { font-size: 15px; font-weight: 700; color: var(--ink-900); line-height: 1.4; }
.recheck { display: block; margin: 8px auto 0; background: none; border: 0; font-size: 12px; color: var(--ink-500); padding: 2px 8px; }
.bottom-bar-gap { height: calc(110px + env(safe-area-inset-bottom)); }
</style>
