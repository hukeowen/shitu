<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { opsApi, useDict } from '@shitu/api-client'
import { IconBanknote, IconBriefcase, IconBuildingComplex, IconChevronRight, IconCircleCheck, IconFileText, IconInbox, IconReceipt, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { BILLING_ROLES, MENU, PENDING_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'
import { fmtDateTime } from '@/utils/format'

const auth = useAuthStore()
const pending = usePendingStore()
const { label } = useDict()

const canPending = computed(() => auth.hasAnyRole(PENDING_ROLES))
/** 数字只在这次拿到了数据时显示：加载中、失败都显示「—」（规范「Page States」） */
const ready = computed(() => !!pending.counts && !pending.loading && !pending.error)

/** 待确认付款（超管 / 财务）：数量来自对账汇总 /ops/bills-summary，不在待办接口里；拿不到时显示「—」 */
const canBilling = computed(() => auth.hasAnyRole(BILLING_ROLES))
const payPending = ref<number | null>(null)
/** 待付流转分成（平台该付给企业的应收流转费）：数量来自 /ops/receivables-summary，两个数各拿各的，一个失败不影响另一个 */
const payoutUnpaid = ref<number | null>(null)
const payLoading = ref(false)
async function loadPayPending() {
  if (!canBilling.value || payLoading.value) return
  payLoading.value = true
  try {
    const [bills, receivables] = await Promise.allSettled([opsApi.billsSummary(), opsApi.receivablesSummary()])
    payPending.value = bills.status === 'fulfilled' ? bills.value.paymentPending : null
    payoutUnpaid.value = receivables.status === 'fulfilled' ? receivables.value.unpaidBills : null
  } finally {
    payLoading.value = false
  }
}
function refresh() {
  void pending.refresh()
  void loadPayPending()
}

const auditCards = computed(() => {
  const c = ready.value ? pending.counts : null
  return [
    { key: 'companies', icon: IconBuildingComplex, title: '待审核入驻', desc: '劳务公司入驻申请，核验营业执照与派遣许可', n: c?.companies, unit: '项', to: { path: '/companies/list', query: { status: 'PENDING_AUDIT' } } },
    { key: 'contracts', icon: IconFileText, title: '待备案合同', desc: '劳务公司与甲方的合作合同，备案后才能发岗', n: c?.contracts, unit: '项', to: { path: '/governance/job-audit', query: { tab: 'contracts' } } },
    { key: 'jobs', icon: IconBriefcase, title: '待审核岗位', desc: '按提交时间排队，通过后进入匹配池', n: c?.jobs, unit: '项', to: { path: '/governance/job-audit', query: { tab: 'jobs' } } },
  ]
})
const cards = computed(() => [
  ...(canPending.value ? auditCards.value : []),
  ...(canBilling.value
    ? [{ key: 'payments', icon: IconReceipt, title: '待确认付款', desc: '企业提交的账单付款凭证，核对银行流水后确认到账', n: payLoading.value ? undefined : payPending.value ?? undefined, unit: '笔', to: { path: '/settlement/bills', query: { flag: 'PAYMENT_PENDING' } } },
      { key: 'payouts', icon: IconBanknote, title: '待付流转分成', desc: '该付给企业的应收流转费，转账后在账单上登记付款', n: payLoading.value ? undefined : payoutUnpaid.value ?? undefined, unit: '张', to: { path: '/settlement/bills', query: { flag: 'RECEIVABLE_UNPAID' } } }]
    : []),
])
const allDone = computed(() => auditCards.value.every((c) => c.n === 0))

const modules = computed(() =>
  MENU.flatMap((g) => g.items.filter((it) => it.ready && it.path !== '/workbench' && auth.hasAnyRole(it.roles)).map((it) => ({ ...it, group: g.title }))),
)

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? '夜深了' : h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好'
})

onMounted(refresh)
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>{{ greeting }}，{{ auth.me?.displayName }}</h2>
        <p>
          角色：{{ auth.roles.map((r) => label('OpsRole', r)).join('、') || '—' }}
          <template v-if="auth.me?.lastLoginAt"> · 上次登录 {{ fmtDateTime(auth.me.lastLoginAt) }}</template>
        </p>
      </div>
      <div class="spacer" />
      <el-button v-if="canPending || canBilling" :loading="pending.loading || payLoading" @click="refresh">刷新</el-button>
    </div>

    <template v-if="canPending || canBilling">
      <div v-loading="pending.loading" class="grid kpis" :class="cards.length > 3 ? 'g-4' : 'g-3'">
        <router-link v-for="c in cards" :key="c.key" :to="c.to" class="stat stat--icon stat--link">
          <div class="stat-l">{{ c.title }}</div>
          <component :is="c.icon" :size="20" class="stat-i" />
          <div class="stat-v">
            <template v-if="c.n != null">{{ c.n }}<small>{{ c.unit }}</small></template>
            <template v-else>—</template>
          </div>
          <div class="stat-d">{{ c.desc }}</div>
          <span class="go">去处理<IconChevronRight :size="14" /></span>
        </router-link>
      </div>
      <div v-if="pending.error && !pending.loading" class="notice-bar notice-bar--danger pend-err" role="alert">
        <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
        <span class="pend-t">待办数量加载失败：{{ pending.offline ? '请检查网络后重新加载' : pending.error }}</span>
        <el-button size="small" @click="pending.refresh()">重新加载</el-button>
      </div>
      <div v-else-if="canPending && ready && allDone" class="notice-bar notice-bar--ok pend-ok" role="status">
        <IconCircleCheck :size="16" class="notice-bar-i" />
        <span>目前没有待处理的入驻审核、合同备案和岗位审核</span>
      </div>
    </template>

    <div class="card mod">
      <div class="card__hd"><h3>我的功能</h3><span class="t-xs">根据账号角色显示</span></div>
      <div class="card__bd">
        <div v-if="modules.length" class="grid g-4">
          <router-link v-for="m in modules" :key="m.path" :to="m.path" class="mod-it">
            <component :is="m.icon" :size="20" class="mod-i" />
            <span class="mod-t">
              <b>{{ m.title }}</b>
              <span class="t-xs">{{ m.group }}</span>
            </span>
          </router-link>
        </div>
        <div v-else class="state-box">
          <IconInbox :size="48" />
          <h4>暂无可用功能</h4>
          <p>当前角色暂无可用功能，请联系超级管理员分配</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { gap: var(--space-gap); }
.go { display: inline-flex; align-items: center; gap: 2px; margin-top: var(--space-2); font-size: var(--font-size-min); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.pend-err, .pend-ok { margin-top: var(--space-3); align-items: center; }
.pend-t { flex: 1; min-width: 0; }
.mod { margin-top: var(--space-gap); }
.mod-it { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--bg-card); text-decoration: none; transition: border-color .14s; }
.mod-it:hover { border-color: var(--primary-line); background: var(--bg-hover); }
.mod-it:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.mod-i { flex: none; color: var(--text-2); }
.mod-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mod-t b { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
</style>
