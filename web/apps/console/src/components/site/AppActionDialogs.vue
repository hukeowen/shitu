<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  errorMessage,
  tenantApi,
  type LaborContractView,
  type SiteApplication,
  type SiteApplicationAction,
} from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import QrImage from '@/components/QrImage.vue'
import { useMeStore } from '@/stores/me'
import { copyText, fmtDate, fmtDateTime, fmtPhone, PHONE_RE } from '@/utils/format'
import { addDays, nextWorkday9, parseLocal, toLocalIso, ymd } from '@/utils/time'

/**
 * 报名操作弹窗（A-02 / A-03 / A-04 共用）。页面放一个实例，按钮点击后调用 run(action, app)。
 * 知悉推送 / 修改面试信息、到厂确认、面试通过 / 未通过、爽约、取消、确权签约 / 重发签约。
 */
const emit = defineEmits<{ done: [action: SiteApplicationAction, app: SiteApplication] }>()
const meStore = useMeStore()

const PRESET_DOCS = ['身份证', '一寸照片', '银行卡', '健康证', '学历证明']

// ---------------------------------------------------------------- 知悉并推送面试信息
const ack = reactive({
  visible: false,
  saving: false,
  prefilling: false,
  app: null as SiteApplication | null,
  repush: false,
  hint: '',
  form: { interviewAt: '', address: '', routeTips: '', documents: [] as string[], contactName: '', contactPhone: '' },
})
const docOptions = computed(() => Array.from(new Set([...PRESET_DOCS, ...ack.form.documents])))

async function openAck(app: SiteApplication, repush: boolean) {
  ack.app = app
  ack.repush = repush
  ack.hint = ''
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
  ack.saving = true
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
    ElMessage.error(errorMessage(e))
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
})

