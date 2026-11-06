import { ref } from 'vue'
import { tenantApi, type ProjectView } from '@shitu/api-client'

/** 项目下拉数据（筛选用）：会话内只加载一次 */
const projects = ref<ProjectView[]>([])
let loading: Promise<void> | null = null

export function useProjects() {
  if (!loading) {
    loading = tenantApi
      .projects()
      .then((r) => {
        projects.value = r
      })
      .catch(() => {
        loading = null
      })
  }
  return { projects, ready: loading }
}
