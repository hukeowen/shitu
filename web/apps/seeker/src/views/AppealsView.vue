<script setup lang="ts">
import { ref } from 'vue'
import { errorMessage, seekerApi, useDict, type MyAppeal, type ReviewStatus } from '@shitu/api-client'
import { IconChevronRight, IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { formatServerTime } from '@/utils/time'

/** 我的申诉：实名申诉（身份证被占用 / 失信）的处理进度与平台复核意见 */
const { label } = useDict()
const rows = ref<MyAppeal[]>([])
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    rows.value = await seekerApi.myAppeals()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  await load()
  refreshing.value = false
}

const TONE: Record<ReviewStatus, string> = { PENDING: 'status-tag--warning', APPROVED: 'status-tag--success', REJECTED: 'status-tag--danger' }
const RESULT: Record<ReviewStatus, string> = {
  PENDING: '平台风控将在 5 个工作日内人工复核，结果会通过消息中心通知你',
  APPROVED: '申诉已通过',
  REJECTED: '申诉未通过',
}
</script>

<template>
  <div class="apls">
    <AppBar title="我的申诉" fallback="/me" />
    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>
      <div v-else-if="!rows.length" class="state-block">
        <IconInbox :size="48" :stroke-width="1.5" />
        <div class="state-block-t">暂无申诉记录</div>
        <div class="state-block-d">实名认证时提示「身份证已被其他账号绑定」或「账号受限」，可在实名页提交申诉。</div>
        <van-button type="primary" to="/kyc" replace>返回实名认证</van-button>
      </div>
      <div v-else class="pad stack">
        <article v-for="a in rows" :key="a.id" class="acard">
          <div class="item-hd">
            <h3>{{ label('KycReviewType', a.reviewType) }}</h3>
            <span class="status-tag" :class="TONE[a.status]">{{ label('ReviewStatus', a.status) }}</span>
          </div>
          <p class="item-meta">提交于 {{ formatServerTime(a.createdAt) }}</p>
          <p class="quote">{{ a.remark }}</p>
          <div class="res">
            <p :class="a.status === 'PENDING' ? 'para' : 'res-t'">{{ RESULT[a.status] }}</p>
            <template v-if="a.status !== 'PENDING'">
              <p v-if="a.reviewerRemark" class="item-sub">复核意见：{{ a.reviewerRemark }}</p>
              <p class="item-meta">复核时间 {{ formatServerTime(a.reviewedAt) }}</p>
            </template>
          </div>
        </article>
        <p class="list-end">没有更多了</p>
        <router-link to="/kyc" class="link more">返回实名认证<IconChevronRight :size="16" /></router-link>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.apls { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.quote { margin-top: var(--space-3); padding: var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.res { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.res-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.more { display: flex; justify-content: center; min-height: 44px; }
</style>
