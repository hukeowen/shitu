import { refreshSession, useDict } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'
import { useChannelStore } from '@/stores/channel'

let booting: Promise<void> | null = null

/**
 * 应用启动（首次导航前只执行一次）：
 * 1. 内存里没有 access token 时用 30 天 refresh Cookie 恢复登录态（微信内置浏览器刷新后也能保持登录）；
 * 2. 已登录 → 拉取用户档案；游客 → 查询暂存渠道码的邀请方信息。
 */
export function bootstrap(): Promise<void> {
  if (!booting) booting = run()
  return booting
}

async function run() {
  void useDict().ready
  const auth = useAuthStore()
  const channel = useChannelStore()
  if (!auth.accessToken) await refreshSession()
  if (auth.accessToken) {
    try {
      await auth.loadProfile()
    } catch {
      /* 档案加载失败时首页会展示错误态并可重试 */
    }
  }
  if (auth.isLoggedIn) {
    // C-106：已注册用户再扫码不改变任何归属（后端只记录触达日志），本地渠道码直接丢弃
    channel.reset()
  } else {
    void channel.loadInfo()
  }
}
