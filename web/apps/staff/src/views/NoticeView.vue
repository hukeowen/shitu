<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, useDict, type CompanyStatus } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'

/** 公司不可用（审核中 / 驳回 / 封禁 / 注销等，TenantMe.operational = false）时的提示页，代替工作台 */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const refreshing = ref(false)

const company = computed(() => auth.me?.company)
const status = computed<CompanyStatus | undefined>(() => company.value?.status)

const copy = computed(() => {
  switch (status.value) {
    case 'PENDING_AUDIT':
      return { icon: 'clock-o', tone: 'warn', title: '公司入驻审核中', desc: '平台正在审核你所在公司的入驻资料，审核通过后即可使用驻场工作台。' }
    case 'REJECTED':
      return { icon: 'warning-o', tone: 'danger', title: '公司入驻未通过', desc: '请联系公司管理员在电脑端公司后台修改资料后重新提交。' }
    case 'BANNED':
      return { icon: 'warning-o', tone: 'danger', title: '公司账号已被限制使用', desc: '如有疑问请联系公司管理员或平台客服。' }
    default:
      return { icon: 'info-o', tone: 'info', title: '公司暂不可使用业务功能', desc: '如有疑问请联系公司管理员。' }
  }
})
const remark = computed(() => company.value?.auditRemark || company.value?.statusRemark || '')

async function refresh() {
  refreshing.value = true
  try {
    const me = await auth.loadMe()
    if (me.operational) {
      showToast('公司已可正常使用')
      await router.replace('/')
    } else {
      showToast('状态暂未变化')
    }
  } catch (e) {
    showToast(errorMessage(e))
  } finally {
    refreshing.value = false
  }
}

async function logout() {
  try {
    await auth.logout()
  } catch {
    /* 已清空本地登录态 */
  }
  await router.replace('/login')
}
</script>

<template>
  <div class="notice">
    <div class="box" :class="copy.tone">
      <div class="ic"><van-icon :name="copy.icon" size="34" /></div>
      <h2>{{ copy.title }}</h2>
      <p class="t-sm desc">{{ copy.desc }}</p>
    </div>

    <section v-if="company" class="acard">
      <dl>
        <div class="kv"><dt>所属公司</dt><dd>{{ company.shortName || company.name }}</dd></div>
        <div class="kv"><dt>公司状态</dt><dd>{{ label('CompanyStatus', company.status) }}</dd></div>
        <div v-if="remark" class="kv"><dt>说明</dt><dd>{{ remark }}</dd></div>
        <div v-if="auth.me" class="kv"><dt>当前账号</dt><dd>{{ auth.me.name }}</dd></div>
      </dl>
    </section>

    <div class="actions">
      <van-button type="primary" block class="btn-cta" :loading="refreshing" @click="refresh">刷新状态</van-button>
      <van-button block class="btn-cta" @click="logout">退出登录</van-button>
    </div>
  </div>
</template>

<style scoped>
.notice { min-height: 100vh; padding: calc(48px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }
.box { text-align: center; margin-bottom: 20px; }
.ic { width: 70px; height: 70px; margin: 0 auto 16px; border-radius: 22px; display: grid; place-items: center; border: 1px solid; }
.warn .ic { color: var(--warn); background: var(--warn-bg); border-color: var(--warn-line); }
.danger .ic { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-line); }
.info .ic { color: var(--info); background: var(--info-bg); border-color: var(--info-line); }
h2 { font-size: 20px; font-weight: 700; color: var(--ink-900); }
.desc { margin-top: 8px; line-height: 1.7; padding: 0 12px; }
.actions { display: grid; gap: 10px; margin-top: 20px; }
</style>
