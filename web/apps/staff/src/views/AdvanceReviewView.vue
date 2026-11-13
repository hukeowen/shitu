<script setup lang="ts">
import { shNow } from '@/utils/time'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, tenantApi, useDict, type AdvanceRow } from '@shitu/api-client'
import { IconChevronRight, IconCircleExclamationPoint, IconLock, IconWallet } from '@shitu/ui-icons'
import ReasonDialog from '@/components/ReasonDialog.vue'
import { ADVANCE_TONE, canSiteReview, siteReview } from '@/utils/advance'
import { fmtTime, fmtYuan } from '@/utils/time'

/** M-11 薪酬预支初审：本人发起 → 驻场初审 → 项目经理终审 → 拨款（驳回退回机会） */
type TabKey = 'todo' | 'all'
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const tab = ref<TabKey>(route.query.tab === 'all' ? 'all' : 'todo')
watch(tab, (t) => void router.replace({ query: { ...route.query, tab: t === 'all' ? 'all' : undefined } }))

const rows = shallowRef<AdvanceRow[]>([])
const loading = ref(true)
const loadError = ref('')
const forbidden = ref(false)
const refreshing = ref(false)
/** 被后端拒绝的单：按钮置灰、原因留在卡片上，下拉刷新后重新判断 */
const blocked = ref<Record<string, string>>({})

async function load() {
  loadError.value = ''
  try {
    rows.value = await tenantApi.advances()
    blocked.value = {}
  } catch (e) {
    if (isApiError(e) && e.status === 403) forbidden.value = true
    else loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
/** 重新加载：先回到加载中，重试期间不闪空状态 */
function reload() {
  loading.value = true
  void load()
}
async function onRefresh() {
  try {
    await load()
  } finally {
    refreshing.value = false
  }
}

const todo = computed(() => rows.value.filter(canSiteReview))
const shown = computed(() => (tab.value === 'todo' ? todo.value : rows.value))
const nowDate = shNow()

const dialog = ref<InstanceType<typeof ReasonDialog> | null>(null)
async function review(a: AdvanceRow, approve: boolean) {
  const onRejected = (reason: string) => (blocked.value = { ...blocked.value, [a.advanceId]: `暂时不能${approve ? '初审通过' : '驳回'}：${reason}` })
  if (await siteReview(dialog.value, a, approve, fmtYuan(a.amount), onRejected)) void load()
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="adv">
    <van-nav-bar title="预支初审" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab name="todo"><template #title>待初审<span v-if="!loading && !loadError && !forbidden" class="n">{{ todo.length }}</span></template></van-tab>
      <van-tab name="all"><template #title>全部记录<span v-if="!loading && !loadError && !forbidden" class="n">{{ rows.length }}</span></template></van-tab>
    </van-tabs>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="forbidden" class="state-block">
        <IconLock :size="48" />
        <p class="state-block-t">暂无预支审批权限</p>
        <p class="state-block-d">你的角色暂无预支审批权限</p>
      </div>
      <div v-else-if="loadError" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ loadError }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reload">重新加载</van-button>
      </div>
      <div v-else class="pad stack">
        <p v-if="tab === 'todo' && todo.length" class="note">流程：本人发起 → <b>驻场初审</b> → 项目经理终审 → 拨款。驳回后本次机会退回给求职者。</p>
        <article v-for="a in shown" :key="a.advanceId" class="acard adv-card">
          <router-link :to="`/advance/${a.advanceId}`" class="head">
            <div class="item-hd">
              <h3>{{ a.seekerName ?? '—' }}</h3>
              <span class="status-tag" :class="ADVANCE_TONE[a.status]">{{ label('AdvanceStatus', a.status) }}</span>
            </div>
            <p class="item-sub">
              <span class="flex1">预支 <b class="money-in">{{ fmtYuan(a.amount) }}</b> · {{ a.projectName ?? '—' }}</span>
              <IconChevronRight :size="16" class="chev" />
            </p>
          </router-link>
          <dl class="facts">
            <div class="kv"><dt>申请时间</dt><dd>{{ fmtTime(a.createdAt, nowDate) }}</dd></div>
            <div class="kv"><dt>所属月份</dt><dd>{{ a.bizMonth }}</dd></div>
            <div class="kv"><dt>申请单号</dt><dd class="code">{{ a.advanceId }}</dd></div>
          </dl>
          <div v-if="canSiteReview(a)" class="acts">
            <van-button v-if="a.allowedActions.includes('SITE_REJECT')" plain type="danger" class="act" :disabled="!!blocked[a.advanceId]" @click="review(a, false)">驳回</van-button>
            <van-button v-if="a.allowedActions.includes('SITE_APPROVE')" type="primary" class="act" :disabled="!!blocked[a.advanceId]" @click="review(a, true)">初审通过</van-button>
          </div>
          <p v-if="blocked[a.advanceId]" class="why" role="status">{{ blocked[a.advanceId] }}</p>
        </article>
        <div v-if="!shown.length" class="state-block">
          <IconWallet :size="48" />
          <p class="state-block-t">{{ tab === 'todo' ? '暂无待你初审的预支申请' : '暂无预支记录' }}</p>
          <p class="state-block-d">下拉可刷新</p>
        </div>
        <p v-else class="list-end">没有更多了</p>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>
    <ReasonDialog ref="dialog" />
  </div>
</template>

<style scoped>
.adv { min-height: 100vh; }
.n { margin-left: var(--space-1); }
.pr { min-height: calc(100vh - 100px); }
.head { display: block; color: inherit; text-decoration: none; }
.head:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--radius-control); }
.head .item-sub { display: flex; align-items: center; gap: var(--space-2); }
.head .chev { flex: none; color: var(--text-3); }
.facts { margin-top: var(--space-2); }
.code { font-family: var(--font-mono); }
.acts { display: flex; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.act { flex: 1; min-width: 0; font-weight: var(--font-weight-medium); }
/* 被后端拒绝的原因：危险文字色、左对齐（和详情通栏、原因弹窗里的同一句一致） */
.why { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--danger-text); text-align: left; }
</style>
