import 'vue-router'
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    tabbar?: boolean
    proto?: string
  }
}
export {}
