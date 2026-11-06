import { ref, shallowRef } from 'vue'
import { errorMessage, type PageResult } from '@shitu/api-client'

export interface PageParams {
  page: number
  pageSize: number
}

/**
 * 分页列表：rows / total / loading / error + load()。
 * 筛选条件由调用方在 fetcher 闭包里读取；条件变化时调用 search()（回到第 1 页）。
 */
export function usePagedList<T>(fetcher: (p: PageParams) => Promise<PageResult<T>>, pageSize = 20) {
  const rows = shallowRef<T[]>([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(pageSize)
  const loading = ref(false)
  const error = ref('')
  let seq = 0

  async function load() {
    const my = ++seq
    loading.value = true
    error.value = ''
    try {
      const r = await fetcher({ page: page.value, pageSize: size.value })
      if (my !== seq) return
      rows.value = r.records
      total.value = r.total
      // 删除 / 状态变化后当前页可能越界
      if (r.records.length === 0 && r.total > 0 && page.value > 1) {
        page.value = Math.max(1, Math.ceil(r.total / size.value))
        await load()
      }
    } catch (e) {
      if (my !== seq) return
      error.value = errorMessage(e, '加载失败，请稍后重试')
      rows.value = []
      total.value = 0
    } finally {
      if (my === seq) loading.value = false
    }
  }

  function search() {
    page.value = 1
    return load()
  }

  function onPageChange(p: number) {
    page.value = p
    return load()
  }

  function onSizeChange(s: number) {
    size.value = s
    page.value = 1
    return load()
  }

  return { rows, total, page, pageSize: size, loading, error, load, search, onPageChange, onSizeChange }
}
