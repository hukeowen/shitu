import { tenantApi, type SiteApplication } from '@shitu/api-client'
import { remainMs } from '@/utils/time'

/**
 * 进行中的报名（待面试 + 待确权），按 24h 响应截止时间升序。
 * 后端单页最多 100 条、无按截止时间排序的接口：这里各取一页合并，truncated 表示有未取到的数据。
 */
export async function loadOpenApplications(projectId?: string): Promise<{ list: SiteApplication[]; truncated: boolean }> {
  const [a, b] = await Promise.all([
    tenantApi.applications({ status: 'PENDING_INTERVIEW', projectId: projectId || undefined, page: 1, pageSize: 100 }),
    tenantApi.applications({ status: 'PENDING_CONFIRM', projectId: projectId || undefined, page: 1, pageSize: 100 }),
  ])
  const now = Date.now()
  const key = (x: SiteApplication) => remainMs(x.responseDeadline, now) ?? Number.MAX_SAFE_INTEGER
  const list = [...a.records, ...b.records].sort((x, y) => key(x) - key(y))
  return { list, truncated: a.total > a.records.length || b.total > b.records.length }
}

/** 报名所处阶段的说明（响应监控 / 工作台） */
export function stageText(a: SiteApplication): string {
  if (a.status === 'PENDING_INTERVIEW') return a.acknowledgedAt ? '已推送，待到厂 / 面试结果' : '报名后未推送面试信息'
  if (a.status === 'PENDING_CONFIRM') return a.allowedActions.includes('RESEND_CONTRACT') ? '已发起签约，待求职者签署' : '面试通过未完成确权'
  return ''
}
