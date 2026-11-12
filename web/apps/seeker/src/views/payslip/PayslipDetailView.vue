<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, useDict, type MyPayslipAppeal, type Payslip, type PayslipAppealItem, type PayslipAppealStatus } from '@shitu/api-client'
import { IconCheck, IconFileText, IconInfo, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'
import { formatServerTime } from '@/utils/time'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtDeduct, fmtMonth, fmtYuan } from '@/utils/format'
import { totalDeduct } from '@/utils/payslip'

/** S-42 工资条明细（C-701）：应发、社保、个税、其他扣款、预支抵扣（高亮单列）、实发；S-43 工资申诉（C-702）发给发薪公司 */
const route = useRoute()
const router = useRouter()

const id = computed(() => String(route.params.id))
const slip = ref<Payslip | null>(null)
const loading = ref(true)
const loadError = ref('')
/** 工资条不存在（SYS_4040）：给「返回」，不给「重新加载」 */
const missing = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  missing.value = false
  try {
    slip.value = await seekerApi.payslip(id.value)
  } catch (e) {
    slip.value = null
    missing.value = isApiError(e, 'SYS_4040')
    if (!missing.value) loadError.value = errorMessage(e, '加载失败，请稍后重试')
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
const APPEAL_TONE: Record<PayslipAppealStatus, string> = { OPEN: 'status-tag--warning', RESOLVED: 'status-tag--success', REJECTED: 'status-tag--danger' }
const MAX = 500
const appeals = ref<MyPayslipAppeal[]>([])
const appealOpen = ref(false)
const item = ref<PayslipAppealItem | ''>('')
const reason = ref('')
const sending = ref(false)
/** 校验没过的提示写在对应字段下方；提交被拒的原因留在按钮上方（轻提示两秒就没了） */
const errs = ref({ item: '', reason: '' })
const rejected = ref('')
const conflict = ref('')
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
  item.value = ''
  reason.value = ''
  errs.value = { item: '', reason: '' }
  rejected.value = ''
  conflict.value = ''
  appealOpen.value = true
}
function pick(v: PayslipAppealItem) {
  item.value = v
  errs.value.item = ''
}
async function submitAppeal() {
  if (sending.value) return
  if (!item.value) {
    errs.value.item = '请选择有疑问的项目'
    return void showToast(errs.value.item)
  }
  const text = reason.value.trim()
  if (text.length < 5) {
    errs.value.reason = '请至少用 5 个字说明问题'
    return void showToast(errs.value.reason)
  }
  sending.value = true
  rejected.value = ''
  try {
    await seekerApi.appealPayslip(id.value, { itemCode: item.value, content: text })
    appealOpen.value = false
    showToast({ type: 'success', message: '申诉已提交，公司处理后会通知你' })
    await loadAppeals()
  } catch (e) {
    const msg = errorMessage(e, '提交失败，请稍后重试')
    showToast(msg)
    if (isApiError(e, 'SYS_4090')) {
      // 已有一条在处理：弹层关掉，原因留在底部按钮上方（重新拉到那条申诉后按钮置灰，换成置灰的原因）
      conflict.value = msg
      appealOpen.value = false
      await loadAppeals()
    } else {
      rejected.value = msg
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
    <div v-else-if="missing" class="state-block">
      <IconFileText :size="48" :stroke-width="1.5" />
      <div class="state-block-t">工资条不存在</div>
      <div class="state-block-d">未找到该工资条</div>
      <van-button type="primary" @click="router.replace('/payslips')">返回我的工资</van-button>
    </div>
    <div v-else-if="loadError || !slip" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError || '加载失败，请稍后重试' }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <template v-else>
      <div class="pad stack">
        <!-- 实发：整页最大的数字 -->
        <section class="acard">
          <div class="acard-hd"><h4>实发工资</h4><span class="status-tag status-tag--success">已出工资条</span></div>
          <div class="sum-amt">{{ fmtYuan(slip.netPay) }}</div>
          <p class="sum-note">应发 <b class="money-in">{{ fmtAmount(slip.grossPay) }}</b> − 扣款 <b class="money-in">{{ fmtAmount(deduct) }}</b></p>
          <dl class="sum-kv">
            <div class="kv"><dt>计薪月份</dt><dd>{{ fmtMonth(slip.payMonth) }}</dd></div>
            <div class="kv"><dt>发薪主体</dt><dd>{{ slip.companyName || '—' }}</dd></div>
            <div class="kv"><dt>工资条编号</dt><dd class="code">{{ slip.payslipId }}</dd></div>
          </dl>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>应发项</h4></div>
          <dl>
            <div class="kv total"><dt>应发合计</dt><dd class="money">{{ fmtAmount(slip.grossPay) }}</dd></div>
          </dl>
          <p class="aux">含基本工资、加班费、补贴与奖金，明细以劳务公司工资表为准</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>扣款项</h4></div>
          <dl>
            <div class="kv"><dt>社会保险（个人部分）</dt><dd class="money">{{ fmtDeduct(slip.socialInsurance) }}</dd></div>
            <div class="kv"><dt>个人所得税</dt><dd class="money">{{ fmtDeduct(slip.incomeTax) }}</dd></div>
            <div class="kv"><dt>其他扣款</dt><dd class="money">{{ fmtDeduct(slip.otherDeduct) }}</dd></div>
            <div class="kv adv">
              <dt>薪资预支抵扣<span class="sub">{{ hasAdvance ? '发薪日系统自动抵扣已到账的薪资预支，不足部分结转下月' : '本月无预支抵扣' }}</span></dt>
              <dd class="money">{{ fmtDeduct(slip.advanceDeduct) }}</dd>
            </div>
            <div class="kv total"><dt>扣款合计</dt><dd class="money">{{ fmtDeduct(deduct) }}</dd></div>
          </dl>
        </section>

        <van-button v-if="hasAdvance" block @click="router.push('/advance/records')">查看预支记录与欠款</van-button>

        <section v-if="appeals.length" class="acard">
          <div class="acard-hd"><h4>我的申诉</h4></div>
          <div v-for="a in appeals" :key="a.id" class="apl">
            <div class="item-hd">
              <h3>{{ a.itemCode ? label('PayslipAppealItem', a.itemCode) : '工资申诉' }}</h3>
              <span class="status-tag" :class="APPEAL_TONE[a.status]">{{ label('PayslipAppealStatus', a.status) }}</span>
            </div>
            <p class="item-meta">{{ formatServerTime(a.createdAt) }}</p>
            <p class="apl-q">{{ a.content }}</p>
            <div v-if="a.reply" class="apl-r"><b>公司回复</b><p>{{ a.reply }}</p></div>
          </div>
        </section>

        <section class="tipbar">
          <IconInfo :size="20" />
          <div class="flex1"><div class="tipbar-d first">申诉会发给发薪公司的项目经理处理，结果通过消息中心通知你。</div></div>
        </section>
        <div class="bottom-bar-gap" :class="{ 'with-why': hasOpenAppeal || conflict }"></div>
      </div>

      <div class="bottom-bar">
        <p v-if="hasOpenAppeal" class="bar-why">已有一条申诉在处理中，请等待公司回复</p>
        <p v-else-if="conflict" class="bar-why err" role="alert"><IconTriangleExclamationPoint :size="16" />没有提交成功：{{ conflict }}</p>
        <van-button type="primary" size="large" block :disabled="hasOpenAppeal" @click="openAppeal">{{ hasOpenAppeal ? '申诉处理中' : '对这张工资条提出申诉' }}</van-button>
      </div>
    </template>

    <van-popup v-model:show="appealOpen" position="bottom" round teleport="body" safe-area-inset-bottom class="sheet">
      <div class="sheet-head">
        <div class="flex1">
          <h3>工资申诉</h3>
          <p v-if="slip" class="sheet-sub">{{ fmtMonth(slip.payMonth) }}工资条</p>
        </div>
        <button type="button" class="sheet-x" aria-label="关闭" @click="appealOpen = false"><IconX :size="20" /></button>
      </div>

      <div id="apl-item" class="lbl">哪一项有疑问</div>
      <div class="opts" role="group" aria-labelledby="apl-item">
        <button v-for="i in ITEMS" :key="i.value" type="button" class="chip-tap" :aria-pressed="item === i.value" @click="pick(i.value)">
          <span class="chip opt"><IconCheck v-if="item === i.value" :size="14" :stroke-width="2.25" />{{ i.label }}</span>
        </button>
      </div>
      <p v-if="errs.item" class="fhint fhint--err" role="alert">{{ errs.item }}</p>

      <van-cell-group :border="false" class="grp">
        <van-field
          v-model="reason"
          class="ffield"
          :class="{ bad: errs.reason }"
          type="textarea"
          label="说明情况"
          label-align="top"
          rows="4"
          :maxlength="MAX"
          show-word-limit
          placeholder="例如：本月出勤 26 天，应发应为 6200 元，工资条少算了 3 天加班。"
          :error-message="errs.reason"
          :border="false"
          @update:model-value="errs.reason = ''; rejected = ''"
        />
      </van-cell-group>

      <div v-if="rejected" class="tipbar tipbar--danger tip" role="alert">
        <IconTriangleExclamationPoint :size="20" />
        <div class="flex1"><div class="tipbar-d first">没有提交成功：{{ rejected }}</div></div>
      </div>
      <van-button block type="primary" size="large" class="submit" :loading="sending" loading-text="提交中…" @click="submitAppeal">提交申诉</van-button>
    </van-popup>
  </div>
</template>

<style scoped>
.slip { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.code { font-family: var(--font-mono); }
.aux { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-wrap: pretty; }
.kv dt { flex: 1; min-width: 0; }
.kv.total dt { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.kv.adv { align-items: flex-start; }
.sub { display: block; margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-wrap: pretty; }
.apl { padding: var(--space-3) 0; border-top: 1px solid var(--divider); }
.acard-hd + .apl { border-top: 0; padding-top: 0; }
.apl:last-of-type { padding-bottom: 0; }
.apl-q { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.apl-r { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--success-soft); }
.apl-r b { font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--success-text); }
.apl-r p { margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }

.sheet { max-height: 88vh; padding: var(--space-4) var(--space-page) var(--space-3); overflow-y: auto; box-sizing: border-box; }
.lbl { margin-top: var(--space-3); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); line-height: 20px; color: var(--text-2); }
.opts { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); }
/* 可选的小块：外层 44 高的点击区，选中除了变色还带勾 */
.opt { padding: var(--space-1) var(--space-3); border: 1px solid var(--border); background: var(--bg-card); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.chip-tap[aria-pressed="true"] .opt { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.chip-tap:focus-visible .opt { outline: 2px solid var(--primary); outline-offset: 2px; }
.grp { margin-top: var(--space-3); }
.tip { margin-top: var(--space-4); }
.submit { margin-top: var(--space-4); }
</style>
