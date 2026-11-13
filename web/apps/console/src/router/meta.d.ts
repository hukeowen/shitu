import 'vue-router'
import type { Access } from './menu'
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    proto?: string
    group?: string
    /** 不需要登录（登录、入驻申请） */
    public?: boolean
    access?: Access
    /** 未匹配到任何页面的兜底路由 */
    notFound?: boolean
  }
}
export {}
