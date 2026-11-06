import 'vue-router'
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    tabbar?: boolean
    proto?: string
    /** 无需登录（登录页） */
    public?: boolean
    /** 公司未审核通过 / 被封禁时仍可访问（状态提示页、我的） */
    allowInactive?: boolean
  }
}
export {}
