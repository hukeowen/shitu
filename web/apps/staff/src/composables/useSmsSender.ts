import { reactive, ref } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isApiError, type Captcha, type SmsCodeRequest, type SmsSendResult } from '@shitu/api-client'
import { useSmsCountdown } from './useSmsCountdown'

export interface SmsApi {
  sendSms: (req: SmsCodeRequest) => Promise<SmsSendResult>
  captcha: () => Promise<Captcha>
}

/**
 * 发送短信验证码：60s 倒计时 + 风控触发时的图形验证码（AUTH_4004 需要 / AUTH_4005 输错）。
 * onSent 收到结果（本地 Mock 短信通道会带 devCode）。
 */
export function useSmsSender(api: SmsApi, onSent?: (r: SmsSendResult) => void) {
  const countdown = useSmsCountdown()
  const sending = ref(false)
  const captcha = reactive({ visible: false, loading: false, id: '', image: '', code: '' })
  let pendingPhone = ''

  async function refreshCaptcha() {
    captcha.loading = true
    captcha.code = ''
    try {
      const c = await api.captcha()
      captcha.id = c.captchaId
      captcha.image = c.imageBase64
    } catch (e) {
      showToast(errorMessage(e, '图形验证码加载失败'))
    } finally {
      captcha.loading = false
    }
  }

  async function doSend(phone: string, withCaptcha: boolean): Promise<boolean> {
    sending.value = true
    try {
      const req: SmsCodeRequest = withCaptcha ? { phone, captchaId: captcha.id, captchaCode: captcha.code.trim() } : { phone }
      const r = await api.sendSms(req)
      countdown.start(r.retryAfterSeconds || 60)
      captcha.visible = false
      showToast('验证码已发送')
      onSent?.(r)
      return true
    } catch (e) {
      if (isApiError(e, 'AUTH_4004') || isApiError(e, 'AUTH_4005')) {
        pendingPhone = phone
        if (captcha.visible || isApiError(e, 'AUTH_4005')) showToast(e.message || '图形验证码错误，请重新输入')
        captcha.visible = true
        await refreshCaptcha()
        return false
      }
      showToast(errorMessage(e))
      return false
    } finally {
      sending.value = false
    }
  }

  /** 点击「获取验证码」 */
  function send(phone: string) {
    if (sending.value || countdown.counting.value) return Promise.resolve(false)
    return doSend(phone, false)
  }

  /** 图形验证码弹窗点「确定」：返回 true 关闭弹窗 */
  async function confirmCaptcha(): Promise<boolean> {
    if (!captcha.code.trim()) {
      showToast('请输入图中的字符')
      return false
    }
    return doSend(pendingPhone, true)
  }

  return { countdown, sending, captcha, send, confirmCaptcha, refreshCaptcha }
}
