<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type CancelRequestRow, type CancelRequestStatus } from '@shitu/api-client'
import { IconChevronRight, IconCircleExclamationPoint, IconCircleX, IconLock } from '@shitu/ui-icons'
import ReasonDialog from '@/components/ReasonDialog.vue'
import { useCancelRequestsStore } from '@/stores/cancelRequests'
import { fmtTime, shNow } from '@/utils/time'

/**
 * 取消申请：求职者不能自己取消报名，只能提交申请；驻场 / 项目经理在这里「同意并取消」或「不同意」（必填说明，求职者可见）。
 * 报名因其他原因先结束的，待处理申请由后端关掉（CLOSED）。接口只对驻场 / 项目经理开放，结果限本人项目。
 */
type TabKey = 'todo' | 'done'
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const counter = useCancelRequestsStore()
const tab = ref<TabKey>(route.query.tab === 'done' ? 'done' : 'todo')
watch(tab, (t) => void router.replace({ query: { ...route.query, tab: t === 'done' ? 'done' : undefined } }))

const STATUS_TEXT: Record<CancelRequestStatus, string> = { PENDING: '待处理', APPROVED: '已同意取消', REJECTED: '未同意', CLOSED: '已关闭' }
const STATUS_TONE: Record<CancelRequestStatus, string> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CLOSED: 'neutral' }

const rows = shallowRef<CancelRequestRow[]>([])
const loading = ref(true)
const loadError = ref('')
const forbidden = ref(false)
const refreshing = ref(false)
/** 被后端拒绝的申请：按钮置灰、原因留在卡片上，下拉刷新后重新判断 */
const blocked = ref<Record<number, string>>({})

async function load() {
  loadError.value = ''
  try {
    rows.value = await tenantApi.cancelRequests()
    blocked.value = {}
    forbidden.value = false
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
    void counter.refresh()
  } finally {
    refreshing.value = false
  }
}

const todo = computed(() => rows.value.filter((r) => r.status === 'PENDING'))
const done = computed(() => rows.value.filter((r) => r.status !== 'PENDING'))
const shown = computed(() => (tab.value === 'todo' ? todo.value : done.value))
const countsReady = computed(() => !loading.value && !loadError.value && !forbidden.value)
const nowDate = shNow()

const who = (r: CancelRequestRow) => `${r.seekerName}（${r.jobTitle ?? '—'}）`
/** 业务拒绝（不是断网）：原因留在卡片上 */
function onFail(r: CancelRequestRow, e: unknown, act: string) {
  if (isApiError(e) && e.code !== 'NETWORK') blocked.value = { ...blocked.value, [r.id]: `暂时不能${act}：${errorMessage(e)}` }
}
/** 处理完：列表和两处入口的待处理数一起刷新 */
function afterDecide() {
  void load()
  void counter.refresh()
}

async function approve(r: CancelRequestRow) {
  try {
    await showConfirmDialog({
      title: '同意取消报名',
      message: `同意后，${who(r)}的这条报名会立即取消，求职者被释放、可以重新匹配，岗位名额退回。`,
      confirmButtonText: '同意并取消',
      confirmButtonColor: 'var(--danger-text)',
      beforeClose: async (action) => {
        if (action !== 'confirm') return true
        try {
          await tenantApi.decideCancelRequest(r.id, true)
          return true
        } catch (e) {
          showToast(errorMessage(e, '操作失败，请稍后重试'))
          onFail(r, e, '同意取消')
          return false
        }
      },
    })
  } catch {
    return
  }
  showSuccessToast('已同意，报名已取消')
  afterDecide()
}

