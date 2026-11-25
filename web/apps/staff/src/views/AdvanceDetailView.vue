<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, tenantApi, useDict, type AdvanceDetail } from '@shitu/api-client'
import { IconCircleExclamationPoint } from '@shitu/ui-icons'
import ReasonDialog from '@/components/ReasonDialog.vue'
import AdvanceCheckBlock from '@/components/AdvanceCheckBlock.vue'
import { ADVANCE_TONE, DECISION_TEXT, LEDGER_TEXT, STEP_TEXT, approveText, canAct, canApprove, canPayout, canReject, checkBlockText, payoutAdvance, reviewAdvance } from '@/utils/advance'
import { fmtFull, fmtYuan, parseLocal } from '@/utils/time'

/** M-11 预支单笔详情：申请信息、逐级审批记录（节点 / 结论 / 意见 / 时间）、拨款与抵扣流水，可在此初审（驻场）/ 终审（项目经理） */
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const id = computed(() => String(route.params.id ?? ''))
const detail = shallowRef<AdvanceDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
/** 无权查看 / 不存在：给「返回」；其他失败给「重新加载」 */
const notFound = ref(false)
/** 初审 / 终审被后端拒绝：两个按钮置灰，原因留在底部通栏上方，下拉刷新后重新判断 */
const blocked = ref('')

