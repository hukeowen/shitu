/** 首页核心功能四宫格（AI 问薪 / 我的报名 / 薪资预支 / 我的合同）。推荐裂变、工分变现属 V1.5，上线前不占入口 */
export interface QuadItem {
  key: 'match' | 'reports' | 'advance' | 'contracts'
  title: string
  desc: string
  /** 当前不能用：置灰，desc 写原因 */
  off?: boolean
}
