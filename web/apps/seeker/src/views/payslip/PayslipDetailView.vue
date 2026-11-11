<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, useDict, type MyPayslipAppeal, type Payslip, type PayslipAppealItem, type PayslipAppealStatus } from '@shitu/api-client'
import { formatServerTime } from '@/utils/time'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtMonth, fmtYuan } from '@/utils/format'
import { totalDeduct } from '@/utils/payslip'

/** S-42 工资条明细（C-701）：应发、社保、个税、其他扣款、预支抵扣（高亮单列）、实发；S-43 工资申诉（C-702）发给发薪公司 */
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

// ---------- 工资申诉（C-702） ----------
const { label } = useDict()
const ITEMS: { value: PayslipAppealItem; label: string }[] = [
  { value: 'GROSS', label: '应发工资' },
  { value: 'SOCIAL', label: '社保' },
  { value: 'TAX', label: '个税' },
  { value: 'OTHER_DEDUCT', label: '其他扣款' },
  { value: 'ADVANCE_DEDUCT', label: '预支抵扣' },
  { value: 'NET', label: '实发金额' },
  { value: 'OTHER', label: '其他' },
]
const APPEAL_TAG: Record<PayslipAppealStatus, string> = { OPEN: 'tag-warn', RESOLVED: 'tag-ok', REJECTED: 'tag-danger' }
const appeals = ref<MyPayslipAppeal[]>([])
const appealOpen = ref(false)
const item = ref<PayslipAppealItem | ''>('')
const reason = ref('')
const sending = ref(false)
const hasOpenAppeal = computed(() => appeals.value.some((a) => a.status === 'OPEN'))

async function loadAppeals() {
  try {
    appeals.value = await seekerApi.payslipAppeals(id.value)
  } catch {
    appeals.value = []
  }
}
void loadAppeals()

function openAppeal() {
  if (hasOpenAppeal.value) return void showToast('已有一条申诉在处理中，请等待公司回复')
  item.value = ''
  reason.value = ''
  appealOpen.value = true
}
async function submitAppeal() {
  if (sending.value) return
  if (!item.value) return void showToast('请选择有疑问的项目')
  const text = reason.value.trim()
  if (text.length < 5) return void showToast('请至少用 5 个字说明问题')
  sending.value = true
  try {
    await seekerApi.appealPayslip(id.value, { itemCode: item.value, content: text })
    appealOpen.value = false
    showToast({ type: 'success', message: '申诉已提交，公司处理后会通知你' })
    await loadAppeals()
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
    if (isApiError(e, 'SYS_4090')) {
      appealOpen.value = false
      await loadAppeals()
    }
  } finally {
    sending.value = false
  }
}

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
      <section v-if="appeals.length" class="acard">
        <div class="acard-hd"><h4>我的申诉</h4></div>
        <div v-for="a in appeals" :key="a.id" class="apl">
          <div class="row-b">
            <b class="t-sm strong">{{ a.itemCode ? label('PayslipAppealItem', a.itemCode) : '工资申诉' }}</b>
            <span class="tag" :class="APPEAL_TAG[a.status]"><i class="dot"></i>{{ label('PayslipAppealStatus', a.status) }}</span>
          </div>
          <div class="t-xs num" style="margin-top: 3px">{{ formatServerTime(a.createdAt) }}</div>
          <div class="apl-q">{{ a.content }}</div>
          <div v-if="a.reply" class="apl-r"><b>公司回复</b><p>{{ a.reply }}</p></div>
        </div>
      </section>

      <van-button block class="btn-cta" @click="openAppeal">{{ hasOpenAppeal ? '申诉处理中' : '对这张工资条提出申诉' }}</van-button>
      <div class="note note--info">申诉会发给发薪公司的项目经理处理，结果通过消息中心通知你。</div>
      <div class="page-bottom-gap"></div>
    </div>

    <van-popup v-model:show="appealOpen" position="bottom" round teleport="body" safe-area-inset-bottom class="apl-pop">
      <div class="row-b" style="margin-bottom: 10px">
        <h3 class="apl-ttl">工资申诉</h3>
        <button type="button" class="apl-x" aria-label="关闭" @click="appealOpen = false"><van-icon name="cross" size="18" /></button>
      </div>
      <div class="apl-lbl">哪一项有疑问</div>
      <div class="apl-chips">
        <button v-for="i in ITEMS" :key="i.value" type="button" class="apl-chip" :class="{ on: item === i.value }" @click="item = i.value">{{ i.label }}</button>
      </div>
      <div class="apl-lbl" style="margin-top: 14px">说明情况</div>
      <textarea v-model="reason" class="apl-ta" rows="4" maxlength="500" placeholder="例如：本月出勤 26 天，应发应为 6200 元，工资条少算了 3 天加班。"></textarea>
      <van-button block type="primary" class="apl-btn" :loading="sending" loading-text="提交中…" @click="submitAppeal">提交申诉</van-button>
    </van-popup>
  </div>
</template>

<style scoped>
.apl { padding: 10px 0; border-top: 1px solid var(--line); }
.apl:first-of-type { border-top: 0; padding-top: 0; }
.apl-q { margin-top: 6px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.7; color: var(--ink-700); white-space: pre-wrap; word-break: break-word; }
.apl-r { margin-top: 6px; padding: 8px 10px; border-radius: var(--r-sm); border-left: 3px solid var(--ok); background: var(--surface-2); }
.apl-r b { font-size: 12.5px; color: var(--ok); }
.apl-r p { margin: 3px 0 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
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

<style>
.apl-pop { padding: 18px 18px 22px; }
.apl-pop .apl-ttl { margin: 0; font-size: 17px; font-weight: 700; color: var(--ink-900); }
.apl-pop .apl-x { border: 0; background: none; color: var(--ink-500); padding: 4px; }
.apl-pop .apl-lbl { font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 8px; }
.apl-pop .apl-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.apl-pop .apl-chip { height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); font-size: 13px; color: var(--ink-700); }
.apl-pop .apl-chip.on { border-color: var(--signal); background: var(--signal-50); color: var(--signal-700); font-weight: 600; }
.apl-pop .apl-ta { width: 100%; box-sizing: border-box; border: 1.5px solid transparent; border-radius: 12px; background: var(--surface-2); padding: 11px 12px; font-size: 14px; line-height: 1.7; outline: none; resize: none; font-family: inherit; color: var(--ink-900); }
.apl-pop .apl-ta:focus { background: var(--surface); border-color: var(--signal); }
.apl-pop .apl-btn { margin-top: 14px; height: 48px; border-radius: 14px; font-size: 16px; font-weight: 700; }
</style>
