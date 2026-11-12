<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type AdvanceRow, type DebtLogEntry } from '@shitu/api-client'
import { IconInbox, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { ADVANCE_TONE, OUTSTANDING, inReview, repaidRatio, stageText, unpaid } from '@/utils/advance'
import { fmtYuan } from '@/utils/format'
import { formatServerTime } from '@/utils/time'

/**
 * S-36 预支记录与还款（C-604）：发薪日自动抵扣；工资不足时部分抵扣、余额结转；离职时强制结清（D-22）。
 * 欠款流水：拨款 +、工资抵扣 −、离职核销 −，逐笔显示结余。
 */
const router = useRouter()
const { label } = useDict()

type Tab = 'records' | 'log'
const tab = ref<Tab>('records')
const list = ref<AdvanceRow[]>([])
const log = ref<DebtLogEntry[]>([])
const debt = ref<number | null>(null)
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    const [rows, entries] = await Promise.all([
      seekerApi.myAdvances(),
      seekerApi.debtLog().catch(() => [] as DebtLogEntry[]),
      seekerApi.advanceQuota().then((q) => (debt.value = Number(q.debt))).catch(() => undefined),
    ])
    list.value = rows
    log.value = entries
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  await load()
  refreshing.value = false
}

const PAID_OUT = ['PAID', 'PARTIALLY_REPAID', 'REPAID']
const summary = computed(() => {
  const paid = list.value.filter((a) => PAID_OUT.includes(a.status))
  const total = paid.reduce((s, a) => s + Number(a.amount), 0)
  const repaid = paid.reduce((s, a) => s + Number(a.repaidAmount || 0), 0)
  const owed = list.value.reduce((s, a) => s + unpaid(a), 0)
  return { total, repaid, owed: debt.value ?? owed }
})

const LOG_TEXT: Record<DebtLogEntry['changeType'], { t: string; sign: 1 | -1 }> = {
  PAYOUT: { t: '预支拨款到账', sign: 1 },
  DEDUCT: { t: '发薪日工资抵扣', sign: -1 },
  WRITE_OFF: { t: '离职结清 / 核销', sign: -1 },
}
const open = (a: AdvanceRow) => router.push(`/advance/${a.advanceId}`)
function logRef(e: DebtLogEntry): string {
  if (e.advanceId) return `预支单 ${e.advanceId}`
  if (e.payslipId) return `工资条 ${e.payslipId}`
  return ''
}
</script>

