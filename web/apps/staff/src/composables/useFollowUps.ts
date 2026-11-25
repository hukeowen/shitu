import { computed, ref, shallowRef, type Ref } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, type PrivatePendingRow, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { ACTION_TEXT, tagTone } from '@/utils/actions'
import { PRIVATE_PENDING_TAG, STAGE_TAG, STAGE_TEXT, URGENT_MS } from '@/utils/status'
import { fmtDuration, fmtPhone, parseLocal } from '@/utils/time'

/**
 * 24 小时窗口内要跟进的人（跟进提醒页、工作台「今日待办」共用）：
 * 私域待匹配（扫码注册未报名）、待知悉 / 待面试 / 已到厂（待面试报名的三个子阶段）、待确权，合在一起按截止时间从早到晚排。
 * 已超时、不足 4 小时的排在最前面（截止时间最早）。
 */
export type FollowKind = 'private' | 'ack' | 'interview' | 'arrived' | 'confirm'
export interface FollowItem {
  key: string
  kind: FollowKind
  deadline: number | null
  p?: PrivatePendingRow
  a?: SiteApplication
}
/** 后端拒绝过的操作：这一条的按钮置灰、原因留在卡片上，刷新后重新判断 */
export interface FollowBlocked {
  text: string
  action?: SiteApplicationAction
}

export const FOLLOW_KIND_TAG: Record<FollowKind, { text: string; tone: string }> = {
  private: { text: '私域待匹配', tone: tagTone(PRIVATE_PENDING_TAG) },
  ack: { text: STAGE_TEXT.ack, tone: tagTone(STAGE_TAG.ack) },
  interview: { text: STAGE_TEXT.interview, tone: tagTone(STAGE_TAG.interview) },
  arrived: { text: STAGE_TEXT.arrived, tone: tagTone(STAGE_TAG.arrived) },
  confirm: { text: STAGE_TEXT.confirm, tone: tagTone(STAGE_TAG.confirm) },
}

/** 剩余时间：文案与全端统一（剩余 19 小时 21 分 / 已超时 1 小时 5 分）；已超时或不足 4 小时 urgent */
export function followRemain(i: FollowItem, now: number) {
  if (i.deadline == null) return null
  const ms = i.deadline - now
  return { label: ms > 0 ? '剩余' : '已超时', text: fmtDuration(ms), urgent: ms < URGENT_MS }
}

const APP_PAGE = 50
const ts = (v?: string) => parseLocal(v)?.getTime() ?? null

/**
 * apps：当前登录人能不能拉报名列表（驻场 / 项目经理）；不能时只拉私域待匹配，不发注定 403 的请求
 */
export function useFollowUps(apps: () => boolean = () => true) {
  const privates = shallowRef<PrivatePendingRow[]>([])
  const acks = shallowRef<SiteApplication[]>([])
  const confirms = shallowRef<SiteApplication[]>([])
  const loaded = ref(false)
  const loadError = ref('')
  const appsForbidden = ref(false)
  const blocked: Ref<Record<string, FollowBlocked>> = ref({})

  async function load() {
    loadError.value = ''
    blocked.value = {}
    const errs: string[] = []
    const tasks: Promise<unknown>[] = [
      tenantApi
        .privatePending()
        .then((r) => (privates.value = r))
        .catch((e: unknown) => errs.push(errorMessage(e, '私域待匹配加载失败'))),
    ]
    if (apps()) {
      tasks.push(
        tenantApi
          .applications({ status: 'PENDING_INTERVIEW', sort: 'DEADLINE', page: 1, pageSize: APP_PAGE })
          .then((r) => (acks.value = r.records))
          .catch((e: unknown) => {
            if (isApiError(e) && e.status === 403) appsForbidden.value = true
            else errs.push(errorMessage(e, '报名待办加载失败'))
          }),
        tenantApi
          .applications({ status: 'PENDING_CONFIRM', sort: 'DEADLINE', page: 1, pageSize: APP_PAGE })
          .then((r) => (confirms.value = r.records))
          .catch((e: unknown) => {
            if (!(isApiError(e) && e.status === 403)) errs.push(errorMessage(e, '待确权加载失败'))
          }),
      )
    } else {
      appsForbidden.value = true
      acks.value = []
      confirms.value = []
    }
    await Promise.all(tasks)
    loadError.value = errs[0] ?? ''
    loaded.value = true
  }

  const items = computed<FollowItem[]>(() => {
    const list: FollowItem[] = [
      ...privates.value.map((p) => ({ key: `p-${p.userId}`, kind: 'private' as const, deadline: ts(p.deadline), p })),
      ...acks.value.map((a) => ({
        key: `a-${a.applicationId}`,
        kind: a.arrivedAt ? ('arrived' as const) : a.acknowledgedAt ? ('interview' as const) : ('ack' as const),
        deadline: ts(a.responseDeadline),
        a,
      })),
      ...confirms.value.map((a) => ({ key: `c-${a.applicationId}`, kind: 'confirm' as const, deadline: ts(a.responseDeadline), a })),
    ]
    return list.sort((x, y) => (x.deadline ?? Infinity) - (y.deadline ?? Infinity))
  })

  function onRejected(a: SiteApplication, action: SiteApplicationAction, reason: string) {
    blocked.value = { ...blocked.value, [a.applicationId]: { action, text: `暂时不能${ACTION_TEXT[action]}：${reason}` } }
  }

  /** M-09 一键流转至人才经纪人（私域待匹配） */
  async function transfer(p: PrivatePendingRow) {
    if (p.inBrokerPool) return
    try {
      await showConfirmDialog({
        title: '流转至人才经纪人',
        // D-57：转交时跟进时限顺延到经纪人出结果的期限（默认 24 小时），只延不缩、同一窗口只顺延一次
        message: `把 ${p.seekerName}（${fmtPhone(p.phone)}）交给本公司人才经纪人跟进？\n之后会这样：\n· 人还归本公司（私域），不会因为转交被放到公域\n· 经纪人要在 2 小时内联系他，24 小时内给他推荐岗位\n· 他的跟进时限延长到经纪人出结果的时间（从现在起 24 小时）；只延长一次，再转交不会再延长\n· 经纪人能看到他的问薪画像、以前的匹配记录和注册来源`,
        confirmButtonText: '确认流转',
        messageAlign: 'left',
        beforeClose: async (action) => {
          if (action !== 'confirm') return true
          try {
            await tenantApi.transferToBroker(p.userId)
            return true
          } catch (e) {
            showToast(errorMessage(e, '流转失败，请稍后重试'))
            if (isApiError(e) && e.code !== 'NETWORK') blocked.value = { ...blocked.value, [p.userId]: { text: `暂时不能流转：${errorMessage(e)}` } }
            return false
          }
        },
      })
    } catch {
      return
    }
    // 跟进时限可能顺延了，重新拉一次排序才对
    privates.value = privates.value.map((r) => (r.userId === p.userId ? { ...r, inBrokerPool: true } : r))
    showSuccessToast('已流转至人才经纪人')
    void tenantApi
      .privatePending()
      .then((r) => (privates.value = r))
      .catch(() => undefined)
  }

  return { privates, acks, confirms, loaded, loadError, appsForbidden, blocked, items, load, onRejected, transfer }
}
