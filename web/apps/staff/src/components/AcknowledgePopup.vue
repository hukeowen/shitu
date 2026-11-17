<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, reactive, ref, watch } from 'vue'
import { showSuccessToast, showToast, type PickerOption } from 'vant'
import { errorMessage, isApiError, tenantApi, type SiteApplication } from '@shitu/api-client'
import { IconCheck } from '@shitu/ui-icons'
import { useAuthStore } from '@/stores/auth'
import { fmtFull, nextWorkday9, parseLocal, toLocalIso } from '@/utils/time'

/**
 * M-02「知悉并推送面试信息」：全屏表单。首次知悉（ACKNOWLEDGE）与修改面试信息（REPUSH）共用，
 * 提交后后端通过短信 + 站内信推送给求职者（C-408），可重复推送，以最后一次为准。
 */
const props = defineProps<{ application: SiteApplication | null }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ done: [app: SiteApplication]; rejected: [e: unknown] }>()
/** 提交被拒的原因：留在提交按钮上方，轻提示消失后还看得到 */
const submitError = ref('')
/** 后端业务拒绝后提交按钮置灰；改了表单内容可以再提交 */
const rejected = ref(false)

const auth = useAuthStore()
const PRESET_DOCS = ['身份证', '一寸照片', '银行卡', '健康证', '学历证明']
const MINUTE_STEP = 5

const form = reactive({
  interviewAt: nextWorkday9(),
  address: '',
  routeTips: '',
  documents: [] as string[],
  contactName: '',
  contactPhone: '',
})
const customDocs = ref<string[]>([])
const customInput = ref('')
const prefilling = ref(false)
const submitting = ref(false)
const addressHint = ref('')
const timeHint = ref('')

const isRepush = computed(() => props.application?.allowedActions.includes('REPUSH') ?? false)
const title = computed(() => (isRepush.value ? '修改面试信息' : '知悉并推送面试信息'))
const allDocs = computed(() => [...PRESET_DOCS, ...customDocs.value])

watch(show, (v) => {
  if (v) submitError.value = ''
  if (v && props.application) void prefill(props.application)
})
watch([form, customDocs], () => (rejected.value = false), { deep: true })

async function prefill(app: SiteApplication) {
  const existing = parseLocal(app.interviewAt)
  form.interviewAt = existing && existing.getTime() > shNowMs() ? existing : nextWorkday9()
  form.address = ''
  form.routeTips = ''
  form.documents = ['身份证']
  form.contactName = auth.me?.name ?? ''
  form.contactPhone = ''
  customDocs.value = []
  customInput.value = ''
  addressHint.value = ''
  timeHint.value = ''
  // 重新推送：带出上次推送的面试信息，只需改动变化的部分
  const n = app.notice
  if (n) {
    form.address = n.address ?? ''
    form.routeTips = n.routeTips ?? ''
    form.documents = n.documents?.length ? [...n.documents] : []
    customDocs.value = form.documents.filter((d) => !PRESET_DOCS.includes(d))
    form.contactName = n.contactName ?? form.contactName
    form.contactPhone = n.contactPhone ?? ''
    const pushed = parseLocal(n.pushedAt)
    if (pushed) addressHint.value = `已带出 ${fmtFull(pushed)} 推送的面试信息`
    return
  }
  prefilling.value = true
  try {
    // 面试地点 / 所需材料默认取岗位信息，岗位取不到时退回项目地址
    const job = await tenantApi.job(app.jobId)
    if (props.application?.applicationId !== app.applicationId) return
    form.address = job.interviewAddress ?? ''
    if (job.interviewTimeDesc) timeHint.value = `岗位面试时间：${job.interviewTimeDesc}`
    if (job.requiredDocuments?.length) {
      form.documents = [...job.requiredDocuments]
      customDocs.value = job.requiredDocuments.filter((d) => !PRESET_DOCS.includes(d))
    }
    if (form.address) addressHint.value = '已带出岗位面试地址，可修改'
  } catch {
    try {
      const project = await tenantApi.project(app.projectId)
      if (props.application?.applicationId !== app.applicationId) return
      form.address = [project.city, project.district, project.address].filter(Boolean).join('')
      if (form.address) addressHint.value = '已带出项目地址，可修改'
    } catch {
      /* 留空由驻场填写 */
    }
  } finally {
    prefilling.value = false
  }
}

// ---------- 时间选择 ----------
const pickerShow = ref(false)
const dateVals = ref<string[]>([])
const timeVals = ref<string[]>([])
const minDate = computed(() => {
  const d = shNow()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
})
const maxDate = computed(() => {
  const d = shNow()
  return new Date(d.getFullYear(), d.getMonth() + 2, d.getDate())
})
const p2 = (n: number) => String(n).padStart(2, '0')

