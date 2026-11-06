import { refreshSession, useDict } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'

let booting: Promise<void> | null = null

/** 首次导航前执行一次：无 token 时用 refresh Cookie 恢复登录，再拉取成员信息 */
export function bootstrap(): Promise<void> {
  if (!booting) booting = run()
  return booting
}

async function run() {
  void useDict().ready
  const auth = useAuthStore()
  if (!auth.accessToken) await refreshSession()
  if (auth.accessToken) {
    try {
      await auth.loadMe()
    } catch {
      /* 工作台会展示错误态并可重试 */
    }
  }
}
