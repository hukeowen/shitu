import 'vue-router'
import type { OpsRole } from '@shitu/api-client'
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    proto?: string
    group?: string
    /** 不需要登录 */
    public?: boolean
    /** 可访问角色；不填 = 登录即可 */
    roles?: OpsRole[]
  }
}
export {}
