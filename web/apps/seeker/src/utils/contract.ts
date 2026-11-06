import type { ContractStatus, LaborContractView } from '@shitu/api-client'
import { formatServerTime, parseServerTime } from '@/utils/time'

/** 合同状态徽标配色（中文名从字典 ContractStatus 取） */
export const CONTRACT_TAG_CLASS: Record<ContractStatus, string> = {
  PENDING_SIGN: 'tag-warn',
  EFFECTIVE: 'tag-ok',
  EXPIRED: 'tag-muted',
  DISSOLVED: 'tag-muted',
  TERMINATED: 'tag-muted',
  VOIDED: 'tag-muted',
}

const DAY = 86400_000

/** 北京时间的「今天」0 点（UTC 毫秒） */
function todayStart(now = Date.now()): number {
  return Math.floor((now + 8 * 3600_000) / DAY) * DAY - 8 * 3600_000
}

/** 合同期限：2026-04-13 → 2027-04-12（无截止日时为「无固定期限」） */
export function termText(c: Pick<LaborContractView, 'termStart' | 'termEnd'>): string {
  const s = formatServerTime(c.termStart, false)
  return c.termEnd ? `${s} → ${formatServerTime(c.termEnd, false)}` : `${s} 起 · 无固定期限`
}

/** 合同时长（月，按日期差四舍五入），无截止日返回 null */
export function termMonths(c: Pick<LaborContractView, 'termStart' | 'termEnd'>): number | null {
  const a = parseServerTime(c.termStart)
  const b = parseServerTime(c.termEnd)
  if (a == null || b == null || b < a) return null
  return Math.max(1, Math.round((b - a + DAY) / (30.44 * DAY)))
}

/** 距合同截止还有几天（含当天）；无截止日或已过返回 null */
export function daysLeft(termEnd: string | null | undefined, now = Date.now()): number | null {
  const t = parseServerTime(termEnd)
  if (t == null) return null
  const d = Math.floor((t - todayStart(now)) / DAY) + 1
  return d > 0 ? d : null
}

/** 生效后的历史合同（不含已作废的签署邀请），按签署 / 生成时间倒序 */
export function sortContracts(list: LaborContractView[]): LaborContractView[] {
  const key = (c: LaborContractView) => parseServerTime(c.signedAt ?? c.createdAt) ?? 0
  return list
    .filter((c) => c.status !== 'VOIDED')
    .sort((a, b) => {
      if (a.status === 'PENDING_SIGN' && b.status !== 'PENDING_SIGN') return -1
      if (b.status === 'PENDING_SIGN' && a.status !== 'PENDING_SIGN') return 1
      return key(b) - key(a)
    })
}

/**
 * 打开签署链接：Mock 电子签的签署页是本应用的 /esign/mock/{flowId}（开发环境），站内路由跳转；
 * 真实 e签宝是外部地址，整页跳转（微信内置浏览器不支持 window.open）。
 */
export function signTarget(signUrl: string): { internal: string } | { external: string } {
  try {
    const u = new URL(signUrl, location.origin)
    if (u.pathname.startsWith('/esign/mock/')) return { internal: u.pathname }
    return { external: u.href }
  } catch {
    return { external: signUrl }
  }
}
