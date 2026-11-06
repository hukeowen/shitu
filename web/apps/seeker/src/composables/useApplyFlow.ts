import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'
import { useMatchStore } from '@/stores/match'

/**
 * 报名闭环（C-403 / C-404 / C-407）：点「报名面试」直接调报名接口，按错误码引导——
 *   APP_4012 未同意告知书 → 弹 S-20，同意后自动重试；
 *   APP_4010 未实名 → 去 S-21 实名页，实名通过后由实名页重试；
 *   APP_4011 未满 18 / APP_4008 失信 → 提示；
 *   APP_4001 名额已满 → 回结果页重新匹配；
 *   APP_4002 / LC_4003 已有报名 → 我的报备；
 *   APP_4004 不在匹配结果 → 回结果页。
 * 页面需渲染 <DisclaimerPopup v-model:show="flow.disclaimerOpen.value" @agreed="flow.retry" />。
 */
export function useApplyFlow() {
  const router = useRouter()
  const auth = useAuthStore()
  const match = useMatchStore()
  const submitting = ref(false)
  const disclaimerOpen = ref(false)
  let pendingJob = ''

  async function apply(jobId: string, opts: { fromKyc?: boolean } = {}): Promise<void> {
    if (submitting.value) return
    submitting.value = true
    pendingJob = jobId
    try {
      const r = await seekerApi.apply(jobId)
      match.setApplyResult(r)
      try {
        await auth.loadProfile()
      } catch {
        /* 成功页仍可展示，首页会再拉档案 */
      }
      await router.replace('/apply/success')
    } catch (e) {
      await handleError(e, jobId, opts.fromKyc === true)
    } finally {
      submitting.value = false
    }
  }

  async function handleError(e: unknown, jobId: string, fromKyc: boolean) {
    if (!isApiError(e)) {
      showToast(errorMessage(e, '报名失败，请稍后重试'))
      return
    }
    switch (e.code) {
      case 'APP_4012':
        disclaimerOpen.value = true
        return
      case 'APP_4010':
        if (fromKyc) showToast(e.message)
        else await router.push({ path: '/kyc', query: { jobId } })
        return
      case 'APP_4011':
      case 'APP_4008':
        await showDialog({ title: '暂不能报名', message: e.message, confirmButtonText: '我知道了' })
        return
      case 'APP_4001':
        try {
          await showConfirmDialog({ title: '名额已满', message: e.message || '该岗位名额已满，请重新匹配', confirmButtonText: '重新匹配', cancelButtonText: '返回结果' })
          await router.replace('/match/quiz')
        } catch {
          await router.replace('/match/result')
        }
        return
      case 'APP_4002':
      case 'LC_4003':
        showToast(e.message || '你已有进行中的报名')
        void auth.loadProfile().catch(() => undefined)
        await router.replace('/reports')
        return
      case 'APP_4004':
        showToast(e.message || '只能报名匹配结果中的岗位')
        await router.replace('/match/result')
        return
      default:
        showToast(errorMessage(e, '报名失败，请稍后重试'))
    }
  }

  /** 同意告知书后重试 */
  function retry() {
    if (pendingJob) void apply(pendingJob)
  }

  return { submitting, disclaimerOpen, apply, retry }
}
