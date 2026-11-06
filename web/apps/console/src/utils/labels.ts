import { dictLabel, useDict } from '@shitu/api-client'

/**
 * 字典兜底：以下枚举后端 /dict 尚未提供（Sprint 4 新增），先在前端兜底。
 * 一旦 /dict 返回同名类型，优先使用后端字典（见 enumLabel）。
 */
const LOCAL: Record<string, Record<string, string>> = {
  BillStatus: { GENERATED: '已生成', ISSUED: '已下发', DISPUTED: '异议中', CONFIRMED: '已确认', SETTLED: '已结算' },
  BrokerCaseStatus: { OPEN: '待联系', CONTACTED: '已联系', RECOMMENDED: '已推荐', APPLIED: '已报名', RELEASED: '已释放', CLOSED: '已结束' },
  BrokerTriggerType: { LOW_MATCH: '匹配度不足', REMATCH_LIMIT: '多次匹配未报名', SITE_TRANSFER: '驻场流转', JOB_CHANGE: '在职换岗' },
  ResignStatus: { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已驳回' },
  StaffSource: { OWN: '本公司', PLATFORM: '平台', TRANSFER: '流转' },
  AbsenceType: { LEAVE: '请假', ABSENT: '旷工' },
  DisputeStatus: { OPEN: '处理中', ACCEPTED: '已采纳', REJECTED: '已驳回' },
  LedgerDirection: { PAYABLE: '流入应付', RECEIVABLE: '流出应收' },
}

const { dict } = useDict()

export function enumLabel(type: string, value: string | null | undefined): string {
  if (value == null || value === '') return ''
  if (dict.value[type]?.length) return dictLabel(type, value)
  return LOCAL[type]?.[value] ?? value
}

export function enumOptions(type: string): { value: string; label: string }[] {
  const d = dict.value[type]
  if (d?.length) return d
  return Object.entries(LOCAL[type] ?? {}).map(([value, label]) => ({ value, label }))
}
