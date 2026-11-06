<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '@shitu/api-client'
import { guessKind, useFileUrls } from '@/composables/useFileUrls'

/** 查看单个私有文件（合同）：图片弹出大图查看器，PDF / 其他在新标签页打开。卸载时 revoke。 */
const props = withDefaults(defineProps<{ fileKey?: string | null; text?: string }>(), { text: '查看' })
const files = useFileUrls()
const viewerUrl = ref('')
const loading = ref(false)

async function view() {
  if (!props.fileKey) return
  if (guessKind(props.fileKey) !== 'image') {
    await files.openInTab(props.fileKey)
    return
  }
  loading.value = true
  try {
    viewerUrl.value = (await files.get(props.fileKey)).url
  } catch (e) {
    ElMessage.error(errorMessage(e, '文件加载失败'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-button v-if="fileKey" link type="primary" size="small" :loading="loading" @click.stop="view">{{ text }}</el-button>
  <span v-else class="dim">—</span>
  <el-image-viewer v-if="viewerUrl" :url-list="[viewerUrl]" teleported hide-on-click-modal @close="viewerUrl = ''" />
</template>
