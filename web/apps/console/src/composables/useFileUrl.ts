import { onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, fetchFileUrl, tenantApi } from '@shitu/api-client'

export interface LoadedFile {
  url: string
  type: string
  isImage: boolean
  isPdf: boolean
}

/**
 * 私有文件（营业执照、合同）需要带 token 拉取，转成 objectURL 后预览。
 * 组件卸载时统一 revoke。
 */
export function useFileUrl() {
  const urls = new Set<string>()
  const loading = ref(false)

  async function load(key: string): Promise<LoadedFile> {
    loading.value = true
    try {
      const { url, type } = await fetchFileUrl(tenantApi.filePath, key)
      urls.add(url)
      const lower = key.toLowerCase()
      const isPdf = type === 'application/pdf' || lower.endsWith('.pdf')
      const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(lower)
      return { url, type, isImage, isPdf }
    } finally {
      loading.value = false
    }
  }

  function revoke(url: string) {
    if (urls.delete(url)) URL.revokeObjectURL(url)
  }

  function revokeAll() {
    urls.forEach((u) => URL.revokeObjectURL(u))
    urls.clear()
  }

  /** 非图片（PDF 等）直接新标签页打开；新标签页加载需要时间，延迟回收 */
  async function openInNewTab(key: string) {
    try {
      const f = await load(key)
      const w = window.open(f.url, '_blank')
      if (!w) ElMessage.warning('浏览器拦截了弹出窗口，请允许后重试')
      setTimeout(() => revoke(f.url), 60_000)
    } catch (e) {
      ElMessage.error(errorMessage(e, '文件加载失败'))
    }
  }

  onBeforeUnmount(revokeAll)

  return { loading, load, revoke, revokeAll, openInNewTab }
}
