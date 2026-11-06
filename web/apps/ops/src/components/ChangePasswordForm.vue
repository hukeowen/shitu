<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { errorMessage, opsApi } from '@shitu/api-client'

/** 修改密码表单（强制改密 / 主动改密共用）。成功后服务端吊销全部会话，由父组件清理登录态。 */
withDefaults(defineProps<{ submitText?: string; showCancel?: boolean }>(), { submitText: '确认修改', showCancel: false })
const emit = defineEmits<{ success: []; cancel: [] }>()

const PWD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/

const formRef = ref<FormInstance>()
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const submitting = ref(false)
const error = ref('')

const rules: FormRules<typeof form> = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      validator: (_r, v: string, cb) => {
        if (!PWD_RULE.test(v)) cb(new Error('至少 8 位，且同时包含字母和数字'))
        else if (v === form.oldPassword) cb(new Error('新密码不能与当前密码相同'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, v: string, cb) => (v !== form.newPassword ? cb(new Error('两次输入的新密码不一致')) : cb()),
      trigger: 'blur',
    },
  ],
}

async function submit() {
  error.value = ''
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  submitting.value = true
  try {
    await opsApi.changePassword(form.oldPassword, form.newPassword)
    emit('success')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
    <el-form-item label="当前密码" prop="oldPassword">
      <el-input v-model="form.oldPassword" type="password" show-password autocomplete="current-password" placeholder="请输入当前密码（或初始密码）" />
    </el-form-item>
    <el-form-item label="新密码" prop="newPassword">
      <el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password" maxlength="64" placeholder="至少 8 位，包含字母和数字" />
    </el-form-item>
    <el-form-item label="确认新密码" prop="confirm">
      <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" maxlength="64" placeholder="再次输入新密码" />
    </el-form-item>
    <div v-if="error" class="notice notice--danger err">{{ error }}</div>
    <div class="acts">
      <el-button v-if="showCancel" @click="emit('cancel')">取消</el-button>
      <el-button type="primary" native-type="submit" :loading="submitting" :class="{ block: !showCancel }">{{ submitText }}</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.err { margin-bottom: 14px; }
.acts { display: flex; justify-content: flex-end; gap: 8px; }
.block { width: 100%; height: 38px; }
</style>
