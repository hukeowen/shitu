import { http } from '@shitu/api-client'

/** 从 Content-Disposition 取文件名（支持 RFC 5987 filename*=UTF-8''…） */
function filenameOf(cd: string | undefined, fallback: string): string {
  if (!cd) return fallback
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd)
  return plain ? plain[1] : fallback
}

/** 带 token 下载需要鉴权的文件（模板、失败行等）并触发浏览器保存 */
export async function downloadAuthed(path: string, fallbackName: string): Promise<void> {
  const resp = await http.get<Blob>(path, { responseType: 'blob' })
  const header = resp.headers['content-disposition']
  const name = filenameOf(typeof header === 'string' ? header : undefined, fallbackName)
  const url = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
