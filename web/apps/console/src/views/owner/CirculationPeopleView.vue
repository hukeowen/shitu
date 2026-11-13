<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type CirculationPerson } from '@shitu/api-client'
import { IconArrowLeftRight, IconCircleExclamationPoint, IconInfo, IconUserMinus, IconUsers } from '@shitu/ui-icons'
import { fmtSigned, toNum } from '@/utils/format'

/**
 * 流转人员台账（T-404 的按人累计视图，老板）：逐人看流转费从哪天计到哪天、每天多少、本月多少、累计多少。
 * 流入（我付费）的人在我司任职，展示脱敏姓名、岗位、来源公司；流出（我收费）的人只有用户编号、天数和金额。
 */
const router = useRouter()
const rows = ref<CirculationPerson[]>([])
const loading = ref(false)
const loadError = ref('')
/** 台账拿到过数据（没拿到时指标和页签不显示数字） */
const ready = ref(false)

type Tab = 'out' | 'in' | 'ended'
const tab = ref<Tab>('out')
const keyword = ref('')
const counterpart = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  ready.value = false
  try {
    rows.value = await tenantApi.ledgerPeople()
    ready.value = true
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '流转人员台账加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const outActive = computed(() => rows.value.filter((r) => r.direction === 'RECEIVABLE' && r.active))
const inActive = computed(() => rows.value.filter((r) => r.direction === 'PAYABLE' && r.active))
const ended = computed(() => rows.value.filter((r) => !r.active))
const base = computed(() => (tab.value === 'out' ? outActive.value : tab.value === 'in' ? inActive.value : ended.value))

/** 对手方筛选只对流入的人有意义（流出不返回去向公司） */
const counterparts = computed(() => {
  const m = new Map<string, string>()
  rows.value.forEach((r) => {
    if (r.counterpartCompanyId) m.set(r.counterpartCompanyId, r.counterpartCompanyName ?? r.counterpartCompanyId)
  })
  return [...m.entries()].map(([value, label]) => ({ value, label }))
})
const list = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return base.value.filter(
    (r) =>
      (!counterpart.value || r.counterpartCompanyId === counterpart.value) &&
      (!k || r.userId.toLowerCase().includes(k) || (r.name ?? '').toLowerCase().includes(k)),
  )
})
const sum = (xs: CirculationPerson[], f: (r: CirculationPerson) => number | string) => xs.reduce((s, r) => s + toNum(f(r)), 0)
const outDaily = computed(() => sum(outActive.value, (r) => r.dailyAmount))
const inDaily = computed(() => sum(inActive.value, (r) => r.dailyAmount))
/** 底部合计按方向算净额（我收为正、我付为负），和每行的 +/− 一致 */
const net = (f: (r: CirculationPerson) => number | string) => list.value.reduce((s, r) => s + (r.direction === 'RECEIVABLE' ? 1 : -1) * toNum(f(r)), 0)
const listMonth = computed(() => net((r) => r.monthAmount))
const listTotal = computed(() => net((r) => r.totalAmount))

/** 金额方向：流出是我收（+），流入是我付（−）；已停止计费页按每行自己的方向 */
const dirOf = (r: CirculationPerson) => (r.direction === 'RECEIVABLE' ? 'in' : 'out') as 'in' | 'out'
const TABS: { key: Tab; label: string }[] = [
  { key: 'out', label: '流出 · 我收钱' },
  { key: 'in', label: '流入 · 我付钱' },
  { key: 'ended', label: '已停止计费' },
]
const tabCount = (t: Tab) => (t === 'out' ? outActive.value.length : t === 'in' ? inActive.value.length : ended.value.length)
function pickTab(t: Tab) {
  tab.value = t
  counterpart.value = ''
}

