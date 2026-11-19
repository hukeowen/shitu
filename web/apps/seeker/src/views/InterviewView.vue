<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type MyApplication } from '@shitu/api-client'
import { IconCheck, IconCircleExclamationPoint, IconClock, IconExternalLink, IconMapPin, IconPhone, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import CancelRequestBlock from '@/components/CancelRequestBlock.vue'
import { telHref } from '@/utils/format'
import { amapLink } from '@/utils/map'
import { APPLICATION_TONE } from '@/utils/status'
import { formatServerTime, formatShort, untilText } from '@/utils/time'

/**
 * S-24 面试确认信息（C-408）：驻场「知悉」后推送的时间、地点、路线、证件清单。
 * 只有「待面试」展示面试须知（倒计时、证件清点、取消提示）；面试已通过 / 已入职 / 已结束的报名
 * 展示与状态相符的摘要，面试时间只作为过去的事实。
 * 进行中的报名（待面试 / 待签约入职）带「申请取消报名」的入口与申请状态；「申请进展」通知也跳到这里。
 */
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const app = ref<MyApplication | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const all = await seekerApi.myApplications()
    app.value = all.find((a) => a.applicationId === route.params.applicationId) ?? null
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const n = computed(() => app.value?.notice)
const where = computed(() => [app.value?.projectName, app.value?.companyName].filter(Boolean).join(' · '))
const nav = computed(() => (n.value ? amapLink({ address: n.value.address, name: n.value.address }) : null))
const tel = computed(() => telHref(n.value?.contactPhone))
const until = computed(() => untilText(n.value?.interviewAt))
const checked = ref<Record<string, boolean>>({})

const pendingInterview = computed(() => app.value?.status === 'PENDING_INTERVIEW')
/** 待签约入职：只有驻场已发起电子签约（存在待签署合同）才给出签署入口；否则只展示等待说明 */
const hasPendingSign = ref(false)
watch(
  () => app.value?.status,
  (s) => {
    hasPendingSign.value = false
    if (s === 'PENDING_CONFIRM') void seekerApi.pendingContract().then((c) => (hasPendingSign.value = !!c)).catch(() => undefined)
  },
  { immediate: true },
)
const title = computed(() => {
  const s = app.value?.status
  if (!s || s === 'PENDING_INTERVIEW') return '面试确认信息'
  if (s === 'PENDING_CONFIRM') return '面试已通过'
  if (s === 'EMPLOYED') return '已入职'
  return '报名详情'
})
watch(title, (t) => (document.title = t), { immediate: true })
/** 非待面试状态的一句话结论 */
const summary = computed(() => {
  const s = app.value?.status
  if (s === 'PENDING_CONFIRM') {
    return hasPendingSign.value
      ? { t: '面试已通过', d: '劳务公司已发起电子签约，签署劳动合同后即正式入职。' }
      : { t: '面试已通过', d: '驻场老师正在为你办理入职，请留意电子合同的签署通知。' }
  }
  if (s === 'EMPLOYED') return { t: '已入职', d: '你已通过面试并办理入职，在岗信息请到「我的工作」查看。' }
  if (s === 'TIMEOUT') return { t: label('ApplicationStatus', 'TIMEOUT'), d: '驻场未在时限内处理，本次报名已自动作废，你可以重新匹配岗位。' }
  return { t: s ? label('ApplicationStatus', s) : '', d: '本次报名已结束，可重新进入 AI 问薪匹配岗位。' }
})
</script>

<template>
  <div class="iv">
    <AppBar :title="title" fallback="/reports" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>
    <div v-else-if="!app" class="state-block">
      <IconCircleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">报名记录不存在</div>
      <van-button type="primary" @click="router.replace('/reports')">返回我的报备</van-button>
    </div>
    <!-- 面试已通过 / 已入职 / 已结束：状态摘要，不出现倒计时、证件清点与取消提示 -->
    <div v-else-if="!pendingInterview" class="pad stack">
      <section class="acard">
        <div class="item-hd">
          <h1>{{ app.jobTitle || '岗位' }}</h1>
          <span class="status-tag" :class="APPLICATION_TONE[app.status]">{{ label('ApplicationStatus', app.status) }}</span>
        </div>
        <p v-if="where" class="item-sub">{{ where }}</p>
        <p class="item-meta">报名单号 <span class="code">{{ app.applicationId }}</span></p>
      </section>

      <section class="tipbar" :class="{ 'tipbar--ok': app.status === 'PENDING_CONFIRM' || app.status === 'EMPLOYED' }">
        <IconCheck v-if="app.status === 'PENDING_CONFIRM' || app.status === 'EMPLOYED'" :size="20" />
        <IconCircleExclamationPoint v-else :size="20" />
        <div class="flex1">
          <div class="tipbar-t">{{ summary.t }}</div>
          <div class="tipbar-d">{{ summary.d }}</div>
        </div>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>报名记录</h4></div>
        <dl>
          <div class="kv"><dt>报名时间</dt><dd>{{ formatServerTime(app.createdAt) }}</dd></div>
          <div v-if="n" class="kv"><dt>面试时间</dt><dd>{{ formatServerTime(n.interviewAt) }}</dd></div>
          <div v-if="n?.address || app.address" class="kv"><dt>面试地点</dt><dd>{{ n?.address || app.address }}</dd></div>
          <div v-if="n?.contactName" class="kv"><dt>驻场老师</dt><dd>{{ n.contactName }}</dd></div>
          <div v-if="app.endedAt && app.status !== 'EMPLOYED' && app.status !== 'PENDING_CONFIRM'" class="kv"><dt>结束时间</dt><dd>{{ formatServerTime(app.endedAt) }}</dd></div>
          <div v-if="app.endReason" class="kv"><dt>原因</dt><dd>{{ label('LifecycleEvent', app.endReason) }}</dd></div>
        </dl>
      </section>

      <CancelRequestBlock v-if="app.status === 'PENDING_CONFIRM'" card :application-id="app.applicationId" :job-title="app.jobTitle" :subtitle="where" />

      <van-button v-if="app.status === 'PENDING_CONFIRM' && hasPendingSign" type="primary" block class="btn-cta" @click="router.push('/contracts/sign')">去签署合同</van-button>
      <van-button v-else-if="app.status === 'EMPLOYED'" type="primary" block class="btn-cta" @click="router.push('/work')">查看我的工作</van-button>
      <van-button block class="btn-cta" @click="router.replace('/reports')">返回我的报备</van-button>
      <div class="page-bottom-gap"></div>
    </div>

    <div v-else-if="!n">
      <div class="state-block">
        <IconClock :size="48" :stroke-width="1.5" />
        <div class="state-block-t">驻场老师还没有推送面试信息</div>
        <div class="state-block-d">请留意站内消息和短信</div>
        <van-button type="primary" @click="router.replace('/reports')">返回我的报备</van-button>
      </div>
      <div class="pad">
        <CancelRequestBlock card :application-id="app.applicationId" :job-title="app.jobTitle" :subtitle="where" />
      </div>
      <div class="page-bottom-gap"></div>
    </div>

    <div v-else class="pad stack">
      <section class="acard">
        <div class="item-hd">
          <h1>{{ app.jobTitle }}</h1>
          <span class="status-tag" :class="APPLICATION_TONE[app.status]">{{ label('ApplicationStatus', app.status) }}</span>
        </div>
        <p v-if="where" class="item-sub">{{ where }}</p>
        <p class="item-meta">报名单号 <span class="code">{{ app.applicationId }}</span></p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>面试时间</h4></div>
        <p class="when">{{ formatServerTime(n.interviewAt) }}</p>
        <p v-if="until" class="until">距面试还有 {{ until }}</p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>集合地点</h4></div>
        <p class="addr">{{ n.address }}</p>
        <a v-if="nav" :href="nav" class="map" target="_blank" rel="noopener">
          <IconMapPin :size="20" />用高德地图导航到集合点<IconExternalLink :size="16" />
        </a>
      </section>

      <section v-if="n.routeTips" class="acard">
        <div class="acard-hd"><h4>路线提示</h4></div>
        <p class="para">{{ n.routeTips }}</p>
      </section>

      <section v-if="n.documents?.length" class="acard">
        <div class="acard-hd"><h4>证件清单</h4><span class="status-tag status-tag--warning">必带</span></div>
        <ul class="docs">
          <li v-for="d in n.documents" :key="d">
            <button type="button" role="checkbox" :aria-checked="!!checked[d]" class="doc" @click="checked[d] = !checked[d]">
              <span class="box" :class="{ on: checked[d] }"><IconCheck v-if="checked[d]" :size="14" :stroke-width="2.5" /></span>
              <span class="flex1">{{ d }}</span>
            </button>
          </li>
        </ul>
        <p class="tip">勾选仅用于自己清点，不会提交</p>
      </section>

      <section v-if="n.contactName || n.contactPhone" class="acard">
        <div class="acard-hd"><h4>驻场老师</h4></div>
        <div class="contact">
          <div class="avatar">{{ (n.contactName || '驻').slice(0, 1) }}</div>
          <div class="flex1">
            <b class="c-n">{{ n.contactName || '驻场老师' }}</b>
            <span v-if="n.contactPhone" class="c-m">{{ n.contactPhone }}</span>
            <span class="c-m">{{ formatShort(n.pushedAt) }} 推送</span>
          </div>
          <a v-if="tel" :href="tel" class="call"><IconPhone :size="18" />电话</a>
        </div>
      </section>

      <CancelRequestBlock card :application-id="app.applicationId" :job-title="app.jobTitle" :subtitle="where" />
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.iv { min-height: 100vh; }
.item-hd h1 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.code { font-family: var(--font-mono); color: var(--text-1); }
.when { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.until { margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; font-weight: var(--font-weight-medium); color: var(--primary-text); }
.addr { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); text-wrap: balance; }
.map { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--control-height); margin-top: var(--space-3); padding: 0 var(--space-3); border: 1px solid var(--primary-line); border-radius: var(--radius-control); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); text-decoration: none; }
.map:active { background: var(--primary-bg); }
.docs li + li { border-top: 1px solid var(--divider); }
.doc { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 44px; padding: var(--space-2) 0; border: 0; background: none; font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); text-align: left; }
.box { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid var(--text-3); border-radius: var(--radius-tag); color: var(--text-on-primary); }
.box.on { background: var(--primary); border-color: var(--primary); }
.tip { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.contact { display: flex; align-items: center; gap: var(--space-3); }
.c-n { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.c-m { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.call { flex: none; display: flex; align-items: center; gap: var(--space-1); min-height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--primary-line); border-radius: var(--radius-control); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); text-decoration: none; }
.call:active { background: var(--primary-bg); }
</style>
