<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, tenantApi, useDict, type AdvanceDetail } from '@shitu/api-client'
import ReasonDialog from '@/components/ReasonDialog.vue'
import { ADVANCE_TAG, DECISION_TEXT, LEDGER_TEXT, STEP_TEXT, approveText, canApprove, canReject, canReview, reviewAdvance } from '@/utils/advance'
import { fmtFull, fmtYuan, parseLocal } from '@/utils/time'

/** M-11 预支单笔详情：申请信息、逐级审批记录（节点 / 结论 / 意见 / 时间）、拨款与抵扣流水，可在此初审（驻场）/ 终审（项目经理） */
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const id = computed(() => String(route.params.id ?? ''))
const detail = shallowRef<AdvanceDetail | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  if (!id.value) return
  loadError.value = ''
  try {
    detail.value = await tenantApi.advanceDetail(id.value)
  } catch (e) {
    detail.value = null
    loadError.value = isApiError(e) && e.status === 403 ? '无权查看该预支申请' : errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
watch(id, () => load(), { immediate: true })

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

const dialog = ref<InstanceType<typeof ReasonDialog> | null>(null)
async function review(approve: boolean) {
  const a = adv.value
  if (a && (await reviewAdvance(dialog.value, a, approve, fmtYuan(a.amount)))) void load()
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/advance')
}
</script>

<template>
  <div class="advd">
    <van-nav-bar title="预支详情" left-arrow safe-area-inset-top @click-left="back" />
    <div v-if="loading" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="!detail || !adv" class="state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>
    <div v-else class="pad stack">
      <section class="acard sum">
        <span class="tag tag--lg" :class="ADVANCE_TAG[adv.status]">{{ label('AdvanceStatus', adv.status) }}</span>
        <div class="amt num">{{ fmtYuan(adv.amount) }}</div>
        <div class="t-sm">{{ adv.seekerName ?? '—' }} · {{ adv.projectName ?? '—' }}</div>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>申请信息</h4></div>
        <dl>
          <div class="kv"><dt>申请时间</dt><dd class="num">{{ full(adv.createdAt) }}</dd></div>
          <div class="kv"><dt>所属月份</dt><dd class="num">{{ adv.bizMonth }}</dd></div>
          <div v-if="adv.paidAt" class="kv"><dt>拨款时间</dt><dd class="num">{{ full(adv.paidAt) }}</dd></div>
          <div class="kv"><dt>已抵扣</dt><dd class="num">{{ fmtYuan(adv.repaidAmount) }}</dd></div>
          <div class="kv"><dt>申请单号</dt><dd class="num">{{ adv.advanceId }}</dd></div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>审批记录</h4></div>
        <ul class="tl">
          <li class="done">
            <div class="tl-t">本人发起申请</div>
            <div class="tl-m num">{{ full(adv.createdAt) }}</div>
          </li>
          <li v-for="(s, i) in detail.approvals" :key="i" :class="s.decision === 'REJECT' ? 'fail' : 'done'">
            <div class="tl-t">{{ s.step === 'PAYOUT' && s.decision === 'APPROVE' ? '已拨款' : `${STEP_TEXT[s.step] ?? s.step} · ${DECISION_TEXT[s.decision] ?? s.decision}` }}</div>
            <div class="tl-m num">{{ full(s.at) }}</div>
            <div v-if="s.opinion" class="tl-o">意见：{{ s.opinion }}</div>
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
            <span class="num">{{ full(l.createdAt) }}</span>
          </dt>
          <dd>
            <b class="num">{{ l.changeType === 'PAYOUT' ? '+' : '−' }}{{ fmtYuan(l.amount) }}</b>
            <span class="num">本笔剩余 {{ fmtYuan(l.balanceAfter) }}</span>
          </dd>
        </div>
      </section>

      <div class="page-bottom-gap" />
    </div>

    <div v-if="adv && canReview(adv)" class="foot">
      <van-button v-if="canReject(adv)" class="btn-cta f1" @click="review(false)">驳回</van-button>
      <van-button v-if="canApprove(adv)" type="primary" class="btn-cta f2" @click="review(true)">{{ approveText(adv) }}</van-button>
    </div>
    <ReasonDialog ref="dialog" />
  </div>
</template>

<style scoped>
.advd { min-height: 100vh; }
.state { padding-top: 80px; }
.sum { text-align: center; padding: 18px 14px; }
.sum .amt { font-family: var(--f-dis); font-size: 32px; font-weight: 700; color: var(--ink-900); margin: 8px 0 4px; }
.tl { position: relative; padding-left: 20px; list-style: none; margin: 0; }
.tl::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--line-2); }
.tl li { position: relative; padding: 0 0 14px; }
.tl li:last-child { padding-bottom: 0; }
.tl li::before { content: ""; position: absolute; left: -19px; top: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--surface); border: 1.5px solid var(--line-2); }
.tl li.done::before { background: var(--ok); border-color: var(--ok); }
.tl li.now::before { background: var(--signal); border-color: var(--signal); }
.tl li.fail::before { background: var(--danger); border-color: var(--danger); }
.tl li.fail .tl-t { color: var(--danger); }
.tl-t { font-size: 13px; font-weight: 600; color: var(--ink-900); }
.tl-m { font-size: 11.5px; color: var(--ink-400); margin-top: 1px; }
.tl-o { font-size: 12px; color: var(--ink-600); margin-top: 4px; padding: 6px 8px; background: var(--surface-2); border-radius: var(--r-sm); line-height: 1.6; }
.led dt b, .led dd b { display: block; font-size: 13px; color: var(--ink-900); }
.led dt span, .led dd span { display: block; font-size: 11px; color: var(--ink-400); font-weight: 400; margin-top: 2px; }
.foot { position: sticky; bottom: 0; display: flex; gap: 10px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
.f1 { flex: 1; }
.f2 { flex: 1.8; }
</style>
