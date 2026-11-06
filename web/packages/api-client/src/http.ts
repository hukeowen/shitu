import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'

/** 后端统一返回结构：{ code, message, data, traceId }，code = "0" 表示成功 */
export interface ApiEnvelope<T> {
  code: string
  message: string
  data: T
  traceId?: string
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly traceId?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 三套账号域：决定刷新接口路径 /api/v1/{domain}/auth/refresh */
export type AuthDomain = 'seeker' | 'tenant' | 'ops'

interface AuthOptions {
  domain: AuthDomain
  getToken: () => string | null | undefined
  setToken: (token: string | null) => void
  /** 刷新也失败（登录已失效）时调用，一般跳转登录页 */
  onUnauthorized?: () => void
}

let auth: AuthOptions | null = null

/**
 * 由各应用在启动时注入登录态（docs/02 §10）：
 * access token 只放内存；refresh token 在 HttpOnly Cookie 里，401 时自动刷新一次并重试原请求。
 */
export function configureAuth(opts: AuthOptions) {
  auth = opts
}

const baseURL = import.meta.env.VITE_API_BASE ?? '/api/v1'

export const http = axios.create({ baseURL, timeout: 15000, withCredentials: true })

/** 不带拦截器的实例，专门用于刷新，避免递归 */
const bare = axios.create({ baseURL, timeout: 15000, withCredentials: true })

let refreshing: Promise<string | null> | null = null

/**
 * 用 refresh Cookie 换新的 access token（并发调用只发一次请求）。
 * 应用启动时调用一次即可恢复登录态（页面刷新后内存里的 token 会丢）。
 */
export function refreshSession(): Promise<string | null> {
  if (!auth) return Promise.resolve(null)
  if (!refreshing) {
    const a = auth
    refreshing = bare
      .post<ApiEnvelope<{ accessToken: string; expiresIn: number }>>(`/${a.domain}/auth/refresh`, null, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      .then((r) => {
        if (r.data?.code === '0') {
          a.setToken(r.data.data.accessToken)
          return r.data.data.accessToken
        }
        a.setToken(null)
        return null
      })
      .catch(() => {
        a.setToken(null)
        return null
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

/** 退出登录：吊销服务端会话并清掉内存 token */
export async function logout(): Promise<void> {
  if (!auth) return
  try {
    await bare.post(`/${auth.domain}/auth/logout`, null, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
  } finally {
    auth.setToken(null)
  }
}

http.interceptors.request.use((config) => {
  config.headers.set('X-Requested-With', 'XMLHttpRequest')
  const token = auth?.getToken()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

http.interceptors.response.use(
  (resp) => {
    // 文件流等非 JSON 响应直接返回
    if (resp.config.responseType === 'blob') return resp
    const body = resp.data as ApiEnvelope<unknown>
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== '0') {
        throw new ApiError(String(body.code), body.message, body.traceId, resp.status)
      }
      resp.data = body.data
    }
    return resp
  },
  async (err: AxiosError<ApiEnvelope<unknown>>) => {
    const status = err.response?.status
    const cfg = err.config as RetriableConfig | undefined
    const isAuthCall = cfg?.url?.includes('/auth/')
    if (status === 401 && cfg && !cfg._retried && !isAuthCall && auth) {
      cfg._retried = true
      const token = await refreshSession()
      if (token) {
        cfg.headers.set('Authorization', `Bearer ${token}`)
        return http.request(cfg)
      }
      auth.onUnauthorized?.()
    } else if (status === 401 && !isAuthCall) {
      auth?.onUnauthorized?.()
    }
    const raw = err.response?.data as Partial<ApiEnvelope<unknown>> | Blob | undefined
    let body: Partial<ApiEnvelope<unknown>> | undefined
    // 文件下载失败时错误体是 JSON 的 Blob，解析出真实的 code / message
    if (raw instanceof Blob) {
      try {
        body = JSON.parse(await raw.text()) as Partial<ApiEnvelope<unknown>>
      } catch {
        body = undefined
      }
    } else {
      body = raw
    }
    throw new ApiError(
      String(body?.code ?? status ?? 'NETWORK'),
      body?.message ?? (status ? '请求失败，请稍后重试' : '网络异常，请检查网络后重试'),
      body?.traceId,
      status,
    )
  },
)

/** orval mutator / 手写接口统一入口：返回已解包的 data */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const resp = await http.request<T>(config)
  return resp.data
}

/**
 * 读取需要鉴权的私有文件（营业执照、合同）：带 token 拉取 blob，返回 objectURL。
 * <img> / <a> 不能带 Authorization 头，所以不能直接用接口地址。用完记得 URL.revokeObjectURL。
 */
export async function fetchFileUrl(path: string, key: string): Promise<{ url: string; type: string }> {
  const resp = await http.get<Blob>(path, { params: { key }, responseType: 'blob' })
  const blob = resp.data
  return { url: URL.createObjectURL(blob), type: blob.type }
}
