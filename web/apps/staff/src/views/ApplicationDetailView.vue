<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type ApplicationInsight, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import QrImage from '@/components/QrImage.vue'
import { useNow } from '@/composables/useNow'
import { APPLICATION_TAG, CONTRACT_TAG } from '@/utils/status'
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

/** 画像标签、匹配记录、历史报名：加载失败不影响主流程，只是不显示 */
const insight = shallowRef<ApplicationInsight | null>(null)
async function loadInsight() {
  insight.value = null
  try {
    insight.value = await tenantApi.applicationInsight(id.value)
  } catch {
    insight.value = null
  }
}

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
watch(id, () => { void load(); void loadInsight() }, { immediate: true })

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
      <section v-if="insight" class="acard">
        <div class="acard-hd"><h4>求职者画像</h4></div>
        <div v-if="insight.profileTags.length" class="chips"><span v-for="t in insight.profileTags" :key="t" class="tag tag-muted">{{ t }}</span></div>
        <div v-else class="t-xs">没有答题记录（推荐报名）</div>
        <template v-if="insight.matchRecords.length">
          <div class="sub-hd">匹配记录</div>
          <div v-for="(m, i) in insight.matchRecords" :key="i" class="rec">
            <div class="rec-hd"><span class="num t-xs">{{ full(m.matchedAt) }}</span><span v-if="m.source" class="tag tag-ok">本次报名</span></div>
            <div v-for="j in m.jobs" :key="j.jobId" class="rec-job">
              <span class="rec-title" :class="{ strong: j.appliedJob }">{{ j.title }}</span>
              <span class="rec-score">匹配度 <b class="num">{{ Number(j.matchScore).toFixed(0) }}%</b></span>
            </div>
          </div>
        </template>
        <div class="sub-hd">在本公司的历史报名</div>
        <div v-if="insight.history.length === 0" class="t-xs">这是第一次报名本公司岗位</div>
        <div v-for="h in insight.history" :key="h.applicationId" class="his">
          <div><span class="strong">{{ h.jobTitle }}</span> <span class="tag" :class="APPLICATION_TAG[h.status] ?? 'tag-muted'">{{ label('ApplicationStatus', h.status) }}</span></div>
          <div class="t-xs num">{{ full(h.createdAt) }}<template v-if="h.endReason"> · {{ label('LifecycleEvent', h.endReason) }}</template></div>
        </div>
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
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sub-hd { margin: 14px 0 6px; font-size: 12px; font-weight: 700; color: var(--ink-600); }
.rec { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); margin-bottom: 6px; }
.rec-hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 20px; margin-bottom: 4px; }
.rec-job { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 22px; font-size: 13px; line-height: 1.4; padding: 2px 0; }
.rec-title { flex: 1; min-width: 0; }
.rec-score { flex: none; font-size: 11.5px; color: var(--ink-400); white-space: nowrap; }
.rec-score b { font-size: 13px; color: var(--ink-900); margin-left: 2px; }
.strong { font-weight: 700; color: var(--ink-900); }
.his { padding: 7px 0; border-top: 1px dashed var(--line); line-height: 1.7; font-size: 13px; }
</style>
