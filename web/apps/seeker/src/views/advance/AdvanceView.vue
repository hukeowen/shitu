<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type AdvanceQuota, type AdvanceRow, type MyWork } from '@shitu/api-client'
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

async function onRefresh() {
  await load()
  refreshing.value = false
}

function goBack() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
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

const reason = computed(() => quota.value?.reasons[0] ?? '')
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
  try {
    const id = await seekerApi.applyAdvance()
    showToast({ type: 'success', message: '申请已提交' })
    void router.push({ path: `/advance/${id}`, query: { new: '1' } })
  } catch (e) {
    showToast(isApiError(e, 'ADV_4001') ? errorMessage(e).split('；')[0] : errorMessage(e, '提交失败，请稍后重试'))
    void load()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="adv">
    <header class="hero pri ahero">
      <div class="nav">
        <button type="button" class="ico" aria-label="返回" @click="goBack"><van-icon name="arrow-left" size="20" /></button>
        <span class="ttl">薪资预支</span>
        <button type="button" class="ico" aria-label="预支记录" @click="router.push('/advance/records')">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="lbl">单次可预支金额</div>
      <div class="amt">{{ quota ? fmtYuan(quota.amount) : '¥—' }}<small>固定额度</small></div>
      <div class="hstats">
        <div><span>本月剩余机会</span><b class="num">{{ quota?.remainingThisMonth ?? '—' }}<small> / {{ quota?.monthlyLimit ?? 4 }}</small></b></div>
        <div><span>本月已用</span><b class="num">{{ quota?.usedThisMonth ?? '—' }}<small> 次</small></b></div>
        <div><span>当前欠款</span><b class="num" :class="{ owe: debt > 0 }">{{ quota ? fmtYuan(debt) : '—' }}</b></div>
      </div>
    </header>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError || !quota" class="page-state">
        <van-empty image="error" :description="loadError || '加载失败'">
          <van-button round type="primary" size="small" @click="load">重新加载</van-button>
        </van-empty>
      </div>

      <div v-else class="pad stack body">
        <!-- 审批中的一笔 -->
        <button v-if="pending" type="button" class="acard pendc" @click="router.push(`/advance/${pending.advanceId}`)">
          <div class="row-b">
            <span class="tag tag-warn"><i class="dot"></i>审批中</span>
            <span class="t-xs mono">{{ pending.advanceId }}</span>
          </div>
          <div class="row-b" style="margin-top: 8px">
            <span class="pend-t">{{ stageText(pending.status) }}</span>
            <span class="num pend-a">{{ fmtYuan(pending.amount) }}</span>
          </div>
          <div class="t-xs" style="margin-top: 4px">查看审批进度 ›</div>
        </button>

        <section class="acard">
          <div class="acard-hd"><h4>在岗日进度</h4><span class="t-xs">累计在岗 <b class="num strong">{{ quota.dutyDays }}</b> 天</span></div>
          <div class="row-b t-xs" style="margin-bottom: 6px">
            <span>本周期 <b class="num strong">{{ quota.progressInCycle }}</b> / {{ quota.daysPerChance }} 天</span>
            <span v-if="capped" class="warn-t">本月次数已用完，下月恢复</span>
            <span v-else class="sig-t">再在岗 <b class="num">{{ cycle.left }}</b> 天获得下一次</span>
          </div>
          <div class="bar" role="progressbar" :aria-valuenow="quota.progressInCycle" :aria-valuemax="quota.daysPerChance"><i class="sig" :style="{ width: `${cycle.pct}%` }"></i></div>
          <div class="ticks">
            <i v-for="d in quota.daysPerChance" :key="d" :class="{ on: d <= quota.progressInCycle }"></i>
          </div>
          <p class="t-xs" style="margin-top: 8px; line-height: 1.6">在岗日 = 入职以来的自然日，扣除驻场登记的请假与旷工</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>本月额度</h4><span class="t-xs">本月获得 {{ quota.grantedThisMonth }} 次</span></div>
          <div class="slots">
            <div v-for="s in slots" :key="s.k" class="slot" :class="s.cls">
              <div class="t-xs">第 {{ s.k + 1 }} 次</div>
              <b>{{ s.t }}</b>
            </div>
          </div>
          <div class="note note--warn" style="margin-top: 10px">
            每满 <b>{{ quota.daysPerChance }} 个在岗日</b>获得一次预支机会；<b>当月机会月末清零，不结转</b>。已到账未还的欠款顺延结转 —— 欠款结转 ≠ 额度结转。
          </div>
        </section>

        <section class="acard">
          <div class="acard-hd">
            <h4>准入条件</h4>
            <span class="tag" :class="quota.eligible ? 'tag-ok' : allOk ? 'tag-warn' : 'tag-muted'">{{ quota.eligible ? '已满足' : '未满足' }}</span>
          </div>
          <ul class="rules">
            <li v-for="r in admission.rules" :key="r.t" :class="{ bad: !r.ok }">
              <i>{{ r.ok ? '✓' : '✕' }}</i><span>{{ r.t }}</span>
            </li>
          </ul>
          <div v-for="x in admission.extra" :key="x" class="note note--warn" style="margin-top: 10px">{{ x }}</div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>规则说明</h4></div>
          <dl>
            <div class="kv"><dt>单次金额</dt><dd>固定 {{ fmtAmount(quota.amount) }} 元 / 次</dd></div>
            <div class="kv"><dt>月度上限</dt><dd>每月最多 {{ quota.monthlyLimit }} 次</dd></div>
            <div class="kv"><dt>审批流程</dt><dd>驻场初审 → 项目经理终审 → 拨款</dd></div>
            <div class="kv"><dt>还款方式</dt><dd>发薪日自动抵扣，无需主动还款</dd></div>
            <div class="kv"><dt>抵扣不足</dt><dd>剩余欠款结转下月</dd></div>
            <div class="kv"><dt>离职处理</dt><dd>离职前须结清，从最后一笔工资扣除</dd></div>
          </dl>
        </section>

        <van-button block class="btn-cta" @click="router.push('/advance/records')">预支记录与还款</van-button>
        <div class="bottom-bar-gap" :class="{ tall: !!quota && !quota.eligible && !!reason }"></div>
      </div>
    </van-pull-refresh>

    <div v-if="quota" class="bottom-bar">
      <p v-if="!quota.eligible && reason" class="why">{{ reason }}</p>
      <van-button type="primary" block class="btn-cta" :disabled="!quota.eligible" :loading="submitting" loading-text="提交中…" @click="onApply">
        申请预支 {{ fmtYuan(quota.amount) }}
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.adv { min-height: 100vh; background: var(--surface-2); }
.ahero { padding-bottom: 26px; }
.nav { display: flex; align-items: center; justify-content: space-between; margin: 0 -6px 16px; }
.nav .ico { width: 34px; height: 34px; display: grid; place-items: center; background: none; border: 0; color: #fff; padding: 0; }
.nav .ttl { font-size: 15px; font-weight: 700; }
.lbl { font-size: 12px; color: rgba(255, 255, 255, .6); }
.amt { font-family: var(--f-dis); font-size: 44px; font-weight: 700; line-height: 1.05; margin-top: 2px; }
.amt small { font-size: 14px; color: rgba(255, 255, 255, .5); font-weight: 500; margin-left: 6px; font-family: inherit; }
.hstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px dashed rgba(255, 255, 255, .2); }
.hstats span { display: block; font-size: 11px; color: rgba(255, 255, 255, .55); }
.hstats b { display: block; font-size: 19px; margin-top: 2px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hstats b small { font-size: 12px; color: rgba(255, 255, 255, .5); font-weight: 500; }
.hstats b.owe { color: var(--signal-300); }
.body { margin-top: -10px; position: relative; z-index: 2; }
.page-state { padding-top: 40px; }
button.acard { display: block; width: 100%; text-align: left; font: inherit; }
.pendc { border-color: var(--warn-line); background: var(--warn-bg); }
.pend-t { font-size: 14px; font-weight: 700; color: var(--warn); }
.pend-a { font-size: 18px; font-weight: 700; color: var(--warn); }
.bar { height: 8px; border-radius: 4px; }
.ticks { display: flex; gap: 3px; margin-top: 6px; }
.ticks i { flex: 1; height: 3px; border-radius: 2px; background: var(--line-2); }
.ticks i.on { background: var(--signal); }
.sig-t { color: var(--signal); font-weight: 600; }
.warn-t { color: var(--warn); font-weight: 600; }
.slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.slot { text-align: center; padding: 9px 0; border-radius: var(--r-sm); background: var(--surface-2); border: 1px dashed var(--line-2); color: var(--ink-400); }
.slot b { display: block; font-size: 13px; margin-top: 2px; }
.slot .t-xs { color: inherit; }
.slot.used { background: var(--ok-bg); border: 1px solid var(--ok-line); color: var(--ok); }
.slot.rev { background: var(--warn-bg); border: 1.5px solid var(--warn-line); color: var(--warn); }
.slot.avail { background: var(--signal-50); border: 1.5px solid var(--signal); color: var(--signal); }
.rules { display: grid; gap: 9px; }
.rules li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--ink-700); line-height: 1.5; }
.rules li i { flex: none; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 11px; font-weight: 700; background: var(--ok-bg); color: var(--ok); margin-top: 1px; }
.rules li.bad { color: var(--ink-500); }
.rules li.bad i { background: var(--danger-bg); color: var(--danger); }
.why { font-size: 12px; color: var(--warn); text-align: center; margin-bottom: 8px; line-height: 1.5; text-wrap: balance; }
</style>
