/** 首页核心功能四宫格（AI 问薪 / 推荐裂变 / 薪资预支 / 工分变现） */
export interface QuadItem {
  key: 'match' | 'refer' | 'advance' | 'points'
  title: string
  desc: string
  off?: boolean
  pill?: string
}
