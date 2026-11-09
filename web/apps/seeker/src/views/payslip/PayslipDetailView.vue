<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, seekerApi, type Payslip } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtMonth, fmtYuan } from '@/utils/format'
import { totalDeduct } from '@/utils/payslip'

/** S-42 工资条明细（C-701）：应发、社保、个税、其他扣款、预支抵扣（高亮单列）、实发 */
const route = useRoute()
const router = useRouter()

const id = computed(() => String(route.params.id))
const slip = ref<Payslip | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    slip.value = await seekerApi.payslip(id.value)
  } catch (e) {
    slip.value = null
    loadError.value = isApiError(e, 'SYS_4040') ? '未找到该工资条' : errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const title = computed(() => (slip.value ? `${fmtMonth(slip.value.payMonth)}工资条` : '工资条明细'))
const deduct = computed(() => (slip.value ? totalDeduct(slip.value) : 0))
const hasAdvance = computed(() => Number(slip.value?.advanceDeduct ?? 0) > 0)
</script>

<template>
  <div class="slip">
    <AppBar :title="title" fallback="/payslips" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !slip" class="page-state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <div v-else class="pad stack">
      <section class="acard">
        <div class="acard-hd"><h4>计薪信息</h4><span class="tag tag-ok">已出工资条</span></div>
        <dl>
          <div class="kv"><dt>计薪月份</dt><dd>{{ fmtMonth(slip.payMonth) }}</dd></div>
          <div class="kv"><dt>发薪主体</dt><dd>{{ slip.companyName || '—' }}</dd></div>
          <div class="kv"><dt>工资条编号</dt><dd class="mono">{{ slip.payslipId }}</dd></div>
        </dl>
      </section>

      <section class="acard okc">
        <div class="acard-hd"><h4 class="ok-h">应发项</h4><span class="num ok-v">{{ fmtAmount(slip.grossPay) }}</span></div>
        <div class="row-b"><span class="strong">应发合计</span><span class="num big ok-v">{{ fmtAmount(slip.grossPay) }}</span></div>
        <p class="t-xs" style="margin-top: 6px">含基本工资、加班费、补贴与奖金，明细以劳务公司工资表为准</p>
      </section>

      <section class="acard dc">
        <div class="acard-hd"><h4 class="d-h">扣款项</h4><span class="num d-v">−{{ fmtAmount(deduct) }}</span></div>
        <dl>
          <div class="kv"><dt>社会保险（个人部分）</dt><dd class="num">−{{ fmtAmount(slip.socialInsurance) }}</dd></div>
          <div class="kv"><dt>个人所得税</dt><dd class="num">−{{ fmtAmount(slip.incomeTax) }}</dd></div>
          <div class="kv"><dt>其他扣款</dt><dd class="num">−{{ fmtAmount(slip.otherDeduct) }}</dd></div>
        </dl>
        <div class="advrow" :class="{ on: hasAdvance }">
          <div class="row-b">
            <span class="strong adv-t">薪资预支抵扣</span>
            <span class="num adv-t">−{{ fmtAmount(slip.advanceDeduct) }}</span>
          </div>
          <p class="t-xs adv-d">{{ hasAdvance ? '发薪日系统自动抵扣已到账的薪资预支，不足部分结转下月' : '本月无预支抵扣' }}</p>
        </div>
        <div class="divider" style="margin: 10px 0 8px"></div>
        <div class="row-b"><span class="strong">扣款合计</span><span class="num big d-v">−{{ fmtAmount(deduct) }}</span></div>
      </section>

      <section class="acard netc">
        <div class="row-b"><span class="net-l">实发工资</span><span class="net-v">{{ fmtYuan(slip.netPay) }}</span></div>
        <div class="divider" style="margin: 11px 0; background: rgba(255, 255, 255, .15)"></div>
        <div class="row-b t-xs net-m"><span>应发 − 扣款</span><span class="num">{{ fmtAmount(slip.grossPay) }} − {{ fmtAmount(deduct) }}</span></div>
        <div class="row-b t-xs net-m" style="margin-top: 5px"><span>发薪主体</span><span>{{ slip.companyName || '—' }}</span></div>
      </section>

      <van-button v-if="hasAdvance" block class="btn-cta" @click="router.push('/advance/records')">查看预支记录与欠款</van-button>
      <div class="note note--info">对本月工资有疑问？请联系驻场老师核对，或在「问题反馈」中提交。</div>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.slip { min-height: 100vh; background: var(--surface-2); }
.okc { border-color: var(--ok-line); }
.ok-h, .ok-v { color: var(--ok) !important; }
.dc { border-color: var(--danger-line); }
.d-h, .d-v { color: var(--danger) !important; }
.big { font-size: 18px; font-weight: 700; }
.advrow { margin: 8px -14px 0; padding: 10px 14px; background: var(--surface-2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.advrow .adv-t { color: var(--ink-600); }
.advrow .adv-d { margin-top: 4px; }
.advrow.on { background: var(--signal-50); border-color: var(--signal-300); }
.advrow.on .adv-t, .advrow.on .adv-d { color: var(--signal-700); }
.netc { background: var(--ink-900); border: 0; color: #fff; }
.net-l { font-size: 15px; font-weight: 700; }
.net-v { font-family: var(--f-dis); font-size: 28px; font-weight: 700; color: var(--signal-300); }
.net-m { color: rgba(255, 255, 255, .6); }
</style>
