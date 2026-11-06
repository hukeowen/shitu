import { ElMessageBox } from 'element-plus'

export interface RemarkOptions {
  title: string
  message?: string
  /** 必填说明（驳回 / 强制下架 / 限流封禁） */
  required?: boolean
  confirmText?: string
  danger?: boolean
  placeholder?: string
}

/**
 * 弹出“填写说明”确认框；取消返回 null，确认返回说明文本（选填时可能为空串）。
 */
export async function promptRemark(o: RemarkOptions): Promise<string | null> {
  try {
    const r = await ElMessageBox.prompt(o.message ?? '', o.title, {
      inputType: 'textarea',
      inputPlaceholder: o.placeholder ?? (o.required ? '请填写原因（必填，将通知到对方）' : '备注（选填）'),
      inputValidator: (v: string) => {
        if (o.required && !v?.trim()) return '请填写原因'
        if (v && v.length > 500) return '最多 500 字'
        return true
      },
      confirmButtonText: o.confirmText ?? '确定',
      cancelButtonText: '取消',
      confirmButtonClass: o.danger ? 'el-button--danger' : undefined,
      closeOnClickModal: false,
      customClass: 'remark-box',
    })
    return (r.value ?? '').trim()
  } catch {
    return null
  }
}

export async function confirmAction(title: string, message: string, danger = false): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      type: danger ? 'warning' : 'info',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      confirmButtonClass: danger ? 'el-button--danger' : undefined,
    })
    return true
  } catch {
    return false
  }
}
