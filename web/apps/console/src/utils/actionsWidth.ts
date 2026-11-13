/**
 * 表格操作列（小号文字按钮）的宽度：按这一页实际要出的按钮算，最宽的那一行刚好放下、不折行、不截断。
 * 固定写最宽的组合时，1280 宽下其他列会被挤到横向滚动里（规范 Page States「console 表格操作列宽」）。
 * 实测（12px 字，Element 小号文字按钮，2026-11 工单 16）：汉字每个 12px、英文和空格约 5px，每个按钮另加 6px 内边距和边框；
 * 「更多」加箭头 48px，按钮间距 8px，单元格左右内边距共 24px。换字体或字号后先跑 states.mjs 的 opsCol / tblFit 检查。
 */
export function textBtnWidth(label: string): number {
  let w = 6
  for (const ch of label) w += ch.charCodeAt(0) < 0x100 ? 5 : 12
  return w
}

/** rows：每一行平铺的按钮文字，more 表示这一行还有「更多」 */
export function actionsColWidth(rows: { labels: string[]; more?: boolean }[], min = 96): number {
  const widths = rows.map((r) => {
    const n = r.labels.length + (r.more ? 1 : 0)
    return 24 + r.labels.reduce((w, l) => w + textBtnWidth(l), 0) + (r.more ? 48 : 0) + Math.max(0, n - 1) * 8
  })
  return Math.max(min, ...widths)
}
