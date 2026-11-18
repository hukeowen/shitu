<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type ComplaintCategory } from '@shitu/api-client'
import { IconCheck, IconPlus, IconX } from '@shitu/ui-icons'

/**
 * S-19 岗位投诉（C-402）：3 类 + 选填说明（≤500 字）。只能投诉自己匹配到或报名过的岗位（APP_4004），
 * 同一岗位有待核实的投诉时不能重复提交（SYS_4090）。可附最多 3 张图片凭证（JPG / PNG，单张 5MB 以内）。
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ jobId: string; jobTitle?: string; subtitle?: string }>()
const emit = defineEmits<{ submitted: [] }>()

const OPTIONS: { v: ComplaintCategory; t: string }[] = [
  { v: 'FULL_STILL_HIRING', t: '招满了还在招' },
  { v: 'INFO_FALSE', t: '岗位信息不实' },
  { v: 'MISMATCH_AFTER_INTERVIEW', t: '面试后发现不符' },
]
const MAX = 500
const MAX_IMAGES = 3
const MAX_BYTES = 5 * 1024 * 1024

interface Shot { key: string; url: string }
const shots = ref<Shot[]>([])
const uploading = ref(false)
const picker = ref<HTMLInputElement | null>(null)

function clearShots() {
  shots.value.forEach((s) => URL.revokeObjectURL(s.url))
  shots.value = []
}
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  for (const f of files) {
    if (shots.value.length >= MAX_IMAGES) {
      showToast('最多上传 ' + MAX_IMAGES + ' 张')
      break
    }
    if (!/^image\/(jpeg|png)$/.test(f.type)) {
      showToast('只支持 JPG / PNG 图片')
      continue
    }
    if (f.size > MAX_BYTES) {
      showToast('单张图片不能超过 5MB')
      continue
    }
    uploading.value = true
    try {
      const up = await seekerApi.uploadComplaintImage(f)
      shots.value = [...shots.value, { key: up.key, url: URL.createObjectURL(f) }]
    } catch (err) {
      showToast(errorMessage(err, '图片上传失败，请重试'))
    } finally {
      uploading.value = false
    }
  }
}
function removeShot(i: number) {
  URL.revokeObjectURL(shots.value[i].url)
  shots.value = shots.value.filter((_, idx) => idx !== i)
}

const category = ref<ComplaintCategory | null>(null)
const content = ref('')
const submitting = ref(false)

watch(show, (v) => {
  if (v) {
    category.value = null
    content.value = ''
    clearShots()
  }
})

async function submit() {
  if (submitting.value) return
  if (!category.value) return void showToast('请选择投诉类型')
  const text = content.value.trim()
  if (text.length > MAX) return void showToast(`说明不超过 ${MAX} 字`)
  if (uploading.value) return void showToast('图片还在上传，请稍候')
  submitting.value = true
  try {
    await seekerApi.complain(props.jobId, category.value, text || undefined, shots.value.length ? shots.value.map((s) => s.key) : undefined)
    show.value = false
    showToast({ type: 'success', message: '投诉已提交，平台将尽快核实', duration: 2500 })
    emit('submitted')
  } catch (e) {
    if (isApiError(e, 'SYS_4090')) {
      show.value = false
      showToast(errorMessage(e, '你已投诉过该岗位，平台正在核实'))
    } else if (isApiError(e, 'APP_4004')) {
      showToast(errorMessage(e, '只能投诉你匹配到或报名过的岗位'))
    } else {
      showToast(errorMessage(e, '提交失败，请稍后重试'))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="cmp">
    <div class="sheet-head">
      <div class="flex1">
        <h3>投诉该岗位</h3>
        <p v-if="jobTitle || subtitle" class="sheet-sub">{{ [jobTitle, subtitle].filter(Boolean).join(' · ') }}</p>
      </div>
      <button type="button" class="sheet-x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>

    <div class="opts" role="radiogroup" aria-label="投诉类型">
      <button
        v-for="o in OPTIONS"
        :key="o.v"
        type="button"
        role="radio"
        :aria-checked="category === o.v"
        class="qopt"
        :class="{ sel: category === o.v }"
        @click="category = o.v"
      >
        <span class="flex1">{{ o.t }}</span>
        <IconCheck v-if="category === o.v" :size="20" :stroke-width="2.25" />
      </button>
    </div>

    <div class="field">
      <label for="cmp-ta">补充说明（选填）</label>
      <textarea id="cmp-ta" v-model="content" class="ta" :maxlength="MAX" rows="3" placeholder="请描述具体情况，便于平台核实处理…"></textarea>
      <div class="cnt" :class="{ over: content.length >= MAX }">{{ content.length }} / {{ MAX }}</div>
    </div>

    <div class="field">
      <label>图片凭证（选填，最多 {{ MAX_IMAGES }} 张）</label>
      <div class="shots">
        <div v-for="(s, i) in shots" :key="s.key" class="shot">
          <img :src="s.url" alt="投诉凭证" />
          <button type="button" class="shot-x" aria-label="删除这张图片" @click="removeShot(i)"><IconX :size="14" :stroke-width="2.25" /></button>
        </div>
        <button v-if="shots.length < MAX_IMAGES" type="button" class="shot add" :disabled="uploading" @click="picker?.click()">
          <van-loading v-if="uploading" size="20" />
          <template v-else><IconPlus :size="24" /><span>添加图片</span></template>
        </button>
      </div>
      <input ref="picker" type="file" accept="image/jpeg,image/png" multiple hidden @change="onPick" />
    </div>

    <div class="note note--warn">
      投诉将记录至该岗位与企业的诚信档案。同一岗位累计被投诉并核实属实，系统将下架该岗位并扣减企业诚信分。
    </div>
    <van-button block type="primary" size="large" class="submit" :loading="submitting" loading-text="提交中…" :disabled="!category" @click="submit">提交投诉</van-button>
  </van-popup>
</template>

<style scoped>
.cmp { max-height: 88vh; padding: var(--space-4) var(--space-page) var(--space-3); overflow-y: auto; box-sizing: border-box; }
.opts { display: grid; gap: var(--space-2); margin: var(--space-3) 0 var(--space-4); }
.field { margin-bottom: var(--space-4); }
/* 输入框里的字不小于 16px，否则 iOS 聚焦时会放大页面 */
.ta { font-size: 16px; }
.cnt { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); text-align: right; }
.cnt.over { color: var(--danger-text); }
.shots { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.shot { position: relative; width: 76px; height: 76px; padding: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); }
.shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.shot.add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); border-style: dashed; font-size: var(--font-size-min); color: var(--text-3); }
.shot-x { position: absolute; top: 0; right: 0; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 0 0 0 var(--radius-control); background: var(--text-1); color: var(--text-on-primary); }
.submit { margin-top: var(--space-4); }
</style>
