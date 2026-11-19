<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type CompanyPayee } from '@shitu/api-client'
import { IconInfo } from '@shitu/ui-icons'
import { isBlocked } from '@/composables/boxSubmit'
import { useMeStore } from '@/stores/me'

/**
 * 登记 / 修改公司收款账户（老板）：平台把流转分成（账单上的流转费应收）对公转账到这个账户。
 * 规则同后端：户名、开户行 2–100 字；账号 8–30 位数字（空格、短横线提交前去掉）。
 */
const props = defineProps<{ payee: CompanyPayee | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [payee: CompanyPayee] }>()
const me = useMeStore()

const saving = ref(false)
/** 后端拒绝的原因：留在弹窗里并置灰「保存」，改了内容再放开 */
const why = ref('')
const formRef = ref<FormInstance>()
const form = reactive({ accountName: '', bankName: '', accountNo: '' })
watch(form, () => (why.value = ''))

const title = computed(() => (props.payee ? '修改收款账户' : '登记收款账户'))
/** 账号可以带空格或短横线分段填，校验和提交都按去掉之后的算 */
const digits = (v: string) => v.replace(/[\s-]/g, '')

const lenRule = (label: string) => (_: unknown, v: string, cb: (e?: Error) => void) => {
  const n = (v ?? '').trim().length
  if (!n) return cb(new Error(`请填写${label}`))
  if (n < 2 || n > 100) return cb(new Error(`${label}为 2–100 个字`))
  cb()
}
const rules: FormRules = {
  accountName: [{ required: true, validator: lenRule('收款户名'), trigger: 'blur' }],
  bankName: [{ required: true, validator: lenRule('开户行'), trigger: 'blur' }],
  accountNo: [
    {
      required: true,
      trigger: 'blur',
      validator: (_: unknown, v: string, cb: (e?: Error) => void) => {
        const no = digits(v ?? '')
        if (!no) return cb(new Error('请填写收款账号'))
        if (!/^\d{8,30}$/.test(no)) return cb(new Error('收款账号为 8–30 位数字'))
        cb()
      },
    },
  ],
}

watch(visible, (v) => {
  if (!v) return
  Object.assign(form, {
    accountName: props.payee?.accountName ?? me.me?.company.name ?? '',
    bankName: props.payee?.bankName ?? '',
    accountNo: props.payee?.accountNo ?? '',
  })
  why.value = ''
  formRef.value?.clearValidate()
})

async function submit() {
  if (saving.value) return
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    const saved = await tenantApi.savePayee({ accountName: form.accountName.trim(), bankName: form.bankName.trim(), accountNo: digits(form.accountNo) })
    ElMessage.success('收款账户已保存')
    visible.value = false
    emit('saved', saved)
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) why.value = `暂时不能保存：${errorMessage(e)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="520px" :close-on-click-modal="false">
    <div class="notice-bar tip">
      <IconInfo :size="16" class="notice-bar-i" />
      <span>平台把流转分成（账单上的「流转费应收」）对公转账到这个账户。修改后，之后的付款按新账户付，已经付过的不受影响。</span>
    </div>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" @submit.prevent>
      <el-form-item label="收款户名" prop="accountName">
        <el-input v-model="form.accountName" maxlength="100" placeholder="收款银行账户的户名，一般是公司全称" />
      </el-form-item>
      <el-form-item label="开户行" prop="bankName">
        <el-input v-model="form.bankName" maxlength="100" placeholder="请写到支行，如：中国工商银行上海市浦东分行张江支行" />
      </el-form-item>
      <el-form-item label="收款账号" prop="accountNo">
        <el-input v-model="form.accountNo" maxlength="40" inputmode="numeric" placeholder="8–30 位数字" />
      </el-form-item>
    </el-form>
    <p v-if="why" class="blocked-why" role="alert">{{ why }}</p>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!!why" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tip { margin-bottom: var(--space-4); }
</style>