async function load(silent = false) {
  if (!id.value) return
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    detail.value = await tenantApi.advanceDetail(id.value)
    blocked.value = ''
  } catch (e) {
    if (silent && detail.value) return
    detail.value = null
    notFound.value = isApiError(e) && (e.status === 403 || e.status === 404)
    loadError.value = isApiError(e) && e.status === 403 ? '无权查看该预支申请' : errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
watch(id, () => load(), { immediate: true })
const refreshing = ref(false)
async function onPull() {
  try {
    await load(true)
  } finally {
    refreshing.value = false
  }
}

const adv = computed(() => detail.value?.advance ?? null)
const full = (v?: string) => {
  const d = parseLocal(v)
  return d ? fmtFull(d) : '—'
}
/** 还没走到的节点（展示为待处理） */
const pendingSteps = computed(() => {
  const a = adv.value
  if (!a || a.status === 'REJECTED') return []
  const done = new Set(detail.value?.approvals.map((s) => s.step))
  return (['SITE', 'PM', 'PAYOUT'] as const).filter((s) => !done.has(s))
})
const hasBar = computed(() => !!adv.value && canAct(adv.value))
/** 在岗核对不过关（已离职 / 正在办离职）：通过、登记拨款置灰，驳回仍可点 */
const checkBlock = computed(() => (adv.value && canAct(adv.value) ? checkBlockText(adv.value) : ''))

const dialog = ref<InstanceType<typeof ReasonDialog> | null>(null)
async function review(approve: boolean) {
  const a = adv.value
  if (!a) return
  const onRejected = (reason: string) => (blocked.value = `暂时不能${approve ? approveText(a) : '驳回'}：${reason}`)
  if (await reviewAdvance(dialog.value, a, approve, fmtYuan(a.amount), onRejected)) void load(true)
}
/** 登记拨款（项目经理）：终审通过、线下转账完成后登记 */
async function payout() {
  const a = adv.value
  if (!a) return
  if (await payoutAdvance(a, fmtYuan(a.amount), (reason) => (blocked.value = `暂时不能登记拨款：${reason}`))) void load(true)
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/advance')
}
</script>

<template>
  <div class="advd">
    <van-nav-bar title="预支详情" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="!detail || !adv" class="state-block">
      <IconCircleExclamationPoint :size="48" />
      <p class="state-block-t">{{ loadError || '加载失败' }}</p>
      <template v-if="notFound">
        <p class="state-block-d">这笔预支不在你负责的项目里，或已被删除</p>
        <van-button type="primary" @click="back">返回</van-button>
      </template>
      <template v-else>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="load()">重新加载</van-button>
      </template>
    </div>
    <van-pull-refresh v-else v-model="refreshing" @refresh="onPull">
      <div class="pad stack">
        <section class="acard">
          <div class="item-hd">
            <h3>{{ adv.seekerName ?? '—' }}</h3>
            <span class="status-tag" :class="ADVANCE_TONE[adv.status]">{{ label('AdvanceStatus', adv.status) }}</span>
          </div>
          <p class="item-sub">{{ adv.projectName ?? '—' }}</p>
          <div class="sum">
            <span>预支金额</span>
            <b class="sum-amt">{{ fmtYuan(adv.amount) }}</b>
          </div>
          <AdvanceCheckBlock v-if="adv.check" :check="adv.check" :block-text="checkBlock" />
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>申请信息</h4></div>
          <dl>
            <div class="kv"><dt>申请时间</dt><dd>{{ full(adv.createdAt) }}</dd></div>
            <div class="kv"><dt>所属月份</dt><dd>{{ adv.bizMonth }}</dd></div>
            <div v-if="adv.paidAt" class="kv"><dt>拨款时间</dt><dd>{{ full(adv.paidAt) }}</dd></div>
            <div class="kv"><dt>已抵扣</dt><dd class="money">{{ fmtYuan(adv.repaidAmount) }}</dd></div>
            <div class="kv"><dt>申请单号</dt><dd class="code">{{ adv.advanceId }}</dd></div>
          </dl>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>审批记录</h4></div>
          <ul class="tl">
            <li class="done">
              <div class="tl-t">本人发起申请</div>
              <div class="tl-m">{{ full(adv.createdAt) }}</div>
            </li>
            <li v-for="(s, i) in detail.approvals" :key="i" :class="s.decision === 'REJECT' ? 'fail' : 'done'">
              <div class="tl-t">{{ s.step === 'PAYOUT' && s.decision === 'APPROVE' ? '已拨款' : `${STEP_TEXT[s.step] ?? s.step} · ${DECISION_TEXT[s.decision] ?? s.decision}` }}</div>
              <div class="tl-m">{{ full(s.at) }}</div>
              <!-- 后端给的是「姓名：意见」，意见可能为空 -->
              <div v-if="s.opinion" class="tl-o">
                <template v-if="s.opinion.split('：')[0]">经办：{{ s.opinion.split('：')[0] }}</template>
                <template v-if="s.opinion.includes('：')">{{ s.opinion.split('：')[0] ? ' · ' : '' }}意见：{{ s.opinion.slice(s.opinion.indexOf('：') + 1) }}</template>
              </div>
            </li>
            <li v-for="(s, i) in pendingSteps" :key="s" :class="i === 0 ? 'now' : ''">
              <div class="tl-t">{{ STEP_TEXT[s] }}</div>
              <div class="tl-m">{{ i === 0 ? '待处理' : '待流转' }}</div>
            </li>
          </ul>
        </section>

        <section v-if="detail.ledger.length" class="acard">
          <div class="acard-hd"><h4>拨款与抵扣</h4></div>
          <div v-for="(l, i) in detail.ledger" :key="i" class="kv led">
            <dt>
              <b>{{ LEDGER_TEXT[l.changeType] ?? l.changeType }}</b>
              <span>{{ full(l.createdAt) }}</span>
            </dt>
            <dd>
              <b class="money">{{ Number(l.amount) ? (l.changeType === 'PAYOUT' ? '+' : '−') : '' }}{{ fmtYuan(l.amount) }}</b>
              <span>本笔剩余 <span class="money-in">{{ fmtYuan(l.balanceAfter) }}</span></span>
            </dd>
          </div>
        </section>

        <div :class="hasBar ? (blocked || checkBlock ? 'bottom-bar-gap with-why' : 'bottom-bar-gap') : 'page-bottom-gap'" />
      </div>
    </van-pull-refresh>

    <div v-if="hasBar && adv" class="bottom-bar">
      <p v-if="blocked || checkBlock" class="bar-why err" role="status">{{ blocked || checkBlock }}</p>
      <div class="bar-acts">
        <van-button v-if="canReject(adv)" size="large" plain type="danger" :disabled="!!blocked" @click="review(false)">驳回</van-button>
        <van-button v-if="canApprove(adv)" size="large" type="primary" :disabled="!!blocked || !!checkBlock" @click="review(true)">{{ approveText(adv) }}</van-button>
        <van-button v-if="canPayout(adv)" size="large" type="primary" :disabled="!!blocked || !!checkBlock" @click="payout">登记拨款</van-button>
      </div>
    </div>
    <ReasonDialog ref="dialog" />
  </div>
</template>

<style scoped>
.advd { min-height: 100vh; }
.sum { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-body); color: var(--text-2); }
.sum-amt { font-size: 30px; font-weight: var(--font-weight-semibold); line-height: 36px; color: var(--text-1); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.code { font-family: var(--font-mono); }
/* 审批时间线：完成 / 进行中 / 驳回除了圆点颜色，文字里也写明（「· 通过」「待处理」「· 驳回」） */
.tl { position: relative; padding-left: 20px; }
.tl::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--border); }
.tl li { position: relative; padding: 0 0 var(--space-4); }
.tl li:last-child { padding-bottom: 0; }
/* 未到的节点是空心圆，描边用三级文字色（白底 5.12），过图形 3:1 */
.tl li::before { content: ""; position: absolute; left: -19px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--bg-card); border: 2px solid var(--text-3); box-sizing: border-box; }
.tl li.done::before { background: var(--success-solid); border-color: var(--success-solid); }
.tl li.now::before { background: var(--primary); border-color: var(--primary); }
.tl li.fail::before { background: var(--danger-solid); border-color: var(--danger-solid); }
.tl-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.tl li.fail .tl-t { color: var(--danger-text); }
.tl-m { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.tl-o { margin-top: var(--space-1); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.led dt b { display: block; font-weight: var(--font-weight-medium); color: var(--text-1); }
.led dd b { display: block; }
.led dt span, .led dd span { display: block; margin-top: 2px; font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); color: var(--text-3); }
/* 被拒的原因：危险文字色、左对齐（和列表卡片、原因弹窗里的同一句一致） */
.bottom-bar .bar-why { justify-content: flex-start; text-align: left; }
.bar-acts { display: flex; gap: var(--space-3); }
.bar-acts .van-button { flex: 1; min-width: 0; }
</style>
