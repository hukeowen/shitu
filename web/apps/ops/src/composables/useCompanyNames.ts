import { ref } from 'vue'
import { opsApi } from '@shitu/api-client'

/**
 * 公司 ID → 公司名称。投诉、月账单、处罚记录等接口只返回 companyId，
 * 这里用「公司名称表」接口（所有平台角色可用）补名称；加载失败时界面回退为只显示 ID。
 */
const names = ref<Record<string, string>>({})
let loaded: Promise<void> | null = null

export function useCompanyNames() {
  if (!loaded) {
    loaded = opsApi
      .companyNames()
      .then((rows) => {
        const m: Record<string, string> = {}
        for (const r of rows) m[r.companyId] = r.name
        names.value = m
      })
      .catch(() => {
        loaded = null
      })
  }
  const companyName = (id?: string | null): string => (id ? names.value[id] ?? '' : '')
  return { companyName }
}
