<script setup lang="ts">
import { ref } from 'vue'
import { errorMessage, seekerApi, useDict, type MyAppeal, type ReviewStatus } from '@shitu/api-client'
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
async function onRefresh() {
  await load()
  refreshing.value = false
}

const TAG: Record<ReviewStatus, string> = { PENDING: 'tag-warn', APPROVED: 'tag-ok', REJECTED: 'tag-danger' }
const RESULT: Record<ReviewStatus, string> = {
  PENDING: '平台风控将在 5 个工作日内人工复核，结果会通过消息中心通知你',
  APPROVED: '申诉已通过',
  REJECTED: '申诉未通过',
}
</script>

<template>
  <div class="apls">
    <AppBar title="我的申诉" fallback="/me" />
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="page-state">
        <van-empty image="error" :description="loadError">
          <van-button round type="primary" size="small" @click="load">重新加载</van-button>
        </van-empty>
      </div>
      <div v-else class="pad stack">
        <section v-for="a in rows" :key="a.id" class="acard">
          <div class="row-b">
            <b class="strong t14">{{ label('KycReviewType', a.reviewType) }}</b>
            <span class="tag" :class="TAG[a.status]"><i class="dot"></i>{{ label('ReviewStatus', a.status) }}</span>
          </div>
          <div class="t-xs num" style="margin-top: 4px">提交于 {{ formatServerTime(a.createdAt) }}</div>
          <div class="quote">{{ a.remark }}</div>
          <div class="divider" style="margin: 10px 0"></div>
          <div class="res" :class="a.status.toLowerCase()">
            <b>{{ RESULT[a.status] }}</b>
            <template v-if="a.status !== 'PENDING'">
              <p v-if="a.reviewerRemark" class="t-sm">复核意见：{{ a.reviewerRemark }}</p>
              <p class="t-xs num" style="margin-top: 4px">复核时间 {{ formatServerTime(a.reviewedAt) }}</p>
            </template>
          </div>
        </section>
        <van-empty v-if="!rows.length" image="search" description="暂无申诉记录">
          <p class="t-xs" style="line-height: 1.7; padding: 0 20px">实名认证时提示「身份证已被其他账号绑定」或「账号受限」，可在实名页提交申诉。</p>
        </van-empty>
        <router-link to="/kyc" class="t-sm back-kyc">返回实名认证 ›</router-link>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.apls { min-height: 100vh; background: var(--surface-2); }
.t14 { font-size: 14px; }
.quote { margin-top: 8px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.7; color: var(--ink-700); white-space: pre-wrap; word-break: break-word; }
.res b { font-size: 13px; }
.res.pending b { color: var(--warn); font-weight: 600; font-size: 12.5px; }
.res.approved b { color: var(--ok); }
.res.rejected b { color: var(--danger); }
.res p { margin-top: 4px; line-height: 1.7; }
.back-kyc { display: block; text-align: center; color: var(--ink-500); text-decoration: none; }
</style>
