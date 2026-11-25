<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, h, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type Action, type MessageBoxState } from 'element-plus'
import {
  errorMessage,
  isApiError,
  tenantApi,
  type ApplicationBatchResult,
  type LaborContractView,
  type SiteApplication,
  type SiteApplicationAction,
} from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import QrImage from '@/components/QrImage.vue'
import { ACTION_LABEL } from '@/components/site/AppActionButtons.vue'
import { useMeStore } from '@/stores/me'
import { copyText, fmtDate, fmtDateTime, fmtPhone, PHONE_RE } from '@/utils/format'
import { IconCircleCheck, IconCopy, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { addDays, nextWorkday9, parseLocal, toLocalIso, ymd } from '@/utils/time'

/**
 * 报名操作弹窗（A-02 / A-03 / A-04 共用）。页面放一个实例，按钮点击后调用 run(action, app)。
 * 知悉推送 / 修改面试信息、到厂确认、面试通过 / 未通过、爽约、取消、确权签约 / 重发签约。
 * 提交中按钮转圈、不能重复点；后端业务拒绝（不是断网、超时）时原因留在弹窗里、提交按钮置灰，
 * 下层入口保持可用，重新打开清掉原因；网络失败只提示、可以直接重试。
 *
 * 批量（待办清单）：runBatch('ACKNOWLEDGE' | 'ARRIVE', apps)。批量知悉用同一个知悉表单，一份面试信息推送给多人；
 * 批量到厂是一个确认框。后端逐个执行，结果里失败的人和原因列在结果弹窗里，页面收到 batchDone 后刷新、保留失败的选中。
 */
type BatchAction = 'ACKNOWLEDGE' | 'ARRIVE'
const emit = defineEmits<{
  done: [action: SiteApplicationAction, app: SiteApplication]
  batchDone: [action: BatchAction, result: ApplicationBatchResult]
}>()
const meStore = useMeStore()

const PRESET_DOCS = ['身份证', '一寸照片', '银行卡', '健康证', '学历证明']

/** 提交失败：轻提示写原因；后端业务拒绝才算「被拒」（断网、超时也包成 ApiError，code 为 NETWORK） */
function failed(action: SiteApplicationAction, e: unknown, label: string = ACTION_LABEL[action]): { text: string; blocked: boolean } {
  const reason = errorMessage(e)
  ElMessage.error(reason)
  const blocked = isApiError(e) && e.code !== 'NETWORK'
  return { text: `暂时不能${label}：${reason}`, blocked }
}

// ---------------------------------------------------------------- 批量：名单与结果
const BATCH_LABEL: Record<BatchAction, string> = { ACKNOWLEDGE: '批量知悉', ARRIVE: '批量到厂确认' }
/** 前 3 个人的姓名（接口返回的已是脱敏姓名），多于 3 人时后面接「等」 */
function batchNames(apps: SiteApplication[]): string {
  return apps.slice(0, 3).map((a) => a.seekerName).join('、') + (apps.length > 3 ? ' 等' : '')
}
const batchFail = reactive({
  visible: false,
  action: 'ACKNOWLEDGE' as BatchAction,
  succeeded: 0,
  rows: [] as { applicationId: string; name: string; job: string; reason: string }[],
})
/** 批量接口返回后：成功的轻提示，失败的逐个列出原因，通知页面刷新 */
function finishBatch(action: BatchAction, apps: SiteApplication[], r: ApplicationBatchResult) {
  if (r.succeeded > 0) ElMessage.success(action === 'ACKNOWLEDGE' ? `已为 ${r.succeeded} 人推送面试信息` : `已确认 ${r.succeeded} 人到厂`)
  const bad = r.items.filter((i) => !i.ok)
  if (bad.length) {
    batchFail.action = action
    batchFail.succeeded = r.succeeded
    batchFail.rows = bad.map((i) => {
      const a = apps.find((x) => x.applicationId === i.applicationId)
      return { applicationId: i.applicationId, name: a?.seekerName ?? i.applicationId, job: a?.jobTitle ?? '', reason: i.message || '未处理成功' }
    })
    batchFail.visible = true
  }
  emit('batchDone', action, r)
}

// ---------------------------------------------------------------- 知悉并推送面试信息
const ack = reactive({
  visible: false,
  saving: false,
  prefilling: false,
  app: null as SiteApplication | null,
  /** 批量知悉的名单；空 = 单人 */
  batch: [] as SiteApplication[],
  repush: false,
  hint: '',
  /** 提交失败的原因（留在弹窗里）；blocked = 后端拒绝，提交按钮置灰到下次打开 */
  error: '',
  blocked: false,
  form: { interviewAt: '', address: '', routeTips: '', documents: [] as string[], contactName: '', contactPhone: '' },
})
const docOptions = computed(() => Array.from(new Set([...PRESET_DOCS, ...ack.form.documents])))

async function openAck(app: SiteApplication, repush: boolean, batch: SiteApplication[] = []) {
  ack.app = app
  ack.batch = batch
  ack.repush = repush
  ack.hint = ''
  ack.error = ''
  ack.blocked = false
  const existing = batch.length ? null : parseLocal(app.interviewAt)
  ack.form.interviewAt = toLocalIso(existing && existing.getTime() > shNowMs() ? existing : nextWorkday9())
  ack.form.address = ''
  ack.form.routeTips = ''
  ack.form.documents = ['身份证']
  ack.form.contactName = meStore.me?.name ?? ''
  ack.form.contactPhone = ''
  ack.visible = true
  // 重新推送：预填上次推送的面试信息（地址 / 路线 / 材料 / 联系人），只需改动变化的部分
  const n = batch.length ? undefined : app.notice
  if (n) {
    const at = parseLocal(n.interviewAt)
    if (at && at.getTime() > shNowMs()) ack.form.interviewAt = toLocalIso(at)
    ack.form.address = n.address ?? ''
    ack.form.routeTips = n.routeTips ?? ''
    ack.form.documents = n.documents?.length ? [...n.documents] : []
    ack.form.contactName = n.contactName ?? ack.form.contactName
    ack.form.contactPhone = n.contactPhone ?? ''
    ack.hint = `已带出 ${fmtDateTime(n.pushedAt)} 推送的面试信息`
    return
  }
  // 批量且应聘的岗位不一样：不带出某一个岗位的地址，由驻场填写
  if (batch.some((a) => a.jobId !== app.jobId)) {
    ack.hint = '所选求职者应聘的岗位不同，请确认面试时间和地点对所有人都适用'
    return
  }
  const opened = ack.batch
  ack.prefilling = true
  try {
    // 面试地点 / 所需材料默认取岗位信息
    const job = await tenantApi.job(app.jobId)
    if (ack.app?.applicationId !== app.applicationId || ack.batch !== opened) return
    ack.form.address = job.interviewAddress ?? ''
    if (job.requiredDocuments?.length) ack.form.documents = [...job.requiredDocuments]
    ack.hint = [job.interviewAddress ? '已带出岗位面试地址' : '', job.interviewTimeDesc ? `岗位面试时间：${job.interviewTimeDesc}` : '']
      .filter(Boolean)
      .join(' · ')
  } catch {
    /* 取不到岗位信息时由驻场手填 */
  } finally {
    ack.prefilling = false
  }
}

function disablePast(d: Date) {
  const today = shNow()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

async function submitAck() {
  const app = ack.app
  if (!app) return
  const f = ack.form
  if (!f.interviewAt) return ElMessage.warning('请选择面试时间')
  if (!f.address.trim()) return ElMessage.warning('请填写面试地点')
  if (f.contactPhone && !PHONE_RE.test(f.contactPhone.trim())) return ElMessage.warning('联系电话格式不正确')
  if (ack.saving || ack.blocked) return
  ack.saving = true
  ack.error = ''
  const batch = ack.batch
  const label = batch.length ? BATCH_LABEL.ACKNOWLEDGE : undefined
  try {
    const req = {
      interviewAt: f.interviewAt,
      address: f.address.trim(),
      routeTips: f.routeTips.trim() || undefined,
      documents: f.documents.length ? f.documents : undefined,
      contactName: f.contactName.trim() || undefined,
      contactPhone: f.contactPhone.trim() || undefined,
    }
    if (batch.length) {
      const res = await tenantApi.batchAcknowledge({ applicationIds: batch.map((a) => a.applicationId), ...req })
      ack.visible = false
      finishBatch('ACKNOWLEDGE', batch, res)
      return
    }
    const r = await tenantApi.acknowledge(app.applicationId, req)
    ElMessage.success(ack.repush ? '面试信息已更新并重新推送' : '已知悉，面试信息已推送给求职者')
    ack.visible = false
    emit('done', ack.repush ? 'REPUSH' : 'ACKNOWLEDGE', r)
  } catch (e) {
    ack.saving = false
    const r = failed(ack.repush ? 'REPUSH' : 'ACKNOWLEDGE', e, label)
    // 断网、超时只弹轻提示，不留原因、不置灰
    ack.error = r.blocked ? r.text : ''
    ack.blocked = r.blocked
  } finally {
    ack.saving = false
  }
}

// ---------------------------------------------------------------- 确权签约
const cf = reactive({
  visible: false,
  saving: false,
  app: null as SiteApplication | null,
  resend: false,
  form: { startDate: '', employeeNo: '', termEnd: '' },
  result: null as LaborContractView | null,
  error: '',
  blocked: false,
})

function openConfirm(app: SiteApplication, resend: boolean) {
  const today = shNow()
  cf.app = app
  cf.resend = resend
  cf.result = null
  cf.error = ''
  cf.blocked = false
  cf.form.startDate = ymd(today)
  cf.form.employeeNo = ''
  cf.form.termEnd = ymd(addDays(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()), -1))
  cf.visible = true
}

/** 入职日期：近 3 天到未来 30 天（后端同口径） */
function disableStart(d: Date) {
  const today = shNow()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < addDays(today, -3).getTime() || d.getTime() > addDays(today, 30).getTime()
}
function disableTermEnd(d: Date) {
  const s = parseLocal(cf.form.startDate)
  return s ? d.getTime() <= s.getTime() : false
}

async function submitConfirm() {
  const app = cf.app
  if (!app) return
  const f = cf.form
  if (!f.startDate) return ElMessage.warning('请选择入职日期')
  if (f.termEnd && f.termEnd <= f.startDate) return ElMessage.warning('合同截止日需晚于入职日期')
  if (cf.saving || cf.blocked) return
  if (cf.resend) {
    try {
      await ElMessageBox.confirm('重发会作废尚未签署的旧签约流程，并生成新的签署链接。确定重发？', '重发签约', {
        type: 'warning',
        confirmButtonText: '重发',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  cf.saving = true
  cf.error = ''
  try {
    cf.result = await tenantApi.confirmOnboard(app.applicationId, {
      startDate: f.startDate,
      employeeNo: f.employeeNo.trim() || undefined,
      termEnd: f.termEnd || undefined,
    })
    ElMessage.success(cf.resend ? '已重新发起电子签约' : '确权完成，已发起电子签约')
    emit('done', cf.resend ? 'RESEND_CONTRACT' : 'CONFIRM', app)
  } catch (e) {
    cf.saving = false
    const r = failed(cf.resend ? 'RESEND_CONTRACT' : 'CONFIRM', e)
    // 断网、超时只弹轻提示，不留原因、不置灰
    cf.error = r.blocked ? r.text : ''
    cf.blocked = r.blocked
  } finally {
    cf.saving = false
  }
}

async function copySign(link?: string) {
  const url = link ?? cf.result?.signUrl
  if (!url) return
  if (await copyText(url)) ElMessage.success('签署链接已复制')
  else ElMessage.error('复制失败，请手动复制')
}

// ---------------------------------------------------------------- 简单确认 / 填原因
function who(app: SiteApplication) {
  return `${app.seekerName}（${app.jobTitle ?? '—'}）`
}
/**
 * 面试未通过 / 取消报名后人归谁（D-31，回到报名前的归属）：
 * 报名前是本公司私域 → 还归本公司，回私域待匹配、重开 24 小时；报名前是公域 → 回公域。名额都退回 1 个（D-12）
 */
function ownerAfter(app: SiteApplication) {
  return app.fromPublic
    ? '· 人不再归本公司，回到公域，可以去匹配全平台的岗位'
    : '· 人还归本公司（私域），回到「私域待匹配」，可以再给他匹配本公司别的岗位\n· 跟进时限重新算 24 小时，24 小时内没报上新岗位，会自动放到公域'
}

/**
 * 确认框里提交：点确认后框不关、确认按钮转圈（不能重复点），请求成功再关框。
 * 后端业务拒绝：框不关，原因用提醒色写在提示文字下面，确认按钮置灰；断网、超时只弹轻提示，可以直接再点确认。
 * 提示文字、按钮和原因输入与原来一致。
 */
function boxSubmit(action: SiteApplicationAction, text: string, api: (input: string) => Promise<unknown>, label?: string) {
  const why = ref('')
  const message = () => h('div', [h('p', { style: 'white-space: pre-line' }, text), why.value ? h('p', { class: 'msgbox-why', role: 'alert' }, why.value) : null])
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
      const r = failed(action, e, label)
      if (r.blocked) {
        why.value = r.text
        box.confirmButtonDisabled = true
      }
    }
  }
  return { message, beforeClose }
}

async function simple(action: SiteApplicationAction, app: SiteApplication) {
  try {
    if (action === 'ARRIVE') {
      const s = boxSubmit(action, `确认 ${who(app)} 已到厂？`, () => tenantApi.arrive(app.applicationId))
      await ElMessageBox.confirm(s.message, '到厂确认', { confirmButtonText: '确认到厂', cancelButtonText: '取消', beforeClose: s.beforeClose })
      ElMessage.success('已确认到厂')
    } else if (action === 'PASS') {
      const s = boxSubmit(action, `确认 ${who(app)} 面试通过？通过后进入「待确权」，请尽快完成入职确权与签约。`, () =>
        tenantApi.interviewResult(app.applicationId, true),
      )
      await ElMessageBox.confirm(s.message, '面试通过', {
        confirmButtonText: '面试通过',
        cancelButtonText: '取消',
        beforeClose: s.beforeClose,
      })
      ElMessage.success('已标记面试通过，进入待确权')
    } else if (action === 'FAIL') {
      const s = boxSubmit(action, `${who(app)} 面试未通过。\n之后会这样：\n${ownerAfter(app)}\n· 这个岗位的名额退回 1 个`, (remark) =>
        tenantApi.interviewResult(app.applicationId, false, remark),
      )
      await ElMessageBox.prompt(s.message, '面试未通过', {
        confirmButtonText: '确认未通过',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请填写未通过原因（必填）',
        inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写未通过原因',
        type: 'warning',
        beforeClose: s.beforeClose,
      })
      ElMessage.success('已标记面试未通过')
    } else if (action === 'NO_SHOW') {
      const s = boxSubmit(action, `确认 ${who(app)} 爽约？\n之后会这样：\n· 人马上不再归本公司，回到公域，可以去匹配全平台的岗位\n· 这个岗位的名额退回 1 个\n· 他的注册来源不变（以后在别家入职，来源公司照常分流转费）\n标记后不能撤销。`, () => tenantApi.noShow(app.applicationId))
      await ElMessageBox.confirm(s.message, '标记爽约', {
        type: 'warning',
        confirmButtonText: '确认爽约',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        beforeClose: s.beforeClose,
      })
      ElMessage.success('已标记爽约')
    } else if (action === 'CANCEL') {
      const s = boxSubmit(action, `取消 ${who(app)} 的报名。\n之后会这样：\n${ownerAfter(app)}\n· 这个岗位的名额退回 1 个${app.status === 'PENDING_CONFIRM' ? '\n· 还没签的入职合同作废' : ''}\n求职者自己不能取消报名，只能由你们取消。取消后不能撤销。`, (reason) =>
        tenantApi.cancelApplication(app.applicationId, reason),
      )
      await ElMessageBox.prompt(s.message, '取消报名', {
        confirmButtonText: '确认取消',
        cancelButtonText: '返回',
        inputType: 'textarea',
        inputPlaceholder: '请填写取消原因（必填）',
        inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写取消原因',
        type: 'warning',
        beforeClose: s.beforeClose,
      })
      ElMessage.success('报名已取消')
    } else {
      return
    }
    emit('done', action, app)
  } catch (e) {
    // 取消 / 关闭框；提交失败已在框里处理
    if (e === 'cancel' || e === 'close') return
    failed(action, e)
  }
}

/** 批量到厂确认：确认框里提交，成功后按结果提示 */
async function batchArrive(apps: SiteApplication[]) {
  const out: { result?: ApplicationBatchResult } = {}
  const s = boxSubmit(
    'ARRIVE',
    // 「张*、李*、王* 等 30 人」 / 「张*、李* 共 2 人」
    `确认 ${batchNames(apps)}${apps.length > 3 ? '' : ' 共'} ${apps.length} 人已到厂？`,
    async () => {
      out.result = await tenantApi.batchArrive(apps.map((a) => a.applicationId))
    },
    BATCH_LABEL.ARRIVE,
  )
  try {
    await ElMessageBox.confirm(s.message, '批量到厂确认', { confirmButtonText: '确认到厂', cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭框；提交失败已在框里处理
    return
  }
  if (out.result) finishBatch('ARRIVE', apps, out.result)
}

/** 批量操作入口：apps 是页面上勾选的报名（1–50 个，都允许这个操作） */
function runBatch(action: BatchAction, apps: SiteApplication[]) {
  if (!apps.length) return
  if (action === 'ACKNOWLEDGE') openAck(apps[0], false, [...apps])
  else batchArrive([...apps])
}

function run(action: SiteApplicationAction, app: SiteApplication) {
  if (action === 'ACKNOWLEDGE' || action === 'REPUSH') openAck(app, action === 'REPUSH')
  else if (action === 'CONFIRM' || action === 'RESEND_CONTRACT') openConfirm(app, action === 'RESEND_CONTRACT')
  else simple(action, app)
}

defineExpose({ run, runBatch })
</script>

<template>
  <!-- 知悉并推送面试信息 -->
  <el-dialog
    v-model="ack.visible"
    :title="ack.batch.length ? '批量知悉并推送面试信息' : ack.repush ? '修改面试信息并重新推送' : '知悉并推送面试信息'"
    width="560px"
    :close-on-click-modal="false"
  >
    <template v-if="ack.app">
      <div v-if="ack.batch.length" class="ctx ctx--batch">
        <b>将为 {{ ack.batch.length }} 人推送同一份面试信息</b>
        <span class="ctx-m">{{ batchNames(ack.batch) }}</span>
      </div>
      <div v-else class="ctx">
        <b>{{ ack.app.seekerName }}</b>
        <span class="ctx-m">{{ fmtPhone(ack.app.phone) }}</span>
        <span class="ctx-m">{{ ack.app.jobTitle }} · {{ ack.app.projectName }}</span>
      </div>
      <div class="notice-bar notice-bar--info dlg-tip"><IconInfo :size="16" class="notice-bar-i" /><span>提交后通过短信 + 站内信推送给求职者，可重复推送，以最后一次为准。</span></div>
      <el-form v-loading="ack.prefilling" label-width="88px" @submit.prevent>
        <el-form-item label="面试时间" required>
          <el-date-picker
            v-model="ack.form.interviewAt"
            type="datetime"
            value-format="YYYY-MM-DD[T]HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            :disabled-date="disablePast"
            :clearable="false"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="面试地点" required>
          <el-input v-model="ack.form.address" maxlength="200" placeholder="详细地址" />
        </el-form-item>
        <el-form-item label="路线提示">
          <el-input v-model="ack.form.routeTips" type="textarea" :rows="2" maxlength="300" placeholder="如：地铁 S1 线 XX 站 2 号口，步行 300 米到东门" />
        </el-form-item>
        <el-form-item label="携带材料">
          <el-select v-model="ack.form.documents" multiple filterable allow-create default-first-option placeholder="可输入自定义材料" style="width: 100%">
            <el-option v-for="d in docOptions" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <div class="grid g-2" style="gap: 0 12px">
          <el-form-item label="现场联系人">
            <el-input v-model="ack.form.contactName" maxlength="20" />
          </el-form-item>
          <el-form-item label="联系电话" label-width="72px">
            <el-input v-model="ack.form.contactPhone" maxlength="11" placeholder="选填" />
          </el-form-item>
        </div>
        <div v-if="ack.hint" class="hint">{{ ack.hint }}</div>
      </el-form>
    </template>
    <template #footer>
      <p v-if="ack.error" class="blocked-why dlg-err" role="alert">{{ ack.error }}</p>
      <el-button @click="ack.visible = false">取消</el-button>
      <el-button type="primary" :loading="ack.saving" :disabled="ack.blocked" @click="submitAck">
        {{ ack.batch.length ? `知悉并推送（${ack.batch.length} 人）` : ack.repush ? '重新推送' : '知悉并推送' }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 批量操作结果：没处理成功的人和原因 -->
  <el-dialog v-model="batchFail.visible" :title="`${BATCH_LABEL[batchFail.action]}：${batchFail.rows.length} 人未成功`" width="520px" class="batch-fail-dialog" append-to-body>
    <p class="bf-sum">成功 {{ batchFail.succeeded }} 人，未成功 {{ batchFail.rows.length }} 人。未成功的仍保持选中，可按原因处理后重试。</p>
    <ul class="bf-list">
      <li v-for="r in batchFail.rows" :key="r.applicationId" class="batch-fail-item">
        <b>{{ r.name }}</b><span v-if="r.job" class="ctx-m">{{ r.job }}</span>
        <p class="blocked-why">{{ r.reason }}</p>
      </li>
    </ul>
    <template #footer>
      <el-button type="primary" @click="batchFail.visible = false">知道了</el-button>
    </template>
  </el-dialog>

  <!-- 确权签约 / 重发签约 -->
  <el-dialog v-model="cf.visible" :title="cf.resend ? '重发电子签约' : '入职确权并发起电子签约'" width="560px" :close-on-click-modal="false">
    <template v-if="cf.app">
      <div class="ctx">
        <b>{{ cf.app.seekerName }}</b>
        <span class="ctx-m">{{ fmtPhone(cf.app.phone) }}</span>
        <span class="ctx-m">{{ cf.app.jobTitle }} · {{ cf.app.projectName }}</span>
      </div>
      <template v-if="!cf.result">
        <template v-if="cf.resend">
          <div v-if="cf.app.contract?.signUrl" class="sign sign--top">
            <QrImage :url="cf.app.contract.signUrl" :size="104" />
            <div class="sign-r">
              <div class="sign-t">当前签署链接 <DictTag type="ContractStatus" :value="cf.app.contract.status" /></div>
              <div class="code link">{{ cf.app.contract.signUrl }}</div>
              <div class="row sign-acts">
                <el-button size="small" @click="copySign(cf.app.contract.signUrl)"><IconCopy :size="14" class="btn-i" />复制链接</el-button>
                <span class="hint">发起于 {{ fmtDateTime(cf.app.contract.createdAt) }} · 链接仍有效时无需重发</span>
              </div>
            </div>
          </div>
          <div class="notice-bar notice-bar--warn dlg-tip"><IconTriangleExclamationPoint :size="16" class="notice-bar-i" /><span>该报名已有待签署的电子合同。重发将作废旧流程并生成新的签署链接（旧链接失效）。</span></div>
        </template>
        <div v-else class="notice-bar notice-bar--info dlg-tip">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>
            确权是<b>唯一数据统计节点</b>：完成后写入归属、锁定匹配范围（仅本公司内部调岗），并开始计费；随后生成电子劳动合同推送求职者签署，签署完成即「已入职在岗」。
            <template v-if="cf.app.fromPublic"><br />该用户报名前为<b>公域</b>，确权后归属写入本公司、标签变为私域。</template>
          </span>
        </div>
        <el-form label-width="96px" @submit.prevent>
          <el-form-item label="入职日期" required>
            <el-date-picker v-model="cf.form.startDate" type="date" value-format="YYYY-MM-DD" :disabled-date="disableStart" :clearable="false" style="width: 100%" />
            <div class="hint">可选近 3 天到未来 30 天</div>
          </el-form-item>
          <el-form-item label="工号">
            <el-input v-model="cf.form.employeeNo" maxlength="32" placeholder="选填，如 XC-2026-0913" />
          </el-form-item>
          <el-form-item label="合同截止日">
            <el-date-picker v-model="cf.form.termEnd" type="date" value-format="YYYY-MM-DD" :disabled-date="disableTermEnd" placeholder="默认入职起 1 年" style="width: 100%" />
          </el-form-item>
        </el-form>
      </template>
      <template v-else>
        <div class="notice-bar notice-bar--ok dlg-tip"><IconCircleCheck :size="16" class="notice-bar-i" /><span>电子合同已生成并推送给求职者，签署完成后状态自动变为「已入职在岗」。</span></div>
        <dl class="kv"><dt>合同编号</dt><dd class="code">{{ cf.result.contractNo }}</dd></dl>
        <dl class="kv"><dt>合同名称</dt><dd>{{ cf.result.title }}</dd></dl>
        <dl class="kv"><dt>合同期限</dt><dd>{{ fmtDate(cf.result.termStart) }} ~ {{ fmtDate(cf.result.termEnd) }}</dd></dl>
        <dl class="kv"><dt>状态</dt><dd><DictTag type="ContractStatus" :value="cf.result.status" /></dd></dl>
        <dl class="kv"><dt>生成时间</dt><dd>{{ fmtDateTime(cf.result.createdAt) }}</dd></dl>
        <div v-if="cf.result.signUrl" class="sign">
          <QrImage :url="cf.result.signUrl" :size="112" />
          <div class="sign-r">
            <div class="sign-t">签署链接</div>
            <div class="code link">{{ cf.result.signUrl }}</div>
            <div class="row sign-acts">
              <el-button size="small" @click="copySign()"><IconCopy :size="14" class="btn-i" />复制链接</el-button>
              <span class="hint">可发给求职者或现场扫码签署</span>
            </div>
          </div>
        </div>
      </template>
    </template>
    <template #footer>
      <template v-if="!cf.result">
        <p v-if="cf.error" class="blocked-why dlg-err" role="alert">{{ cf.error }}</p>
        <el-button @click="cf.visible = false">取消</el-button>
        <el-button type="primary" :loading="cf.saving" :disabled="cf.blocked" @click="submitConfirm">{{ cf.resend ? '重发签约' : '确认入职并发起电子签约' }}</el-button>
      </template>
      <el-button v-else type="primary" @click="cf.visible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ctx { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
.ctx b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.ctx-m { font-size: var(--font-size-aux); color: var(--text-2); }
.dlg-tip { margin-bottom: var(--space-4); }
.bf-sum { margin: 0 0 var(--space-3); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-2); }
.bf-list { margin: 0; padding: 0; list-style: none; max-height: 360px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-card); }
.batch-fail-item { padding: var(--space-2) var(--space-3); }
.batch-fail-item + .batch-fail-item { border-top: 1px solid var(--divider); }
.batch-fail-item b { margin-right: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.hint { font-size: var(--font-size-min); line-height: 1.6; color: var(--text-3); }
.code { font-family: var(--font-mono); }
.sign { display: flex; gap: var(--space-4); margin-top: var(--space-4); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--bg-hover); }
.sign--top { margin: 0 0 var(--space-4); }
.sign-r { flex: 1; min-width: 0; }
.sign-t { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--text-2); }
.sign-acts { margin-top: var(--space-2); }
.btn-i { margin-right: var(--space-1); }
.link { word-break: break-all; margin-top: var(--space-1); font-size: var(--font-size-aux); color: var(--text-2); }
/* 被拒原因占底部一整行，在按钮上方 */
.dlg-err { text-align: left; margin-bottom: var(--space-3); }
</style>
