<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { errorMessage } from '@shitu/api-client'
import { guessKind, useFileUrls, type FileBlob } from '@/composables/useFileUrls'

/** 私有文件缩略图：图片可点击大图预览（el-image），PDF 点击在新标签页打开。卸载时 revoke objectURL。 */
const props = defineProps<{ keys?: readonly string[] | null }>()
const files = useFileUrls()

interface Item {
  key: string
  state: 'loading' | 'ok' | 'error'
  blob?: FileBlob
  err?: string
}
const items = reactive<Item[]>([])

watch(
  () => props.keys,
  (keys) => {
    items.splice(0, items.length, ...(keys ?? []).map((key) => ({ key, state: 'loading' as const })))
    items.forEach((it) => {
      // PDF 不预取，点击时再拉
      if (guessKind(it.key) === 'pdf') {
        it.state = 'ok'
        it.blob = { url: '', kind: 'pdf' }
        return
      }
      files
        .get(it.key)
        .then((b) => {
          it.blob = b
          it.state = 'ok'
        })
        .catch((e: unknown) => {
          it.state = 'error'
          it.err = errorMessage(e, '加载失败')
        })
    })
  },
  { immediate: true },
)

const previewList = computed(() => items.filter((i) => i.blob?.kind === 'image').map((i) => i.blob!.url))
function previewIndex(it: Item) {
  return Math.max(0, previewList.value.indexOf(it.blob?.url ?? ''))
}
function fileName(key: string) {
  return key.split('/').pop() ?? key
}
</script>

<template>
  <div class="thumbs">
    <span v-if="items.length === 0" class="dim t-sm">未上传</span>
    <div v-for="it in items" :key="it.key" class="thumb" :title="fileName(it.key)">
      <div v-if="it.state === 'loading'" class="ph">加载中…</div>
      <div v-else-if="it.state === 'error'" class="ph err">{{ it.err }}</div>
      <el-image
        v-else-if="it.blob?.kind === 'image'"
        :src="it.blob.url"
        :preview-src-list="previewList"
        :initial-index="previewIndex(it)"
        fit="cover"
        preview-teleported
        hide-on-click-modal
        class="img"
      />
      <button v-else type="button" class="ph doc" @click="files.openInTab(it.key)">
        <b>{{ it.blob?.kind === 'pdf' ? 'PDF' : 'FILE' }}</b>
        <span>点击查看</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.thumbs { display: flex; flex-wrap: wrap; gap: 10px; }
.thumb { width: 112px; height: 84px; border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.img { width: 100%; height: 100%; display: block; cursor: zoom-in; }
.ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 11.5px; color: var(--ink-400); text-align: center; padding: 4px; }
.ph.err { color: var(--danger); }
.doc { border: 0; background: transparent; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 4px; font-family: inherit; }
.doc b { font-family: var(--f-mono); font-size: 15px; color: var(--danger); letter-spacing: .06em; }
.doc:hover { background: var(--surface-3); }
</style>
