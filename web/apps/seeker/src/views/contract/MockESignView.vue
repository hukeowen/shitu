<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type KycView, type LaborContractView } from '@shitu/api-client'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { termText } from '@/utils/contract'
import { formatServerTime } from '@/utils/time'

/**
 * 【仅开发环境】模拟 e签宝 签署页：Mock 电子签生成的签署链接指向这里。
 * 「同意并签署」→ 后端模拟 e签宝推送签署完成回调 → 入职生效。生产环境签署页在 e签宝，不会进入本页。
 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const journey = useJourney()

const flowId = computed(() => String(route.params.flowId))
const c = ref<LaborContractView | null>(null)
const kyc = ref<KycView | null>(null)
const loading = ref(true)
const loadError = ref('')
const agreed = ref(false)
const signing = ref(false)
const done = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [p, k] = await Promise.all([journey.loadPending(), seekerApi.kyc().catch(() => null)])
    kyc.value = k
    c.value = p && p.signUrl?.includes(flowId.value) ? p : null
    if (!c.value) loadError.value = '签署链接已失效（合同已签署或已重新发送）'
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const party = computed(() => kyc.value?.realNameMasked || auth.profile?.phoneMasked || '乙方')

async function sign() {
  if (!agreed.value) {
    showToast('请先阅读并勾选同意合同条款')
    return
  }
  if (signing.value) return
  signing.value = true
  try {
    await seekerApi.mockSign(flowId.value)
    done.value = true
    journey.pending = null
    try {
      await auth.loadProfile()
    } catch {
      /* 我的工作页会再拉档案 */
    }
  } catch (e) {
    if (isApiError(e, 'SYS_4040')) showToast('签署链接已失效，或当前环境不支持模拟签署')
    else showToast(errorMessage(e, '签署失败，请稍后重试'))
  } finally {
    signing.value = false
  }
}
</script>

<template>
  <div class="es">
    <header class="es-bar">
      <span class="logo">e</span>
      <div class="flex1"><b>电子签署</b><span>模拟 e签宝 · 仅开发环境</span></div>
      <span class="tag tag-warn">MOCK</span>
    </header>

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>

    <div v-else-if="done" class="pad stack">
      <section class="acard ok">
        <div class="big-ic ok-ic">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </div>
        <div class="ok-t">签署完成</div>
        <p class="t-sm" style="margin-top: 6px">合同已生效并归档，你已正式入职在岗。</p>
      </section>
      <van-button type="primary" block class="btn-cta" @click="router.replace('/work')">查看我的工作</van-button>
      <van-button block class="btn-cta" @click="router.replace('/contracts')">查看我的合同</van-button>
    </div>

    <div v-else-if="loadError || !c" class="page-state">
      <van-empty image="error" :description="loadError">
        <div class="row" style="justify-content: center; gap: 10px">
          <van-button round size="small" @click="router.replace('/contracts')">我的合同</van-button>
          <van-button round type="primary" size="small" @click="router.replace('/')">返回首页</van-button>
        </div>
      </van-empty>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard">
          <div class="paper">
            <div class="paper-t">{{ c.title }}</div>
            <p class="mono paper-no">编号 {{ c.contractNo }}</p>
            <p>甲方（用人单位）：{{ c.companyName || '—' }}</p>
            <p>乙方（劳动者）：{{ party }}</p>
            <p class="gap">根据《中华人民共和国劳动合同法》《劳务派遣暂行规定》及相关法律法规，甲乙双方在平等自愿、协商一致的基础上，签订本合同。</p>
            <p class="gap"><b>第一条 合同期限</b><br />本合同期限为 {{ termText(c) }}。</p>
            <p class="gap"><b>第二条 工作内容与地点</b><br />乙方被派遣至{{ c.projectName || '用工单位' }}，从事「{{ c.jobTitle || '—' }}」岗位工作。</p>
            <p class="gap"><b>第三条 劳动报酬</b><br />按用工单位公示的薪资标准及乙方实际出勤、绩效核算，按月足额支付。</p>
            <p class="gap"><b>第四条 社会保险</b><br />甲方依法为乙方缴纳社会保险……</p>
            <p class="gap t-xs">（模拟页面仅展示合同摘要，正式合同全文以 e签宝 签署页为准）</p>
          </div>
        </section>
        <dl class="acard">
          <div class="kv"><dt>签署方</dt><dd>{{ party }}</dd></div>
          <div class="kv"><dt>发起时间</dt><dd class="num">{{ formatServerTime(c.createdAt) }}</dd></div>
          <div class="kv"><dt>流程号</dt><dd class="mono fid">{{ flowId }}</dd></div>
        </dl>
        <van-checkbox v-model="agreed" shape="square" icon-size="16px" class="agree">我已阅读并同意上述合同条款，确认由本人签署</van-checkbox>
        <div class="bottom-bar-gap"></div>
      </div>
      <div class="bottom-bar">
        <van-button type="primary" block class="btn-cta" :loading="signing" loading-text="签署中…" :disabled="!agreed" @click="sign">同意并签署</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.es { min-height: 100vh; background: var(--surface-2); }
.es-bar { display: flex; align-items: center; gap: 10px; padding: calc(12px + env(safe-area-inset-top)) 14px 12px; background: #1F5FBF; color: #fff; }
.es-bar b { display: block; font-size: 15px; }
.es-bar span:not(.tag):not(.logo) { font-size: 11px; opacity: .7; }
.logo { width: 30px; height: 30px; border-radius: 8px; background: #fff; color: #1F5FBF; font-weight: 800; display: grid; place-items: center; font-size: 17px; flex: none; }
.paper { border: 1px solid var(--line); border-radius: var(--r-md); background: #fff; padding: 14px 12px; font-size: 12px; color: var(--ink-600); line-height: 1.8; }
.paper-t { text-align: center; font-weight: 700; font-size: 14px; color: var(--ink-900); }
.paper-no { text-align: center; font-size: 10.5px; color: var(--ink-400); margin-bottom: 8px; }
.paper .gap { margin-top: 6px; }
.paper b { color: var(--ink-900); }
.fid { font-size: 11px; }
.agree { font-size: 12.5px; padding: 0 2px; }
.agree :deep(.van-checkbox__label) { color: var(--ink-700); line-height: 1.5; }
.ok { text-align: center; padding: 26px 16px; border-color: var(--ok-line); background: var(--ok-bg); }
.ok-ic { color: var(--ok); }
.ok-t { font-size: 18px; font-weight: 700; color: var(--ok); }
</style>
