<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { errorMessage, tenantApi, type ChannelFunnelRow, type MemberView } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconEye, IconFilePenLine, IconInfo, IconQrCode, IconUserCheck, IconUsers } from '@shitu/ui-icons'
import { useProjects } from '@/composables/useProjects'
import { exportList, type CsvColumn } from '@/utils/exportCsv'

/**
 * A-15 渠道转化报表（T-402，老板 / 项目经理）：按渠道码统计 访问 → 注册 → 报名 → 入职 及各段转化率（累计口径）。
 * 归属人 / 项目由 memberId、projectId 在前端映射名称。
 */
const { projects } = useProjects()
const rows = ref<ChannelFunnelRow[]>([])
const members = ref<MemberView[]>([])
const loading = ref(false)
const loadError = ref('')
/** 报表拿到过数据（没拿到时指标显示「—」，漏斗对比不下「暂无数据」的结论） */
const ready = ref(false)
const keyword = ref('')
const sortKey = ref<'hired' | 'registrations' | 'visits' | 'rate'>('hired')

const memberName = (id: string | null) => (id ? (members.value.find((m) => m.memberId === id)?.name ?? id) : '')
const projectName = (id: string | null) => (id ? (projects.value.find((p) => p.projectId === id)?.name ?? id) : '')

function pct(a: number, b: number): string {
  if (!b) return '—'
  return `${((a / b) * 100).toFixed(1)}%`
}
/** 行内迷你漏斗：以该行最大阶段为 100%（访问记录可能少于注册，不能固定以访问为基数） */
function barW(r: ChannelFunnelRow, k: (typeof STAGES)[number]['key']) {
  const max = Math.max(r.visits, r.registrations, r.applied, r.hired)
  return max ? Math.max(r[k] ? 2 : 0, Math.round((r[k] / max) * 100)) : 0
}
function ratio(a: number, b: number) {
  return b ? a / b : -1
}

const shown = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  const list = rows.value.filter(
    (r) => !k || r.name.toLowerCase().includes(k) || r.code.toLowerCase().includes(k) || memberName(r.memberId).includes(k) || projectName(r.projectId).includes(k),
  )
  const key = (r: ChannelFunnelRow) => (sortKey.value === 'rate' ? ratio(r.hired, r.registrations) : r[sortKey.value])
  return [...list].sort((a, b) => key(b) - key(a))
})
const total = computed(() =>
  shown.value.reduce(
    (s, r) => ({ visits: s.visits + r.visits, registrations: s.registrations + r.registrations, applied: s.applied + r.applied, hired: s.hired + r.hired }),
    { visits: 0, registrations: 0, applied: 0, hired: 0 },
  ),
)
/** 漏斗对比：入职最多的前 5 个渠道 */
const top = computed(() => [...rows.value].filter((r) => r.visits + r.registrations > 0).sort((a, b) => b.hired - a.hired || b.registrations - a.registrations).slice(0, 5))

async function load() {
  loading.value = true
  loadError.value = ''
  ready.value = false
  try {
    rows.value = await tenantApi.reportChannels()
    ready.value = true
  } catch (e) {
    loadError.value = errorMessage(e, '渠道报表加载失败')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  load()
  members.value = await tenantApi.members().catch(() => [])
})

/** 导出：表格当前显示的渠道（按搜索词筛过、按所选排序）；转化率同表格里的小字，没有基数时留空 */
const rate = (a: number, b: number) => (b ? pct(a, b) : '')
const EXPORT_COLUMNS: CsvColumn<ChannelFunnelRow>[] = [
  { header: '渠道', value: (r) => r.name },
  { header: '渠道码', value: (r) => r.code, kind: 'text' },
  { header: '归属人', value: (r) => memberName(r.memberId) || '公司' },
  { header: '归属项目', value: (r) => projectName(r.projectId) || '不限项目' },
  { header: '访问', value: (r) => r.visits },
  { header: '注册', value: (r) => r.registrations },
  { header: '访问→注册', value: (r) => rate(r.registrations, r.visits) },
  { header: '报名', value: (r) => r.applied },
  { header: '注册→报名', value: (r) => rate(r.applied, r.registrations) },
  { header: '入职', value: (r) => r.hired },
  { header: '报名→入职', value: (r) => rate(r.hired, r.applied) },
  { header: '注册→入职', value: (r) => rate(r.hired, r.registrations) },
]
function doExport() {
  exportList({ name: '渠道转化报表', columns: EXPORT_COLUMNS, rows: shown.value })
}

