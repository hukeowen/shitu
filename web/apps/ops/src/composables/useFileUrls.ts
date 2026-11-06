import { onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, fetchFileUrl, opsApi } from '@shitu/api-client'

export interface FileBlob {
  url: string
  /** image / pdf / other */
  kind: 'image' | 'pdf' | 'other'
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i
const PDF_EXT = /\.pdf$/i

function kindOf(type: string, key: string): FileBlob['kind'] {
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf') return 'pdf'
  if (IMG_EXT.test(key)) return 'image'
  if (PDF_EXT.test(key)) return 'pdf'
  return 'other'
}

export function guessKind(key: string): FileBlob['kind'] {
  return kindOf('', key)
}

/**
 * 私有文件（营业执照、合同）：带 token 拉 blob → objectURL，组件卸载时统一 revoke。
 * 抽屉使用 destroy-on-close，关闭抽屉即释放。
 */
export function useFileUrls() {
  const cache = new Map<string, Promise<FileBlob>>()
  const urls = new Set<string>()

  function get(key: string): Promise<FileBlob> {
    let p = cache.get(key)
    if (!p) {
      p = fetchFileUrl(opsApi.filePath, key).then((r) => {
        urls.add(r.url)
        return { url: r.url, kind: kindOf(r.type, key) }
      })
      p.catch(() => cache.delete(key))
      cache.set(key, p)
    }
    return p
  }

  /** 在新标签页打开（PDF 等）。先同步开窗避免被浏览器拦截弹窗，拿到 blob 后再跳转。 */
  async function openInTab(key: string) {
    const win = window.open('', '_blank')
    try {
      const f = await get(key)
      if (win) {
        win.location.href = f.url
      } else {
        const a = document.createElement('a')
        a.href = f.url
        a.target = '_blank'
        a.rel = 'noopener'
        a.click()
      }
    } catch (e) {
      win?.close()
      ElMessage.error(errorMessage(e, '文件加载失败'))
    }
  }

  function revokeAll() {
    // 已在新标签页打开的 PDF 稍后再释放，避免查看器还在读取
    const list = [...urls]
    urls.clear()
    cache.clear()
    setTimeout(() => list.forEach((u) => URL.revokeObjectURL(u)), 60_000)
  }

  onBeforeUnmount(revokeAll)

  return { get, openInTab, revokeAll }
}
