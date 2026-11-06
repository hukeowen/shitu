import { defineStore } from 'pinia'
import { seekerApi, type ChannelInfo } from '@shitu/api-client'

/**
 * 渠道码暂存：扫码 /r/{code}（后端 302 到 /?ch=）或前端兜底路由 /r/:code 写入，注册时随请求提交。
 * localStorage 有效期 7 天；后端同时写了 7 天 HttpOnly Cookie（docs/02 §10），localStorage 不可用时由 Cookie 兜底。
 */
const KEY = 'shitu.channel'
const TTL_MS = 7 * 24 * 3600 * 1000

export interface ChannelRecord {
  code: string
  ts: number
}

/** 同一渠道码的查询去重（扫码进入时 capture 与启动流程都会触发） */
let inflight: { code: string; p: Promise<void> } | null = null

const CODE_RE = /^[0-9A-Za-z_-]{1,64}$/

export function saveChannel(code: string) {
  if (!CODE_RE.test(code)) return
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
    if (Date.now() - rec.ts > TTL_MS || !CODE_RE.test(rec.code)) {
      localStorage.removeItem(KEY)
      return null
    }
    return rec.code
  } catch {
    return null
  }
}

export function clearChannel() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** 邀请方信息（启动页 / 游客首页 / 引导弹窗 / 注册页的「XX 邀请你」横幅） */
export const useChannelStore = defineStore('channel', {
  state: () => ({
    code: null as string | null,
    info: null as ChannelInfo | null,
  }),
  getters: {
    /** 有效且为公司码时才展示邀请方；无效码静默忽略 */
    inviter: (s): string | null => (s.info?.valid && s.info.companyName ? s.info.companyName : null),
  },
  actions: {
    /** 注册时提交的渠道码（localStorage 不可用时用内存值；都没有则后端读 Cookie） */
    submitCode(): string | null {
      return readChannel() ?? this.code
    },
    capture(code: string) {
      if (!CODE_RE.test(code)) return
      saveChannel(code)
      if (this.code !== code) {
        this.code = code
        this.info = null
        void this.loadInfo()
      }
    },
    loadInfo(): Promise<void> {
      const code = this.code ?? readChannel()
      if (!code) return Promise.resolve()
      this.code = code
      if (this.info || inflight?.code === code) return inflight?.p ?? Promise.resolve()
      const p = seekerApi
        .channelInfo(code)
        .then((info) => {
          if (this.code === code) this.info = info
        })
        .catch(() => {
          /* 网络错误时不展示邀请方即可 */
        })
      inflight = { code, p }
      return p
    },
    /** 登录成功 / 已登录用户：渠道只在首次注册时绑定，已注册用户再扫码不改变归属（C-106） */
    reset() {
      clearChannel()
      inflight = null
      this.code = null
      this.info = null
    },
  },
})
