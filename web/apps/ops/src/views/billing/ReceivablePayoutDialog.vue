<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, opsApi, type CompanyPayee, type MonthlyBill } from '@shitu/api-client'
import { IconInfo } from '@shitu/ui-icons'
import FileUploader, { type FileEntry } from '@/components/FileUploader.vue'
import { isBlocked } from '@/composables/boxSubmit'
import { fmtMoney, todayStr } from '@/utils/format'

/**
 * 登记流转分成已付款（超管 / 财务）：线下对公转账给企业后，在账单上登记这笔付款。
 * 规则同后端：金额固定为账单的应收流转费（一次付清，不用填）；付款日期不晚于今天、不早于账单下发日；回单、流水号、备注选填。
 * 登记后企业会收到通知，不能撤销，所以在弹窗里提交：被拒时原因留在弹窗里并置灰确认按钮，改了内容再放开。
 */
const props = defineProps<{ bill: MonthlyBill | null; companyName: string; payee: CompanyPayee | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()

const saving = ref(false)
const why = ref('')
const formRef = ref<FormInstance>()
const form = reactive<{ paidDate: string; bankRef: string; files: FileEntry[]; remark: string }>({ paidDate: '', bankRef: '', files: [], remark: '' })
watch(form, () => (why.value = ''))

const rules: FormRules = {
  paidDate: [{ required: true, message: '请选择付款日期', trigger: 'change' }],
  bankRef: [{ max: 64, message: '最多 64 字', trigger: 'blur' }],
  remark: [{ max: 255, message: '最多 255 字', trigger: 'blur' }],
}

const issueDate = computed(() => props.bill?.issuedAt?.slice(0, 10) ?? '')
/** 不能选未来，也不能早于账单下发日 */
function disabledDate(d: Date): boolean {
  const p = (n: number) => String(n).padStart(2, '0')
  const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return s > todayStr() || (!!issueDate.value && s < issueDate.value)
}

watch(visible, (v) => {
  if (!v) return
  Object.assign(form, { paidDate: todayStr(), bankRef: '', files: [], remark: '' })
  why.value = ''
  formRef.value?.clearValidate()
})

async function submit() {
  if (!props.bill || saving.value) return
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    await opsApi.registerReceivablePayout(props.bill.billId, {
      paidDate: form.paidDate,
      bankRef: form.bankRef.trim() || undefined,
      voucherKey: form.files[0]?.key,
      remark: form.remark.trim() || undefined,
    })
    ElMessage.success('已登记付款')
    visible.value = false
    emit('done')
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) why.value = `暂时不能登记付款：${errorMessage(e)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog class="dlg-16" v-model="visible" title="登记流转分成付款" width="560px" append-to-body :close-on-click-modal="false">
    <template v-if="bill">
      <dl class="kv-grid one to">
        <div class="kv"><dt>收款企业</dt><dd>{{ companyName || bill.companyId }} · {{ bill.billMonth }} 账单</dd></div>
        <div v-if="payee" class="kv"><dt>收款账户</dt><dd>{{ payee.accountName }} · {{ payee.bankName }} · <span class="mono">{{ payee.accountNo }}</span></dd></div>
      </dl>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="144px" @submit.prevent>
        <el-form-item label="付款金额">
          <el-input :model-value="`${fmtMoney(bill.transferReceivable)} 元`" disabled />
        </el-form-item>
        <el-form-item label="付款日期" prop="paidDate">
          <el-date-picker v-model="form.paidDate" type="date" value-format="YYYY-MM-DD" :disabled-date="disabledDate" :clearable="false" placeholder="选择付款日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="银行流水号（选填）" prop="bankRef">
          <el-input v-model="form.bankRef" maxlength="64" placeholder="转账回单上的流水号" />
        </el-form-item>
        <el-form-item label="付款回单（选填）">
          <FileUploader v-model="form.files" :upload="opsApi.upload" :limit="1" hint="转账回单或截图，JPG / PNG / PDF，≤ 10MB" />
        </el-form-item>
        <el-form-item label="备注（选填）" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="255" show-word-limit placeholder="需要企业了解的其他情况" />
        </el-form-item>
      </el-form>
      <div class="notice-bar notice-bar--warn">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>请确认已经向上面的账户转账 {{ fmtMoney(bill.transferReceivable) }} 元。登记后会通知企业流转分成已付款，<b>不可撤销</b>。</span>
      </div>
      <p v-if="why" class="blocked-why why" role="alert">{{ why }}</p>
    </template>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!bill || !!why" @click="submit">确认已付款</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.to { margin-bottom: var(--space-4); }
.why { margin-top: var(--space-3); }
</style>
