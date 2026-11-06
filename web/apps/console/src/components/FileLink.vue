<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '@shitu/api-client'
import { useFileUrl } from '@/composables/useFileUrl'

/** 查看私有文件：图片用大图预览，PDF 等新标签页打开 */
const props = withDefaults(defineProps<{ fileKey: string; label?: string }>(), { label: '查看' })

const { loading, load, revoke } = useFileUrl()
const preview = ref<string | null>(null)

async function open() {
  try {
    const f = await load(props.fileKey)
    if (f.isImage) {
      preview.value = f.url
    } else {
      const w = window.open(f.url, '_blank')
      if (!w) ElMessage.warning('浏览器拦截了弹出窗口，请允许后重试')
      setTimeout(() => revoke(f.url), 60_000)
    }
  } catch (e) {
    ElMessage.error(errorMessage(e, '文件加载失败'))
  }
}

function close() {
  if (preview.value) revoke(preview.value)
  preview.value = null
}
</script>

<template>
  <el-button link type="primary" size="small" :loading="loading" @click="open">{{ label }}</el-button>
  <el-image-viewer v-if="preview" :url-list="[preview]" teleported hide-on-click-modal @close="close" />
</template>
