<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { seekerApi, type CancelRequestMine } from '@shitu/api-client'
import { IconChevronRight } from '@shitu/ui-icons'
import CancelRequestPopup from '@/components/CancelRequestPopup.vue'
import { formatServerTime } from '@/utils/time'

/**
 * 进行中的报名（待面试 / 待签约入职）上的「申请取消报名」：入口 + 申请状态。
 * 待驻场处理：展示原因与提交时间；未获同意：展示驻场回复，可再次申请；
 * 其余（没申请过 / 已关闭 / 已同意）只给入口 —— 报名结束后由页面本身的结束状态说明。
 * card = 独立成卡（报名详情页）；否则嵌在报名卡片里（我的报名列表）。
 */
const props = defineProps<{ applicationId: string; jobTitle?: string; subtitle?: string; card?: boolean }>()

const req = ref<CancelRequestMine | null>(null)
const loaded = ref(false)
const open = ref(false)

async function load() {
  try {
    req.value = (await seekerApi.cancelRequest(props.applicationId)) ?? null
  } catch {
    // 查不到申请状态时仍给出入口；重复提交由后端拦截并提示
    req.value = null
  } finally {
    loaded.value = true
  }
}
watch(() => props.applicationId, () => void load(), { immediate: true })

const pending = computed(() => req.value?.status === 'PENDING')
const refused = computed(() => req.value?.status === 'REJECTED')

function onSubmitted(r: CancelRequestMine) {
  req.value = r
}
</script>

<template>
  <section v-if="loaded" class="crq" :class="card ? 'acard' : 'inline'">
    <template v-if="pending && req">
      <div class="crq-hd">
        <h4>取消报名申请</h4>
        <span class="status-tag status-tag--warning">待驻场处理</span>
      </div>
      <dl>
        <div class="kv kv-stack"><dt>取消原因</dt><dd>{{ req.reason }}</dd></div>
        <div class="kv"><dt>提交时间</dt><dd>{{ formatServerTime(req.createdAt) }}</dd></div>
      </dl>
      <p class="crq-tip">驻场老师同意后报名才会取消，结果会通过消息通知你。在这之前报名仍然有效。</p>
    </template>

    <template v-else-if="refused && req">
      <div class="crq-hd">
        <h4>取消报名申请</h4>
        <span class="status-tag status-tag--danger">未获同意</span>
      </div>
      <dl>
        <div class="kv kv-stack"><dt>驻场回复</dt><dd>{{ req.reply || '驻场老师没有同意取消' }}</dd></div>
        <div class="kv kv-stack"><dt>你的原因</dt><dd>{{ req.reason }}</dd></div>
        <div v-if="req.handledAt" class="kv"><dt>处理时间</dt><dd>{{ formatServerTime(req.handledAt) }}</dd></div>
      </dl>
      <p class="crq-tip">报名仍然有效。如果还是去不了，可以再提交一次申请。</p>
      <van-button block class="crq-btn" @click="open = true">重新申请取消报名</van-button>
    </template>

    <template v-else-if="card">
      <div class="crq-hd"><h4>不去了？</h4></div>
      <p class="crq-tip first">你不能直接取消报名，但可以在这里提交申请，驻场老师同意后报名就会取消，之后可以重新匹配岗位。</p>
      <van-button block class="crq-btn" @click="open = true">申请取消报名</van-button>
    </template>
    <button v-else type="button" class="crq-link" @click="open = true">不去了或报错了岗位？申请取消报名<IconChevronRight :size="16" /></button>

    <CancelRequestPopup
      v-model:show="open"
      :application-id="applicationId"
      :job-title="jobTitle"
      :subtitle="subtitle"
      @submitted="onSubmitted"
      @conflict="load"
    />
  </section>
</template>

<style scoped>
.inline { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.crq-hd { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2); }
.crq-hd h4 { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); line-height: 22px; color: var(--text-1); }
.acard .crq-hd h4 { font-size: var(--font-size-section); line-height: 24px; }
.crq-tip { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.crq-tip.first { margin-top: 0; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.crq-btn { margin-top: var(--space-3); }
.crq-link { display: flex; align-items: center; justify-content: center; gap: 2px; width: 100%; min-height: 44px; margin-top: calc(var(--space-3) * -1); padding: 0; border: 0; background: none; font-size: var(--font-size-aux); color: var(--text-2); }
</style>
