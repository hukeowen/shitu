<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, tenantApi, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import AcknowledgePopup from '@/components/AcknowledgePopup.vue'
import ConfirmOnboardPopup from '@/components/ConfirmOnboardPopup.vue'
import ReasonDialog from '@/components/ReasonDialog.vue'
import { splitActions } from '@/utils/actions'

/**
 * 报名操作（页面放一个实例，按钮点击后调用 run(action, app) / more(app)）：
 * M-02 知悉推送 / 修改面试信息、M-05 到厂确认 + 面试结果、M-06/M-07 确权签约 / 重发、M-08 爽约、M-10 取消报名。
 * 只执行后端 allowedActions 里有的操作。
 */
const emit = defineEmits<{ done: [action: SiteApplicationAction, app: SiteApplication | null] }>()

const target = shallowRef<SiteApplication | null>(null)
const ackShow = ref(false)
const cfShow = ref(false)
const cfResend = ref(false)
const reason = ref<InstanceType<typeof ReasonDialog> | null>(null)

const who = (a: SiteApplication) => `${a.seekerName}（${a.jobTitle ?? '—'}）`

async function confirmThen(title: string, message: string, confirmText: string, fn: () => Promise<unknown>, danger = false): Promise<boolean> {
  try {
    await showConfirmDialog({
      title,
      message,
      confirmButtonText: confirmText,
      confirmButtonColor: danger ? 'var(--danger)' : undefined,
      beforeClose: async (action) => {
        if (action !== 'confirm') return true
        try {
          await fn()
          return true
        } catch (e) {
          showToast(errorMessage(e, '操作失败，请稍后重试'))
          return false
        }
      },
    })
    return true
  } catch {
    return false
  }
}

async function withReason(o: Parameters<NonNullable<typeof reason.value>['open']>[0]): Promise<boolean> {
  if (!reason.value) return false
  return (await reason.value.open(o)) !== null
}

const failWrap = (fn: (reason: string) => Promise<unknown>) => async (reason: string) => {
  try {
    await fn(reason)
  } catch (e) {
    showToast(errorMessage(e, '操作失败，请稍后重试'))
    throw e
  }
}

async function run(action: SiteApplicationAction, app: SiteApplication) {
  if (!app.allowedActions.includes(action)) {
    showToast('当前状态不能执行该操作，请刷新后重试')
    return
  }
  target.value = app
  const id = app.applicationId
  let ok = false
  switch (action) {
    case 'ACKNOWLEDGE':
    case 'REPUSH':
      ackShow.value = true
      return
    case 'CONFIRM':
    case 'RESEND_CONTRACT':
      cfResend.value = action === 'RESEND_CONTRACT'
      cfShow.value = true
      return
    case 'ARRIVE':
      ok = await confirmThen('到厂确认', `确认 ${who(app)} 已到厂？请核验本人到场、人证一致。`, '确认到厂', () => tenantApi.arrive(id))
      if (ok) showSuccessToast('已确认到厂')
      break
    case 'PASS':
      ok = await confirmThen('面试通过', `确认 ${who(app)} 面试通过？通过后进入「待确权」，请在 24 小时内完成入职确权与签约。`, '面试通过', () =>
        tenantApi.interviewResult(id, true),
      )
      if (ok) showSuccessToast('已标记面试通过')
      break
    case 'FAIL':
      ok = await withReason({
        title: '面试未通过',
        message: `${who(app)} 面试未通过：将立即清空当前归属，私域用户回到本公司私域待匹配，公域用户回到公域并可重新匹配。`,
        presets: ['技能不符', '体检不合格', '证件不全', '年龄 / 纹身不符', '本人放弃'],
        required: true,
        placeholder: '请填写未通过原因（必填）',
        confirmText: '确认未通过',
        danger: true,
        submit: failWrap((r) => tenantApi.interviewResult(id, false, r)),
      })
      if (ok) showSuccessToast('已标记面试未通过')
      break
    case 'NO_SHOW':
      ok = await withReason({
        title: '标记爽约',
        message: `确认 ${who(app)} 爽约？标记后归属清空、简历当日释放至全平台公域（来源归属不变），此操作不可撤销。`,
        presets: ['未到场且电话无法接通', '电话告知不来了', '到场后自行离开'],
        placeholder: '爽约情况备注（选填）',
        confirmText: '确认爽约',
        danger: true,
        submit: failWrap((r) => tenantApi.noShow(id, r || undefined)),
      })
      if (ok) showSuccessToast('已标记爽约')
      break
    case 'CANCEL':
      ok = await withReason({
        title: '取消报名',
        message: `取消 ${who(app)} 的报名。用户无法自行取消，取消后可重新进入 AI 问薪匹配流程，此操作不可撤销。`,
        presets: ['用户申请更换岗位', '用户误操作报名', '岗位已满 / 暂停招聘', '用户联系取消面试'],
        required: true,
        placeholder: '请填写取消原因（必填）',
        confirmText: '确认取消',
        danger: true,
        submit: failWrap((r) => tenantApi.cancelApplication(id, r)),
      })
      if (ok) showSuccessToast('报名已取消')
      break
  }
  if (ok) emit('done', action, null)
}

// ---------- 更多操作 ----------
const sheetShow = ref(false)
const sheetApp = shallowRef<SiteApplication | null>(null)
const sheetActions = computed(() =>
  sheetApp.value
    ? splitActions(sheetApp.value).more.map((b) => ({ name: b.text, key: b.key, color: b.type === 'danger' ? 'var(--danger)' : undefined }))
    : [],
)
function more(app: SiteApplication) {
  sheetApp.value = app
  sheetShow.value = true
}
function onSelect(item: { key: SiteApplicationAction }) {
  sheetShow.value = false
  if (sheetApp.value) void run(item.key, sheetApp.value)
}

function onAcked(a: SiteApplication) {
  emit('done', target.value?.allowedActions.includes('REPUSH') ? 'REPUSH' : 'ACKNOWLEDGE', a)
}

defineExpose({ run, more })
</script>

<template>
  <AcknowledgePopup v-model:show="ackShow" :application="target" @done="onAcked" />
  <ConfirmOnboardPopup v-model:show="cfShow" :application="target" :resend="cfResend" @done="emit('done', cfResend ? 'RESEND_CONTRACT' : 'CONFIRM', null)" />
  <ReasonDialog ref="reason" />
  <van-action-sheet
    v-model:show="sheetShow"
    :actions="sheetActions"
    :description="sheetApp ? `${sheetApp.seekerName} · ${sheetApp.jobTitle ?? ''}` : ''"
    cancel-text="取消"
    close-on-click-action
    teleport="body"
    @select="onSelect"
  />
</template>