<template>
  <div class="advr">
    <AppBar title="预支记录" fallback="/advance" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="retry">重新加载</van-button>
    </div>

    <template v-else>
      <div class="pad-x top">
        <section class="acard">
          <div class="acard-hd"><h4>当前欠款</h4></div>
          <div class="sum-amt">{{ fmtYuan(summary.owed) }}</div>
          <dl class="sum-kv">
            <div class="kv"><dt>累计到账</dt><dd class="money">{{ fmtYuan(summary.total) }}</dd></div>
            <div class="kv"><dt>已抵扣</dt><dd class="money">{{ fmtYuan(summary.repaid) }}</dd></div>
          </dl>
        </section>
      </div>
      <van-tabs v-model:active="tab" sticky offset-top="44" shrink class="seg-tabs">
        <van-tab name="records" :title="`预支记录 ${list.length}`" />
        <van-tab name="log" :title="`欠款流水 ${log.length}`" />
      </van-tabs>

      <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
        <div class="pad stack">
          <template v-if="tab === 'records'">
            <template v-if="list.length">
              <article v-for="a in list" :key="a.advanceId" class="acard tap" role="button" tabindex="0" @click="open(a)" @keydown.enter="open(a)" @keydown.space.prevent="open(a)">
                <div class="item-hd">
                  <h3>{{ stageText(a.status) }}</h3>
                  <span class="status-tag" :class="ADVANCE_TONE[a.status]">{{ inReview(a) ? '审批中' : label('AdvanceStatus', a.status) }}</span>
                </div>
                <p class="item-meta code">申请单号 {{ a.advanceId }}</p>
                <dl class="sum-kv">
                  <div class="kv"><dt>预支金额</dt><dd class="money">{{ fmtYuan(a.amount) }}</dd></div>
                  <div class="kv"><dt>申请时间</dt><dd>{{ formatServerTime(a.createdAt) }}</dd></div>
                  <div v-if="a.paidAt" class="kv"><dt>到账时间</dt><dd>{{ formatServerTime(a.paidAt) }}</dd></div>
                  <template v-if="PAID_OUT.includes(a.status)">
                    <div class="kv"><dt>已抵扣</dt><dd class="money">{{ fmtYuan(a.repaidAmount || 0) }}</dd></div>
                    <div v-if="OUTSTANDING.includes(a.status)" class="kv"><dt>待抵扣</dt><dd class="money">{{ fmtYuan(unpaid(a)) }}</dd></div>
                  </template>
                </dl>
                <div v-if="PAID_OUT.includes(a.status)" class="repay">
                  <div class="bar" role="progressbar" aria-label="已抵扣比例" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(repaidRatio(a) * 100)"><i :class="a.status === 'REPAID' ? 'ok' : 'sig'" :style="{ width: `${Math.round(repaidRatio(a) * 100)}%` }"></i></div>
                  <p class="aux">{{ a.status === 'REPAID' ? '已还清' : `已抵扣 ${Math.round(repaidRatio(a) * 100)}%，剩余部分在发薪日自动抵扣` }}</p>
                </div>
              </article>
              <p class="list-end">没有更多了</p>
            </template>
            <div v-else class="state-block">
              <IconInbox :size="48" :stroke-width="1.5" />
              <div class="state-block-t">还没有预支记录</div>
              <div class="state-block-d">发起预支后，每一笔的审批和还款情况都在这里</div>
              <van-button type="primary" @click="router.replace('/advance')">去看看预支额度</van-button>
            </div>
          </template>

          <template v-else>
            <template v-if="log.length">
              <section class="acard list">
                <div v-for="(e, i) in log" :key="i" class="lrow">
                  <div class="lt">
                    <b>{{ LOG_TEXT[e.changeType]?.t ?? e.changeType }}</b>
                    <span>{{ formatServerTime(e.createdAt) }}</span>
                    <span v-if="logRef(e)" class="ref">{{ logRef(e) }}</span>
                  </div>
                  <div class="lv">
                    <b class="money">{{ fmtYuan(Math.abs(Number(e.amount)) * (LOG_TEXT[e.changeType]?.sign ?? -1), true) }}</b>
                    <span>结余 <b class="money-in">{{ fmtYuan(e.balanceAfter) }}</b></span>
                  </div>
                </div>
              </section>
              <p class="list-end">没有更多了</p>
            </template>
            <div v-else class="state-block">
              <IconInbox :size="48" :stroke-width="1.5" />
              <div class="state-block-t">暂无欠款流水</div>
              <div class="state-block-d">预支到账和每次工资抵扣都会记在这里</div>
            </div>
          </template>

          <section class="tipbar">
            <IconInfo :size="20" />
            <div class="flex1"><div class="tipbar-d first"><b class="strong">还款说明：</b>预支到账后于发薪日从工资中自动抵扣，无需主动还款；当月工资不足抵扣时先扣一部分，剩余欠款结转下月；<b class="strong">离职前须结清</b>，未结清部分从最后一笔工资中扣除。</div></div>
          </section>
          <div class="page-bottom-gap"></div>
        </div>
      </van-pull-refresh>
    </template>
  </div>
</template>

<style scoped>
.advr { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.top { padding-top: var(--space-page); padding-bottom: var(--space-gap); }
.body { min-height: 50vh; }
.tap { cursor: pointer; }
.tap:active { background: var(--bg-hover); }
.tap:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.code { font-family: var(--font-mono); overflow-wrap: anywhere; }
.aux { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.repay { margin-top: var(--space-2); }
.list { padding: 0; overflow: hidden; }
.lrow { align-items: flex-start; }
.lt span { display: block; line-height: 20px; }
.lt .ref { font-family: var(--font-mono); overflow-wrap: anywhere; }
.lv { flex: none; text-align: right; }
.lv > b { display: block; font-size: var(--font-size-body); line-height: 22px; }
.lv span { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }
</style>
