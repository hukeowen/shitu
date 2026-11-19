<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type MyResign } from '@shitu/api-client'
import { IconChevronRight, IconInfo, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'
import ReasonField from '@/components/ReasonField.vue'
import { parseServerTime } from '@/utils/time'

/**
 * 申请离职：离职日期（今天 … 今天 + 30 天，且晚于入职日期）+ 原因（必填 ≤255 字），交项目经理审核。
 * 同一时间只能有一条进行中的申请（后端返回 SYS_4090）。
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ subtitle?: string; startDate?: string }>()
const emit = defineEmits<{ submitted: [req: MyResign]; conflict: [] }>()

const PRESETS = ['找到其他工作了', '家里有事要回去', '身体原因干不了', '工作不适应']
const MAX = 255
const RANGE_DAYS = 30
const DAY = 86400_000

/** 北京时间的「今天」，用本地零点的 Date 表示（日期选择器只取年月日） */
function bjDate(ms: number): Date {
  const d = new Date(ms + 8 * 3600_000)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
const minDate = ref(new Date())
const maxDate = ref(new Date())
function resetRange() {
  const now = Date.now()
  let min = bjDate(now)
  // 离职日期须晚于入职日期
  const start = parseServerTime(props.startDate)
  if (start != null) {
    const afterStart = bjDate(start + DAY)
    if (afterStart > min) min = afterStart
  }
  const max = bjDate(now + RANGE_DAYS * DAY)
  minDate.value = min
  maxDate.value = max < min ? min : max
}

const p2 = (n: number) => String(n).padStart(2, '0')
/** 选中的日期：yyyy-MM-dd；空 = 还没选 */
const resignDate = ref('')
const picking = ref(false)
const pickerValue = ref<string[]>([])
function openPicker() {
  const d = resignDate.value ? resignDate.value.split('-') : [String(minDate.value.getFullYear()), p2(minDate.value.getMonth() + 1), p2(minDate.value.getDate())]
  pickerValue.value = d
  picking.value = true
}
function onPick({ selectedValues }: { selectedValues: Array<string | number> }) {
  resignDate.value = selectedValues.map((v) => p2(Number(v))).join('-')
  picking.value = false
}
const dateText = computed(() => {
  if (!resignDate.value) return ''
  const [y, m, d] = resignDate.value.split('-').map(Number)
  const week = '日一二三四五六'[new Date(y, m - 1, d).getDay()]
  return `${y} 年 ${m} 月 ${d} 日 周${week}`
})

const reason = ref('')
const submitting = ref(false)
/** 提交被拒的原因：轻提示两秒就没了，这里留在按钮上方，改了内容再清掉 */
const rejected = ref('')

watch(show, (v) => {
  if (v) {
    resetRange()
    resignDate.value = ''
    reason.value = ''
    rejected.value = ''
  } else {
    picking.value = false
  }
})
watch([reason, resignDate], () => (rejected.value = ''))

async function submit() {
  if (submitting.value) return
  if (!resignDate.value) return void showToast('请选择离职日期')
  const text = reason.value.trim()
  if (!text) return void showToast('请选择或填写离职原因')
  if (text.length > MAX) return void showToast(`离职原因不超过 ${MAX} 字`)
  submitting.value = true
  rejected.value = ''
  try {
    const req = await seekerApi.submitResignRequest({ resignDate: resignDate.value, reason: text })
    show.value = false
    showToast({ type: 'success', message: '离职申请已提交，等待项目经理审核', duration: 2500 })
    emit('submitted', req)
  } catch (e) {
    if (isApiError(e, 'SYS_4090')) {
      show.value = false
      showToast({ message: errorMessage(e, '已有一条离职申请在处理中'), duration: 2500 })
      emit('conflict')
    } else {
      rejected.value = errorMessage(e, '提交失败，请稍后重试')
      showToast(rejected.value)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="rsp">
    <div class="sheet-head">
      <div class="flex1">
        <h3>申请离职</h3>
        <p v-if="subtitle" class="sheet-sub">{{ subtitle }}</p>
      </div>
      <button type="button" class="sheet-x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>

    <div class="tipbar tip">
      <IconInfo :size="20" />
      <div class="flex1">
        <div class="tipbar-d first">申请由<b class="strong">项目经理审核</b>，通过后在离职日期生效；离职日期之前请照常上班。</div>
        <div class="tipbar-d">如有未结清的薪资预支，会从最后一笔工资中扣除。</div>
      </div>
    </div>

    <div class="field date">
      <label id="rsp-date-l">离职日期（必填）</label>
      <button type="button" class="pick" :class="{ empty: !resignDate }" aria-labelledby="rsp-date-l" @click="openPicker">
        <span class="flex1">{{ dateText || '请选择离职日期' }}</span>
        <IconChevronRight :size="20" />
      </button>
      <p class="hint">可选今天起 {{ RANGE_DAYS }} 天内的日期</p>
    </div>

    <ReasonField
      id="rsp-reason"
      v-model="reason"
      class="reason"
      label="离职原因（必填）"
      :presets="PRESETS"
      :max="MAX"
      placeholder="点上面的原因，或自己写几句…"
    />

    <div v-if="rejected" class="tipbar tipbar--danger tip" role="alert">
      <IconTriangleExclamationPoint :size="20" />
      <div class="flex1"><div class="tipbar-d first">没有提交成功：{{ rejected }}</div></div>
    </div>
    <van-button block type="primary" size="large" class="submit" :loading="submitting" loading-text="提交中…" :disabled="!resignDate || !reason.trim()" @click="submit">提交离职申请</van-button>

    <van-popup v-model:show="picking" position="bottom" round teleport="body" safe-area-inset-bottom>
      <van-date-picker
        v-model="pickerValue"
        title="选择离职日期"
        :min-date="minDate"
        :max-date="maxDate"
        confirm-button-text="确定"
        cancel-button-text="取消"
        @confirm="onPick"
        @cancel="picking = false"
      />
    </van-popup>
  </van-popup>
</template>

<style scoped>
.rsp { max-height: 88vh; padding: var(--space-4) var(--space-page) var(--space-3); overflow-y: auto; box-sizing: border-box; }
.tip { margin-top: var(--space-3); }
.tipbar-d.first { margin-top: 0; }
.date { margin-top: var(--space-4); }
.pick { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-body); color: var(--text-1); text-align: left; }
.pick.empty { color: var(--text-placeholder); }
.pick > svg { flex: none; color: var(--text-3); }
.hint { margin-top: var(--space-1); font-size: var(--font-size-min); line-height: 18px; color: var(--text-3); }
.reason { margin-bottom: 0; }
.submit { margin-top: var(--space-4); }
</style>
