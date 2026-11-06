<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, tenantApi, type SiteApplication } from '@shitu/api-client'
import AcknowledgePopup from '@/components/AcknowledgePopup.vue'
import ApplicationCard from '@/components/ApplicationCard.vue'
import { useNow } from '@/composables/useNow'
import { fmtFull, parseLocal } from '@/utils/time'

/** 报名详情（站内信「新报名」跳转目标 /applications/:id） */
const route = useRoute()
const router = useRouter()
const now = useNow()
const app = shallowRef<SiteApplication | null>(null)
const loading = ref(false)
const loadError = ref('')
const ackShow = ref(false)

const id = computed(() => String(route.params.id ?? ''))

async function load() {
  if (!id.value) return
  loading.value = true
  loadError.value = ''
  try {
    app.value = await tenantApi.application(id.value)
  } catch (e) {
    app.value = null
    loadError.value = isApiError(e) && e.status === 403 ? '无权查看该报名（不在你负责的项目）' : errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
watch(id, load, { immediate: true })

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
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>
    <div v-else class="pad stack">
      <ApplicationCard :app="app" :now="now" @action="ackShow = true" />
      <section class="acard">
        <div class="acard-hd"><h4>跟进记录</h4></div>
        <dl>
          <div class="kv"><dt>报名时间</dt><dd class="num">{{ full(app.createdAt) }}</dd></div>
          <div class="kv"><dt>24h 响应截止</dt><dd class="num">{{ full(app.responseDeadline) }}</dd></div>
          <div class="kv"><dt>知悉时间</dt><dd class="num">{{ app.acknowledgedAt ? full(app.acknowledgedAt) : '未知悉' }}</dd></div>
          <div class="kv"><dt>面试时间</dt><dd class="num">{{ app.interviewAt ? full(app.interviewAt) : '未推送' }}</dd></div>
          <div class="kv"><dt>报名编号</dt><dd class="num">{{ app.applicationId }}</dd></div>
        </dl>
      </section>
      <div class="page-bottom-gap" />
    </div>
    <AcknowledgePopup v-model:show="ackShow" :application="app" @done="(a) => (app = a)" />
  </div>
</template>

<style scoped>
.detail { min-height: 100vh; }
.state { padding-top: 80px; }
</style>
