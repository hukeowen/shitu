<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type MonthlyBill, type TenantBillDetail, type UploadedFile } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import FileUploader, { type FileEntry } from '@/components/FileUploader.vue'
import { isBlocked } from '@/composables/boxSubmit'
import { useMeStore } from '@/stores/me'
import { copyText, fmtYuan, toNum } from '@/utils/format'
import { shNow, ymd } from '@/utils/time'
import { payLabel } from './billPayment'

/**
 * 提交付款凭证（老板）：先看平台收款账户和应付金额，线下对公转账后填付款信息、上传凭证，平台核对到账后账单结清。
 * 规则同后端：金额等于应付合计（一次付清）、付款日期不晚于今天且不早于下发日、同一张账单同时只能有一笔待确认。
 */
const props = defineProps<{ bill: MonthlyBill | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()
const me = useMeStore()

const detail = ref<TenantBillDetail | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
/** 后端拒绝的原因：留在弹窗里并置灰「提交凭证」，改了内容再放开 */
const why = ref('')
const fileError = ref('')
const formRef = ref<FormInstance>()
const form = reactive<{ paidDate: string; payerName: string; bankRef: string; files: FileEntry[]; remark: string }>({
  paidDate: '',
  payerName: '',
  bankRef: '',
  files: [],
  remark: '',
})
watch(form, () => (why.value = ''))

const rules: FormRules = {
  paidDate: [{ required: true, message: '请选择付款日期', trigger: 'change' }],
  payerName: [
    { required: true, whitespace: true, message: '请填写付款户名', trigger: 'blur' },
    { max: 100, message: '最多 100 字', trigger: 'blur' },
  ],
  bankRef: [{ max: 64, message: '最多 64 字', trigger: 'blur' }],
  remark: [{ max: 255, message: '最多 255 字', trigger: 'blur' }],
}

/** 以详情里的账单为准（列表可能是旧的），详情没到时先用列表行 */
const cur = computed(() => detail.value?.bill ?? props.bill)
const payable = computed(() => toNum(cur.value?.payable))
const title = computed(() => payLabel(cur.value))
/** 最近一笔凭证被退回：原因写在弹窗最上面 */
const rejected = computed(() => {
  const last = detail.value?.payments[0]
  return last?.status === 'REJECTED' ? last : null
})

const isPlaceholder = (v?: string | null) => !v || !v.trim() || v.trim().startsWith('（请')
const payee = computed(() => {
  const p = detail.value?.payee
  return [
    { key: 'name', label: '户名', value: p?.name },
    { key: 'bank', label: '开户行', value: p?.bank },
    { key: 'account', label: '账号', value: p?.account },
  ].map((it) => ({ ...it, missing: isPlaceholder(it.value) }))
})
const payeeMissing = computed(() => !!detail.value && payee.value.some((it) => it.missing))

async function copy(label: string, value?: string) {
  if (!value) return
  if (await copyText(value)) ElMessage.success(`${label}已复制`)
  else ElMessage.error('复制失败，请手动复制')
}

const today = () => ymd(shNow())
const issueDate = computed(() => cur.value?.issuedAt?.slice(0, 10) ?? '')
/** 不能选未来，也不能早于账单下发日 */
function disabledDate(d: Date): boolean {
  const s = ymd(d)
  return s > today() || (!!issueDate.value && s < issueDate.value)
}

async function load() {
  if (!props.bill) return
  loading.value = true
  loadError.value = ''
  try {
    detail.value = await tenantApi.bill(props.bill.billId)
  } catch (e) {
    detail.value = null
    loadError.value = errorMessage(e, '收款账户加载失败')
  } finally {
    loading.value = false
  }
}

watch(visible, (v) => {
  if (!v) return
  detail.value = null
  Object.assign(form, { paidDate: today(), payerName: me.me?.company.name ?? '', bankRef: '', files: [], remark: '' })
  fileError.value = ''
  why.value = ''
  formRef.value?.clearValidate()
  load()
})

function upload(file: File): Promise<UploadedFile> {
  return tenantApi.upload(file, 'payment')
}

async function submit() {
  if (!cur.value || saving.value) return
  const ok = await formRef.value?.validate().catch(() => false)
  fileError.value = form.files.length ? '' : '请上传付款凭证'
  if (!ok || fileError.value) return
  saving.value = true
  try {
    await tenantApi.submitBillPayment(cur.value.billId, {
      amount: payable.value,
      paidDate: form.paidDate,
      payerName: form.payerName.trim(),
      bankRef: form.bankRef.trim() || undefined,
      voucherKey: form.files[0].key,
      remark: form.remark.trim() || undefined,
    })
    ElMessage.success('付款凭证已提交，等待平台确认到账')
    visible.value = false
    emit('done')
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) why.value = `暂时不能提交凭证：${errorMessage(e)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="560px" :close-on-click-modal="false">
    <div v-loading="loading" class="wrap">
      <div v-if="loadError" class="state-box">
        <IconCircleExclamationPoint :size="48" />
        <h4>{{ loadError }}</h4>
        <p>请检查网络后重新加载</p>
        <el-button @click="load">重新加载</el-button>
      </div>
      <template v-else-if="detail && cur">
        <div v-if="rejected" class="notice-bar notice-bar--danger tip" role="alert">
          <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
          <span><b>上次提交的凭证被退回：</b>{{ rejected.reviewRemark || '平台未填写原因' }}。请核对后重新提交。</span>
        </div>

        <section class="payee">
          <h4 class="blk-t">平台收款账户<small>请对公转账到以下账户，一次付清</small></h4>
          <dl>
            <div v-for="it in payee" :key="it.key" class="kv">
              <dt>{{ it.label }}</dt>
              <dd>
                <span :class="{ missing: it.missing }">{{ it.value || '—' }}</span>
                <el-button v-if="!it.missing" link type="primary" size="small" class="cp" :aria-label="`复制${it.label}`" @click="copy(it.label, it.value)">复制</el-button>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ cur.billMonth }} 账单应付金额</dt>
              <dd><span class="money">{{ fmtYuan(payable) }}</span></dd>
            </div>
          </dl>
          <div v-if="payeeMissing" class="notice-bar notice-bar--warn payee-warn" role="alert">
            <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
            <span>平台尚未配置收款账户，请先联系平台确认收款账户后再付款。已按双方约定的方式付款的，可以直接提交凭证。</span>
          </div>
        </section>

        <div class="notice-bar tip">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>转账完成后填写付款信息并上传凭证。平台核对到账后，账单变为「已结算」。</span>
        </div>
        <el-form ref="formRef" :model="form" :rules="rules" label-width="144px">
          <el-form-item label="付款金额">
            <el-input :model-value="fmtYuan(payable)" disabled />
          </el-form-item>
          <el-form-item label="付款日期" prop="paidDate">
            <el-date-picker v-model="form.paidDate" type="date" value-format="YYYY-MM-DD" :disabled-date="disabledDate" :clearable="false" placeholder="选择付款日期" style="width: 100%" />
          </el-form-item>
          <el-form-item label="付款户名" prop="payerName">
            <el-input v-model="form.payerName" maxlength="100" placeholder="付款银行账户的户名" />
          </el-form-item>
          <el-form-item label="银行流水号（选填）" prop="bankRef">
            <el-input v-model="form.bankRef" maxlength="64" placeholder="转账回单上的流水号" />
          </el-form-item>
          <el-form-item label="付款凭证" required :error="fileError">
            <FileUploader v-model="form.files" :upload="upload" :limit="1" viewable hint="转账回单或截图，JPG / PNG / PDF，≤ 10MB" @update:model-value="fileError = ''" />
          </el-form-item>
          <el-form-item label="备注（选填）" prop="remark">
            <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="255" show-word-limit placeholder="需要平台了解的其他情况" />
          </el-form-item>
        </el-form>
        <p v-if="why" class="blocked-why" role="alert">{{ why }}</p>
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!detail || !!why" @click="submit">提交凭证</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.wrap { min-height: 160px; }
.tip { margin-bottom: var(--space-4); }
.payee { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); }
.payee dl { margin: 0; }
.payee dd { display: inline-flex; align-items: center; gap: var(--space-2); }
.payee .missing { color: var(--text-3); font-weight: var(--font-weight-regular); }
.cp { flex: none; }
.payee-warn { margin-top: var(--space-3); }
</style>
