<script setup lang="ts">
import { computed, ref } from 'vue'
import { showToast } from 'vant'

/** 驻场登录：租户成员账号，手机号 + 短信验证码。接口在 Sprint 1 接入 */
const phone = ref('')
const code = ref('')
const canSubmit = computed(() => /^1\d{10}$/.test(phone.value) && /^\d{6}$/.test(code.value))

function submit() {
  if (!canSubmit.value) return
  // TODO(Sprint 1): POST /tenant/auth/login { phone, code }
  showToast('登录接口将在 Sprint 1 接入')
}
</script>

<template>
  <div class="login">
    <h2>仕兔驻场</h2>
    <p class="sub">劳务公司成员账号登录</p>
    <van-cell-group inset>
      <van-field v-model="phone" type="tel" maxlength="11" label="手机号" placeholder="请输入手机号" />
      <van-field v-model="code" type="digit" maxlength="6" label="验证码" placeholder="6 位短信验证码" />
    </van-cell-group>
    <div class="actions">
      <van-button type="primary" block round :disabled="!canSubmit" @click="submit">登录</van-button>
    </div>
  </div>
</template>

<style scoped>
.login { padding-top: 48px; }
h2 { margin: 0 16px 4px; font-size: 24px; color: var(--ink-900); }
.sub { margin: 0 16px 20px; font-size: 13px; color: var(--ink-500); }
.actions { padding: 20px 16px; }
</style>
