import { ref } from 'vue'
import { dictApi } from './api'
import type { Dict } from './types'

/**
 * 枚举字典（/api/v1/dict）：全应用只加载一次。前端不硬编码枚举中文名（docs/02 §13）。
 *
 *   const { label, options, ready } = useDict()
 *   label('JobStatus', job.status)       // → 招聘中
 *   options('JobType')                   // → [{ value, label }] 供下拉框
 */
const dict = ref<Dict>({})
let loading: Promise<void> | null = null

function load(): Promise<void> {
  if (!loading) {
    loading = dictApi
      .all()
      .then((d) => {
        dict.value = d
      })
      .catch(() => {
        loading = null
      })
  }
  return loading
}

export function dictLabel(type: string, value: string | null | undefined): string {
  if (value == null) return ''
  return dict.value[type]?.find((i) => i.value === value)?.label ?? value
}

export function useDict() {
  const ready = load()
  return {
    ready,
    dict,
    label: dictLabel,
    options: (type: string) => dict.value[type] ?? [],
  }
}
