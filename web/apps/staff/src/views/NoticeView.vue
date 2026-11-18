<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, useDict, type CompanyStatus } from '@shitu/api-client'
import { IconBan, IconCircleExclamationPoint, IconCircleX, IconClock, IconInfo } from '@shitu/ui-icons'
import { useAuthStore } from '@/stores/auth'

/** 公司不可用（审核中 / 驳回 / 封禁 / 注销等，TenantMe.operational = false）时的提示页，代替工作台 */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const refreshing = ref(false)
/** 刷新没拿到新状态的原因：留在按钮上方 */
const refreshError = ref('')

const company = computed(() => auth.me?.company)
const status = computed<CompanyStatus | undefined>(() => company.value?.status)

const copy = computed(() => {
  switch (status.value) {
    case 'PENDING_AUDIT':
      return { icon: IconClock, tone: 'warn', title: '公司入驻审核中', desc: '平台正在审核你所在公司的入驻资料，审核通过后即可使用驻场工作台。' }
    case 'REJECTED':
      return { icon: IconCircleX, tone: 'danger', title: '公司入驻未通过', desc: '请联系公司管理员在电脑端公司后台修改资料后重新提交。' }
    case 'BANNED':
      return { icon: IconBan, tone: 'danger', title: '公司账号已被限制使用', desc: '如有疑问请联系公司管理员或平台客服。' }
    case 'DEREGISTERED':
      return { icon: IconInfo, tone: 'info', title: '公司已注销', desc: '公司账号已注销，业务功能不再可用。如有疑问请联系平台客服。' }
    case 'BANKRUPT':
      return { icon: IconInfo, tone: 'info', title: '公司已停止经营', desc: '公司已登记为停止经营，业务功能不再可用。如有疑问请联系平台客服。' }
    default:
      return { icon: IconInfo, tone: 'info', title: '公司暂不可使用业务功能', desc: '如有疑问请联系公司管理员。' }
  }
})
// 公司可正常使用（正常 / 限流）时不该停在本页：路由守卫已拦截，这里兜底（例如停留期间状态恢复）
watchEffect(() => {
  if (auth.me && auth.operational) void router.replace('/')
})
/** 进页面时还没拿到成员信息（启动时加载失败）：先加载，失败给「重新加载」 */
const loading = ref(false)
const loadError = ref('')
async function init() {
  if (auth.me) return
  loading.value = true
  loadError.value = ''
  try {
    if ((await auth.loadMe()).operational) await router.replace('/')
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
void init()

const remark = computed(() => company.value?.auditRemark || company.value?.statusRemark || '')

async function refresh() {
  refreshing.value = true
  refreshError.value = ''
  try {
    const me = await auth.loadMe()
    if (me.operational) {
      showToast('公司已可正常使用')
      await router.replace('/')
    } else {
      showToast('状态暂未变化')
    }
  } catch (e) {
    // 失败原因写在按钮上方，不再弹轻提示盖住它
    refreshError.value = errorMessage(e)
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
  <div v-if="!auth.me && (loading || !loadError)" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
  <div v-else-if="!auth.me" class="state-block page-err">
    <IconCircleExclamationPoint :size="48" />
    <p class="state-block-t">{{ loadError }}</p>
    <p class="state-block-d">请检查网络后重新加载</p>
    <van-button type="primary" @click="init">重新加载</van-button>
  </div>
  <div v-else class="notice">
    <div class="state-block head" :class="copy.tone">
      <component :is="copy.icon" :size="48" />
      <h1 class="state-block-t">{{ copy.title }}</h1>
      <p class="state-block-d">{{ copy.desc }}</p>
    </div>

    <section v-if="company" class="acard">
      <dl>
        <div class="kv"><dt>所属公司</dt><dd>{{ company.shortName || company.name }}</dd></div>
        <div class="kv"><dt>公司状态</dt><dd>{{ label('CompanyStatus', company.status) }}</dd></div>
        <div v-if="remark" class="kv kv-stack"><dt>说明</dt><dd>{{ remark }}</dd></div>
        <div v-if="auth.me" class="kv"><dt>当前账号</dt><dd>{{ auth.me.name }}</dd></div>
      </dl>
    </section>

    <div class="actions">
      <p v-if="refreshError" class="bar-why err" role="alert"><IconCircleExclamationPoint :size="16" />没有刷新成功：{{ refreshError }}</p>
      <van-button type="primary" block size="large" :loading="refreshing" loading-text="刷新中…" @click="refresh">刷新状态</van-button>
      <button type="button" class="out" @click="logout">退出登录</button>
    </div>
  </div>
</template>

<style scoped>
.notice { min-height: 100vh; padding: calc(var(--space-6) + env(safe-area-inset-top)) var(--space-page) calc(var(--space-6) + env(safe-area-inset-bottom)); }
.page-err { padding-top: calc(80px + env(safe-area-inset-top)); }
.head { padding: var(--space-8) var(--space-2) var(--space-6); }
.head.warn > svg { color: var(--warning-text); }
.head.danger > svg { color: var(--danger-text); }
.head.info > svg { color: var(--primary-text); }
.actions { display: grid; justify-items: center; gap: var(--space-2); margin-top: var(--space-6); }
.actions .bar-why { margin-bottom: 0; }
.out { min-height: 44px; min-width: 88px; padding: 0 var(--space-3); border: 0; background: none; font-size: var(--font-size-body); color: var(--primary-text); }
</style>
