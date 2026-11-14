<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { errorMessage } from '@shitu/api-client'
import { IconFileText, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { guessKind, useFileUrls, type FileBlob } from '@/composables/useFileUrls'

/**
 * 私有文件缩略图：图片可点击大图预览（el-image），PDF 点击在新标签页打开。卸载时 revoke objectURL。
 * 审核材料统一排法（工单 23）：112×84 的缩略图块，间距 12，块下一行 12px 说明（label 加序号，没给 label 时写文件类型）。
 */
const props = defineProps<{ keys?: readonly string[] | null; label?: string }>()
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
function caption(it: Item, i: number) {
  const n = items.length > 1 ? ` ${i + 1}` : ''
  if (props.label) return props.label + n
  return (guessKind(it.key) === 'pdf' ? 'PDF 文件' : guessKind(it.key) === 'image' ? '图片' : '文件') + n
}
</script>

<template>
  <div class="thumbs">
    <span v-if="items.length === 0" class="none">未上传</span>
    <figure v-for="(it, i) in items" :key="it.key" class="mat" :title="fileName(it.key)">
      <div class="thumb">
        <div v-if="it.state === 'loading'" class="ph">加载中…</div>
        <div v-else-if="it.state === 'error'" class="ph err"><IconTriangleExclamationPoint :size="20" /><span>{{ it.err }}</span></div>
        <el-image
          v-else-if="it.blob?.kind === 'image'"
          :src="it.blob.url"
          :preview-src-list="previewList"
          :initial-index="previewIndex(it)"
          fit="cover"
          preview-teleported
          hide-on-click-modal
          class="img"
        >
          <template #error><div class="ph err"><IconTriangleExclamationPoint :size="20" /><span>图片打不开</span></div></template>
        </el-image>
        <button v-else type="button" class="ph doc" @click="files.openInTab(it.key)">
          <IconFileText :size="24" />
          <span>点击查看</span>
        </button>
      </div>
      <figcaption>{{ caption(it, i) }}</figcaption>
    </figure>
  </div>
</template>

<style scoped>
.thumbs { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.none { font-size: var(--font-size-aux); color: var(--text-3); }
.mat { margin: 0; width: 112px; }
.thumb { width: 112px; height: 84px; border: 1px solid var(--border); border-radius: var(--radius-control); overflow: hidden; background: var(--bg-fill); }
.mat figcaption { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.img { width: 100%; height: 100%; display: block; cursor: zoom-in; }
.ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: var(--font-size-min); color: var(--text-3); text-align: center; padding: var(--space-1); }
.ph.err { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); color: var(--text-3); }
.doc { border: 0; background: transparent; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); font-family: inherit; color: var(--text-2); }
.doc:hover { background: var(--bg-hover); color: var(--primary-text); }
</style>
