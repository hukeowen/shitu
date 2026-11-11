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

/** 应用级文案覆盖：同一枚举在不同端的叫法不同（例如 C 端不对求职者说「私域 / 公域」） */
let overrides: Record<string, Record<string, string>> = {}
export function setDictOverrides(o: Record<string, Record<string, string>>) {
  overrides = o
}

export function dictLabel(type: string, value: string | null | undefined): string {
  if (value == null) return ''
  const o = overrides[type]?.[value]
  if (o) return o
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
