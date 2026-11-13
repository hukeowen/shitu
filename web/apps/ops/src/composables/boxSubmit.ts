import { h, ref } from 'vue'
import type { Action, MessageBoxState } from 'element-plus'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError } from '@shitu/api-client'

/**
 * 确认框里提交（规范「Page States」后台确认框一律在框内提交，同 console composables/boxSubmit.ts）：
 * 点确认后框不关、确认按钮转圈（不能重复点），请求成功再关框。
 * 后端业务拒绝：框不关，「暂时不能…：原因」用提醒色写在提示文字下面、确认按钮置灰，并回调 onBlocked 让页面也留原因；
 * 断网、超时（ApiError 的 code 为 NETWORK）只弹轻提示，可以直接再点确认。
 * 用法：const s = boxSubmit(text, '发布', api, onBlocked); await ElMessageBox.confirm(s.message, 标题, { …, beforeClose: s.beforeClose })
 */
export function boxSubmit(text: string, actionLabel: string, api: () => Promise<unknown>, onBlocked?: (why: string) => void) {
  const why = ref('')
  const message = () => h('div', [h('p', text), why.value ? h('p', { class: 'msgbox-why', role: 'alert' }, why.value) : null])
  const beforeClose = async (act: Action, box: MessageBoxState, done: () => void) => {
    // 提交中不响应取消、关闭和再次确认
    if (box.confirmButtonLoading) return
    if (act !== 'confirm') return done()
    box.confirmButtonLoading = true
    try {
      await api()
      box.confirmButtonLoading = false
      done()
    } catch (e) {
      box.confirmButtonLoading = false
      const reason = errorMessage(e)
      ElMessage.error(reason)
      if (isBlocked(e)) {
        why.value = `暂时不能${actionLabel}：${reason}`
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

/** 断网、超时：加载失败时提示「请检查网络后重新加载」；别的错误只写原因，不往网络上引 */
export function isNetwork(e: unknown): boolean {
  return isApiError(e) && e.code === 'NETWORK'
}
