/**
 * 表格操作列（小号文字按钮）的宽度，同 console utils/actionsWidth.ts：按这一页实际要出的按钮算，最宽的那一行刚好放下、不折行、不截断。
 * 实测（12px 字，Element 小号文字按钮）：汉字每个 12px、英文和空格约 5px，每个按钮另加 6px 内边距和边框；相邻按钮间距 12px（Element 默认的 margin-left，console 实测按 8px 算，ops 量出来是 12px），单元格左右内边距共 24px。
 */
export function textBtnWidth(label: string): number {
  let w = 6
  for (const ch of label) w += ch.charCodeAt(0) < 0x100 ? 5 : 12
  return w
}

export function actionsColWidth(rows: { labels: string[] }[], min = 96): number {
  const widths = rows.map((r) => 24 + r.labels.reduce((w, l) => w + textBtnWidth(l), 0) + Math.max(0, r.labels.length - 1) * 12)
  return Math.max(min, ...widths)
}
