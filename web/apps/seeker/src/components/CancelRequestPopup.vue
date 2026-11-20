<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type CancelRequestMine } from '@shitu/api-client'
import { IconInfo, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'
import ReasonField from '@/components/ReasonField.vue'

/**
 * 申请取消报名：求职者不能自己取消（R-04），这里只是把申请交给驻场老师；驻场同意后报名才取消。
 * 原因必填 ≤255 字；已有一条待处理的申请时后端返回 SYS_4090。
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ applicationId: string; jobTitle?: string; subtitle?: string }>()
const emit = defineEmits<{ submitted: [req: CancelRequestMine]; conflict: [] }>()

const PRESETS = ['找到其他工作了', '时间 / 地点不合适', '报错岗位了', '家里有事去不了']
const MAX = 255
const reason = ref('')
const submitting = ref(false)
/** 提交被拒的原因：轻提示两秒就没了，这里留在按钮上方，改了原因再清掉 */
const rejected = ref('')

watch(show, (v) => {
  if (v) {
    reason.value = ''
    rejected.value = ''
  }
})
watch(reason, () => (rejected.value = ''))

async function submit() {
  if (submitting.value) return
  const text = reason.value.trim()
  if (!text) return void showToast('请选择或填写取消原因')
  if (text.length > MAX) return void showToast(`取消原因不超过 ${MAX} 字`)
  submitting.value = true
  rejected.value = ''
  try {
    const req = await seekerApi.submitCancelRequest(props.applicationId, text)
    show.value = false
    showToast({ type: 'success', message: '申请已提交，等待驻场老师处理', duration: 2500 })
    emit('submitted', req)
  } catch (e) {
    if (isApiError(e, 'SYS_4090')) {
      show.value = false
      showToast({ message: errorMessage(e, '你已经提交过取消申请，驻场老师正在处理'), duration: 2500 })
      emit('conflict')
    } else {
      // 报名已结束、原因为空 / 超长等：后端 message 直接展示
      rejected.value = errorMessage(e, '提交失败，请稍后重试')
      showToast(rejected.value)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="crp">
    <div class="sheet-head">
      <div class="flex1">
        <h3>申请取消报名</h3>
        <p v-if="jobTitle || subtitle" class="sheet-sub sheet-sub--wrap">{{ [jobTitle, subtitle].filter(Boolean).join(' · ') }}</p>
      </div>
      <button type="button" class="sheet-x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>

    <div class="tipbar tip">
      <IconInfo :size="20" />
      <div class="flex1"><div class="tipbar-d first">申请会发给驻场老师，<b class="strong">驻场老师同意后报名才会取消</b>。在这之前报名仍然有效，请照常按安排进行。</div></div>
    </div>

    <ReasonField
      id="crp-reason"
      v-model="reason"
      class="reason"
      label="取消原因（必填）"
      :presets="PRESETS"
      :max="MAX"
      placeholder="点上面的原因，或自己写几句…"
    />

    <div v-if="rejected" class="tipbar tipbar--danger tip" role="alert">
      <IconTriangleExclamationPoint :size="20" />
      <div class="flex1"><div class="tipbar-d first">没有提交成功：{{ rejected }}</div></div>
    </div>
    <van-button block type="primary" size="large" class="submit" :loading="submitting" loading-text="提交中…" :disabled="!reason.trim()" @click="submit">提交申请</van-button>
  </van-popup>
</template>

<style scoped>
.crp { max-height: 88vh; padding: var(--space-4) var(--space-page) var(--space-3); overflow-y: auto; box-sizing: border-box; }
.tip { margin-top: var(--space-3); }
.tipbar-d.first { margin-top: 0; }
.reason { margin-top: var(--space-4); margin-bottom: 0; }
.submit { margin-top: var(--space-4); }
</style>
