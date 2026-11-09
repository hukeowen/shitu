<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, seekerApi, useDict, type AdvanceDetail } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { ADVANCE_TAG_CLASS, LEDGER_NAME, OUTSTANDING, STEP_NAME, detailSteps, inReview, rejectedStep, repaidRatio, stageText, unpaid } from '@/utils/advance'
import { fmtMonth, fmtYuan } from '@/utils/format'
import { formatServerTime } from '@/utils/time'

/**
 * S-35 审批进度（C-603）：已提交 → 驻场初审 → 项目经理终审 → 已拨款 → 抵扣中 / 已还清（双级审批，D-25）。
 * 时间线用后端逐级审批记录（节点 / 结论 / 意见 / 时间），驳回时显示驳回节点与意见；还款明细取本笔流水。
 */
const route = useRoute()
const router = useRouter()
const { label } = useDict()

const id = computed(() => String(route.params.id))
const justSubmitted = computed(() => route.query.new === '1')
const detail = ref<AdvanceDetail | null>(null)
const row = computed(() => detail.value?.advance ?? null)
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    detail.value = await seekerApi.advanceDetail(id.value)
  } catch (e) {
    detail.value = null
    loadError.value = isApiError(e, 'SYS_4040') ? '未找到该预支申请' : errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
async function onRefresh() {
  await load()
  refreshing.value = false
}

const steps = computed(() => (detail.value ? detailSteps(detail.value, (s) => formatServerTime(s)) : []))
const rejected = computed(() => (detail.value ? rejectedStep(detail.value) : null))
const ledger = computed(() => detail.value?.ledger ?? [])
const tone = computed(() => {
  const s = row.value?.status
  if (!s) return ''
  if (s === 'REJECTED') return 'danger'
  if (inReview(row.value!)) return 'warn'
  if (s === 'REPAID') return 'muted'
  return 'ok'
})
const owed = computed(() => (row.value ? unpaid(row.value) : 0))
const pct = computed(() => Math.round((row.value ? repaidRatio(row.value) : 0) * 100))
</script>

<template>
  <div class="advp">
    <AppBar title="审批进度" fallback="/advance" />

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError || !row" class="page-state">
        <van-empty image="error" :description="loadError || '加载失败'">
          <van-button round type="primary" size="small" @click="load">重新加载</van-button>
        </van-empty>
      </div>

      <div v-else class="pad stack">
        <div v-if="justSubmitted && inReview(row)" class="note note--ok"><b>申请已提交。</b>系统已推送驻场老师初审，审批结果会通过消息中心通知你。</div>

        <section class="acard sum" :class="tone">
          <span class="tag tag--lg" :class="ADVANCE_TAG_CLASS[row.status]"><i class="dot"></i>{{ inReview(row) ? '审批中' : label('AdvanceStatus', row.status) }}</span>
          <div class="amt num">{{ fmtYuan(row.amount) }}</div>
          <div class="t-xs st">{{ stageText(row.status) }}</div>
          <div class="t-xs mono no">申请单号 {{ row.advanceId }}</div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>审批流转</h4></div>
          <ul class="tl">
            <li v-for="s in steps" :key="s.t" :class="s.cls">
              <div class="tl-t">{{ s.t }}</div>
              <div class="tl-m">{{ s.m }}</div>
              <div v-if="s.o" class="tl-o">{{ s.cls === 'fail' ? '驳回意见' : '审批意见' }}：{{ s.o }}</div>
            </li>
          </ul>
        </section>

        <template v-if="row.status === 'REJECTED'">
          <div class="note note--danger">
            <b>{{ rejected ? `${STEP_NAME[rejected.step]}未通过` : '本次申请未通过' }}，已退回本次机会。</b>
            <template v-if="rejected?.opinion">驳回意见：{{ rejected.opinion }}。</template>本月满足准入条件时可再次申请；如有疑问请联系驻场老师。
          </div>
          <van-button type="primary" block class="btn-cta" @click="router.replace('/advance')">返回预支首页</van-button>
        </template>

        <section v-else class="acard">
          <div class="acard-hd"><h4>还款计划</h4></div>
          <dl>
            <div class="kv"><dt>所属月份</dt><dd>{{ fmtMonth(row.bizMonth) }}</dd></div>
            <div class="kv"><dt>还款方式</dt><dd>发薪日从工资中自动抵扣</dd></div>
            <div v-if="row.paidAt" class="kv"><dt>到账时间</dt><dd class="num">{{ formatServerTime(row.paidAt) }}</dd></div>
            <div v-if="!inReview(row)" class="kv"><dt>已抵扣</dt><dd class="num">{{ fmtYuan(row.repaidAmount || 0) }}</dd></div>
            <div v-if="OUTSTANDING.includes(row.status)" class="kv"><dt>待抵扣</dt><dd class="num owe">{{ fmtYuan(owed) }}</dd></div>
          </dl>
          <template v-if="!inReview(row)">
            <div class="bar" style="margin-top: 10px"><i :class="row.status === 'REPAID' ? 'ok' : 'sig'" :style="{ width: `${pct}%` }"></i></div>
            <div class="t-xs" style="margin-top: 5px">已还 {{ pct }}%</div>
          </template>
          <template v-if="ledger.length">
            <div class="divider" style="margin: 12px 0 4px"></div>
            <div class="t-xs" style="margin-bottom: 2px">本笔到账与抵扣明细</div>
            <div v-for="(l, i) in ledger" :key="i" class="led">
              <div class="flex1">
                <b>{{ LEDGER_NAME[l.changeType]?.t ?? l.changeType }}</b>
                <span class="num">{{ formatServerTime(l.createdAt) }}</span>
              </div>
              <div class="r">
                <b class="num" :class="LEDGER_NAME[l.changeType]?.sign === 1 ? 'in' : 'out'">{{ LEDGER_NAME[l.changeType]?.sign === 1 ? '+' : '−' }}{{ fmtYuan(l.amount) }}</b>
                <span class="num">本笔剩余 {{ fmtYuan(l.balanceAfter) }}</span>
              </div>
              <router-link v-if="l.payslipId" :to="`/payslips/${l.payslipId}`" class="slip" aria-label="查看工资条"><van-icon name="arrow" /></router-link>
            </div>
          </template>
          <p v-if="row.status === 'PARTIALLY_REPAID'" class="t-xs" style="margin-top: 8px; line-height: 1.6">当月实发工资不足抵扣，剩余欠款已自动结转至下一个发薪日，不产生利息或手续费。</p>
        </section>

        <div v-if="inReview(row)" class="note note--info"><b>审批较慢怎么办？</b>系统会逐级推送待审批提醒（驻场 → 项目经理）；长时间未处理可线下联系驻场老师催办。</div>
        <div v-if="row.status !== 'REJECTED'" class="note note--warn">离职前须结清全部预支欠款，未结清部分将从最后一笔工资中扣除。</div>

        <van-button block class="btn-cta" @click="router.push('/advance/records')">查看全部预支记录</van-button>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.advp { min-height: 100vh; background: var(--surface-2); }
.sum { text-align: center; padding: 20px 16px; }
.sum .amt { font-family: var(--f-dis); font-size: 36px; font-weight: 700; margin-top: 10px; color: var(--ink-900); }
.sum .st { margin-top: 4px; font-weight: 600; }
.sum .no { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sum.warn { border-color: var(--warn-line); background: var(--warn-bg); }
.sum.warn .amt, .sum.warn .st { color: var(--warn); }
.sum.ok { border-color: var(--ok-line); background: var(--ok-bg); }
.sum.ok .amt, .sum.ok .st { color: var(--ok); }
.sum.danger { border-color: var(--danger-line); background: var(--danger-bg); }
.sum.danger .amt, .sum.danger .st { color: var(--danger); }
.tl li.fail::before { background: var(--danger); border-color: var(--danger); }
.tl li.fail .tl-t { color: var(--danger); }
.owe { color: var(--signal) !important; }
.tl-o { font-size: 12px; color: var(--ink-600); margin-top: 4px; padding: 6px 8px; background: var(--surface-2); border-radius: var(--r-sm); line-height: 1.6; }
.tl li.fail .tl-o { background: var(--danger-bg); color: var(--danger); }
.led { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--line); }
.led:last-child { border-bottom: 0; }
.led b { display: block; font-size: 13px; color: var(--ink-900); }
.led span { display: block; font-size: 11px; color: var(--ink-400); margin-top: 2px; }
.led .r { text-align: right; }
.led b.in { color: var(--ok); }
.led b.out { color: var(--ink-900); }
.led .slip { color: var(--ink-300); display: grid; place-items: center; width: 20px; }
</style>
