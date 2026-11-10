<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import QrImage from '@/components/QrImage.vue'
import { useNow } from '@/composables/useNow'
import { CONTRACT_TAG } from '@/utils/actions'
import { copyText } from '@/utils/clipboard'
import { fmtFull, parseLocal } from '@/utils/time'

/**
 * M-04 报名详情（站内信「新报名」跳转目标 /applications/:id）：跟进记录、电子合同签署状态 / 签署码，
 * 以及 M-05 到厂 + 面试结果、M-06/07 确权签约、M-08 爽约、M-10 取消（按 allowedActions）。
 */
const route = useRoute()
const router = useRouter()
const now = useNow()
const app = shallowRef<SiteApplication | null>(null)
const loading = ref(false)
const loadError = ref('')
const { label } = useDict()
const actions = ref<InstanceType<typeof AppActions> | null>(null)

const id = computed(() => String(route.params.id ?? ''))

async function load(silent = false) {
  if (!id.value) return
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    app.value = await tenantApi.application(id.value)
  } catch (e) {
    if (silent && app.value) return
    app.value = null
    loadError.value = isApiError(e) && e.status === 403 ? '无权查看该报名（不在你负责的项目）' : errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(id, () => load(), { immediate: true })

function onAction(a: SiteApplication, action: SiteApplicationAction) {
  void actions.value?.run(action, a)
}
function onDone(_action: SiteApplicationAction, updated: SiteApplication | null) {
  if (updated) app.value = updated
  void load(true)
}

const contract = computed(() => app.value?.contract)
async function copy(url: string) {
  showToast((await copyText(url)) ? '签署链接已复制，可粘贴发送给求职者' : '复制失败，请长按链接手动复制')
}

const full = (v?: string) => {
  const d = parseLocal(v)
  return d ? fmtFull(d) : '—'
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/todo')
}
</script>

<template>
  <div class="detail">
    <van-nav-bar title="报名详情" left-arrow safe-area-inset-top @click-left="back" />
    <div v-if="loading && !app" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="!app" class="state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="load()">重新加载</van-button>
      </van-empty>
    </div>
    <div v-else class="pad stack">
      <ApplicationCard :app="app" :now="now" @action="onAction" @more="(a) => actions?.more(a)" />
      <section v-if="contract" class="acard">
        <div class="acard-hd">
          <h4>电子合同</h4>
          <span class="tag" :class="CONTRACT_TAG[contract.status] ?? 'tag-muted'">{{ label('ContractStatus', contract.status) }}</span>
        </div>
        <div v-if="contract.signUrl" class="sign">
          <QrImage :url="contract.signUrl" :size="112" alt="电子合同签署码" />
          <div class="flex1">
            <div class="t-xs">签署链接 · 请求职者扫码或打开链接签署</div>
            <div class="mono link">{{ contract.signUrl }}</div>
            <van-button size="small" type="primary" plain class="copy" @click="copy(contract.signUrl)">复制链接</van-button>
          </div>
        </div>
        <dl>
          <div class="kv"><dt>发起时间</dt><dd class="num">{{ full(contract.createdAt) }}</dd></div>
          <div class="kv"><dt>签署时间</dt><dd class="num">{{ contract.signedAt ? full(contract.signedAt) : '未签署' }}</dd></div>
          <div class="kv"><dt>合同编号</dt><dd class="num">{{ contract.contractNo || contract.contractId }}</dd></div>
        </dl>
      </section>
      <section class="acard">
        <div class="acard-hd"><h4>跟进记录</h4></div>
        <dl>
          <div class="kv"><dt>报名时间</dt><dd class="num">{{ full(app.createdAt) }}</dd></div>
          <div class="kv"><dt>24h 响应截止</dt><dd class="num">{{ full(app.responseDeadline) }}</dd></div>
          <div class="kv"><dt>知悉时间</dt><dd class="num">{{ app.acknowledgedAt ? full(app.acknowledgedAt) : '未知悉' }}</dd></div>
          <div class="kv"><dt>面试时间</dt><dd class="num">{{ app.interviewAt ? full(app.interviewAt) : '未推送' }}</dd></div>
          <div class="kv"><dt>到厂时间</dt><dd class="num">{{ app.arrivedAt ? full(app.arrivedAt) : '未到厂' }}</dd></div>
          <div v-if="app.notice?.address" class="kv"><dt>面试地点</dt><dd>{{ app.notice.address }}</dd></div>
          <div class="kv"><dt>报名编号</dt><dd class="num">{{ app.applicationId }}</dd></div>
        </dl>
      </section>
      <div class="page-bottom-gap" />
    </div>
    <AppActions ref="actions" @done="onDone" />
  </div>
</template>

<style scoped>
.detail { min-height: 100vh; }
.state { padding-top: 80px; }
.sign { display: flex; gap: 12px; align-items: flex-start; padding-bottom: 10px; margin-bottom: 2px; border-bottom: 1px dashed var(--line); }
.link { font-size: 11px; color: var(--ink-600); word-break: break-all; margin: 4px 0 8px; }
.copy { border-radius: var(--r-sm); }
</style>
