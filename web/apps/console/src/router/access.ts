import type { TenantMe } from '@shitu/api-client'
import { MENU, type Access, type MenuGroup } from './menu'

export function canAccess(me: TenantMe | null | undefined, access?: Access): boolean {
  if (!me) return false
  if (!access) return true
  const byPerm = access.perms?.some((p) => me.permissions.includes(p)) ?? false
  const byRole = access.roles?.some((r) => me.roles.includes(r)) ?? false
  return byPerm || byRole
}

export function visibleMenu(me: TenantMe | null | undefined): MenuGroup[] {
  return MENU.map((g) => ({ ...g, items: g.items.filter((it) => canAccess(me, it.access)) })).filter((g) => g.items.length > 0)
}

/** 登录后的默认落地页：按角色优先给 Sprint 1 已实现的页面 */
export function homePath(me: TenantMe | null | undefined): string {
  if (!me) return '/login'
  const preferred = ['/pm/jobs', '/settings/org', '/settings/projects', '/settings/channels']
  const items = visibleMenu(me).flatMap((g) => g.items)
  const hit = preferred.find((p) => items.some((it) => it.path === p))
  return hit ?? items[0]?.path ?? '/settings/channels'
}
