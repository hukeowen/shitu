/**
 * 「专属服务 / 自由求职」的白话说明（D-62 ④：叫法保留，但每个出现成标签的地方旁边都要配一句大白话）。
 * 只给这两种；「报名中」本身就是白话，不另外解释。
 */
const HINT: Record<string, string> = {
  PRIVATE: '专属服务：这家劳务公司专门帮你找活',
  PUBLIC: '自由求职：全平台的岗位都能找',
}

export function domainHint(tag: string | null | undefined): string {
  return tag ? HINT[tag] ?? '' : ''
}