function openPicker() {
  const d = form.interviewAt
  dateVals.value = [String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate())]
  // 分钟按步长取整（59 分取整到 55，避免进位跨天）
  const m = Math.min(Math.round(d.getMinutes() / MINUTE_STEP) * MINUTE_STEP, 60 - MINUTE_STEP)
  timeVals.value = [p2(d.getHours()), p2(m)]
  pickerShow.value = true
}

function minuteFilter(type: string, options: PickerOption[]): PickerOption[] {
  return type === 'minute' ? options.filter((o) => Number(o.value) % MINUTE_STEP === 0) : options
}

function onPickerConfirm() {
  const [y, mo, d] = dateVals.value.map(Number)
  const [h, mi] = timeVals.value.map(Number)
  const picked = new Date(y, mo - 1, d, h, mi, 0)
  if (picked.getTime() <= shNowMs()) {
    showToast('面试时间需晚于当前时间')
    return
  }
  form.interviewAt = picked
  pickerShow.value = false
}

// ---------- 材料 ----------
function toggleDoc(d: string) {
  const i = form.documents.indexOf(d)
  if (i >= 0) form.documents.splice(i, 1)
  else form.documents.push(d)
}
function addCustomDoc() {
  const v = customInput.value.trim()
  if (!v) return
  if (v.length > 20) {
    showToast('材料名称最多 20 字')
    return
  }
  if (!allDocs.value.includes(v)) customDocs.value.push(v)
  if (!form.documents.includes(v)) form.documents.push(v)
  customInput.value = ''
}

// ---------- 提交 ----------
const PHONE_RE = /^(1\d{10}|0\d{2,3}-?\d{7,8}(-\d{1,6})?|400-?\d{3}-?\d{4})$/

