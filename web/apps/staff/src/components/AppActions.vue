<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, type ApplicationBatchResult, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import AcknowledgePopup from '@/components/AcknowledgePopup.vue'
import ConfirmOnboardPopup from '@/components/ConfirmOnboardPopup.vue'
import ReasonDialog from '@/components/ReasonDialog.vue'
import { splitActions } from '@/utils/actions'

/**
 * 报名操作（页面放一个实例，按钮点击后调用 run(action, app) / more(app)）：
 * M-02 知悉推送 / 修改面试信息、M-05 到厂确认 + 面试结果、M-06/M-07 确权签约 / 重发、M-08 爽约、M-10 取消报名。
 * 只执行后端 allowedActions 里有的操作。
 *
 * 批量（待办清单）：runBatch('ACKNOWLEDGE' | 'ARRIVE', apps)。批量知悉用同一个知悉表单，批量到厂是一个确认框；
 * 后端逐个执行，成功的轻提示，没成功的人和原因列在结果弹窗里，页面收到 batchDone 后刷新。
 */
type BatchAction = 'ACKNOWLEDGE' | 'ARRIVE'
const emit = defineEmits<{
  batchDone: [action: BatchAction, result: ApplicationBatchResult]
  done: [action: SiteApplicationAction, app: SiteApplication | null]
  /** 后端业务拒绝（不是网络失败）：页面把这条的按钮置灰、原因留在卡片上，刷新后重新判断 */
  rejected: [app: SiteApplication, action: SiteApplicationAction, reason: string]
}>()

const target = shallowRef<SiteApplication | null>(null)
const pending = shallowRef<SiteApplicationAction | null>(null)
function reject(e: unknown) {
  if (isApiError(e) && e.code !== 'NETWORK' && target.value && pending.value) emit('rejected', target.value, pending.value, errorMessage(e))
}
/** 批量操作的名单；单人操作时为空 */
const batchApps = shallowRef<SiteApplication[]>([])
const ackShow = ref(false)
const cfShow = ref(false)
const cfResend = ref(false)
const reason = ref<InstanceType<typeof ReasonDialog> | null>(null)

const who = (a: SiteApplication) => `${a.seekerName}（${a.jobTitle ?? '—'}）`
/**
 * 面试未通过 / 取消报名后人归谁（D-31，回到报名前的归属）：
 * 报名前是本公司私域 → 还归本公司，回私域待匹配、重开 24 小时；报名前是公域 → 回公域。名额都退回 1 个（D-12）
 */
const ownerAfter = (a: SiteApplication) =>
  a.fromPublic
    ? '· 人不再归本公司，回到公域，可以去匹配全平台的岗位'
    : '· 人还归本公司（私域），回到「私域待匹配」，可以再给他匹配本公司别的岗位\n· 跟进时限重新算 24 小时，24 小时内没报上新岗位，会自动放到公域'

