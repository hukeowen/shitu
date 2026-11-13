/** 表格行操作：主操作平铺（最多 max 个），其余收进「更多」；操作列宽度按当前数据实际出现的按钮估算 */
export interface RowAction {
  key: string
  label: string
  type?: 'primary' | 'danger' | 'default'
  plain?: boolean
  /** 文字链样式（查看类操作） */
  link?: boolean
  /** 始终收进「更多」 */
  more?: boolean
  disabled?: boolean
}

export const MORE_LABEL = '更多'

export function splitActions(actions: RowAction[], max = 2): { flat: RowAction[]; more: RowAction[] } {
  const main = actions.filter((a) => !a.more)
  const forced = actions.filter((a) => a.more)
  // 只多出一个且没有强制收起的操作时直接平铺，避免「更多」里只有一项
  if (!forced.length && main.length <= max + 1) return { flat: main, more: [] }
  return { flat: main.slice(0, max), more: [...main.slice(max), ...forced] }
}

/** 13px 字号下的文本宽度估算：中文按全宽，其余按半宽 */
function textPx(s: string, font = 13): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? font : ch === ' ' ? font * 0.3 : font * 0.6
  return Math.ceil(w)
}

const GAP = 8
const CELL_PAD = 24
const BTN_PAD = 24
const LINK_PAD = 6

function btnPx(a: Pick<RowAction, 'label' | 'link'>): number {
  return textPx(a.label) + (a.link ? LINK_PAD : BTN_PAD)
}

/**
 * 操作列宽度。传入每一行可见的操作；所有行都没有操作时返回 0（调用方据此不渲染该列）。
 */
export function opsColWidth(rows: RowAction[][], max = 2): number {
  let w = 0
  for (const actions of rows) {
    if (!actions.length) continue
    const { flat, more } = splitActions(actions, max)
    const items = [...flat.map(btnPx), ...(more.length ? [btnPx({ label: MORE_LABEL })] : [])]
    w = Math.max(w, items.reduce((s, x) => s + x, 0) + GAP * (items.length - 1))
  }
  // 留 6px 余量，表头「操作」至少放得下
  return w ? Math.max(72, w + CELL_PAD + 6) : 0
}