function openConfirm(app: SiteApplication, resend: boolean) {
  const today = shNow()
  cf.app = app
  cf.resend = resend
  cf.result = null
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
  try {
    cf.result = await tenantApi.confirmOnboard(app.applicationId, {
      startDate: f.startDate,
      employeeNo: f.employeeNo.trim() || undefined,
      termEnd: f.termEnd || undefined,
    })
    ElMessage.success(cf.resend ? '已重新发起电子签约' : '确权完成，已发起电子签约')
    emit('done', cf.resend ? 'RESEND_CONTRACT' : 'CONFIRM', app)
  } catch (e) {
    ElMessage.error(errorMessage(e))
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

async function simple(action: SiteApplicationAction, app: SiteApplication) {
  try {
    if (action === 'ARRIVE') {
      await ElMessageBox.confirm(`确认 ${who(app)} 已到厂？`, '到厂确认', { confirmButtonText: '确认到厂', cancelButtonText: '取消' })
      await tenantApi.arrive(app.applicationId)
      ElMessage.success('已确认到厂')
    } else if (action === 'PASS') {
      await ElMessageBox.confirm(`确认 ${who(app)} 面试通过？通过后进入「待确权」，请尽快完成入职确权与签约。`, '面试通过', {
        confirmButtonText: '面试通过',
        cancelButtonText: '取消',
      })
      await tenantApi.interviewResult(app.applicationId, true)
      ElMessage.success('已标记面试通过，进入待确权')
    } else if (action === 'FAIL') {
      const { value } = await ElMessageBox.prompt(
        `${who(app)} 面试未通过。本公司渠道来的求职者回到「私域待匹配」继续跟进，其他求职者回到公域。`,
        '面试未通过',
        {
          confirmButtonText: '确认未通过',
          cancelButtonText: '取消',
          inputType: 'textarea',
          inputPlaceholder: '请填写未通过原因（必填）',
          inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写未通过原因',
          type: 'warning',
        },
      )
      await tenantApi.interviewResult(app.applicationId, false, value.trim())
      ElMessage.success('已标记面试未通过')
    } else if (action === 'NO_SHOW') {
      await ElMessageBox.confirm(`确认 ${who(app)} 爽约？标记后归属清空，简历释放至全平台公域，此操作不可撤销。`, '标记爽约', {
        type: 'warning',
        confirmButtonText: '确认爽约',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      })
      await tenantApi.noShow(app.applicationId)
      ElMessage.success('已标记爽约')
    } else if (action === 'CANCEL') {
      const { value } = await ElMessageBox.prompt(
        `取消 ${who(app)} 的报名。用户无法自行取消，取消后可重新进入 AI 问薪匹配流程，此操作不可撤销。`,
        '取消报名',
        {
          confirmButtonText: '确认取消',
          cancelButtonText: '返回',
          inputType: 'textarea',
          inputPlaceholder: '请填写取消原因（必填）',
          inputValidator: (v: string) => (v && v.trim().length > 0) || '请填写取消原因',
          type: 'warning',
        },
      )
      await tenantApi.cancelApplication(app.applicationId, value.trim())
      ElMessage.success('报名已取消')
    } else {
      return
    }
    emit('done', action, app)
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(errorMessage(e))
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
        <span class="mono t-sm">{{ fmtPhone(ack.app.phone) }}</span>
        <span class="t-sm">{{ ack.app.jobTitle }} · {{ ack.app.projectName }}</span>
      </div>
      <div class="note note--info" style="margin-bottom: 14px">提交后通过短信 + 站内信推送给求职者，可重复推送，以最后一次为准。</div>
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
        <div v-if="ack.hint" class="t-xs">{{ ack.hint }}</div>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="ack.visible = false">取消</el-button>
      <el-button type="primary" :loading="ack.saving" @click="submitAck">{{ ack.repush ? '重新推送' : '知悉并推送' }}</el-button>
    </template>
  </el-dialog>

  <!-- 确权签约 / 重发签约 -->
  <el-dialog v-model="cf.visible" :title="cf.resend ? '重发电子签约' : '入职确权并发起电子签约'" width="560px" :close-on-click-modal="false">
    <template v-if="cf.app">
      <div class="ctx">
        <b>{{ cf.app.seekerName }}</b>
        <span class="mono t-sm">{{ fmtPhone(cf.app.phone) }}</span>
        <span class="t-sm">{{ cf.app.jobTitle }} · {{ cf.app.projectName }}</span>
      </div>
      <template v-if="!cf.result">
        <template v-if="cf.resend">
          <div v-if="cf.app.contract?.signUrl" class="sign" style="margin: 0 0 14px">
            <QrImage :url="cf.app.contract.signUrl" :size="104" />
            <div class="sign-r">
              <div class="eyebrow">当前签署链接 · <DictTag type="ContractStatus" :value="cf.app.contract.status" /></div>
              <div class="mono t-sm link">{{ cf.app.contract.signUrl }}</div>
              <div class="row" style="margin-top: 8px">
                <el-button size="small" type="primary" @click="copySign(cf.app.contract.signUrl)">复制链接</el-button>
                <span class="t-xs">发起于 {{ fmtDateTime(cf.app.contract.createdAt) }} · 链接仍有效时无需重发</span>
              </div>
            </div>
          </div>
          <div class="note note--warn" style="margin-bottom: 14px">该报名已有待签署的电子合同。重发将作废旧流程并生成新的签署链接（旧链接失效）。</div>
        </template>
        <div v-else class="note" style="margin-bottom: 14px">
          确权是<b>唯一数据统计节点</b>：完成后写入归属、锁定匹配范围（仅本公司内部调岗），并开始计费；随后生成电子劳动合同推送求职者签署，签署完成即「已入职在岗」。
          <template v-if="cf.app.fromPublic"><br />该用户报名前为<b>公域</b>，确权后归属写入本公司、标签变为私域。</template>
        </div>
        <el-form label-width="96px" @submit.prevent>
          <el-form-item label="入职日期" required>
            <el-date-picker v-model="cf.form.startDate" type="date" value-format="YYYY-MM-DD" :disabled-date="disableStart" :clearable="false" style="width: 100%" />
            <div class="t-xs">可选近 3 天到未来 30 天</div>
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
        <div class="note note--ok" style="margin-bottom: 14px">电子合同已生成并推送给求职者，签署完成后状态自动变为「已入职在岗」。</div>
        <dl class="kv"><dt>合同编号</dt><dd class="mono">{{ cf.result.contractNo }}</dd></dl>
        <dl class="kv"><dt>合同名称</dt><dd>{{ cf.result.title }}</dd></dl>
        <dl class="kv"><dt>合同期限</dt><dd class="mono">{{ fmtDate(cf.result.termStart) }} ~ {{ fmtDate(cf.result.termEnd) }}</dd></dl>
        <dl class="kv"><dt>状态</dt><dd><DictTag type="ContractStatus" :value="cf.result.status" /></dd></dl>
        <dl class="kv"><dt>生成时间</dt><dd class="mono">{{ fmtDateTime(cf.result.createdAt) }}</dd></dl>
        <div v-if="cf.result.signUrl" class="sign">
          <QrImage :url="cf.result.signUrl" :size="112" />
          <div class="sign-r">
            <div class="eyebrow">签署链接</div>
            <div class="mono t-sm link">{{ cf.result.signUrl }}</div>
            <div class="row" style="margin-top: 8px">
              <el-button size="small" type="primary" @click="copySign()">复制链接</el-button>
              <span class="t-xs">可发给求职者或现场扫码签署</span>
            </div>
          </div>
        </div>
      </template>
    </template>
    <template #footer>
      <template v-if="!cf.result">
        <el-button @click="cf.visible = false">取消</el-button>
        <el-button type="primary" :loading="cf.saving" @click="submitConfirm">{{ cf.resend ? '重发签约' : '确认入职并发起电子签约' }}</el-button>
      </template>
      <el-button v-else type="primary" @click="cf.visible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ctx { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.ctx b { font-size: 15px; color: var(--ink-900); }
.sign { display: flex; gap: 14px; margin-top: 14px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-2); }
.sign-r { flex: 1; min-width: 0; }
.link { word-break: break-all; margin-top: 4px; color: var(--ink-700); }
</style>
