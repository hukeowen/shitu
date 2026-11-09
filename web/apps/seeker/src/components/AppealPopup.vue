<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, useDict } from '@shitu/api-client'

/**
 * 实名申诉（C-406）：身份证已被其他账号占用（APP_4007）→ 申诉换绑；平台级失信（APP_4008）→ 失信申诉。
 * 理由必填 ≤500 字；同类申诉有一条处理中时后端返回 SYS_4090。平台风控 5 个工作日内人工复核。
 */
type AppealType = 'ID_OCCUPIED_APPEAL' | 'BLACKLIST_APPEAL'
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ type: AppealType }>()
const emit = defineEmits<{ submitted: []; pending: [] }>()
const { label } = useDict()

const MAX = 500
const remark = ref('')
const submitting = ref(false)

watch(show, (v) => {
  if (v) remark.value = ''
})

const tips = computed(() =>
  props.type === 'ID_OCCUPIED_APPEAL'
    ? ['旧手机号已停用、无法登录找回', '说明旧号码（如记得）与停用原因', '如非本人注册，请说明情况，平台将核查身份冒用']
    : ['说明你认为标记有误的原因', '可写明涉及的公司、时间等事实', '平台复核期间账号仍受限'],
)
const placeholder = computed(() =>
  props.type === 'ID_OCCUPIED_APPEAL'
    ? '例如：这是我本人身份证，旧手机号 138****1234 已停用，无法登录原账号，申请换绑到当前手机号。'
    : '例如：我从未在 XX 公司入职，失信标记与事实不符，请核查。',
)

async function submit() {
  if (submitting.value) return
  const text = remark.value.trim()
  if (!text) return void showToast('请写明申诉理由')
  if (text.length > MAX) return void showToast(`申诉理由不超过 ${MAX} 字`)
  submitting.value = true
  try {
    await seekerApi.appeal(props.type, text)
    show.value = false
    showToast({ type: 'success', message: '申诉已提交，平台将在 5 个工作日内复核', duration: 2500 })
    emit('submitted')
  } catch (e) {
    if (isApiError(e, 'SYS_4090')) {
      show.value = false
      showToast({ message: errorMessage(e, '已有一条申诉在处理中，请耐心等待'), duration: 2500 })
      emit('pending')
    } else {
      // SYS_4000：理由为空 / 超长、或没有对应的拦截记录（后端 message 直接展示）
      showToast(errorMessage(e, '提交失败，请稍后重试'))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="apl">
    <div class="sheet-h" aria-hidden="true"></div>
    <div class="row-b" style="margin-bottom: 4px">
      <h3 class="ttl">提交申诉</h3>
      <button type="button" class="x" aria-label="关闭" @click="show = false"><van-icon name="cross" size="18" /></button>
    </div>
    <p class="t-sm sub"><span class="tag" :class="type === 'BLACKLIST_APPEAL' ? 'tag-muted' : 'tag-warn'">{{ label('KycReviewType', type) }}</span></p>

    <ul class="tips t-xs">
      <li v-for="t in tips" :key="t">· {{ t }}</li>
    </ul>

    <div class="field">
      <label for="apl-ta">申诉理由（必填）</label>
      <textarea id="apl-ta" v-model="remark" class="ta" :maxlength="MAX" rows="5" :placeholder="placeholder"></textarea>
      <div class="cnt t-xs" :class="{ over: remark.length >= MAX }">{{ remark.length }} / {{ MAX }}</div>
    </div>

    <div class="note note--info" style="margin-bottom: 14px">平台风控将在 <b>5 个工作日</b>内人工复核，结果会通过消息中心通知你，也可在「我的申诉」查看进度。</div>
    <van-button block type="primary" class="btn-cta" :loading="submitting" loading-text="提交中…" :disabled="!remark.trim()" @click="submit">提交申诉</van-button>
  </van-popup>
</template>

<style scoped>
.apl { padding: 8px 16px 12px; max-height: 90vh; overflow-y: auto; box-sizing: border-box; }
.sheet-h { width: 36px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 auto 12px; }
.ttl { font-size: 17px; font-weight: 700; color: var(--ink-900); }
.x { width: 32px; height: 32px; display: grid; place-items: center; background: none; border: 0; color: var(--ink-500); padding: 0; margin-right: -6px; }
.sub { margin-bottom: 10px; }
.tips { line-height: 1.8; margin-bottom: 12px; color: var(--ink-500); }
.field { margin-bottom: 12px; }
.cnt { text-align: right; margin-top: 4px; }
.cnt.over { color: var(--warn); }
</style>
