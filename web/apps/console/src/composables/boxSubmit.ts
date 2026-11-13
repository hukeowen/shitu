import { h, ref } from 'vue'
import type { Action, MessageBoxState } from 'element-plus'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError } from '@shitu/api-client'

/**
 * 确认框里提交（规范「Page States」后台确认框一律在框内提交）：点确认后框不关、确认按钮转圈（不能重复点），请求成功再关框。
 * 后端业务拒绝：框不关，「暂时不能…：原因」用提醒色写在提示文字下面、确认按钮置灰，并回调 onBlocked 让页面也留原因；
 * 断网、超时（ApiError 的 code 为 NETWORK）只弹轻提示，可以直接再点确认。
 * 用法：const s = boxSubmit(text, '标记已联系', api, onBlocked); await ElMessageBox.confirm(s.message, 标题, { …, beforeClose: s.beforeClose })
 * explain：某些拒绝码要在原因后面接一句下一步怎么办（如岗位保存的 TEN_4004），返回空则不接
 */
export function boxSubmit(
  text: string,
  actionLabel: string,
  api: (input: string) => Promise<unknown>,
  onBlocked?: (why: string) => void,
  explain?: (e: unknown) => string | undefined,
) {
  const why = ref('')
  const message = () => h('div', [h('p', text), why.value ? h('p', { class: 'msgbox-why', role: 'alert' }, why.value) : null])
  const beforeClose = async (act: Action, box: MessageBoxState, done: () => void) => {
    // 提交中不响应取消、关闭和再次确认
    if (box.confirmButtonLoading) return
    if (act !== 'confirm') return done()
    box.confirmButtonLoading = true
    try {
      await api(box.inputValue?.trim() ?? '')
      box.confirmButtonLoading = false
      done()
    } catch (e) {
      box.confirmButtonLoading = false
      const reason = errorMessage(e)
      ElMessage.error(reason)
      if (isApiError(e) && e.code !== 'NETWORK') {
        const next = explain?.(e)
        why.value = `暂时不能${actionLabel}：${reason}${next ? `。${next}` : ''}`
        box.confirmButtonDisabled = true
        onBlocked?.(why.value)
      }
    }
  }
  return { message, beforeClose }
}

/** 后端业务拒绝（要置灰并留原因）；断网、超时不算 */
export function isBlocked(e: unknown): boolean {
  return isApiError(e) && e.code !== 'NETWORK'
}
