<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, tenantApi, type LedgerLine } from '@shitu/api-client'
import { IconArrowLeftRight, IconBanknote, IconCircleExclamationPoint, IconInfo, IconUsers, IconWallet } from '@shitu/ui-icons'
import { fmtSigned, toNum } from '@/utils/format'
import { ym } from '@/utils/time'

/**
 * A-10 人才流转账本（T-404，老板）：流入应付（我用了别人的人，10 元/人/天）与流出应收（别人用了我的人，8 元/人/天），
 * 按公司、按人两级汇总，不轧差。后端只返回 userId / 对方公司编号，不展示其他公司的员工隐私。
 */
const route = useRoute()
const router = useRouter()
const month = ref<string>(typeof route.query.month === 'string' && /^\d{4}-\d{2}$/.test(route.query.month) ? route.query.month : ym(shNow()))
const lines = ref<LedgerLine[]>([])
const loading = ref(false)
const loadError = ref('')
/** 账本拿到过数据（没拿到时指标显示「—」、不下「本月无记录」的结论） */
const ready = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  ready.value = false
  try {
    lines.value = await tenantApi.ledger(month.value)
    ready.value = true
  } catch (e) {
    loadError.value = errorMessage(e, '流转账本加载失败')
    lines.value = []
  } finally {
    loading.value = false
  }
}
watch(month, (m) => {
  router.replace({ query: { ...route.query, month: m } })
  load()
})
onMounted(load)

