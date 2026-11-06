/** 渠道码暂存：扫码进入 /r/:code 时写入，注册时随请求提交（docs/02 §10，有效期 7 天） */
const KEY = 'shitu.channel'
const TTL_MS = 7 * 24 * 3600 * 1000

export interface ChannelRecord {
  code: string
  ts: number
}

export function saveChannel(code: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, ts: Date.now() } satisfies ChannelRecord))
  } catch {
    /* 隐私模式下 localStorage 不可用，后端 Cookie 兜底 */
  }
}

export function readChannel(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const rec = JSON.parse(raw) as ChannelRecord
    if (Date.now() - rec.ts > TTL_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return rec.code
  } catch {
    return null
  }
}
