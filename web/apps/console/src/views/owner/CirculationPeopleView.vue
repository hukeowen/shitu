<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type CirculationPerson } from '@shitu/api-client'
import { fmtYuan, toNum } from '@/utils/format'

/**
 * 流转人员台账（T-404 的按人累计视图，老板）：逐人看流转费从哪天计到哪天、每天多少、本月多少、累计多少。
 * 流入（我付费）的人在我司任职，展示脱敏姓名、岗位、来源公司；流出（我收费）的人只有用户编号、天数和金额。
 */
const router = useRouter()
const rows = ref<CirculationPerson[]>([])
const loading = ref(false)
const loadError = ref('')

type Tab = 'out' | 'in' | 'ended'
const tab = ref<Tab>('out')
const keyword = ref('')
const counterpart = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await tenantApi.ledgerPeople()
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
const TABS = computed<{ key: Tab; label: string; n: number }[]>(() => [
  { key: 'out', label: '流出 · 我收钱', n: outActive.value.length },
  { key: 'in', label: '流入 · 我付钱', n: inActive.value.length },
  { key: 'ended', label: '已停止计费', n: ended.value.length },
])
function setTab(t: Tab) {
  tab.value = t
  counterpart.value = ''
}
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
const listMonth = computed(() => sum(list.value, (r) => r.monthAmount))
const listTotal = computed(() => sum(list.value, (r) => r.totalAmount))

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

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="load">重试</el-button>
    </el-alert>

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" type="button" :class="{ on: tab === t.key }" @click="setTab(t.key)">{{ t.label }}<span class="n">{{ t.n }}</span></button>
        </div>
        <div class="tb-fields">
          <el-select v-if="tab !== 'out'" v-model="counterpart" clearable placeholder="全部来源公司" style="width: 180px">
            <el-option v-for="c in counterparts" :key="c.value" :value="c.value" :label="c.label" />
          </el-select>
          <el-input v-model="keyword" clearable :placeholder="tab === 'out' ? '用户编号' : '姓名 / 用户编号'" style="width: 180px" />
        </div>
      </div>

      <div v-if="tab === 'out'" class="banner ok">
        <span><b>这些人由我司引入平台（来源归属是我司），现在在别的公司上班。</b>他们每在职一天，我司收一笔流转费，不承担用工成本。按规则只显示用户编号，不显示去向公司和岗位。</span>
        <b class="num">+{{ fmtYuan(outDaily) }} / 天</b>
      </div>
      <div v-else-if="tab === 'in'" class="banner danger">
        <span><b>这些人由别的公司或平台引入，现在在我司上班。</b>他们每在职一天，我司付一笔流转费，其中一部分给来源公司、一部分给平台。</span>
        <b class="num">−{{ fmtYuan(inDaily) }} / 天</b>
      </div>
      <div v-else class="banner">
        <span>最近一个计费日已经没有记录的人：离职、被释放或调整后停止计费。历史金额固定留存，不会回退。</span>
      </div>

      <el-table v-loading="loading" :data="list" :row-key="(r: CirculationPerson) => `${r.direction}-${r.userId}-${r.firstDate}`" max-height="620">
        <el-table-column v-if="tab === 'ended'" label="方向" min-width="110">
          <template #default="{ row }"><span class="tag" :class="row.direction === 'PAYABLE' ? 'tag--danger' : 'tag--ok'">{{ row.direction === 'PAYABLE' ? '流入 · 我付' : '流出 · 我收' }}</span></template>
        </el-table-column>
        <el-table-column v-if="tab !== 'out'" label="姓名" min-width="96"><template #default="{ row }"><span class="nowrap">{{ row.name ?? '—' }}</span></template></el-table-column>
        <el-table-column label="用户编号" min-width="160" show-overflow-tooltip><template #default="{ row }"><span class="mono t-sm">{{ row.userId }}</span></template></el-table-column>
        <el-table-column v-if="tab !== 'out'" label="来源归属（付给谁）" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.counterpartCompanyName ?? row.counterpartCompanyId ?? '—' }}</template>
        </el-table-column>
        <el-table-column v-if="tab !== 'out'" label="我司岗位" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.jobTitle ?? '—' }}</template></el-table-column>
        <el-table-column label="计费起始日" min-width="120"><template #default="{ row }"><span class="mono t-sm">{{ row.firstDate }}</span></template></el-table-column>
        <el-table-column label="最近计费日" min-width="120"><template #default="{ row }"><span class="mono t-sm">{{ row.lastDate }}</span></template></el-table-column>
        <el-table-column label="计费天数" min-width="90" align="right"><template #default="{ row }"><span class="num">{{ row.days }}</span></template></el-table-column>
        <el-table-column :label="tab === 'out' ? '日收' : tab === 'in' ? '日付' : '日金额'" min-width="96" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.dailyAmount) }}</span></template></el-table-column>
        <el-table-column label="本月" min-width="116" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.monthAmount) }}</span></template></el-table-column>
        <el-table-column label="累计" min-width="124" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.totalAmount) }}</span></template></el-table-column>
        <el-table-column label="状态" min-width="110">
          <template #default="{ row }"><span class="tag" :class="row.active ? 'tag--ok' : 'tag--muted'">{{ row.active ? '计费中' : '已停止计费' }}</span></template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="56" :description="keyword || counterpart ? '没有符合条件的人员' : tab === 'out' ? '目前没有我司引入、在别的公司任职的人' : tab === 'in' ? '目前没有其他来源的人在我司任职' : '没有已停止计费的记录'" />
        </template>
      </el-table>
      <div class="card__ft row">
        <span class="t-sm">共 {{ list.length }} 人</span>
        <span class="spacer" />
        <span class="t-sm">本月合计 <b class="num">{{ fmtYuan(listMonth) }}</b></span>
        <span class="t-sm" style="margin-left: 18px">累计合计 <b class="num">{{ fmtYuan(listTotal) }}</b></span>
      </div>
    </div>

    <div class="note" style="margin-top: 14px">
      ① 金额以每日计费明细为准，和「流转账本」「费用账单」是同一份数据。② 同一个人离职后再次入职，按任职段分开列。③ 来源归属注册时锁定，离职、释放都不改变。
    </div>
  </div>
</template>

<style scoped>
.banner { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--line); font-size: 13.5px; line-height: 1.7; color: var(--ink-600); }
.banner span { flex: 1; min-width: 0; }
.banner > b { flex: none; font-size: 15px; }
.banner.ok { background: var(--ok-bg); border-bottom-color: var(--ok-line); color: var(--ok); }
.banner.danger { background: var(--danger-bg); border-bottom-color: var(--danger-line); color: var(--danger); }
</style>
