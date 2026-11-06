<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { readChannel } from '@/stores/channel'

/** S-04 手机号注册（无密码）。接口在 Sprint 1 接入 identity 模块 */
const router = useRouter()
const phone = ref('')
const code = ref('')
const agreed = ref(false)
const countdown = ref(0)
const channelCode = readChannel()
let timer: ReturnType<typeof setInterval> | undefined

const phoneValid = computed(() => /^1\d{10}$/.test(phone.value))
const canSubmit = computed(() => phoneValid.value && /^\d{6}$/.test(code.value) && agreed.value)

function sendCode() {
  if (!phoneValid.value) {
    showToast('请输入正确的手机号')
    return
  }
  // TODO(Sprint 1): POST /seeker/auth/sms-code（含图形验证码）
  countdown.value = 60
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) clearInterval(timer)
  }, 1000)
}

function submit() {
  if (!canSubmit.value) return
  // TODO(Sprint 1): POST /seeker/auth/login { phone, code, channelCode }
  showToast('注册接口将在 Sprint 1 接入')
}

onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="login">
    <van-nav-bar title="手机号注册" left-arrow @click-left="router.back()" />
    <div class="body">
      <h2>手机号注册</h2>
      <p class="sub">注册即生成唯一用户 ID，无需设置密码</p>
      <van-cell-group inset>
        <van-field v-model="phone" type="tel" maxlength="11" label="+86" placeholder="请输入手机号" />
        <van-field v-model="code" type="digit" maxlength="6" label="验证码" placeholder="6 位短信验证码">
          <template #button>
            <van-button size="small" type="primary" plain :disabled="countdown > 0" @click="sendCode">
              {{ countdown > 0 ? countdown + 's' : '获取验证码' }}
            </van-button>
          </template>
        </van-field>
      </van-cell-group>
      <p v-if="channelCode" class="channel">
        来源渠道：<span class="mono">{{ channelCode }}</span>（注册后按渠道锁定归属）
      </p>
      <van-checkbox v-model="agreed" shape="square" class="agree">
        我已阅读并同意《仕兔用户协议》《隐私政策》，理解平台仅提供匹配服务、不直接雇佣。
      </van-checkbox>
      <div class="actions">
        <van-button type="primary" block round :disabled="!canSubmit" @click="submit">注册并开始匹配</van-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.body { padding: 20px 0; }
h2 { margin: 0 16px 4px; font-size: 22px; color: var(--ink-900); }
.sub { margin: 0 16px 16px; font-size: 13px; color: var(--ink-500); }
.channel { margin: 12px 16px 0; padding: 8px 10px; font-size: 12px; color: var(--private); background: var(--private-bg); border-radius: var(--r-sm); }
.agree { margin: 16px; font-size: 12px; line-height: 1.6; color: var(--ink-600); }
.actions { padding: 0 16px; }
</style>