/** 四个阶段用图表分类色（规范 Color Roles）：入职是主色，其余按青、橙、紫 */
const STAGES = [
  { key: 'visits', label: '访问', color: 'var(--chart-2)' },
  { key: 'registrations', label: '注册', color: 'var(--chart-3)' },
  { key: 'applied', label: '报名', color: 'var(--chart-4)' },
  { key: 'hired', label: '入职', color: 'var(--chart-1)' },
] as const
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>渠道转化报表</h2>
        <p>各渠道码带来的访问、注册、报名、入职人数与转化率（累计口径）</p>
      </div>
      <span class="spacer" />
      <el-button :disabled="!shown.length" @click="doExport">导出</el-button>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div v-loading="loading" class="kpis">
      <div class="stat stat--icon">
        <IconEye :size="20" class="stat-i" />
        <div class="stat-l">访问人数</div><div class="stat-v">{{ ready ? total.visits : '—' }}</div><div class="stat-d">扫码 / 打开分享链接（按人去重）</div>
      </div>
      <div class="stat stat--icon">
        <IconUsers :size="20" class="stat-i" />
        <div class="stat-l">注册</div><div class="stat-v">{{ ready ? total.registrations : '—' }}</div><div class="stat-d">访问 → 注册 {{ ready ? pct(total.registrations, total.visits) : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconFilePenLine :size="20" class="stat-i" />
        <div class="stat-l">报名</div><div class="stat-v">{{ ready ? total.applied : '—' }}</div><div class="stat-d">注册 → 报名 {{ ready ? pct(total.applied, total.registrations) : '—' }}</div>
      </div>
      <div class="stat stat--icon stat--signal">
        <IconUserCheck :size="20" class="stat-i" />
        <div class="stat-l">入职</div><div class="stat-v">{{ ready ? total.hired : '—' }}</div><div class="stat-d">注册 → 入职 {{ ready ? pct(total.hired, total.registrations) : '—' }}</div>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索渠道名称 / 渠道码 / 归属人 / 项目" clearable style="width: 280px" />
        <span class="spacer" />
        <span class="hint">排序</span>
        <el-radio-group v-model="sortKey" size="small">
          <el-radio-button value="hired">入职</el-radio-button>
          <el-radio-button value="registrations">注册</el-radio-button>
          <el-radio-button value="visits">访问</el-radio-button>
          <el-radio-button value="rate">注册→入职</el-radio-button>
        </el-radio-group>
      </div>
      <el-table v-loading="loading" :data="shown" row-key="code">
        <el-table-column label="渠道" min-width="150">
          <template #default="{ row }">
            <b class="cname">{{ row.name }}</b>
            <div class="code">{{ row.code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="归属" min-width="120">
          <template #default="{ row }">
            <div>{{ memberName(row.memberId) || '公司' }}</div>
            <div class="hint">{{ projectName(row.projectId) || '不限项目' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="访问" width="72" align="right"><template #default="{ row }">{{ row.visits }}</template></el-table-column>
        <el-table-column label="注册" width="80" align="right">
          <template #default="{ row }">{{ row.registrations }}<div class="hint">{{ pct(row.registrations, row.visits) }}</div></template>
        </el-table-column>
        <el-table-column label="报名" width="80" align="right">
          <template #default="{ row }">{{ row.applied }}<div class="hint">{{ pct(row.applied, row.registrations) }}</div></template>
        </el-table-column>
        <el-table-column label="入职" width="80" align="right">
          <template #default="{ row }"><b>{{ row.hired }}</b><div class="hint">{{ pct(row.hired, row.applied) }}</div></template>
        </el-table-column>
        <el-table-column label="注册→入职" width="100" align="right">
          <template #default="{ row }"><b>{{ pct(row.hired, row.registrations) }}</b></template>
        </el-table-column>
        <el-table-column label="漏斗" min-width="150">
          <template #default="{ row }">
            <div class="mini">
              <template v-for="s in STAGES" :key="s.key">
                <span class="mini-l">{{ s.label }}</span>
                <span class="mini-t"><i :style="{ width: `${barW(row, s.key)}%`, background: s.color }" :title="`${s.label} ${row[s.key]}`" /></span>
              </template>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconQrCode :size="48" />
            <h4>{{ keyword ? '没有符合条件的渠道' : '暂无渠道码' }}</h4>
            <p>{{ keyword ? '换个渠道名称、渠道码、归属人或项目再试' : '可在「渠道二维码」中创建，扫码带来的访问和注册会统计在这里' }}</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div class="card__ft hint">各列下方小字为相邻上一阶段的转化率；「注册→入职」为整体转化率。报名 / 入职按该渠道注册用户去重计。</div>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>渠道转化漏斗对比</h3><span class="hint">入职最多的前 5 个渠道 · 累计</span></div>
        <div v-loading="loading" class="card__bd chart">
          <div v-for="r in top" :key="r.code" class="fn">
            <div class="fn-h"><span class="fn-n">{{ r.name }}</span><span class="hint">注册→入职 <b>{{ pct(r.hired, r.registrations) }}</b></span></div>
            <div class="fn-b">
              <template v-for="s in STAGES" :key="s.key">
                <i v-if="r[s.key] > 0" :style="{ flex: r[s.key], background: s.color }" :title="`${s.label} ${r[s.key]}`" />
              </template>
            </div>
            <div class="fn-v">
              <span v-for="s in STAGES" :key="s.key">{{ s.label }} {{ r[s.key] }}</span>
            </div>
          </div>
          <p v-if="ready && !top.length" class="hint">暂无数据</p>
          <p v-else-if="loadError" class="hint">报表加载失败，重新加载后显示</p>
          <div v-if="top.length" class="chart-legend">
            <span v-for="s in STAGES" :key="s.key"><i :style="{ background: s.color }" />{{ s.label }}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>渠道 → 归属规则</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>公司二维码 / 驻场分享</dt><dd>绑定本公司 · <span class="status-tag status-tag--private">私域</span></dd></dl>
          <dl class="kv"><dt>已入职员工分享</dt><dd>平台 · <span class="status-tag status-tag--public">公域</span></dd></dl>
          <dl class="kv"><dt>花名册导入</dt><dd>绑定本公司 · <span class="status-tag status-tag--private">私域</span></dd></dl>
          <div class="notice-bar rule"><IconInfo :size="16" class="notice-bar-i" /><span>已入职员工分享注册的用户归属为<b>平台</b>而非该员工所在公司 —— 这是裂变渠道与公司二维码的关键差异。</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.hint b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.cname { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.code { font-family: var(--font-mono); font-size: var(--font-size-min); color: var(--text-3); }
/* 每条前面写阶段名，不只靠颜色区分（各阶段人数在左边几列） */
.mini { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0 var(--space-2); font-size: var(--font-size-min); line-height: 1.3; color: var(--text-3); }
.mini-t i { display: block; height: 4px; border-radius: var(--radius-tag); }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.chart { min-height: 120px; }
.fn { margin-bottom: var(--space-4); }
.fn-h { display: flex; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
.fn-n { font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.fn-b { display: flex; gap: var(--space-1); height: 12px; border-radius: var(--radius-tag); overflow: hidden; }
.fn-b i { display: block; min-width: 3px; }
/* 数值标签 12px 二级文字，写在条形下面（白字压在图表色上对比度不够） */
.fn-v { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-2); font-variant-numeric: tabular-nums; }
.rule { margin-top: var(--space-3); }
</style>
