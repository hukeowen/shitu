<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { errorMessage, isApiError } from '@shitu/api-client'
import { IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useMatchSession } from '@/composables/useMatchSession'

/**
 * 游客预览 → 登录后的接续页（D-62）：取出登录前答的题，按登录后的账号（专属公司 / 全平台）跑正式匹配，
 * 落到正常的匹配结果页。登录前的答案只用一次，用完即删。
 */
const router = useRouter()
const { match, locked, appliedLock, lockText } = useMatchSession()

const error = ref('')

async function run() {
  error.value = ''
  const pending = match.takePending()
  if (!pending) {
    // 没有待用的答案（比如刷新了两次）：有结果看结果，没有就重新开始
    const o = await match.loadLatest(true).catch(() => null)
    void router.replace(o ? '/match/result' : '/match')
    return
  }
  if (locked.value) {
    try {
      await showConfirmDialog({
        title: '暂不能重新匹配',
        message: `${lockText.value}。`,
        confirmButtonText: appliedLock.value ? '查看我的报名' : '回首页',
        showCancelButton: appliedLock.value,
        cancelButtonText: '回首页',
      })
      void router.replace(appliedLock.value ? '/reports' : '/')
    } catch {
      void router.replace('/')
    }
    return
  }
  try {
    await match.runMatch()
    void router.replace('/match/result')
  } catch (e) {
    if (isApiError(e, 'LC_4003')) {
      void router.replace('/reports')
      return
    }
    error.value = errorMessage(e, '匹配失败，请稍后重试')
  }
}
void run()

function redo() {
  match.setStep(0)
  void router.replace('/match/quiz')
}
</script>

<template>
  <div class="cont">
    <AppBar title="匹配结果" fallback="/" :on-back="() => router.replace('/')" />
    <div v-if="error" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">没能接着匹配</div>
      <div class="state-block-d">{{ error }}</div>
      <van-button type="primary" @click="redo">回去检查答案</van-button>
    </div>
    <div v-else class="page-state"><van-loading size="28" vertical>正在按你的账号确认岗位和名额…</van-loading></div>
  </div>
</template>

<style scoped>
.cont { min-height: 100vh; }
</style>
