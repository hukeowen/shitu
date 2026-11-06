<script setup lang="ts">
import { reactive } from 'vue'
import { APP_TITLE } from '@/router/menu'

/** 后台登录：手机号 + 短信验证码。接口在 Sprint 1 接入 */
const form = reactive({ phone: '', code: '' })

function submit() {
  // TODO(Sprint 1): 调用登录接口
}
</script>

<template>
  <div class="login">
    <el-card class="box" shadow="never">
      <h2>{{ APP_TITLE }}</h2>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="手机号">
          <el-input v-model="form.phone" maxlength="11" placeholder="请输入手机号" />
        </el-form-item>
        <el-form-item label="短信验证码">
          <el-input v-model="form.code" maxlength="6" placeholder="6 位验证码" />
        </el-form-item>
        <el-button type="primary" native-type="submit" class="btn">登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; background: var(--paper); }
.box { width: 360px; }
h2 { margin: 0 0 16px; font-family: var(--f-dis); }
.btn { width: 100%; }
</style>