function exportCsv() {
  const head = ['方向', '用户编号', '姓名', '对方公司', '岗位', '计费起始日', '最近计费日', '计费天数', '日金额', '本月金额', '累计金额', '状态']
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = list.value.map((r) =>
    [r.direction === 'PAYABLE' ? '流入（我付）' : '流出（我收）', r.userId, r.name, r.counterpartCompanyName, r.jobTitle, r.firstDate, r.lastDate, r.days, r.dailyAmount, r.monthAmount, r.totalAmount, r.active ? '计费中' : '已停止计费']
      .map(cell)
      .join(','),
  )
  const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `流转人员台账-${tab.value === 'out' ? '流出' : tab.value === 'in' ? '流入' : '已停止计费'}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>流转人员台账</h2>
        <p>逐人可查：流转费从哪天计到哪天、每天多少钱、本月多少、累计多少</p>
      </div>
      <span class="spacer" />
      <el-button @click="router.push('/circulation/ledger')">返回账本</el-button>
      <el-button :disabled="!list.length" @click="exportCsv">导出当前列表</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <div v-loading="loading" class="kpis">
      <div class="stat stat--icon">
        <IconArrowLeftRight :size="20" class="stat-i" />
        <div class="stat-l">流出计费中（我收钱）</div>
        <div class="stat-v money">{{ ready ? `${fmtSigned(outDaily, 'in')} / 天` : '—' }}</div>
        <div class="stat-d">{{ ready ? `${outActive.length} 人在别的公司任职` : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconUsers :size="20" class="stat-i" />
        <div class="stat-l">流入计费中（我付钱）</div>
        <div class="stat-v money">{{ ready ? `${fmtSigned(inDaily, 'out')} / 天` : '—' }}</div>
        <div class="stat-d">{{ ready ? `${inActive.length} 人在我司任职` : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconUserMinus :size="20" class="stat-i" />
        <div class="stat-l">已停止计费</div>
        <div class="stat-v">{{ ready ? ended.length : '—' }}</div>
        <div class="stat-d">离职、被释放或调整后停止</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="pickTab(t.key)">
            {{ t.label }}<span v-if="ready" class="n">{{ tabCount(t.key) }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-select v-if="tab !== 'out'" v-model="counterpart" clearable placeholder="全部来源公司" style="width: 180px">
          <el-option v-for="c in counterparts" :key="c.value" :value="c.value" :label="c.label" />
        </el-select>
        <el-input v-model="keyword" clearable :placeholder="tab === 'out' ? '用户编号' : '姓名 / 用户编号'" style="width: 180px" />
      </div>

      <div class="notice-bar tbl-tip">
        <IconInfo :size="16" class="notice-bar-i" />
        <span v-if="tab === 'out'"><b>这些人由我司引入平台（来源归属是我司），现在在别的公司上班。</b>他们每在职一天，我司收一笔流转费，不承担用工成本。按规则只显示用户编号，不显示去向公司和岗位。</span>
        <span v-else-if="tab === 'in'"><b>这些人由别的公司或平台引入，现在在我司上班。</b>他们每在职一天，我司付一笔流转费，其中一部分给来源公司、一部分给平台。</span>
        <span v-else>最近一个计费日已经没有记录的人：离职、被释放或调整后停止计费。历史金额固定留存，不会回退。</span>
      </div>

      <el-table v-loading="loading" :data="list" :row-key="(r: CirculationPerson) => `${r.direction}-${r.userId}-${r.firstDate}`" max-height="620">
        <el-table-column v-if="tab === 'ended'" label="方向" width="100">
          <template #default="{ row }"><span class="status-tag" :class="row.direction === 'PAYABLE' ? 'status-tag--neutral' : 'status-tag--info'">{{ row.direction === 'PAYABLE' ? '流入 · 我付' : '流出 · 我收' }}</span></template>
        </el-table-column>
        <el-table-column :label="tab === 'out' ? '用户编号' : '人员'" min-width="130">
          <template #default="{ row }">
            <div v-if="tab !== 'out'" class="who">{{ row.name ?? '—' }}</div>
            <span class="code" :class="{ 'code--sub': tab !== 'out' }">{{ row.userId }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="tab !== 'out'" label="来源归属（付给谁）" min-width="100">
          <template #default="{ row }">{{ row.counterpartCompanyName ?? row.counterpartCompanyId ?? '—' }}</template>
        </el-table-column>
        <el-table-column v-if="tab !== 'out'" label="我司岗位" min-width="100"><template #default="{ row }">{{ row.jobTitle ?? '—' }}</template></el-table-column>
        <el-table-column label="计费起止" width="156">
          <template #default="{ row }"><div class="code">{{ row.firstDate }}</div><div class="code code--sub">{{ row.active ? '最近计费' : '至' }} {{ row.lastDate }}</div></template>
        </el-table-column>
        <el-table-column label="计费天数" width="84" align="right"><template #default="{ row }">{{ row.days }}</template></el-table-column>
        <el-table-column :label="tab === 'out' ? '日收' : tab === 'in' ? '日付' : '日金额'" width="96" align="right"><template #default="{ row }"><span class="money">{{ fmtSigned(row.dailyAmount, dirOf(row)) }}</span></template></el-table-column>
        <el-table-column label="本月" width="112" align="right"><template #default="{ row }"><span class="money">{{ fmtSigned(row.monthAmount, dirOf(row)) }}</span></template></el-table-column>
        <el-table-column label="累计" width="112" align="right"><template #default="{ row }"><span class="money">{{ fmtSigned(row.totalAmount, dirOf(row)) }}</span></template></el-table-column>
        <!-- 已停止计费页的人全是「已停止计费」，状态由页签说明，这一列给「方向」让位 -->
        <el-table-column v-if="tab !== 'ended'" label="状态" width="92">
          <template #default="{ row }"><span class="status-tag" :class="row.active ? 'status-tag--success' : 'status-tag--neutral'">{{ row.active ? '计费中' : '已停止计费' }}</span></template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconUsers :size="48" />
            <h4>{{ keyword || counterpart ? '没有符合条件的人员' : tab === 'out' ? '目前没有我司引入、在别的公司任职的人' : tab === 'in' ? '目前没有其他来源的人在我司任职' : '没有已停止计费的记录' }}</h4>
            <p>{{ keyword || counterpart ? '换个姓名、用户编号或来源公司再试' : '流转费按每日计费明细生成，有人开始计费后会出现在这里' }}</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div class="card__ft total">
        <span class="hint">共 {{ ready ? list.length : '—' }} 人</span>
        <span class="spacer" />
        <span class="hint">本月合计 <b class="money">{{ ready ? fmtSigned(listMonth, 'in') : '—' }}</b></span>
        <span class="hint">累计合计 <b class="money">{{ ready ? fmtSigned(listTotal, 'in') : '—' }}</b></span>
      </div>
    </div>

    <p class="foot">
      ① 金额以每日计费明细为准，和「流转账本」「费用账单」是同一份数据。② 同一个人离职后再次入职，按任职段分开列。③ 来源归属注册时锁定，离职、释放都不改变。
    </p>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4); }
.who { color: var(--text-1); }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-1); white-space: nowrap; }
.code--sub { font-size: var(--font-size-min); color: var(--text-3); }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.total { display: flex; align-items: center; gap: var(--space-4); }
.foot { margin-top: var(--space-gap); font-size: var(--font-size-aux); line-height: 1.8; color: var(--text-3); }
</style>
