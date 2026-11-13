<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, reactive } from 'vue'
import { ElMessage, ElMessageBox, type Action, type MessageBoxState } from 'element-plus'
import {
  errorMessage,
  isApiError,
  tenantApi,
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
 * 并抛出 rejected 让页面把这条报名的按钮置灰、写明原因（规范「Page States」），网络失败只提示、可以直接重试。
 */
const emit = defineEmits<{
  done: [action: SiteApplicationAction, app: SiteApplication]
  rejected: [action: SiteApplicationAction, app: SiteApplication, reason: string]
}>()
const meStore = useMeStore()

const PRESET_DOCS = ['身份证', '一寸照片', '银行卡', '健康证', '学历证明']

/** 提交失败：轻提示写原因；后端业务拒绝才算「被拒」（断网、超时也包成 ApiError，code 为 NETWORK） */
function failed(action: SiteApplicationAction, app: SiteApplication, e: unknown): { text: string; blocked: boolean } {
  const reason = errorMessage(e)
  ElMessage.error(reason)
  const blocked = isApiError(e) && e.code !== 'NETWORK'
  if (blocked) emit('rejected', action, app, reason)
  return { text: `暂时不能${ACTION_LABEL[action]}：${reason}`, blocked }
}

// ---------------------------------------------------------------- 知悉并推送面试信息
const ack = reactive({
  visible: false,
  saving: false,
  prefilling: false,
  app: null as SiteApplication | null,
  repush: false,
  hint: '',
  /** 提交失败的原因（留在弹窗里）；blocked = 后端拒绝，提交按钮置灰到下次打开 */
  error: '',
  blocked: false,
  form: { interviewAt: '', address: '', routeTips: '', documents: [] as string[], contactName: '', contactPhone: '' },
})
const docOptions = computed(() => Array.from(new Set([...PRESET_DOCS, ...ack.form.documents])))

async function openAck(app: SiteApplication, repush: boolean) {
  ack.app = app
  ack.repush = repush
  ack.hint = ''
  ack.error = ''
  ack.blocked = false
  const existing = parseLocal(app.interviewAt)
  ack.form.interviewAt = toLocalIso(existing && existing.getTime() > shNowMs() ? existing : nextWorkday9())
  ack.form.address = ''
  ack.form.routeTips = ''
  ack.form.documents = ['身份证']
  ack.form.contactName = meStore.me?.name ?? ''
  ack.form.contactPhone = ''
  ack.visible = true
  // 重新推送：预填上次推送的面试信息（地址 / 路线 / 材料 / 联系人），只需改动变化的部分
  const n = app.notice
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
  ack.prefilling = true
  try {
    // 面试地点 / 所需材料默认取岗位信息
    const job = await tenantApi.job(app.jobId)
    if (ack.app?.applicationId !== app.applicationId) return
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
  try {
    const r = await tenantApi.acknowledge(app.applicationId, {
      interviewAt: f.interviewAt,
      address: f.address.trim(),
      routeTips: f.routeTips.trim() || undefined,
      documents: f.documents.length ? f.documents : undefined,
      contactName: f.contactName.trim() || undefined,
      contactPhone: f.contactPhone.trim() || undefined,
    })
    ElMessage.success(ack.repush ? '面试信息已更新并重新推送' : '已知悉，面试信息已推送给求职者')
    ack.visible = false
    emit('done', ack.repush ? 'REPUSH' : 'ACKNOWLEDGE', r)
  } catch (e) {
    ack.saving = false
    const r = failed(ack.repush ? 'REPUSH' : 'ACKNOWLEDGE', app, e)
    ack.error = r.text
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
    const r = failed(cf.resend ? 'RESEND_CONTRACT' : 'CONFIRM', app, e)
    cf.error = r.text
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
 * 确认框里提交：点确认后确认按钮转圈、不能重复点，请求结束（成功或失败）再关框；
 * 失败的错误交回调用方，关框后统一处理。提示文字、按钮和原因输入与原来一致。
 */
function submitIn(api: (input: string) => Promise<unknown>) {
  const state = { error: null as unknown }
  const beforeClose = async (act: Action, box: MessageBoxState, done: () => void) => {
    // 提交中不响应取消、关闭和再次确认
    if (box.confirmButtonLoading) return
    if (act !== 'confirm') return done()
    box.confirmButtonLoading = true
    try {
      await api(box.inputValue?.trim() ?? '')
    } catch (e) {
      state.error = e
    } finally {
      box.confirmButtonLoading = false
      done()
    }
  }
  return { beforeClose, state }
}

async function simple(action: SiteApplicationAction, app: SiteApplication) {
  try {
    if (action === 'ARRIVE') {
      const s = submitIn(() => tenantApi.arrive(app.applicationId))
      await ElMessageBox.confirm(`确认 ${who(app)} 已到厂？`, '到厂确认', { confirmButtonText: '确认到厂', cancelButtonText: '取消', beforeClose: s.beforeClose })
      if (s.state.error) throw s.state.error
      ElMessage.success('已确认到厂')
    } else if (action === 'PASS') {
      const s = submitIn(() => tenantApi.interviewResult(app.applicationId, true))
      await ElMessageBox.confirm(`确认 ${who(app)} 面试通过？通过后进入「待确权」，请尽快完成入职确权与签约。`, '面试通过', {
        confirmButtonText: '面试通过',
        cancelButtonText: '取消',
        beforeClose: s.beforeClose,
      })
      if (s.state.error) throw s.state.error
      ElMessage.success('已标记面试通过，进入待确权')
    } else if (action === 'FAIL') {
      const s = submitIn((remark) => tenantApi.interviewResult(app.applicationId, false, remark))
      await ElMessageBox.prompt(
        `${who(app)} 面试未通过。本公司渠道来的求职者回到「私域待匹配」继续跟进，其他求职者回到公域。`,
        '面试未通过',
        {
          confirmButtonText: '确认未通过',
          cancelButtonText: '取消',
          inputType: 'textarea',
          inputPlaceholder: '请填写未通过原因（必填）',
          inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写未通过原因',
          type: 'warning',
          beforeClose: s.beforeClose,
        },
      )
      if (s.state.error) throw s.state.error
      ElMessage.success('已标记面试未通过')
    } else if (action === 'NO_SHOW') {
      const s = submitIn(() => tenantApi.noShow(app.applicationId))
      await ElMessageBox.confirm(`确认 ${who(app)} 爽约？标记后归属清空，简历释放至全平台公域，此操作不可撤销。`, '标记爽约', {
        type: 'warning',
        confirmButtonText: '确认爽约',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        beforeClose: s.beforeClose,
      })
      if (s.state.error) throw s.state.error
      ElMessage.success('已标记爽约')
    } else if (action === 'CANCEL') {
      const s = submitIn((reason) => tenantApi.cancelApplication(app.applicationId, reason))
      await ElMessageBox.prompt(
        `取消 ${who(app)} 的报名。用户无法自行取消，取消后可重新进入 AI 问薪匹配流程，此操作不可撤销。`,
        '取消报名',
        {
          confirmButtonText: '确认取消',
          cancelButtonText: '返回',
          inputType: 'textarea',
          inputPlaceholder: '请填写取消原因（必填）',
          inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写取消原因',
          type: 'warning',
          beforeClose: s.beforeClose,
        },
      )
      if (s.state.error) throw s.state.error
      ElMessage.success('报名已取消')
    } else {
      return
    }
    emit('done', action, app)
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    failed(action, app, e)
  }
}

function run(action: SiteApplicationAction, app: SiteApplication) {
  if (action === 'ACKNOWLEDGE' || action === 'REPUSH') openAck(app, action === 'REPUSH')
  else if (action === 'CONFIRM' || action === 'RESEND_CONTRACT') openConfirm(app, action === 'RESEND_CONTRACT')
  else simple(action, app)
}

defineExpose({ run })
</script>

<template>
  <!-- 知悉并推送面试信息 -->
  <el-dialog v-model="ack.visible" :title="ack.repush ? '修改面试信息并重新推送' : '知悉并推送面试信息'" width="560px" :close-on-click-modal="false">
    <template v-if="ack.app">
      <div class="ctx">
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
      <p v-if="ack.error" class="form-err dlg-err" role="alert">{{ ack.error }}</p>
      <el-button @click="ack.visible = false">取消</el-button>
      <el-button type="primary" :loading="ack.saving" :disabled="ack.blocked" @click="submitAck">{{ ack.repush ? '重新推送' : '知悉并推送' }}</el-button>
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
        <p v-if="cf.error" class="form-err dlg-err" role="alert">{{ cf.error }}</p>
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
