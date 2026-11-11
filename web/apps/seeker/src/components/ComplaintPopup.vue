<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type ComplaintCategory } from '@shitu/api-client'

/**
 * S-19 岗位投诉（C-402）：3 类 + 选填说明（≤500 字）。只能投诉自己匹配到或报名过的岗位（APP_4004），
 * 同一岗位有待核实的投诉时不能重复提交（SYS_4090）。可附最多 3 张图片凭证（JPG / PNG，单张 5MB 以内）。
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ jobId: string; jobTitle?: string; subtitle?: string }>()
const emit = defineEmits<{ submitted: [] }>()

const OPTIONS: { v: ComplaintCategory; t: string }[] = [
  { v: 'FULL_STILL_HIRING', t: '岗位已满仍在招' },
  { v: 'INFO_FALSE', t: '岗位信息不实' },
  { v: 'MISMATCH_AFTER_INTERVIEW', t: '面试后岗位不符' },
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
    <div class="sheet-h" aria-hidden="true"></div>
    <div class="row-b" style="margin-bottom: 4px">
      <h3 class="ttl">投诉该岗位</h3>
      <button type="button" class="x" aria-label="关闭" @click="show = false"><van-icon name="cross" size="18" /></button>
    </div>
    <p v-if="jobTitle || subtitle" class="t-sm sub">{{ [jobTitle, subtitle].filter(Boolean).join(' · ') }}</p>

    <div class="stack-sm" role="radiogroup" aria-label="投诉类型">
      <button
        v-for="(o, i) in OPTIONS"
        :key="o.v"
        type="button"
        role="radio"
        :aria-checked="category === o.v"
        class="qopt"
        :class="{ sel: category === o.v }"
        @click="category = o.v"
      >
        <span class="k">{{ i + 1 }}</span>{{ o.t }}
      </button>
    </div>

    <div class="field" style="margin-top: 14px">
      <label for="cmp-ta">补充说明（选填）</label>
      <textarea id="cmp-ta" v-model="content" class="ta" :maxlength="MAX" rows="3" placeholder="请描述具体情况，便于平台核实处理…"></textarea>
      <div class="cnt t-xs" :class="{ over: content.length >= MAX }">{{ content.length }} / {{ MAX }}</div>
    </div>

    <div class="field">
      <label>图片凭证（选填，最多 {{ MAX_IMAGES }} 张）</label>
      <div class="shots">
        <div v-for="(s, i) in shots" :key="s.key" class="shot">
          <img :src="s.url" alt="投诉凭证" />
          <button type="button" class="shot-x" aria-label="删除这张图片" @click="removeShot(i)"><van-icon name="cross" size="12" /></button>
        </div>
        <button v-if="shots.length < MAX_IMAGES" type="button" class="shot add" :disabled="uploading" @click="picker?.click()">
          <van-loading v-if="uploading" size="18" />
          <template v-else><van-icon name="photograph" size="22" /><span>添加图片</span></template>
        </button>
      </div>
      <input ref="picker" type="file" accept="image/jpeg,image/png" multiple hidden @change="onPick" />
    </div>

    <div class="note note--warn" style="margin-bottom: 14px">
      投诉将记录至该岗位与企业的诚信档案。同一岗位累计被投诉并核实属实，系统将下架该岗位并扣减企业诚信分。
    </div>
    <van-button block type="danger" class="btn-cta" :loading="submitting" loading-text="提交中…" :disabled="!category" @click="submit">提交投诉</van-button>
  </van-popup>
</template>

<style scoped>
.cmp { padding: 8px 16px 12px; max-height: 88vh; overflow-y: auto; box-sizing: border-box; }
.sheet-h { width: 36px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 auto 12px; }
.ttl { font-size: 17px; font-weight: 700; color: var(--ink-900); }
.x { width: 32px; height: 32px; display: grid; place-items: center; background: none; border: 0; color: var(--ink-500); padding: 0; margin-right: -6px; }
.sub { margin-bottom: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qopt { font-size: 14px; padding: 11px 14px; }
.cnt { text-align: right; margin-top: 4px; }
.cnt.over { color: var(--warn); }
.field { margin-bottom: 12px; }
.shots { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
.shot { position: relative; width: 76px; height: 76px; border-radius: var(--r-sm); overflow: hidden; border: 1px solid var(--line); background: var(--surface); padding: 0; }
.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.shot.add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-style: dashed; color: var(--ink-500); font-size: 11px; }
.shot-x { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, 0.55); color: #fff; display: grid; place-items: center; padding: 0; }
</style>
