<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, useDict } from '@shitu/api-client'
import { IconInfo, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'

/**
 * 实名申诉（C-406）：身份证已被其他账号占用（APP_4007）→ 申诉换绑；平台级失信（APP_4008）→ 失信申诉。
 * 理由必填 ≤500 字；同类申诉有一条处理中时后端返回 SYS_4090。平台风控 5 个工作日内人工复核。
 */
type AppealType = 'ID_OCCUPIED_APPEAL' | 'BLACKLIST_APPEAL'
const show = defineModel<boolean>('show', { required: true })
/** fraud：身份证被占用时走「举报冒用」——不是我本人注册的，请平台核查冒用（与换号申诉区分开） */
const props = defineProps<{ type: AppealType; fraud?: boolean }>()
const FRAUD_TAG = '【举报身份冒用】'
const emit = defineEmits<{ submitted: []; pending: [] }>()
const { label } = useDict()

const MAX = 480
const remark = ref('')
const submitting = ref(false)
/** 提交被拒的原因：轻提示两秒就没了，这里留在按钮上方，改了理由再清掉 */
const rejected = ref('')

watch(show, (v) => {
  if (v) {
    remark.value = ''
    rejected.value = ''
  }
})

const tips = computed(() =>
  props.fraud
    ? ['你的身份证被别人用来注册了账号', '说明你是否认识对方、何时发现、有没有把身份证交给过别人或中介', '平台会核查那个账号，属实的解除占用并处理冒用方']
    : props.type === 'ID_OCCUPIED_APPEAL'
    ? ['旧手机号已停用、无法登录找回', '说明旧号码（如记得）与停用原因', '如非本人注册，请返回选择「举报冒用」']
    : ['说明你认为标记有误的原因', '可写明涉及的公司、时间等事实', '平台复核期间账号仍受限'],
)
const placeholder = computed(() =>
  props.fraud
    ? '例如：我从没注册过仕兔，这是第一次用。上个月把身份证复印件给过一个中介，怀疑被拿去注册了。'
    : props.type === 'ID_OCCUPIED_APPEAL'
    ? '例如：这是我本人身份证，旧手机号 138****1234 已停用，无法登录原账号，申请换绑到当前手机号。'
    : '例如：我从未在 XX 公司入职，失信标记与事实不符，请核查。',
)

async function submit() {
  if (submitting.value) return
  const text = remark.value.trim()
  if (!text) return void showToast(props.fraud ? '请写明冒用情况' : '请写明申诉理由')
  if (text.length > MAX) return void showToast(`申诉理由不超过 ${MAX} 字`)
  submitting.value = true
  rejected.value = ''
  try {
    await seekerApi.appeal(props.type, props.fraud ? FRAUD_TAG + text : text)
    show.value = false
    showToast({ type: 'success', message: props.fraud ? '举报已提交，平台将在 5 个工作日内核查' : '申诉已提交，平台将在 5 个工作日内复核', duration: 2500 })
    emit('submitted')
  } catch (e) {
    if (isApiError(e, 'SYS_4090')) {
      show.value = false
      showToast({ message: errorMessage(e, '已有一条申诉在处理中，请耐心等待'), duration: 2500 })
      emit('pending')
    } else {
      // SYS_4000：理由为空 / 超长、或没有对应的拦截记录（后端 message 直接展示）
      rejected.value = errorMessage(e, '提交失败，请稍后重试')
      showToast(rejected.value)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="apl">
    <div class="sheet-head">
      <div class="flex1">
        <h3>{{ fraud ? '举报身份冒用' : '提交申诉' }}</h3>
        <p class="sheet-sub">{{ fraud ? '不是我本人注册的账号占用了我的身份证' : label('KycReviewType', type) }}</p>
      </div>
      <button type="button" class="sheet-x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>

    <ul class="tips">
      <li v-for="t in tips" :key="t">{{ t }}</li>
    </ul>

    <van-cell-group :border="false">
      <van-field
        v-model="remark"
        class="ffield"
        type="textarea"
        :label="fraud ? '冒用情况（必填）' : '申诉理由（必填）'"
        label-align="top"
        rows="5"
        :maxlength="MAX"
        show-word-limit
        :placeholder="placeholder"
        :border="false"
        @update:model-value="rejected = ''"
      />
    </van-cell-group>

    <div class="tipbar tip">
      <IconInfo :size="20" />
      <div class="flex1"><div class="tipbar-d first">平台风控将在 <b class="strong">5 个工作日</b>内人工复核，结果会通过消息中心通知你，也可在「我的申诉」查看进度。</div></div>
    </div>
    <div v-if="rejected" class="tipbar tipbar--danger tip" role="alert">
      <IconTriangleExclamationPoint :size="20" />
      <div class="flex1"><div class="tipbar-d first">没有提交成功：{{ rejected }}</div></div>
    </div>
    <van-button block type="primary" size="large" class="submit" :loading="submitting" loading-text="提交中…" :disabled="!remark.trim()" @click="submit">提交申诉</van-button>
  </van-popup>
</template>

<style scoped>
.apl { max-height: 88vh; padding: var(--space-4) var(--space-page) var(--space-3); overflow-y: auto; box-sizing: border-box; }
.tips { margin: var(--space-3) 0 var(--space-4); padding-left: var(--space-5); list-style: disc; font-size: var(--font-size-body); line-height: 24px; color: var(--text-2); }
.tip { margin-top: var(--space-4); }
.tip + .tip { margin-top: var(--space-2); }
.tipbar-d.first { margin-top: 0; }
.submit { margin-top: var(--space-4); }
</style>
