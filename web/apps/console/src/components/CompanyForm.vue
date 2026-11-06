<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import type { ApplyCompanyRequest, CompanyView, UploadedFile } from '@shitu/api-client'
import FileUploader, { type FileEntry } from './FileUploader.vue'
import { CREDIT_CODE_RE } from '@/utils/format'

/** 入驻资料表单：首次申请（入驻票据上传）与驳回后重新提交（登录态上传）共用 */
const props = withDefaults(
  defineProps<{
    upload: (file: File) => Promise<UploadedFile>
    initial?: CompanyView | null
    viewable?: boolean
  }>(),
  { initial: null, viewable: false },
)

const formRef = ref<FormInstance>()
const form = reactive({
  name: props.initial?.name ?? '',
  shortName: props.initial?.shortName ?? '',
  unifiedCreditCode: props.initial?.unifiedCreditCode ?? '',
  dispatchLicenseNo: props.initial?.dispatchLicenseNo ?? '',
  contactName: props.initial?.contactName ?? '',
})
const files = ref<FileEntry[]>((props.initial?.licenseFiles ?? []).map((key, i) => ({ key, name: `已提交文件 ${i + 1}` })))

const rules: FormRules = {
  name: [
    { required: true, message: '请填写营业执照上的公司全称', trigger: 'blur' },
    { min: 4, max: 100, message: '公司全称 4–100 个字', trigger: 'blur' },
  ],
  shortName: [{ max: 20, message: '简称最多 20 个字', trigger: 'blur' }],
  unifiedCreditCode: [
    { required: true, message: '请填写统一社会信用代码', trigger: 'blur' },
    {
      validator: (_r, v: string, cb) => (CREDIT_CODE_RE.test((v ?? '').trim().toUpperCase()) ? cb() : cb(new Error('请填写 18 位统一社会信用代码'))),
      trigger: 'blur',
    },
  ],
  contactName: [{ required: true, message: '请填写联系人', trigger: 'blur' }],
}

const fileError = ref('')

async function collect(): Promise<ApplyCompanyRequest | null> {
  const ok = await formRef.value?.validate().catch(() => false)
  fileError.value = files.value.length ? '' : '请上传营业执照（劳务派遣许可证如有一并上传）'
  if (!ok || fileError.value) return null
  return {
    name: form.name.trim(),
    shortName: form.shortName.trim() || undefined,
    unifiedCreditCode: form.unifiedCreditCode.trim().toUpperCase(),
    dispatchLicenseNo: form.dispatchLicenseNo.trim() || undefined,
    contactName: form.contactName.trim(),
    licenseFiles: files.value.map((f) => f.key),
  }
}

defineExpose({ collect })
</script>

<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="company-form">
    <div class="grid g-2" style="gap: 0 16px">
      <el-form-item label="公司全称" prop="name">
        <el-input v-model="form.name" maxlength="100" placeholder="与营业执照一致" />
      </el-form-item>
      <el-form-item label="公司简称" prop="shortName">
        <el-input v-model="form.shortName" maxlength="20" placeholder="求职者端展示，如：鑫诚劳务" />
      </el-form-item>
      <el-form-item label="统一社会信用代码" prop="unifiedCreditCode">
        <el-input v-model="form.unifiedCreditCode" maxlength="18" show-word-limit placeholder="18 位" class="mono-input" />
      </el-form-item>
      <el-form-item label="劳务派遣许可证编号" prop="dispatchLicenseNo">
        <el-input v-model="form.dispatchLicenseNo" maxlength="50" placeholder="如有请填写" />
      </el-form-item>
      <el-form-item label="联系人" prop="contactName">
        <el-input v-model="form.contactName" maxlength="20" placeholder="负责对接平台的联系人姓名" />
      </el-form-item>
    </div>
    <el-form-item label="营业执照 / 劳务派遣许可证" required :error="fileError">
      <FileUploader v-model="files" :upload="upload" :limit="6" :viewable="viewable" @update:model-value="fileError = ''" />
    </el-form-item>
  </el-form>
</template>

<style scoped>
.mono-input :deep(input) { font-family: var(--f-mono); letter-spacing: .04em; }
</style>
