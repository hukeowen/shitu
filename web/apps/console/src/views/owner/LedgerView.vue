<script setup lang="ts">
import { shNowMs, shNow } from '@/utils/time'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, tenantApi, type LedgerLine } from '@shitu/api-client'
import { fmtYuan, toNum } from '@/utils/format'
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

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    lines.value = await tenantApi.ledger(month.value)
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
  byCompany: { company: string; name: string; people: number; days: number; amount: number }[]
}
function side(dir: LedgerLine['direction']): Side {
  const rows = lines.value.filter((l) => l.direction === dir).sort((a, b) => toNum(b.amount) - toNum(a.amount))
  const map = new Map<string, Side['byCompany'][number]>()
  rows.forEach((r) => {
    const k = r.counterpartCompanyId ?? '—'
    const g = map.get(k) ?? { company: k, name: r.counterpartCompanyName ?? '', people: 0, days: 0, amount: 0 }
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
/**
 * 左 ① 流出应收、右 ② 流入应付。流出一侧按规则不返回去向公司（来源方看不到自己的人现在在哪家公司），
 * 所以不显示「按公司」汇总和「对方公司」列，在副标题里说明。
 */
const SIDES = computed(() => [
  { key: 'RECEIVABLE' as const, title: '① 流出应收 · 我是来源方', sub: '我的人在别家在岗 · 按规则不显示去向公司', data: receivable.value, color: 'var(--ok)', unit: '8 元' },
  { key: 'PAYABLE' as const, title: '② 流入应付 · 我是接收方', sub: '别人的人在我司在岗 · 付给来源归属公司', data: payable.value, color: 'var(--danger)', unit: '10 元' },
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

    <div class="note rule" style="margin-bottom: 14px">
      <b>规则只有一条</b>
      <span class="row"><span class="tag tag--ok tag--lg">别人用了我的人</span>→ <span class="strong">我收 <b class="num" style="color: var(--ok)">8.00</b> 元/人/天</span></span>
      <span class="row"><span class="tag tag--danger tag--lg">我用了别人的人</span>→ <span class="strong">我付 <b class="num" style="color: var(--danger)">10.00</b> 元/人/天</span></span>
      <span class="spacer" />
      <span class="t-sm">判定依据：用户的来源归属（注册时永久锁定）</span>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="load">重试</el-button>
    </el-alert>

    <div class="grid g-4">
      <div class="stat"><div class="stat-l">流出人员（应收）</div><div class="stat-v">{{ receivable.people }}</div><div class="stat-d">{{ receivable.days }} 人天</div></div>
      <div class="stat"><div class="stat-l">流转费应收</div><div class="stat-v" style="color: var(--ok)">{{ fmtYuan(receivable.amount) }}</div><div class="stat-d">平台另行结算 · 不轧差</div></div>
      <div class="stat"><div class="stat-l">流入人员（应付）</div><div class="stat-v">{{ payable.people }}</div><div class="stat-d">{{ payable.days }} 人天</div></div>
      <div class="stat"><div class="stat-l">流转费应付</div><div class="stat-v" style="color: var(--danger)">{{ fmtYuan(payable.amount) }}</div><div class="stat-d">计入本月账单应付</div></div>
    </div>

    <div class="grid g-2 grid--top" style="margin-top: 14px">
      <div v-for="s in SIDES" :key="s.key" class="card">
        <div class="card__hd"><h3>{{ s.title }}</h3><span class="t-xs">{{ s.sub }}</span></div>
        <div class="card__bd" style="padding-bottom: 6px">
          <template v-if="s.key === 'PAYABLE'">
            <div class="sec-title" style="margin-bottom: 8px">按来源归属公司</div>
            <el-table v-loading="loading" :data="s.data.byCompany" size="small" row-key="company">
              <el-table-column label="来源归属公司" min-width="170">
                <template #default="{ row }">
                  <div class="t-sm strong ellip" :title="row.name || row.company">{{ row.name || row.company }}</div>
                  <div v-if="row.name && row.name !== row.company && row.name !== '平台'" class="mono t-xs">{{ row.company }}</div>
                </template>
              </el-table-column>
              <el-table-column label="人数" min-width="64" align="right"><template #default="{ row }"><span class="num">{{ row.people }}</span></template></el-table-column>
              <el-table-column label="人天" min-width="70" align="right"><template #default="{ row }"><span class="num">{{ row.days }}</span></template></el-table-column>
              <el-table-column :label="`金额（${s.unit}/人/天）`" min-width="140" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.amount) }}</span></template></el-table-column>
              <template #empty><span class="t-xs">本月无记录</span></template>
            </el-table>
          </template>
          <div class="sec-title" :style="{ margin: s.key === 'PAYABLE' ? '16px 0 8px' : '0 0 8px' }">按人</div>
          <el-table v-loading="loading" :data="s.data.rows" size="small" max-height="360" :row-key="(r: LedgerLine) => `${r.userId}-${r.counterpartCompanyId ?? ''}`">
            <el-table-column label="用户编号" min-width="150" show-overflow-tooltip><template #default="{ row }"><span class="mono t-sm">{{ row.userId }}</span></template></el-table-column>
            <el-table-column v-if="s.key === 'PAYABLE'" label="来源归属公司" min-width="140" show-overflow-tooltip>
              <template #default="{ row }"><span class="t-sm">{{ row.counterpartCompanyName || row.counterpartCompanyId || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="计费天数" min-width="88" align="right"><template #default="{ row }"><span class="num">{{ row.days }}</span></template></el-table-column>
            <el-table-column :label="s.key === 'PAYABLE' ? '金额' : `金额（${s.unit}/人/天）`" min-width="120" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.amount) }}</span></template></el-table-column>
            <template #empty><span class="t-xs">本月无记录</span></template>
          </el-table>
        </div>
        <div class="card__ft row">
          <span class="t-sm">合计 {{ s.data.people }} 人 · {{ s.data.days }} 人天</span>
          <span class="spacer" />
          <b class="num" :style="{ color: s.color, fontSize: '16px' }">{{ fmtYuan(s.data.amount) }}</b>
        </div>
      </div>
    </div>

    <div class="note" style="margin-top: 14px">
      ① 双向互流<b>不轧差</b>，应收应付各自独立结算。② 用户被释放或离职<b>不改变来源归属</b>，离职即停止计费，历史金额固定留存。③ 账本只展示用户编号，不含其他公司员工的姓名、手机号等隐私信息；流出的人员不显示去向公司。
    </div>
  </div>
</template>

<style scoped>
.rule { display: flex; align-items: center; gap: 10px 22px; flex-wrap: wrap; }
.rule .row { gap: 8px; color: var(--ink-400); }
.rule .spacer { flex: 1; }
</style>
