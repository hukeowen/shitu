<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type ClientView } from '@shitu/api-client'
import { CREDIT_CODE_RE } from '@/utils/format'

/** 甲方企业选择：远程搜索 + 找不到时新建（同名甲方后端会复用已有记录） */
const props = withDefaults(defineProps<{ disabled?: boolean; initialName?: string; allowCreate?: boolean }>(), {
  disabled: false,
  initialName: '',
  allowCreate: true,
})
const model = defineModel<string>({ default: '' })
const emit = defineEmits<{ change: [client: ClientView | undefined] }>()

const options = ref<ClientView[]>([])
const loading = ref(false)
const lastQuery = ref('')

async function search(q: string) {
  lastQuery.value = q
  loading.value = true
  try {
    const list = await tenantApi.clients(q.trim() || undefined)
    // 保留当前选中项，避免搜索后显示成 id
    const cur = options.value.find((c) => c.clientId === model.value)
    options.value = cur && !list.some((c) => c.clientId === cur.clientId) ? [cur, ...list] : list
  } catch (e) {
    ElMessage.error(errorMessage(e, '甲方企业加载失败'))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (model.value && props.initialName) options.value = [{ clientId: model.value, name: props.initialName }]
  if (!props.disabled) await search('')
})

function onChange(v: string) {
  emit('change', options.value.find((c) => c.clientId === v))
}

// ---------------------------------------------------------------- 新建
const creating = reactive({ visible: false, saving: false })
const formRef = ref<FormInstance>()
const form = reactive({ name: '', city: '', unifiedCreditCode: '' })
const rules: FormRules = {
  name: [
    { required: true, message: '请填写甲方企业全称', trigger: 'blur' },
    { min: 4, max: 100, message: '请填写完整的企业全称', trigger: 'blur' },
  ],
  unifiedCreditCode: [
    {
      validator: (_r, v: string, cb) => (!v || CREDIT_CODE_RE.test(v.trim().toUpperCase()) ? cb() : cb(new Error('统一社会信用代码格式不正确'))),
      trigger: 'blur',
    },
  ],
}

function openCreate() {
  Object.assign(form, { name: lastQuery.value.trim(), city: '', unifiedCreditCode: '' })
  creating.visible = true
}

async function create() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  creating.saving = true
  try {
    const c = await tenantApi.createClient({
      name: form.name.trim(),
      city: form.city.trim() || undefined,
      unifiedCreditCode: form.unifiedCreditCode.trim().toUpperCase() || undefined,
    })
    options.value = [c, ...options.value.filter((x) => x.clientId !== c.clientId)]
    model.value = c.clientId
    emit('change', c)
    creating.visible = false
    ElMessage.success('甲方企业已添加')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    creating.saving = false
  }
}
</script>

<template>
  <div class="client-select">
    <el-select
      v-model="model"
      filterable
      remote
      :remote-method="search"
      :loading="loading"
      :disabled="disabled"
      placeholder="搜索甲方企业名称"
      no-data-text="没有匹配的甲方企业"
      style="width: 100%"
      @change="onChange"
    >
      <el-option v-for="c in options" :key="c.clientId" :label="c.name" :value="c.clientId">
        <span>{{ c.name }}</span>
        <span v-if="c.city" class="t-xs" style="float: right">{{ c.city }}</span>
      </el-option>
    </el-select>
    <div v-if="allowCreate && !disabled" class="t-xs" style="margin-top: 4px">
      找不到？<el-button link type="primary" size="small" @click="openCreate">新建甲方企业</el-button>
    </div>

    <el-dialog v-model="creating.visible" title="新建甲方企业" width="440px" append-to-body :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="企业全称" prop="name"><el-input v-model="form.name" maxlength="100" placeholder="与合同上的甲方名称一致" /></el-form-item>
        <el-form-item label="所在城市"><el-input v-model="form.city" maxlength="20" placeholder="如：苏州" /></el-form-item>
        <el-form-item label="统一信用代码" prop="unifiedCreditCode"><el-input v-model="form.unifiedCreditCode" maxlength="18" placeholder="选填" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="creating.visible = false">取消</el-button>
        <el-button type="primary" :loading="creating.saving" @click="create">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.client-select { width: 100%; }
</style>