async function submit() {
  const app = props.application
  if (!app || submitting.value) return
  if (form.interviewAt.getTime() <= shNowMs()) {
    showToast('面试时间需晚于当前时间')
    return
  }
  if (!form.address.trim()) {
    showToast('请填写面试地点')
    return
  }
  const phone = form.contactPhone.replace(/\s/g, '')
  if (phone && !PHONE_RE.test(phone)) {
    showToast('联系电话格式不正确')
    return
  }
  submitting.value = true
  submitError.value = ''
  try {
    const updated = await tenantApi.acknowledge(app.applicationId, {
      interviewAt: toLocalIso(form.interviewAt),
      address: form.address.trim(),
      routeTips: form.routeTips.trim() || undefined,
      documents: form.documents.length ? [...form.documents] : undefined,
      contactName: form.contactName.trim() || undefined,
      contactPhone: phone || undefined,
    })
    showSuccessToast('已推送给求职者（短信 + 站内信）')
    show.value = false
    emit('done', updated)
  } catch (e) {
    submitError.value = errorMessage(e, '推送失败，请稍后重试')
    submitting.value = false
    rejected.value = isApiError(e) && e.code !== 'NETWORK'
    showToast(submitError.value)
    emit('rejected', e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="right" class="ack-pop" :style="{ width: '100%', height: '100%' }" :close-on-popstate="true" teleport="body">
    <div class="ack">
      <van-nav-bar :title="title" left-arrow safe-area-inset-top @click-left="show = false" />
      <div v-if="application" class="body">
        <section class="who">
          <div class="avatar">{{ application.seekerName.slice(0, 1) }}</div>
          <div class="flex1">
            <b>{{ application.seekerName }}</b>
            <span>{{ application.jobTitle ?? '—' }}<template v-if="application.projectName"> · {{ application.projectName }}</template></span>
          </div>
        </section>

        <van-cell-group inset class="grp">
          <van-field
            label="面试时间"
            required
            is-link
            readonly
            :class="{ 'has-hint': timeHint }"
            @click="openPicker"
          >
            <!-- 用文字而不是输入框显示：360 宽下能折行，不会截成「09:」 -->
            <template #input><span class="pick-val">{{ fmtFull(form.interviewAt) }}</span></template>
          </van-field>
          <div v-if="timeHint" class="hint">{{ timeHint }}</div>
          <van-field
            v-model="form.address"
            label="面试地点"
            required
            type="textarea"
            rows="2"
            autosize
            maxlength="200"
            :class="{ 'has-hint': addressHint }"
            :placeholder="prefilling ? '正在带出岗位地址…' : '工厂 / 园区 + 门岗，如：昆山开发区 XX 路 88 号 2 号门'"
          />
          <div v-if="addressHint" class="hint">{{ addressHint }}</div>
          <van-field v-model="form.routeTips" label="路线提示" type="textarea" rows="2" autosize maxlength="200" show-word-limit placeholder="选填，如：地铁 S1 线 XX 站 2 号口出，步行 500 米" />
        </van-cell-group>

        <van-cell-group inset class="grp">
          <div class="docs-hd">所需材料<span>（可多选）</span></div>
          <div class="chips">
            <button
              v-for="d in allDocs"
              :key="d"
              type="button"
              class="chip-tap"
              :aria-pressed="form.documents.includes(d)"
              @click="toggleDoc(d)"
            >
              <span class="chip" :class="{ on: form.documents.includes(d) }"><IconCheck :size="14" class="ck" />{{ d }}</span>
            </button>
          </div>
          <div class="custom">
            <input v-model="customInput" class="custom-in" maxlength="20" placeholder="其他材料，如：体检报告" enterkeyhint="done" @keyup.enter="addCustomDoc" />
            <van-button plain type="primary" :disabled="!customInput.trim()" @click="addCustomDoc">添加</van-button>
          </div>
        </van-cell-group>

        <van-cell-group inset class="grp">
          <van-field v-model="form.contactName" label="联系人" maxlength="20" placeholder="默认为你的姓名" />
          <van-field v-model="form.contactPhone" label="联系电话" type="tel" maxlength="20" placeholder="选填，求职者可直接拨打" />
        </van-cell-group>

        <p class="tip">提交后将通过<b>短信 + 站内信</b>推送给求职者。面试信息可重复修改，以最后一次推送为准。</p>
      </div>

      <div class="foot">
        <p v-if="submitError" class="bar-why err" role="status">没有提交成功：{{ submitError }}</p>
        <van-button block type="primary" class="btn-cta" size="large" :loading="submitting" loading-text="推送中…" :disabled="!application || rejected" @click="submit">
          {{ isRepush ? '保存并重新推送' : '确认知悉并推送' }}
        </van-button>
      </div>
    </div>

    <van-popup v-model:show="pickerShow" position="bottom" round teleport="body" safe-area-inset-bottom>
      <van-picker-group title="面试时间" :tabs="['选择日期', '选择时间']" next-step-text="下一步" @confirm="onPickerConfirm" @cancel="pickerShow = false">
        <van-date-picker v-model="dateVals" :min-date="minDate" :max-date="maxDate" />
        <van-time-picker v-model="timeVals" :filter="minuteFilter" />
      </van-picker-group>
    </van-popup>
  </van-popup>
</template>

<style scoped>
.ack { height: 100%; display: flex; flex-direction: column; background: var(--bg-page); }
.body { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 16px; }
.who { display: flex; align-items: center; gap: 10px; padding: 14px 16px 4px; }
.who b { display: block; font-size: var(--font-size-body); font-weight: 700; color: var(--text-1); }
.who span { display: block; font-size: var(--font-size-aux); color: var(--text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp { margin-top: 12px; }
.pick-val { color: var(--text-1); overflow-wrap: anywhere; }
.hint { position: relative; padding: 0 16px 12px; margin-top: -6px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); background: var(--bg-card); }
/* 说明行接在字段下面：分隔线从字段底下挪到说明行底下，说明和它的字段看起来是一格 */
.hint::after { content: ''; position: absolute; left: 16px; right: 16px; bottom: 0; border-bottom: 1px solid var(--border); transform: scaleY(.5); }
.grp :deep(.van-cell.has-hint::after) { display: none; }
.docs-hd { padding: 12px 16px 4px; font-size: var(--font-size-body); color: var(--text-1); }
.docs-hd span { font-size: var(--font-size-aux); color: var(--text-3); }
.chips { display: flex; flex-wrap: wrap; column-gap: var(--space-2); padding: 4px 16px 0; }
/* 可点的小标签：外层按钮撑到 44 高当点击区，里面的标签保持原来大小 */
.chip-tap { display: inline-flex; align-items: center; min-height: var(--control-height); padding: 0; border: 0; background: none; font: inherit; }
/* 选中时左边多出 14 的勾和 4 的间距：没选中时左右各多留 9，选中前后宽度不变、文字居中 */
.chip { display: inline-flex; align-items: center; gap: var(--space-1); height: 32px; padding: 0 19px; border-radius: 16px; border: 1px solid var(--border); background: var(--bg-card); font-size: var(--font-size-aux); color: var(--text-2); }
.chip .ck { display: none; }
.chip.on { padding: 0 var(--space-3) 0 var(--space-2); border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); }
.chip.on .ck { display: inline-block; }
.custom { display: flex; gap: 8px; align-items: center; padding: 8px 16px 14px; }
.custom-in { flex: 1; min-width: 0; height: var(--control-height); padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-control); font-size: 16px; background: var(--bg-page); color: var(--text-1); outline: none; }
.custom-in:focus { border-color: var(--primary); background: var(--bg-card); }
.tip { padding: 12px 18px 0; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.tip b { color: var(--text-2); }
.foot { flex: none; padding: 10px var(--space-4) calc(10px + env(safe-area-inset-bottom)); background: var(--bg-card); border-top: 1px solid var(--border); }
</style>
