import { tenantApi, type SiteApplication } from '@shitu/api-client'
import { remainMs } from '@/utils/time'

/**
 * 进行中的报名（待面试 + 待确权），按 24h 响应截止时间升序。
 * 后端按 sort=DEADLINE 返回（窗口最紧的在前，无窗口的排最后），每个状态取最紧的 100 条后在前端归并；
 * 列表接口只支持单个 status，所以仍需两次请求。truncated 表示有未取到的数据（都是窗口更宽松或无窗口的）。
 */
export async function loadOpenApplications(projectId?: string): Promise<{ list: SiteApplication[]; truncated: boolean }> {
  const q = { projectId: projectId || undefined, page: 1, pageSize: 100, sort: 'DEADLINE' as const }
  const [a, b] = await Promise.all([
    tenantApi.applications({ ...q, status: 'PENDING_INTERVIEW' }),
    tenantApi.applications({ ...q, status: 'PENDING_CONFIRM' }),
  ])
  const now = Date.now()
  const key = (x: SiteApplication) => remainMs(x.responseDeadline, now) ?? Number.MAX_SAFE_INTEGER
  const list = [...a.records, ...b.records].sort((x, y) => key(x) - key(y))
  return { list, truncated: a.total > a.records.length || b.total > b.records.length }
}

/** 报名所处阶段的说明（响应监控 / 工作台） */
export function stageText(a: SiteApplication): string {
  if (a.status === 'PENDING_INTERVIEW') {
    if (a.arrivedAt) return `已到厂 ${a.arrivedAt.replace('T', ' ').slice(5, 16)}，待面试结果`
    return a.acknowledgedAt ? '已推送，待到厂 / 面试结果' : '报名后未推送面试信息'
  }
  if (a.status === 'PENDING_CONFIRM') return a.contract?.status === 'PENDING_SIGN' || a.allowedActions.includes('RESEND_CONTRACT') ? '已发起签约，待求职者签署' : '面试通过未完成确权'
  return ''
}
