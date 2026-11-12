<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, type Payslip } from '@shitu/api-client'
import { IconChevronRight, IconInfo, IconReceipt, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { fmtMonth, fmtYuan } from '@/utils/format'
import { totalDeduct } from '@/utils/payslip'

/** S-41 我的工资（C-701）：按月展示实发；最新一月置顶展示应发 / 扣款 / 实发，预支抵扣单独提醒 */
const router = useRouter()

const list = ref<Payslip[]>([])
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    list.value = [...(await seekerApi.payslips())].sort((a, b) => b.payMonth.localeCompare(a.payMonth))
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

const latest = computed(() => list.value[0] ?? null)
const open = (p: Payslip) => router.push(`/payslips/${p.payslipId}`)
</script>

<template>
  <div class="pays">
    <AppBar title="我的工资" fallback="/me" />

    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>
      <div v-else-if="!latest" class="state-block">
        <IconReceipt :size="48" :stroke-width="1.5" />
        <div class="state-block-t">还没有工资条</div>
        <div class="state-block-d">工资由所属劳务公司核算发放，发薪后可在这里查看明细</div>
      </div>

      <div v-else class="pad stack">
        <section class="acard">
          <div class="acard-hd"><h4>{{ fmtMonth(latest.payMonth) }}实发工资</h4><span class="status-tag status-tag--success">已出工资条</span></div>
          <div class="sum-amt">{{ fmtYuan(latest.netPay) }}</div>
          <dl class="sum-kv">
            <div class="kv"><dt>应发</dt><dd class="money">{{ fmtYuan(latest.grossPay) }}</dd></div>
            <div class="kv"><dt>扣款</dt><dd class="money">−{{ fmtYuan(totalDeduct(latest)) }}</dd></div>
            <div class="kv"><dt>其中预支抵扣</dt><dd class="money">−{{ fmtYuan(latest.advanceDeduct) }}</dd></div>
          </dl>
        </section>

        <article v-if="Number(latest.advanceDeduct) > 0" class="acard tap" role="button" tabindex="0" @click="open(latest)" @keydown.enter="open(latest)" @keydown.space.prevent="open(latest)">
          <div class="item-hd">
            <h3>预支抵扣</h3>
            <span class="status-tag status-tag--warning">{{ fmtMonth(latest.payMonth) }}</span>
          </div>
          <p class="item-sub">本月工资已自动抵扣薪资预支，无需主动还款，不产生任何利息或手续费</p>
          <dl class="sum-kv">
            <div class="kv"><dt>抵扣金额</dt><dd class="money">−{{ fmtYuan(latest.advanceDeduct) }}</dd></div>
          </dl>
          <div class="more"><span class="link">查看明细<IconChevronRight :size="16" /></span></div>
        </article>

        <section class="acard list">
          <div class="acard-hd hd"><h4>历史工资</h4><span class="aux">共 {{ list.length }} 个月</span></div>
          <button v-for="p in list" :key="p.payslipId" type="button" class="lrow" @click="open(p)">
            <span class="lt">
              <b>{{ fmtMonth(p.payMonth) }}</b>
              <span>应发 {{ fmtYuan(p.grossPay) }}</span>
              <span v-if="Number(p.advanceDeduct) > 0">抵扣预支 {{ fmtYuan(p.advanceDeduct) }}</span>
            </span>
            <span class="rv">
              <b class="money">{{ fmtYuan(p.netPay) }}</b>
              <span>实发</span>
            </span>
            <IconChevronRight :size="20" class="chev" />
          </button>
        </section>

        <section class="tipbar">
          <IconInfo :size="20" />
          <div class="flex1"><div class="tipbar-d first">工资由所属劳务公司核算发放，平台仅展示工资条。对工资有疑问请联系驻场老师，或在「问题反馈」中提交。</div></div>
        </section>
        <p class="list-end">没有更多了</p>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.pays { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.tap { cursor: pointer; }
.tap:active { background: var(--bg-hover); }
.tap:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.more { display: flex; justify-content: flex-end; margin-top: var(--space-2); }
.aux { font-size: var(--font-size-aux); color: var(--text-3); }
.list { padding: 0; overflow: hidden; }
.list .hd { padding: var(--space-card) var(--space-card) 0; margin-bottom: var(--space-1); }
.list .lrow { border-left: 0; border-right: 0; border-top: 0; }
.list .lrow:active { background: var(--bg-hover); }
.lt span { display: block; line-height: 20px; font-variant-numeric: tabular-nums; }
.rv { flex: none; text-align: right; }
.rv b { display: block; font-size: var(--font-size-body); line-height: 22px; }
.rv span { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }
</style>