const dialog = ref<InstanceType<typeof ReasonDialog> | null>(null)
async function reject(r: CancelRequestRow) {
  if (!dialog.value) return
  const v = await dialog.value.open({
    title: '不同意取消',
    message: `${who(r)}申请取消报名。请写明不同意的原因，求职者会看到这段说明，报名继续有效。`,
    required: true,
    placeholder: '请填写不同意的原因（必填，求职者可见）',
    confirmText: '确认不同意',
    maxlength: 255,
    submit: async (reply) => {
      try {
        await tenantApi.decideCancelRequest(r.id, false, reply)
      } catch (e) {
        onFail(r, e, '回复')
        throw e
      }
    },
  })
  if (v === null) return
  showSuccessToast('已回复求职者')
  afterDecide()
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="cr">
    <van-nav-bar title="取消申请" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab name="todo"><template #title>待处理<span v-if="countsReady" class="n">{{ todo.length }}</span></template></van-tab>
      <van-tab name="done"><template #title>已处理<span v-if="countsReady" class="n">{{ done.length }}</span></template></van-tab>
    </van-tabs>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="forbidden" class="state-block">
        <IconLock :size="48" />
        <p class="state-block-t">暂无处理权限</p>
        <p class="state-block-d">取消申请仅对驻场 / 项目经理开放</p>
      </div>
      <div v-else-if="loadError" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ loadError }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reload">重新加载</van-button>
      </div>
      <div v-else class="pad stack">
        <p v-if="tab === 'todo' && todo.length" class="note">求职者不能自己取消报名。<b>同意</b>后报名立即取消、名额退回；<b>不同意</b>需写明原因，求职者会看到。</p>
        <article v-for="r in shown" :key="r.id" class="acard cr-card" :data-status="r.status">
          <router-link :to="`/applications/${r.applicationId}`" class="head">
            <div class="item-hd">
              <h3>{{ r.seekerName }}</h3>
              <span class="status-tag" :class="`status-tag--${STATUS_TONE[r.status]}`">{{ STATUS_TEXT[r.status] }}</span>
            </div>
            <p class="item-sub">
              <span class="flex1">{{ r.jobTitle ?? '—' }} · {{ r.projectName ?? '—' }}</span>
              <IconChevronRight :size="16" class="chev" />
            </p>
          </router-link>
          <dl class="facts">
            <div class="kv kv-stack"><dt>取消原因</dt><dd>{{ r.reason }}</dd></div>
            <div class="kv"><dt>申请时间</dt><dd>{{ fmtTime(r.createdAt, nowDate) }}</dd></div>
            <div class="kv"><dt>报名当前阶段</dt><dd>{{ label('ApplicationStatus', r.applicationStatus) }}</dd></div>
            <template v-if="r.status !== 'PENDING'">
              <div v-if="r.reply" class="kv kv-stack"><dt>给求职者的说明</dt><dd>{{ r.reply }}</dd></div>
              <div v-if="r.status === 'CLOSED'" class="kv kv-stack"><dt>处理结果</dt><dd>报名已因其他原因结束，申请自动关闭</dd></div>
              <div v-if="r.handledByName" class="kv"><dt>处理人</dt><dd>{{ r.handledByName }}</dd></div>
              <div v-if="r.handledAt" class="kv"><dt>处理时间</dt><dd>{{ fmtTime(r.handledAt, nowDate) }}</dd></div>
            </template>
          </dl>
          <div v-if="r.status === 'PENDING'" class="acts">
            <van-button plain class="act" :disabled="!!blocked[r.id]" @click="reject(r)">不同意</van-button>
            <van-button type="primary" class="act" :disabled="!!blocked[r.id]" @click="approve(r)">同意并取消</van-button>
          </div>
          <p v-if="blocked[r.id]" class="why" role="status">{{ blocked[r.id] }}。下拉刷新后重新判断</p>
        </article>
        <div v-if="!shown.length" class="state-block">
          <IconCircleX :size="48" />
          <p class="state-block-t">{{ tab === 'todo' ? '没有待处理的取消申请' : '暂无已处理的取消申请' }}</p>
          <p class="state-block-d">{{ tab === 'todo' ? '求职者申请取消报名后会出现在这里，下拉可刷新' : '下拉可刷新' }}</p>
        </div>
        <p v-else class="list-end">没有更多了</p>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>
    <ReasonDialog ref="dialog" />
  </div>
</template>

<style scoped>
.cr { min-height: 100vh; }
.n { margin-left: var(--space-1); }
.pr { min-height: calc(100vh - 100px); }
.head { display: block; color: inherit; text-decoration: none; }
.head:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--radius-control); }
.head .item-sub { display: flex; align-items: center; gap: var(--space-2); }
.head .chev { flex: none; color: var(--text-3); }
.facts { margin-top: var(--space-2); }
.acts { display: flex; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.act { flex: 1; min-width: 0; font-weight: var(--font-weight-medium); }
/* 被后端拒绝的原因：危险文字色、左对齐（和预支审批页同一句的写法一致） */
.why { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--danger-text); text-align: left; }
</style>
