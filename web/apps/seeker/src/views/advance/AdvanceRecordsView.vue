<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type AdvanceRow, type DebtLogEntry } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { ADVANCE_TAG_CLASS, OUTSTANDING, inReview, repaidRatio, stageText, unpaid } from '@/utils/advance'
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
function logRef(e: DebtLogEntry): string {
  if (e.advanceId) return `预支单 ${e.advanceId}`
  if (e.payslipId) return `工资条 ${e.payslipId}`
  return ''
}
</script>

<template>
  <div class="advr">
    <AppBar title="预支记录" fallback="/advance" />

    <div class="pad-x" style="padding-top: 12px">
      <section class="acard sumc">
        <div><span>累计到账</span><b class="num">{{ fmtYuan(summary.total) }}</b></div>
        <div><span>已抵扣</span><b class="num">{{ fmtYuan(summary.repaid) }}</b></div>
        <div><span>当前欠款</span><b class="num owe">{{ fmtYuan(summary.owed) }}</b></div>
      </section>
    </div>
    <div class="atabs tabs2" role="tablist">
      <button type="button" role="tab" :aria-selected="tab === 'records'" :class="{ on: tab === 'records' }" @click="tab = 'records'">预支记录 <span class="mono">{{ list.length }}</span></button>
      <button type="button" role="tab" :aria-selected="tab === 'log'" :class="{ on: tab === 'log' }" @click="tab = 'log'">欠款流水 <span class="mono">{{ log.length }}</span></button>
    </div>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="pad stack body">
        <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
        <div v-else-if="loadError" class="page-state">
          <van-empty image="error" :description="loadError">
            <van-button round type="primary" size="small" @click="load">重新加载</van-button>
          </van-empty>
        </div>

        <template v-else-if="tab === 'records'">
          <template v-if="list.length">
            <article v-for="a in list" :key="a.advanceId" class="acard rec" :class="{ dim: a.status === 'REPAID' || a.status === 'REJECTED' }" @click="router.push(`/advance/${a.advanceId}`)">
              <div class="row-b" style="margin-bottom: 8px">
                <span class="rt"><b class="num">{{ fmtYuan(a.amount) }}</b><span class="mono t-xs">{{ a.advanceId }}</span></span>
                <span class="tag" :class="ADVANCE_TAG_CLASS[a.status]">{{ inReview(a) ? '审批中' : label('AdvanceStatus', a.status) }}</span>
              </div>
              <dl>
                <div class="kv"><dt>申请时间</dt><dd class="num">{{ formatServerTime(a.createdAt) }}</dd></div>
                <div v-if="a.paidAt" class="kv"><dt>到账时间</dt><dd class="num">{{ formatServerTime(a.paidAt) }}</dd></div>
                <div class="kv"><dt>{{ inReview(a) ? '当前节点' : '状态' }}</dt><dd>{{ stageText(a.status) }}</dd></div>
              </dl>
              <div v-if="PAID_OUT.includes(a.status)" class="repay">
                <div class="row-b t-xs">
                  <span>已抵扣 <b class="num strong">{{ fmtYuan(a.repaidAmount || 0) }}</b> / {{ fmtYuan(a.amount) }}</span>
                  <span v-if="OUTSTANDING.includes(a.status)" class="owe-t">待抵扣 {{ fmtYuan(unpaid(a)) }}</span>
                  <span v-else class="ok-t">已还清</span>
                </div>
                <div class="bar" style="margin-top: 5px"><i :class="a.status === 'REPAID' ? 'ok' : 'sig'" :style="{ width: `${Math.round(repaidRatio(a) * 100)}%` }"></i></div>
              </div>
            </article>
          </template>
          <div v-else class="page-state">
            <van-empty description="还没有预支记录">
              <van-button round type="primary" size="small" @click="router.replace('/advance')">去看看预支额度</van-button>
            </van-empty>
          </div>
        </template>

        <template v-else>
          <section v-if="log.length" class="acard list">
            <div v-for="(e, i) in log" :key="i" class="lrow lg">
              <div class="lt">
                <b>{{ LOG_TEXT[e.changeType]?.t ?? e.changeType }}</b>
                <span>{{ formatServerTime(e.createdAt) }}<template v-if="logRef(e)"> · {{ logRef(e) }}</template></span>
              </div>
              <div class="lv">
                <b class="num" :class="(LOG_TEXT[e.changeType]?.sign ?? -1) > 0 ? 'plus' : 'minus'">{{ fmtYuan(Math.abs(Number(e.amount)) * (LOG_TEXT[e.changeType]?.sign ?? -1), true) }}</b>
                <span class="t-xs num">结余 {{ fmtYuan(e.balanceAfter) }}</span>
              </div>
            </div>
          </section>
          <div v-else class="page-state"><van-empty description="暂无欠款流水" /></div>
        </template>

        <div v-if="!loading && !loadError" class="note note--info">
          <b>还款说明：</b>预支到账后于发薪日从工资中自动抵扣，无需主动还款；当月工资不足抵扣时先扣一部分，剩余欠款结转下月；<b>离职前须结清</b>，未结清部分从最后一笔工资中扣除。
        </div>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.advr { min-height: 100vh; background: var(--surface-2); }
.sumc { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; background: var(--ink-900); border: 0; color: #fff; }
.sumc span { display: block; font-size: 11px; color: rgba(255, 255, 255, .55); }
.sumc b { display: block; font-size: 17px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sumc b.owe { color: var(--signal-300); }
.tabs2 { margin-top: 12px; border-top: 1px solid var(--line); }
.body { min-height: 50vh; align-content: start; }
.page-state { padding-top: 30px; }
.rec.dim { opacity: .82; }
.rt { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.rt b { font-size: 16px; color: var(--ink-900); flex: none; }
.rt .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repay { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }
.owe-t { color: var(--signal); font-weight: 600; }
.ok-t { color: var(--ok); font-weight: 600; }
.list { padding: 0; overflow: hidden; }
.lg .lt span { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lv { flex: none; text-align: right; }
.lv b { display: block; font-size: 15px; }
.lv .plus { color: var(--signal); }
.lv .minus { color: var(--ok); }
</style>
