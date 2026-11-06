import { defineStore } from 'pinia'
import { tenantApi, type TenantMe, type TenantRole } from '@shitu/api-client'

/** 当前登录成员（/tenant/me）：角色、权限点、公司状态。菜单 / 按钮显示都以此为准 */
export const useMeStore = defineStore('me', {
  state: () => ({
    me: null as TenantMe | null,
  }),
  getters: {
    operational: (s) => s.me?.operational === true,
    roles: (s): TenantRole[] => s.me?.roles ?? [],
    isOwner: (s) => s.me?.roles.includes('OWNER') === true,
  },
  actions: {
    async load(): Promise<TenantMe> {
      const me = await tenantApi.me()
      this.me = me
      return me
    },
    clear() {
      this.me = null
    },
    /** 拥有任一权限点 */
    can(...perms: string[]): boolean {
      const p = this.me?.permissions ?? []
      return perms.some((x) => p.includes(x))
    },
    hasRole(...roles: TenantRole[]): boolean {
      const r = this.me?.roles ?? []
      return roles.some((x) => r.includes(x))
    },
  },
})
