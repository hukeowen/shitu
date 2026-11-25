<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type ApplicationInsight, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconCopy, IconPhone } from '@shitu/ui-icons'
import AppActions from '@/components/AppActions.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import QrImage from '@/components/QrImage.vue'
import { useNow } from '@/composables/useNow'
import { ACTION_TEXT, CONTRACT_TONE, DOMAIN_TONE, splitActions, tagTone } from '@/utils/actions'
import { APPLICATION_TAG } from '@/utils/status'
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
/** 后端拒绝过的操作：报名状态已变，除「拨打」外的操作置灰、原因留在通栏上方，下拉刷新后重新判断 */
const blocked = ref<{ action: SiteApplicationAction; reason: string } | null>(null)
/** 无权查看 / 不存在：给「返回」；其他失败给「重新加载」 */
const notFound = ref(false)

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
  blocked.value = null
  try {
    app.value = await tenantApi.application(id.value)
  } catch (e) {
    if (silent && app.value) return
    app.value = null
    notFound.value = isApiError(e) && (e.status === 403 || e.status === 404)
    loadError.value = isApiError(e) && e.status === 403 ? '无权查看该报名（不在你负责的项目）' : errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(id, () => { void load(); void loadInsight() }, { immediate: true })

const acts = computed(() => (app.value ? splitActions(app.value) : { main: [], more: [] }))
function onAction(action: SiteApplicationAction) {
  if (app.value) void actions.value?.run(action, app.value)
}
function onDone(_action: SiteApplicationAction, updated: SiteApplication | null) {
  blocked.value = null
  if (updated) app.value = updated
  void load(true)
}
function onRejected(_a: SiteApplication, action: SiteApplicationAction, reason: string) {
  blocked.value = { action, reason }
}
/** 下拉刷新：被拒置灰后不用离开页面，刷新即按最新状态重新判断 */
const refreshing = ref(false)
async function onPull() {
  try {
    await Promise.all([load(true), loadInsight()])
  } finally {
    refreshing.value = false
  }
}
const hasBar = computed(() => !!app.value && (!!app.value.phone || acts.value.main.length > 0 || acts.value.more.length > 0))

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
    <van-nav-bar title="报名详情" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <div v-if="loading && !app" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="!app" class="state-block">
      <IconCircleExclamationPoint :size="48" />
      <p class="state-block-t">{{ loadError || '加载失败' }}</p>
      <template v-if="notFound">
        <p class="state-block-d">这条报名不在你负责的项目里，或已被删除</p>
        <van-button type="primary" @click="back">返回</van-button>
      </template>
      <template v-else>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="load()">重新加载</van-button>
      </template>
    </div>
    <van-pull-refresh v-else v-model="refreshing" @refresh="onPull">
    <div class="pad stack">
      <ApplicationCard :app="app" :now="now" no-actions />
      <section v-if="contract" class="acard">
        <div class="acard-hd">
          <h4>电子合同</h4>
          <span class="status-tag" :class="`status-tag--${CONTRACT_TONE[contract.status] ?? 'neutral'}`">{{ label('ContractStatus', contract.status) }}</span>
        </div>
        <div v-if="contract.signUrl" class="sign">
          <QrImage :url="contract.signUrl" :size="112" alt="电子合同签署码" />
          <div class="flex1">
            <p class="sign-hint">签署链接 · 请求职者扫码或打开链接签署</p>
            <p class="sign-url">{{ contract.signUrl }}</p>
            <van-button plain type="primary" class="copy" @click="copy(contract.signUrl)"><template #icon><IconCopy :size="16" /></template>复制链接</van-button>
          </div>
        </div>
        <dl>
          <div class="kv"><dt>发起时间</dt><dd>{{ full(contract.createdAt) }}</dd></div>
          <div class="kv"><dt>签署时间</dt><dd>{{ contract.signedAt ? full(contract.signedAt) : '未签署' }}</dd></div>
          <div class="kv"><dt>合同编号</dt><dd class="code">{{ contract.contractNo || contract.contractId }}</dd></div>
        </dl>
      </section>
      <section v-if="insight" class="acard">
        <div class="acard-hd"><h4>求职者画像</h4></div>
        <div v-if="insight.profileTags.length" class="chips"><span v-for="t in insight.profileTags" :key="t" class="status-tag">{{ t }}</span></div>
        <p v-else class="para">没有答题记录（推荐报名）</p>
        <template v-if="insight.matchRecords.length">
          <h5 class="sub-hd">匹配记录</h5>
          <div v-for="(m, i) in insight.matchRecords" :key="i" class="rec">
            <div class="rec-hd"><span>{{ full(m.matchedAt) }}</span><span v-if="m.source" class="status-tag status-tag--success">本次报名</span></div>
            <div v-for="j in m.jobs" :key="j.jobId" class="rec-job">
              <span class="rec-title" :class="{ strong: j.appliedJob }">{{ j.title }}</span>
              <span class="rec-score">匹配度 <b>{{ Number(j.matchScore).toFixed(0) }}%</b></span>
            </div>
          </div>
        </template>
        <h5 class="sub-hd">在本公司的历史报名</h5>
        <p v-if="insight.history.length === 0" class="para">这是第一次报名本公司岗位</p>
        <div v-for="h in insight.history" :key="h.applicationId" class="his">
          <div class="his-hd"><span class="strong">{{ h.jobTitle }}</span> <span class="status-tag" :class="`status-tag--${tagTone(APPLICATION_TAG[h.status])}`">{{ label('ApplicationStatus', h.status) }}</span></div>
          <div class="his-m">{{ full(h.createdAt) }}<template v-if="h.endReason"> · {{ label('LifecycleEvent', h.endReason) }}</template></div>
        </div>
      </section>
      <section class="acard">
        <div class="acard-hd"><h4>跟进记录</h4></div>
        <dl>
          <div class="kv">
            <dt>来源</dt>
            <dd class="src">
              <span class="status-tag" :class="`status-tag--${DOMAIN_TONE[app.fromPublic ? 'PUBLIC' : 'PRIVATE']}`">{{ app.fromPublic ? label('DomainTag', 'PUBLIC') : `本公司${label('DomainTag', 'PRIVATE')}` }}</span>
              <template v-if="app.fromPublic">→ 报名后<span class="status-tag status-tag--pending">{{ label('DomainTag', 'TEMP_PRIVATE') }}</span></template>
            </dd>
          </div>
          <div class="kv"><dt>报名时间</dt><dd>{{ full(app.createdAt) }}</dd></div>
          <div class="kv"><dt>24h 响应截止</dt><dd>{{ full(app.responseDeadline) }}</dd></div>
          <div class="kv"><dt>知悉时间</dt><dd>{{ app.acknowledgedAt ? full(app.acknowledgedAt) : '未知悉' }}</dd></div>
          <div class="kv"><dt>面试时间</dt><dd>{{ app.interviewAt ? full(app.interviewAt) : '未推送' }}</dd></div>
          <div class="kv"><dt>到厂时间</dt><dd>{{ app.arrivedAt ? full(app.arrivedAt) : '未到厂' }}</dd></div>
          <div v-if="app.notice?.address" class="kv kv-stack"><dt>面试地点</dt><dd>{{ app.notice.address }}</dd></div>
          <div class="kv"><dt>报名编号</dt><dd class="code">{{ app.applicationId }}</dd></div>
        </dl>
      </section>
      <div :class="hasBar ? (blocked ? 'bottom-bar-gap with-why' : 'bottom-bar-gap') : 'page-bottom-gap'" />
    </div>
    </van-pull-refresh>
    <div v-if="hasBar && app" class="bottom-bar">
      <p v-if="blocked" class="bar-why" role="status">暂时不能{{ ACTION_TEXT[blocked.action] }}：{{ blocked.reason }}</p>
      <div class="bar-acts">
        <van-button v-if="app.phone" size="large" class="b-call" :url="`tel:${app.phone}`"><template #icon><IconPhone :size="18" /></template>拨打</van-button>
        <van-button v-if="acts.more.length" size="large" class="b-more" :disabled="!!blocked" @click="actions?.more(app)">更多</van-button>
        <van-button
          v-for="b in acts.main"
          :key="b.key"
          size="large"
          :type="b.type === 'primary' ? 'primary' : 'default'"
          :disabled="!!blocked"
          class="b-main"
          @click="onAction(b.key)"
        >
          {{ b.text }}
        </van-button>
      </div>
    </div>
    <AppActions ref="actions" @done="onDone" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.detail { min-height: 100vh; }
.sign { display: flex; gap: var(--space-3); align-items: flex-start; padding-bottom: var(--space-3); margin-bottom: var(--space-1); border-bottom: 1px solid var(--divider); }
.sign-hint { font-size: var(--font-size-aux); color: var(--text-3); }
.sign-url { margin: var(--space-1) 0 var(--space-2); font-family: var(--font-mono); font-size: var(--font-size-min); color: var(--text-2); word-break: break-all; }
.code { font-family: var(--font-mono); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.para { font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.sub-hd { margin: var(--space-4) 0 var(--space-2); font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.rec { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); margin-bottom: var(--space-2); }
.rec-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-1); font-size: var(--font-size-aux); color: var(--text-3); }
.rec-job { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding: 2px 0; font-size: var(--font-size-body); color: var(--text-2); }
.rec-title { flex: 1; min-width: 0; }
.rec-score { flex: none; font-size: var(--font-size-aux); color: var(--text-3); white-space: nowrap; }
.rec-score b { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.strong { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.his { padding: var(--space-2) 0; border-top: 1px solid var(--divider); font-size: var(--font-size-body); line-height: 22px; }
.his-hd { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.his-m { font-size: var(--font-size-aux); color: var(--text-3); }
.src { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-1); }
.bar-acts { display: flex; gap: var(--space-2); }
.bar-acts .van-button { width: auto; }
.b-call, .b-more { flex: none; padding: 0 var(--space-4); }
.b-main { flex: 1; min-width: 0; padding: 0 var(--space-2); }
</style>
