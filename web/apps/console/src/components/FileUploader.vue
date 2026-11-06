<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, type UploadedFile } from '@shitu/api-client'
import FileLink from './FileLink.vue'

export interface FileEntry {
  key: string
  name: string
}

/**
 * 文件上传（选择即上传，保留后端返回的 key）。
 * upload 由调用方注入：入驻用 onboardingUpload(ticket)，登录后用 tenantApi.upload(file, category)。
 */
const props = withDefaults(
  defineProps<{
    upload: (file: File) => Promise<UploadedFile>
    limit?: number
    maxMb?: number
    accept?: string
    hint?: string
    /** 已登录时才能带 token 查看文件；入驻申请阶段不可预览 */
    viewable?: boolean
  }>(),
  { limit: 6, maxMb: 10, accept: '.jpg,.jpeg,.png,.pdf', hint: 'JPG / PNG / PDF，单个文件 ≤ 10MB', viewable: false },
)
const files = defineModel<FileEntry[]>({ required: true })

const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function pick() {
  input.value?.click()
}

const allowedExt = () =>
  props.accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

async function onChange(ev: Event) {
  const el = ev.target as HTMLInputElement
  const list = Array.from(el.files ?? [])
  el.value = ''
  if (!list.length) return
  const room = props.limit - files.value.length
  if (list.length > room) {
    ElMessage.warning(`最多上传 ${props.limit} 个文件`)
    list.splice(room)
  }
  uploading.value = true
  try {
    for (const f of list) {
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
      if (!allowedExt().includes(ext)) {
        ElMessage.warning(`「${f.name}」格式不支持`)
        continue
      }
      if (f.size > props.maxMb * 1024 * 1024) {
        ElMessage.warning(`「${f.name}」超过 ${props.maxMb}MB`)
        continue
      }
      try {
        const r = await props.upload(f)
        files.value = [...files.value, { key: r.key, name: r.name || f.name }]
      } catch (e) {
        ElMessage.error(`「${f.name}」上传失败：${errorMessage(e)}`)
      }
    }
  } finally {
    uploading.value = false
  }
}

function remove(i: number) {
  files.value = files.value.filter((_, idx) => idx !== i)
}
</script>

<template>
  <div class="uploader">
    <input ref="input" type="file" multiple :accept="accept" hidden @change="onChange" />
    <div v-if="files.length < limit" class="drop" :class="{ busy: uploading }" @click="pick">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="t-sm strong">{{ uploading ? '上传中…' : '点击选择文件上传' }}</div>
      <div class="t-xs">{{ hint }}（最多 {{ limit }} 个）</div>
    </div>
    <ul v-if="files.length" class="list">
      <li v-for="(f, i) in files" :key="f.key">
        <span class="tag tag--ok">已上传</span>
        <span class="name" :title="f.name">{{ f.name }}</span>
        <FileLink v-if="viewable" :file-key="f.key" />
        <el-button link type="danger" size="small" @click="remove(i)">移除</el-button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.uploader { width: 100%; }
.drop { border: 1px dashed var(--line-2); border-radius: var(--r-md); padding: 14px; text-align: center; background: var(--surface-2); cursor: pointer; color: var(--ink-400); transition: .15s; line-height: 1.6; }
.drop:hover { border-color: var(--signal); color: var(--signal); }
.drop.busy { pointer-events: none; opacity: .6; }
.list { list-style: none; margin: 8px 0 0; padding: 0; }
.list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12.5px; }
.list .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-700); }
</style>
