import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '@shitu/api-client'
import { shNow, ymd } from '@/utils/time'

/**
 * 列表导出为 CSV（浏览器里生成，不经后端）：UTF-8 带 BOM（Excel 打开不乱码）、CRLF 换行、RFC 4180 引号转义。
 * 导出内容只取页面已经拿到 / 能拿到的数据：字段和脱敏同当前角色在页面上看到的一致，不为导出另调接口取更多明细。
 */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => unknown
  /**
   * money：金额，写成两位小数的纯数字（不带 ¥、千分位），可以直接求和；
   * date / datetime：后端北京时间 ISO 串截成 yyyy-MM-dd / yyyy-MM-dd HH:mm；
   * text：手机号、工号、编号、账单号、月份这类以数字开头、只含数字 / 字母 / 连字符 / 下划线的串写成 ="…"，Excel 按文本显示，
   * 不会变成科学计数法、丢前导 0 或被当成日期。只有整串是这些字符时才这样写（里面不可能带公式），其余内容照常走公式注入防护
   */
  kind?: 'money' | 'date' | 'datetime' | 'text'
}

/** 单次导出的行数上限 */
export const EXPORT_CAP = 5000
/** 后端分页接口的每页上限（framework Pages：最大 100） */
const EXPORT_PAGE_SIZE = 100

type PageFetcher<T> = (page: number, pageSize: number) => Promise<{ records: T[]; total: number }>

/** 公式注入防护：以 = + - @ 制表符 回车 开头的文本前面加单引号，表格软件按文本处理 */
function guard(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

function fixed2(n: number): string {
  const s = n.toFixed(2)
  return s === '-0.00' ? '0.00' : s
}

function cellText<T>(col: CsvColumn<T>, row: T): string {
  const v = col.value(row)
  if (v == null || v === '') return ''
  if (col.kind === 'money') {
    const n = Number(v)
    return Number.isFinite(n) ? fixed2(n) : guard(String(v))
  }
  // 数字原样写（负数不加单引号，否则没法求和）
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? '是' : '否'
  let s = String(v)
  if (col.kind === 'date') s = s.slice(0, 10)
  else if (col.kind === 'datetime') s = s.replace('T', ' ').slice(0, 16)
  else if (col.kind === 'text' && /^\d[\dA-Za-z_-]*$/.test(s)) return `="${s}"`
  return guard(s)
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => quote(guard(c.header))).join(',')]
  for (const r of rows) lines.push(columns.map((c) => quote(cellText(c, r))).join(','))
  return lines.join('\r\n')
}

/** 下载 CSV，文件名带当天日期：在岗人员-2026-11-19.csv */
export function downloadCsv<T>(name: string, columns: CsvColumn<T>[], rows: T[]): void {
  const blob = new Blob(['﻿' + toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}-${ymd(shNow())}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 按当前筛选把分页接口翻到底，最多取 EXPORT_CAP 行；任何一页失败都整体失败（不导出半截数据） */
async function fetchAll<T>(fetchPage: PageFetcher<T>): Promise<{ rows: T[]; total: number }> {
  const rows: T[] = []
  let total = 0
  for (let page = 1; rows.length < EXPORT_CAP; page++) {
    const r = await fetchPage(page, EXPORT_PAGE_SIZE)
    total = r.total
    rows.push(...r.records)
    if (r.records.length === 0 || rows.length >= r.total) break
  }
  return { rows: rows.slice(0, EXPORT_CAP), total }
}

/**
 * 页面上的「导出」：rows 传数组就导出页面里已有的整份列表，传函数就按当前筛选逐页取完再导出。
 * 导出中 loading 为 true（按钮转圈）；超过上限时提示被截断，取数失败提示原因，成功提示「已导出 N 条」。
 */
export async function exportList<T>(opts: { name: string; columns: CsvColumn<T>[]; rows: T[] | PageFetcher<T>; loading?: Ref<boolean> }): Promise<void> {
  const { loading } = opts
  if (loading?.value) return
  if (loading) loading.value = true
  try {
    const src = opts.rows
    const { rows, total } = typeof src === 'function' ? await fetchAll(src) : { rows: src.slice(0, EXPORT_CAP), total: src.length }
    if (!rows.length) {
      ElMessage.warning('没有可导出的数据')
      return
    }
    downloadCsv(opts.name, opts.columns, rows)
    if (total > EXPORT_CAP) ElMessage.warning({ message: `共 ${total} 条，超过单次导出上限，只导出了前 ${rows.length} 条，结果不完整。请缩小筛选范围后分批导出`, duration: 8000 })
    else ElMessage.success(`已导出 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error(errorMessage(e, '导出失败，请稍后重试'))
  } finally {
    if (loading) loading.value = false
  }
}
