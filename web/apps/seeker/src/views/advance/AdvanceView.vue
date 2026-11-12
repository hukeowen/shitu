<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type AdvanceQuota, type AdvanceRow, type MyWork } from '@shitu/api-client'
import { IconChevronRight, IconCircleCheck, IconCircleX, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useAuthStore } from '@/stores/auth'
import { admissionRules, inReview, stageText } from '@/utils/advance'
import { fmtAmount, fmtYuan } from '@/utils/format'

/**
 * S-33 薪酬预支首页（C-601 / C-602）：额度、在岗日进度、5 项准入、固定金额本人发起。
 * 规则（D-26 / D-27）：入职满 7 个在岗日解锁首次，此后每满 7 个在岗日 +1 次；单月最多 4 次；机会月末清零不结转。
 */
const router = useRouter()
const auth = useAuthStore()

const quota = ref<AdvanceQuota | null>(null)
const pending = ref<AdvanceRow | null>(null)
const work = ref<MyWork | null>(null)
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)
const submitting = ref(false)
/** 发起被拒的原因：轻提示两秒就没了，这里留在按钮上方，下拉刷新后清掉 */
const applyError = ref('')

async function load() {
  loadError.value = ''
  try {
    const [q, list] = await Promise.all([
      seekerApi.advanceQuota(),
      seekerApi.myAdvances().catch(() => [] as AdvanceRow[]),
      seekerApi.work().then((w) => (work.value = w ?? null)).catch(() => undefined),
    ])
    quota.value = q
    pending.value = list.find(inReview) ?? null
  } catch (e) {
    loadError.value = errorMessage(e, '额度加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
if (!auth.profile) void auth.loadProfile().catch(() => undefined)

function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  applyError.value = ''
  await load()
  refreshing.value = false
}
const toRecords = () => router.push('/advance/records')
function openPending() {
  if (pending.value) void router.push(`/advance/${pending.value.advanceId}`)
}

const company = computed(() => work.value?.companyName || auth.profile?.boundCompanyName || '')
const admission = computed(() => (quota.value ? admissionRules(quota.value, company.value) : { rules: [], extra: [] }))
const allOk = computed(() => admission.value.rules.every((r) => r.ok))

/** 在岗日进度：本周期 x/7，再在岗 N 天获得下一次 */
const cycle = computed(() => {
  const q = quota.value
  if (!q) return { pct: 0, left: 0 }
  const per = Math.max(1, q.daysPerChance)
  const x = Math.min(per, Math.max(0, q.progressInCycle))
  return { pct: Math.round((x / per) * 100), left: per - x }
})
const capped = computed(() => !!quota.value && quota.value.usedThisMonth >= quota.value.monthlyLimit)

/** 本月额度格子：已用 / 审批中 / 可用 / 未解锁 */
const slots = computed(() => {
  const q = quota.value
  if (!q) return []
  const reviewing = pending.value ? 1 : 0
  const usedDone = Math.max(0, q.usedThisMonth - reviewing)
  return Array.from({ length: q.monthlyLimit }, (_, i) => {
    if (i < usedDone) return { k: i, t: '已用', cls: 'used' }
    if (i < q.usedThisMonth) return { k: i, t: '审批中', cls: 'rev' }
    if (i < q.usedThisMonth + q.remainingThisMonth) return { k: i, t: '可用', cls: 'avail' }
    return { k: i, t: '未解锁', cls: '' }
  })
})

const reason = computed(() => quota.value?.reasons[0] || '暂不满足准入条件，详见上方「准入条件」')
const debt = computed(() => Number(quota.value?.debt ?? 0))

async function onApply() {
  const q = quota.value
  if (!q || !q.eligible || submitting.value) return
  try {
    await showConfirmDialog({
      title: `确认预支 ${fmtYuan(q.amount)}`,
      message:
        `审批流程：驻场初审 → 项目经理终审 → 拨款到账。\n\n` +
        `· 还款：到账后于下一个发薪日从工资中自动抵扣，无需主动还款；工资不足抵扣的部分结转下月，不产生利息或手续费。\n` +
        `· 离职：离职前须结清全部预支欠款，未结清部分从最后一笔工资中扣除。\n\n` +
        `我确认本次预支为本人真实意愿。`,
      messageAlign: 'left',
      confirmButtonText: '确认申请',
      cancelButtonText: '再想想',
    })
  } catch {
    return
  }
  submitting.value = true
  applyError.value = ''
  try {
    const id = await seekerApi.applyAdvance()
    showToast({ type: 'success', message: '申请已提交' })
    void router.push({ path: `/advance/${id}`, query: { new: '1' } })
  } catch (e) {
    applyError.value = isApiError(e, 'ADV_4001') ? errorMessage(e).split('；')[0] : errorMessage(e, '提交失败，请稍后重试')
    showToast(applyError.value)
    void load()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="adv">
    <AppBar title="薪资预支">
      <template #right><button type="button" class="bar-act" @click="toRecords">预支记录</button></template>
    </AppBar>

    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError || !quota" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError || '额度加载失败，请稍后重试' }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>

      <div v-else class="pad stack">
        <section class="acard">
          <div class="acard-hd"><h4>单次可预支金额</h4><span class="status-tag">固定额度</span></div>
          <div class="sum-amt">{{ fmtYuan(quota.amount) }}</div>
          <dl class="sum-kv">
            <div class="kv"><dt>本月剩余机会</dt><dd>{{ quota.remainingThisMonth }} / {{ quota.monthlyLimit }} 次</dd></div>
            <div class="kv"><dt>本月已用</dt><dd>{{ quota.usedThisMonth }} 次</dd></div>
            <div class="kv"><dt>当前欠款</dt><dd class="money">{{ fmtYuan(debt) }}</dd></div>
          </dl>
        </section>

        <!-- 审批中的一笔 -->
        <article v-if="pending" class="acard tap" role="button" tabindex="0" @click="openPending" @keydown.enter="openPending" @keydown.space.prevent="openPending">
          <div class="item-hd">
            <h3>{{ stageText(pending.status) }}</h3>
            <span class="status-tag status-tag--warning">审批中</span>
          </div>
          <p class="item-meta code">申请单号 {{ pending.advanceId }}</p>
          <dl class="sum-kv">
            <div class="kv"><dt>预支金额</dt><dd class="money">{{ fmtYuan(pending.amount) }}</dd></div>
          </dl>
          <div class="more"><span class="link">查看审批进度<IconChevronRight :size="16" /></span></div>
        </article>

        <section class="acard">
          <div class="acard-hd"><h4>在岗日进度</h4><span class="aux">累计在岗 {{ quota.dutyDays }} 天</span></div>
          <div class="prog">
            <span>本周期 <b class="strong">{{ quota.progressInCycle }}</b> / {{ quota.daysPerChance }} 天</span>
            <span v-if="capped" class="prog-n warn">本月次数已用完，下月恢复</span>
            <span v-else class="prog-n">再在岗 {{ cycle.left }} 天获得下一次</span>
          </div>
          <div class="bar" role="progressbar" aria-label="本周期在岗日进度" aria-valuemin="0" :aria-valuenow="quota.progressInCycle" :aria-valuemax="quota.daysPerChance"><i class="sig" :style="{ width: `${cycle.pct}%` }"></i></div>
          <div class="ticks" aria-hidden="true">
            <i v-for="d in quota.daysPerChance" :key="d" :class="{ on: d <= quota.progressInCycle }"></i>
          </div>
          <p class="aux foot">在岗日 = 入职以来的自然日，扣除驻场登记的请假与旷工</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>本月额度</h4><span class="aux">本月获得 {{ quota.grantedThisMonth }} 次</span></div>
          <ul class="slots">
            <li v-for="s in slots" :key="s.k" class="slot" :class="s.cls">
              <span>第 {{ s.k + 1 }} 次</span>
              <b>{{ s.t }}</b>
            </li>
          </ul>
          <div class="tipbar tipbar--warn tip">
            <IconInfo :size="20" />
            <div class="flex1"><div class="tipbar-d first">每满 <b class="strong">{{ quota.daysPerChance }} 个在岗日</b>获得一次预支机会；<b class="strong">当月机会月末清零，不结转</b>。已到账未还的欠款顺延结转 —— 欠款结转 ≠ 额度结转。</div></div>
          </div>
        </section>

        <section class="acard">
          <div class="acard-hd">
            <h4>准入条件</h4>
            <span class="status-tag" :class="quota.eligible ? 'status-tag--success' : allOk ? 'status-tag--warning' : 'status-tag--neutral'">{{ quota.eligible ? '已满足' : '未满足' }}</span>
          </div>
          <ul class="rules">
            <li v-for="r in admission.rules" :key="r.t" :class="{ bad: !r.ok }">
              <IconCircleCheck v-if="r.ok" :size="20" /><IconCircleX v-else :size="20" />
              <span class="flex1">{{ r.t }}</span>
              <span class="status-tag" :class="r.ok ? 'status-tag--success' : 'status-tag--warning'">{{ r.ok ? '已满足' : '未满足' }}</span>
            </li>
          </ul>
          <div v-if="admission.extra.length" class="tipbar tipbar--warn tip">
            <IconInfo :size="20" />
            <div class="flex1"><div v-for="(x, i) in admission.extra" :key="x" class="tipbar-d" :class="{ first: i === 0 }">{{ x }}</div></div>
          </div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>规则说明</h4></div>
          <dl>
            <div class="kv"><dt>单次金额</dt><dd>固定 {{ fmtAmount(quota.amount) }} 元 / 次</dd></div>
            <div class="kv"><dt>月度上限</dt><dd>每月最多 {{ quota.monthlyLimit }} 次</dd></div>
            <div class="kv"><dt>抵扣不足</dt><dd>剩余欠款结转下月</dd></div>
            <div class="kv kv-stack"><dt>审批流程</dt><dd>驻场初审 → 项目经理终审 → 拨款</dd></div>
            <div class="kv kv-stack"><dt>还款方式</dt><dd>发薪日自动抵扣，无需主动还款</dd></div>
            <div class="kv kv-stack"><dt>离职处理</dt><dd>离职前须结清，从最后一笔工资扣除</dd></div>
          </dl>
        </section>

        <van-button block @click="toRecords">预支记录与还款</van-button>
        <div class="bottom-bar-gap with-why"></div>
      </div>
    </van-pull-refresh>

    <div v-if="quota && !loading && !loadError" class="bottom-bar">
      <p v-if="applyError" class="bar-why err" role="alert"><IconTriangleExclamationPoint :size="16" />没有提交成功：{{ applyError }}</p>
      <p v-else-if="!quota.eligible" class="bar-why">{{ reason }}</p>
      <van-button type="primary" size="large" block :disabled="!quota.eligible" :loading="submitting" loading-text="提交中…" @click="onApply">
        申请预支 {{ fmtYuan(quota.amount) }}
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.adv { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.tap { cursor: pointer; }
.tap:active { background: var(--bg-hover); }
.tap:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.code { font-family: var(--font-mono); overflow-wrap: anywhere; }
.more { display: flex; justify-content: flex-end; margin-top: var(--space-2); }
.aux { font-size: var(--font-size-aux); color: var(--text-3); }
.prog { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 var(--space-2); margin-bottom: var(--space-2); font-size: var(--font-size-body); color: var(--text-2); }
.prog-n { font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.prog-n.warn { color: var(--warning-text); }
.bar { height: 8px; border-radius: 4px; }
.ticks { display: flex; gap: var(--space-1); margin-top: var(--space-2); }
.ticks i { flex: 1; height: 2px; border-radius: 1px; background: var(--border); }
.ticks i.on { background: var(--primary); }
.foot { margin-top: var(--space-3); line-height: 20px; text-wrap: pretty; }
/* 本月额度的四格：每格都写状态文字，不只靠颜色 */
.slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
.slot { padding: var(--space-2) 0; border: 1px dashed var(--border); border-radius: var(--radius-control); text-align: center; color: var(--text-3); }
.slot span { display: block; font-size: var(--font-size-min); line-height: 18px; }
.slot b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; }
.slot.used { border: 1px solid transparent; background: var(--bg-fill); color: var(--text-2); }
.slot.rev { border: 1px solid transparent; background: var(--warning-soft); color: var(--warning-text); }
.slot.avail { border: 1px solid var(--primary); background: var(--primary-bg); color: var(--primary-text); }
.tip { margin-top: var(--space-3); }
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }
.rules { display: grid; gap: var(--space-3); }
.rules li { display: flex; align-items: flex-start; gap: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.rules li > svg { flex: none; margin-top: 1px; color: var(--success-text); }
.rules li.bad > svg { color: var(--warning-text); }
.rules .flex1 { text-wrap: pretty; }
.rules .status-tag { flex: none; }
</style>