interface Side {
  rows: LedgerLine[]
  people: number
  days: number
  amount: number
  byCompany: { company: string; people: number; days: number; amount: number }[]
}
function side(dir: LedgerLine['direction']): Side {
  const rows = lines.value.filter((l) => l.direction === dir).sort((a, b) => toNum(b.amount) - toNum(a.amount))
  const map = new Map<string, { company: string; people: number; days: number; amount: number }>()
  rows.forEach((r) => {
    const k = r.counterpartCompanyId ?? '—'
    const g = map.get(k) ?? { company: k, people: 0, days: 0, amount: 0 }
    g.people += 1
    g.days += toNum(r.days)
    g.amount += toNum(r.amount)
    map.set(k, g)
  })
  return {
    rows,
    people: new Set(rows.map((r) => r.userId)).size,
    days: rows.reduce((s, r) => s + toNum(r.days), 0),
    amount: rows.reduce((s, r) => s + toNum(r.amount), 0),
    byCompany: [...map.values()].sort((a, b) => b.amount - a.amount),
  }
}
const payable = computed(() => side('PAYABLE'))
const receivable = computed(() => side('RECEIVABLE'))
/** 两边的卡片：流入应付是我付钱（−），流出应收是我收钱（+） */
const sides = computed(() => [
  { key: 'PAYABLE', title: '② 流入应付 · 我是接收方', sub: '别人的人在我司', data: payable.value, dir: 'out' as const, unit: '10 元', company: '来源归属公司', total: '应付合计' },
  { key: 'RECEIVABLE', title: '① 流出应收 · 我是来源方', sub: '我的人在别人那', data: receivable.value, dir: 'in' as const, unit: '8 元', company: '现使用公司', total: '应收合计' },
])
const disabledMonth = (d: Date) => d.getTime() > shNowMs()
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>人才流转账本</h2>
        <p>{{ month }} · 我的人流出去谁在用、谁的人流进来我该付给谁</p>
      </div>
      <span class="spacer" />
      <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" :disabled-date="disabledMonth" style="width: 140px" />
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="notice-bar rule">
      <IconInfo :size="16" class="notice-bar-i" />
      <span>规则只有一条：<b>别人用了我的人</b> → 我收 <b class="money-in">8.00</b> 元/人/天；<b>我用了别人的人</b> → 我付 <b class="money-in">10.00</b> 元/人/天。判定依据：用户的来源归属（注册时永久锁定）。</span>
    </div>

    <div v-loading="loading" class="body">
      <div class="kpis">
        <div class="stat stat--icon">
          <IconUsers :size="20" class="stat-i" />
          <div class="stat-l">流入人员（应付）</div><div class="stat-v">{{ ready ? payable.people : '—' }}</div><div class="stat-d">{{ ready ? `${payable.days} 人天` : '—' }}</div>
        </div>
        <div class="stat stat--icon">
          <IconWallet :size="20" class="stat-i" />
          <div class="stat-l">流转费应付</div><div class="stat-v money">{{ ready ? fmtSigned(payable.amount, 'out') : '—' }}</div><div class="stat-d">计入本月账单应付</div>
        </div>
        <div class="stat stat--icon">
          <IconArrowLeftRight :size="20" class="stat-i" />
          <div class="stat-l">流出人员（应收）</div><div class="stat-v">{{ ready ? receivable.people : '—' }}</div><div class="stat-d">{{ ready ? `${receivable.days} 人天` : '—' }}</div>
        </div>
        <div class="stat stat--icon">
          <IconBanknote :size="20" class="stat-i" />
          <div class="stat-l">流转费应收</div><div class="stat-v money">{{ ready ? fmtSigned(receivable.amount, 'in') : '—' }}</div><div class="stat-d">平台另行结算 · 不轧差</div>
        </div>
      </div>

      <div v-if="loadError" class="card fail">
        <div class="state-box">
          <IconCircleExclamationPoint :size="48" />
          <h4>{{ loadError }}</h4>
          <p>请检查网络后重新加载</p>
          <el-button @click="load">重新加载</el-button>
        </div>
      </div>
      <div v-else-if="ready && !lines.length" class="card fail">
        <div class="state-box">
          <IconArrowLeftRight :size="48" />
          <h4>{{ month }} 没有流转记录</h4>
          <p>这个月没有别的公司的人在我司计费，也没有我司引入的人在别家计费；换个月份看看，或到「流转人员台账」查逐人记录</p>
          <el-button @click="router.push('/circulation/people')">查看流转人员台账</el-button>
        </div>
      </div>
      <div v-else class="sides">
        <div v-for="s in sides" :key="s.key" class="card side-card">
          <div class="card__hd"><h3>{{ s.title }}</h3><span class="hint">{{ s.sub }}</span></div>
          <div class="card__bd">
            <h4 class="blk-t">按公司</h4>
            <el-table :data="s.data.byCompany" row-key="company">
              <el-table-column :label="s.company" min-width="140">
                <template #default="{ row }"><span class="code">{{ row.company }}</span></template>
              </el-table-column>
              <el-table-column label="人数" width="64" align="right"><template #default="{ row }">{{ row.people }}</template></el-table-column>
              <el-table-column label="人天" width="70" align="right"><template #default="{ row }">{{ row.days }}</template></el-table-column>
              <el-table-column :label="`金额（${s.unit}）`" min-width="116" align="right"><template #default="{ row }"><span class="money">{{ fmtSigned(row.amount, s.dir) }}</span></template></el-table-column>
              <template #empty><span v-if="ready" class="hint">本月无记录</span><span v-else /></template>
            </el-table>
            <h4 class="blk-t by-person">按人</h4>
            <el-table :data="s.data.rows" max-height="360" :row-key="(r: LedgerLine) => `${r.userId}-${r.counterpartCompanyId ?? ''}`">
              <el-table-column label="用户编号" min-width="140"><template #default="{ row }"><span class="code">{{ row.userId }}</span></template></el-table-column>
              <el-table-column label="对方公司" min-width="100"><template #default="{ row }"><span class="code">{{ row.counterpartCompanyId ?? '—' }}</span></template></el-table-column>
              <el-table-column label="计费天数" width="84" align="right"><template #default="{ row }">{{ row.days }}</template></el-table-column>
              <el-table-column label="金额" min-width="108" align="right"><template #default="{ row }"><span class="money">{{ fmtSigned(row.amount, s.dir) }}</span></template></el-table-column>
              <template #empty><span v-if="ready" class="hint">本月无记录</span><span v-else /></template>
            </el-table>
          </div>
          <div class="card__ft total">
            <span class="hint">合计 {{ ready ? s.data.people : '—' }} 人 · {{ ready ? s.data.days : '—' }} 人天</span>
            <span class="spacer" />
            <span class="total-l">{{ s.total }}</span>
            <b class="money total-v">{{ ready ? fmtSigned(s.data.amount, s.dir) : '—' }}</b>
          </div>
        </div>
      </div>
    </div>

    <p class="foot">
      ① 双向互流<b>不轧差</b>，应收应付各自独立结算。② 用户被释放或离职<b>不改变来源归属</b>，离职即停止计费，历史金额固定留存。③ 账本只展示用户编号，不含其他公司员工的姓名、手机号等隐私信息。
    </p>
  </div>
</template>

<style scoped>
.rule { margin-bottom: var(--space-gap); }
.money-in { font-variant-numeric: tabular-nums; font-weight: var(--font-weight-semibold); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.fail, .sides { margin-top: var(--space-gap); }
.sides { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); align-items: start; }
.side-card { min-width: 0; }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.side-card :deep(.el-table__body .el-table__cell) { height: 48px; }
.by-person { margin-top: var(--space-6); }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-1); }
.total { display: flex; align-items: center; gap: var(--space-2); }
.total-l { font-size: var(--font-size-aux); color: var(--text-2); }
.total-v { font-size: var(--font-size-section); }
.foot { margin-top: var(--space-gap); font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-3); }
.foot b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
</style>
