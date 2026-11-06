import axios, { type AxiosRequestConfig } from 'axios'

/** 后端统一返回结构：{ code, message, data, traceId }，code = 0 表示成功 */
export interface ApiEnvelope<T> {
  code: number | string
  message: string
  data: T
  traceId?: string
}

export class ApiError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
    public readonly traceId?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type TokenGetter = () => string | null | undefined
let getToken: TokenGetter = () => null
let onUnauthorized: () => void = () => {}

/** 由各应用在启动时注入登录态（token 放内存，refresh 走 HttpOnly Cookie） */
export function configureAuth(opts: { getToken: TokenGetter; onUnauthorized?: () => void }) {
  getToken = opts.getToken
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api/v1',
  timeout: 15000,
  withCredentials: true,
})

http.interceptors.request.use((config) => {
  config.headers.set('X-Requested-With', 'XMLHttpRequest')
  const token = getToken()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

http.interceptors.response.use(
  (resp) => {
    const body = resp.data as ApiEnvelope<unknown>
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0 && body.code !== '0') {
        throw new ApiError(body.code, body.message, body.traceId, resp.status)
      }
      resp.data = body.data
    }
    return resp
  },
  (err) => {
    const status: number | undefined = err.response?.status
    const body = err.response?.data as Partial<ApiEnvelope<unknown>> | undefined
    if (status === 401) onUnauthorized()
    throw new ApiError(body?.code ?? status ?? 'NETWORK', body?.message ?? '网络异常，请稍后重试', body?.traceId, status)
  },
)

/** orval mutator：返回已解包的 data */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const resp = await http.request<T>(config)
  return resp.data
}
