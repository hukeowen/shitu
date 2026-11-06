import 'vue-router'
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    tabbar?: boolean
    proto?: string
    /** 需要登录；游客站内点击时弹 S-03 引导弹窗 */
    auth?: boolean
    /** 仅游客可访问（已登录访问时回首页） */
    guestOnly?: boolean
  }
}
export {}
