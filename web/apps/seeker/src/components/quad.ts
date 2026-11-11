/** 首页核心功能四宫格（AI 问薪 / 我的报备 / 薪资预支 / 我的合同）。推荐裂变、工分变现属 V1.5，上线前不占入口 */
export interface QuadItem {
  key: 'match' | 'reports' | 'advance' | 'contracts'
  title: string
  desc: string
  off?: boolean
  pill?: string
}
