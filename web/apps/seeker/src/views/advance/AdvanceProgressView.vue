<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, seekerApi, useDict, type AdvanceDetail } from '@shitu/api-client'
import { IconChevronRight, IconCircleCheck, IconFileText, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { ADVANCE_TONE, LEDGER_NAME, OUTSTANDING, STEP_NAME, detailSteps, inReview, rejectedStep, repaidRatio, stageText, unpaid } from '@/utils/advance'
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
/** 申请单不存在（SYS_4040）：给「返回」，不给「重新加载」 */
const missing = ref(false)
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  missing.value = false
  try {
    detail.value = await seekerApi.advanceDetail(id.value)
  } catch (e) {
    detail.value = null
    missing.value = isApiError(e, 'SYS_4040')
    loadError.value = missing.value ? '未找到该预支申请' : errorMessage(e, '加载失败，请稍后重试')
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

const steps = computed(() => (detail.value ? detailSteps(detail.value, (s) => formatServerTime(s)) : []))
const rejected = computed(() => (detail.value ? rejectedStep(detail.value) : null))
const ledger = computed(() => detail.value?.ledger ?? [])
/** 时间线节点的文字状态：不只靠圆点颜色。驳回后面那一条是结果说明，标「已结束」 */
const NODE_TAG: Record<string, { t: string; cls: string }> = {
  done: { t: '已完成', cls: 'status-tag--success' },
  now: { t: '进行中', cls: 'status-tag--info' },
  fail: { t: '已驳回', cls: 'status-tag--danger' },
}
const nodeTag = (cls: string) => NODE_TAG[cls] ?? { t: row.value?.status === 'REJECTED' ? '已结束' : '未开始', cls: '' }
const owed = computed(() => (row.value ? unpaid(row.value) : 0))
const pct = computed(() => Math.round((row.value ? repaidRatio(row.value) : 0) * 100))
</script>

<template>
  <div class="advp">
    <AppBar title="审批进度" fallback="/advance" />

    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="missing" class="state-block">
        <IconFileText :size="48" :stroke-width="1.5" />
        <div class="state-block-t">预支申请不存在</div>
        <div class="state-block-d">可能已被撤销，或不是你名下的申请</div>
        <van-button type="primary" @click="router.replace('/advance')">返回预支首页</van-button>
      </div>
      <div v-else-if="loadError || !row" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError || '加载失败，请稍后重试' }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>

      <div v-else class="pad stack">
        <div v-if="justSubmitted && inReview(row)" class="tipbar tipbar--ok">
          <IconCircleCheck :size="20" />
          <div class="flex1">
            <div class="tipbar-t">申请已提交</div>
            <div class="tipbar-d">系统已推送驻场老师初审，审批结果会通过消息中心通知你。</div>
          </div>
        </div>

        <section class="acard">
          <div class="acard-hd"><h4>预支金额</h4><span class="status-tag" :class="ADVANCE_TONE[row.status]">{{ inReview(row) ? '审批中' : label('AdvanceStatus', row.status) }}</span></div>
          <div class="sum-amt">{{ fmtYuan(row.amount) }}</div>
          <p class="item-sub">{{ stageText(row.status) }}</p>
          <p class="item-meta code">申请单号 {{ row.advanceId }}</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>审批流转</h4></div>
          <ul class="tl">
            <li v-for="s in steps" :key="s.t" :class="s.cls">
              <div class="tl-t">{{ s.t }}<span class="status-tag" :class="nodeTag(s.cls).cls">{{ nodeTag(s.cls).t }}</span></div>
              <div v-if="s.m" class="tl-m">{{ s.m }}</div>
              <div v-if="s.o" class="tl-o">{{ s.cls === 'fail' ? '驳回意见' : '审批意见' }}：{{ s.o }}</div>
            </li>
          </ul>
        </section>

        <div v-if="row.status === 'REJECTED'" class="tipbar tipbar--danger">
          <IconTriangleExclamationPoint :size="20" />
          <div class="flex1">
            <div class="tipbar-t">{{ rejected ? `${STEP_NAME[rejected.step]}未通过` : '本次申请未通过' }}，已退回本次机会</div>
            <div v-if="rejected?.opinion" class="tipbar-d">驳回意见：{{ rejected.opinion }}。</div>
            <div class="tipbar-d">本月满足准入条件时可再次申请；如有疑问请联系驻场老师。</div>
          </div>
        </div>

        <section v-else class="acard">
          <div class="acard-hd"><h4>还款计划</h4></div>
          <dl>
            <div class="kv"><dt>所属月份</dt><dd>{{ fmtMonth(row.bizMonth) }}</dd></div>
            <div class="kv"><dt>还款方式</dt><dd>发薪日从工资中自动抵扣</dd></div>
            <div v-if="row.paidAt" class="kv"><dt>到账时间</dt><dd>{{ formatServerTime(row.paidAt) }}</dd></div>
            <div v-if="!inReview(row)" class="kv"><dt>已抵扣</dt><dd class="money">{{ fmtYuan(row.repaidAmount || 0) }}</dd></div>
            <div v-if="OUTSTANDING.includes(row.status)" class="kv"><dt>待抵扣</dt><dd class="money">{{ fmtYuan(owed) }}</dd></div>
          </dl>
          <template v-if="!inReview(row)">
            <div class="bar repay" role="progressbar" aria-label="已还比例" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="pct"><i :class="row.status === 'REPAID' ? 'ok' : 'sig'" :style="{ width: `${pct}%` }"></i></div>
            <p class="aux">已还 {{ pct }}%</p>
          </template>
          <template v-if="ledger.length">
            <h5 class="sub-t">本笔到账与抵扣明细</h5>
            <div v-for="(l, i) in ledger" :key="i" class="led">
              <div class="flex1">
                <b>{{ LEDGER_NAME[l.changeType]?.t ?? l.changeType }}</b>
                <span>{{ formatServerTime(l.createdAt) }}</span>
                <router-link v-if="l.payslipId" :to="`/payslips/${l.payslipId}`" class="link slip">查看工资条<IconChevronRight :size="16" /></router-link>
              </div>
              <div class="r">
                <b class="money">{{ LEDGER_NAME[l.changeType]?.sign === 1 ? '+' : '−' }}{{ fmtYuan(l.amount) }}</b>
                <span>本笔剩余 {{ fmtYuan(l.balanceAfter) }}</span>
              </div>
            </div>
          </template>
          <p v-if="row.status === 'PARTIALLY_REPAID'" class="aux">当月实发工资不足抵扣，剩余欠款已自动结转至下一个发薪日，不产生利息或手续费。</p>
        </section>

        <!-- 同一屏的提醒合成一条 -->
        <div v-if="row.status !== 'REJECTED'" class="tipbar tipbar--warn">
          <IconInfo :size="20" />
          <div class="flex1">
            <div class="tipbar-d first">离职前须结清全部预支欠款，未结清部分将从最后一笔工资中扣除。</div>
            <div v-if="inReview(row)" class="tipbar-d"><b class="strong">审批较慢怎么办？</b>系统会逐级推送待审批提醒（驻场 → 项目经理）；长时间未处理可线下联系驻场老师催办。</div>
          </div>
        </div>

        <van-button block @click="router.push('/advance/records')">查看全部预支记录</van-button>
        <div :class="row.status === 'REJECTED' ? 'bottom-bar-gap' : 'page-bottom-gap'"></div>
      </div>
    </van-pull-refresh>

    <div v-if="row && !loading && row.status === 'REJECTED'" class="bottom-bar">
      <van-button type="primary" size="large" block @click="router.replace('/advance')">返回预支首页</van-button>
    </div>
  </div>
</template>

<style scoped>
.advp { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.code { font-family: var(--font-mono); overflow-wrap: anywhere; }
.tl-t .status-tag { margin-left: var(--space-2); vertical-align: 1px; }
.tl-m { font-size: var(--font-size-aux); line-height: 20px; }
.tl li.fail::before { background: var(--danger-solid); border-color: var(--danger-solid); }
.tl-o { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); overflow-wrap: anywhere; }
.tl li.fail .tl-o { background: var(--danger-soft); }
.tipbar-d.first { margin-top: 0; }
.tipbar-d { text-wrap: pretty; }
.repay { margin-top: var(--space-3); }
.aux { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.sub-t { margin: var(--space-4) 0 0; padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); line-height: 20px; color: var(--text-2); }
.led { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--divider); }
.led:last-of-type { border-bottom: 0; }
.led b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.led b.money { font-weight: var(--font-weight-semibold); }
.led span { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.led .r { flex: none; text-align: right; }
/* 文字链的点击区补到 44 高 */
.led .slip { display: inline-flex; min-width: 44px; min-height: 44px; margin-bottom: calc(var(--space-3) * -1); }
</style>
