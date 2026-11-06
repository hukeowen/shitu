import { ApiError } from './http'

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code)
}

/** 统一取错误提示文案（后端 message 可直接展示给用户）。 */
export function errorMessage(e: unknown, fallback = '操作失败，请稍后重试'): string {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error && e.message) return e.message
  return fallback
}