async function confirmThen(title: string, message: string, confirmText: string, fn: () => Promise<unknown>, danger = false): Promise<boolean> {
  try {
    await showConfirmDialog({
      title,
      message,
      confirmButtonText: confirmText,
      confirmButtonColor: danger ? 'var(--danger-text)' : undefined,
      beforeClose: async (action) => {
        if (action !== 'confirm') return true
        try {
          await fn()
          return true
        } catch (e) {
          showToast(errorMessage(e, '操作失败，请稍后重试'))
          reject(e)
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
    reject(e)
    throw e
  }
}

async function run(action: SiteApplicationAction, app: SiteApplication) {
  if (!app.allowedActions.includes(action)) {
    showToast('当前状态不能执行该操作，请刷新后重试')
    return
  }
  target.value = app
  pending.value = action
  batchApps.value = []
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
        message: `${who(app)} 面试未通过。\n之后会这样：\n${ownerAfter(app)}\n· 这个岗位的名额退回 1 个`,
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
        message: `确认 ${who(app)} 爽约？\n之后会这样：\n· 人马上不再归本公司，回到公域，可以去匹配全平台的岗位\n· 这个岗位的名额退回 1 个\n· 他的注册来源不变（以后在别家入职，来源公司照常分流转费）\n标记后不能撤销。`,
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
        message: `取消 ${who(app)} 的报名。\n之后会这样：\n${ownerAfter(app)}\n· 这个岗位的名额退回 1 个${app.status === 'PENDING_CONFIRM' ? '\n· 还没签的入职合同作废' : ''}\n求职者自己不能取消报名，只能由你们取消。取消后不能撤销。`,
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

// ---------- 批量 ----------
const BATCH_LABEL: Record<BatchAction, string> = { ACKNOWLEDGE: '批量知悉', ARRIVE: '批量到厂确认' }
const failShow = ref(false)
const fail = shallowRef<{ action: BatchAction; succeeded: number; rows: { applicationId: string; name: string; job: string; reason: string }[] } | null>(null)

/** 批量接口返回后：成功的轻提示，没成功的逐个列出原因，通知页面刷新 */
function finishBatch(action: BatchAction, r: ApplicationBatchResult) {
  const apps = batchApps.value
  if (r.succeeded > 0) showSuccessToast(action === 'ACKNOWLEDGE' ? `已为 ${r.succeeded} 人推送面试信息` : `已确认 ${r.succeeded} 人到厂`)
  const bad = r.items.filter((i) => !i.ok)
  if (bad.length) {
    fail.value = {
      action,
      succeeded: r.succeeded,
      rows: bad.map((i) => {
        const a = apps.find((x) => x.applicationId === i.applicationId)
        return { applicationId: i.applicationId, name: a?.seekerName ?? i.applicationId, job: a?.jobTitle ?? '', reason: i.message || '未处理成功' }
      }),
    }
    failShow.value = true
  }
  emit('batchDone', action, r)
}

/** 批量操作入口：apps 是页面上勾选的报名（1–50 个，都允许这个操作） */
async function runBatch(action: BatchAction, apps: SiteApplication[]) {
  if (!apps.length) return
  target.value = null
  pending.value = null
  batchApps.value = [...apps]
  if (action === 'ACKNOWLEDGE') {
    ackShow.value = true
    return
  }
  const n = apps.length
  // 「张*、李*、王* 等 30 人」 / 「张*、李* 共 2 人」
  const names = apps.slice(0, 3).map((a) => a.seekerName).join('、') + (n > 3 ? ` 等 ${n} 人` : ` 共 ${n} 人`)
  const out: { result?: ApplicationBatchResult } = {}
  const ok = await confirmThen('批量到厂确认', `确认 ${names}已到厂？请核验本人到场、人证一致。`, '确认到厂', async () => {
    out.result = await tenantApi.batchArrive(apps.map((a) => a.applicationId))
  })
  if (ok && out.result) finishBatch('ARRIVE', out.result)
}

// ---------- 更多操作 ----------
const sheetShow = ref(false)
const sheetApp = shallowRef<SiteApplication | null>(null)
const sheetActions = computed(() =>
  sheetApp.value
    ? splitActions(sheetApp.value).more.map((b) => ({ name: b.text, key: b.key, color: b.type === 'danger' ? 'var(--danger-text)' : undefined }))
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

defineExpose({ run, runBatch, more })
</script>

<template>
  <AcknowledgePopup v-model:show="ackShow" :application="target" :batch="batchApps" @done="onAcked" @batch-done="(r) => finishBatch('ACKNOWLEDGE', r)" @rejected="reject" />
  <ConfirmOnboardPopup v-model:show="cfShow" :application="target" :resend="cfResend" @rejected="reject" @done="emit('done', cfResend ? 'RESEND_CONTRACT' : 'CONFIRM', null)" />
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
  <!-- 批量操作结果：没处理成功的人和原因 -->
  <van-dialog
    v-model:show="failShow"
    :title="fail ? `${BATCH_LABEL[fail.action]}：${fail.rows.length} 人未成功` : ''"
    confirm-button-text="知道了"
    teleport="body"
    class="batch-fail"
  >
    <div v-if="fail" class="bf">
      <p class="bf-sum">成功 {{ fail.succeeded }} 人，未成功 {{ fail.rows.length }} 人。未成功的仍保持选中，可按原因处理后重试。</p>
      <ul class="bf-list">
        <li v-for="r in fail.rows" :key="r.applicationId" class="batch-fail-item">
          <b>{{ r.name }}</b><span v-if="r.job">{{ r.job }}</span>
          <p>{{ r.reason }}</p>
        </li>
      </ul>
    </div>
  </van-dialog>
</template>

<style scoped>
.bf { padding: var(--space-2) var(--space-4) var(--space-4); }
.bf-sum { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.bf-list { margin-top: var(--space-2); max-height: 45vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.batch-fail-item { padding: var(--space-2) 0; border-top: 1px solid var(--divider); }
.batch-fail-item b { margin-right: var(--space-2); font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.batch-fail-item span { font-size: var(--font-size-aux); color: var(--text-3); }
.batch-fail-item p { margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; color: var(--warning-text); overflow-wrap: anywhere; }
</style>
