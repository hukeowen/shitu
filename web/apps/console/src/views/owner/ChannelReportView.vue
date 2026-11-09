<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { errorMessage, tenantApi, type ChannelFunnelRow, type MemberView } from '@shitu/api-client'
import { useProjects } from '@/composables/useProjects'

/**
 * A-15 渠道转化报表（T-402，老板 / 项目经理）：按渠道码统计 访问 → 注册 → 报名 → 入职 及各段转化率（累计口径）。
 * 归属人 / 项目由 memberId、projectId 在前端映射名称。
 */
const { projects } = useProjects()
const rows = ref<ChannelFunnelRow[]>([])
const members = ref<MemberView[]>([])
const loading = ref(false)
const loadError = ref('')
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
  try {
    rows.value = await tenantApi.reportChannels()
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

const STAGES = [
  { key: 'visits', label: '访问', color: 'var(--ink-300)' },
  { key: 'registrations', label: '注册', color: 'var(--ink-700)' },
  { key: 'applied', label: '报名', color: 'var(--signal-700)' },
  { key: 'hired', label: '入职', color: 'var(--signal)' },
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
      <span class="ref">功能 <b>T-402</b></span>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="load">重试</el-button>
    </el-alert>

    <div class="grid g-4">
      <div class="stat"><div class="stat-l">访问</div><div class="stat-v">{{ total.visits }}</div><div class="stat-d">扫码 / 打开分享链接</div></div>
      <div class="stat"><div class="stat-l">注册</div><div class="stat-v">{{ total.registrations }}</div><div class="stat-d">访问 → 注册 {{ pct(total.registrations, total.visits) }}</div></div>
      <div class="stat"><div class="stat-l">报名</div><div class="stat-v">{{ total.applied }}</div><div class="stat-d">注册 → 报名 {{ pct(total.applied, total.registrations) }}</div></div>
      <div class="stat stat--signal"><div class="stat-l">入职</div><div class="stat-v">{{ total.hired }}</div><div class="stat-d">注册 → 入职 {{ pct(total.hired, total.registrations) }}</div></div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索渠道名称 / 渠道码 / 归属人 / 项目" clearable style="width: 280px" />
        <span class="spacer" />
        <span class="t-xs">排序</span>
        <el-radio-group v-model="sortKey" size="small">
          <el-radio-button value="hired">入职</el-radio-button>
          <el-radio-button value="registrations">注册</el-radio-button>
          <el-radio-button value="visits">访问</el-radio-button>
          <el-radio-button value="rate">注册→入职</el-radio-button>
        </el-radio-group>
      </div>
      <el-table v-loading="loading" :data="shown" row-key="code">
        <el-table-column label="渠道" min-width="170">
          <template #default="{ row }">
            <b>{{ row.name }}</b>
            <div class="mono t-xs">{{ row.code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="归属" min-width="130">
          <template #default="{ row }">
            <div class="t-sm">{{ memberName(row.memberId) || '公司' }}</div>
            <div class="t-xs">{{ projectName(row.projectId) || '不限项目' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="访问" width="80" align="right"><template #default="{ row }"><span class="num">{{ row.visits }}</span></template></el-table-column>
        <el-table-column label="注册" width="80" align="right">
          <template #default="{ row }"><span class="num">{{ row.registrations }}</span><div class="t-xs">{{ pct(row.registrations, row.visits) }}</div></template>
        </el-table-column>
        <el-table-column label="报名" width="80" align="right">
          <template #default="{ row }"><span class="num">{{ row.applied }}</span><div class="t-xs">{{ pct(row.applied, row.registrations) }}</div></template>
        </el-table-column>
        <el-table-column label="入职" width="80" align="right">
          <template #default="{ row }"><b class="num" style="color: var(--ok)">{{ row.hired }}</b><div class="t-xs">{{ pct(row.hired, row.applied) }}</div></template>
        </el-table-column>
        <el-table-column label="注册→入职" width="100" align="right">
          <template #default="{ row }"><b class="num">{{ pct(row.hired, row.registrations) }}</b></template>
        </el-table-column>
        <el-table-column label="漏斗" min-width="180">
          <template #default="{ row }">
            <div class="mini">
              <i v-for="s in STAGES" :key="s.key" :style="{ width: `${barW(row, s.key)}%`, background: s.color }" :title="`${s.label} ${row[s.key]}`" />
            </div>
          </template>
        </el-table-column>
        <template #empty><el-empty :image-size="70" :description="loadError ? '加载失败' : '暂无渠道码 · 可在「渠道二维码」中创建'" /></template>
      </el-table>
      <div class="card__ft t-xs">各列下方小字为相邻上一阶段的转化率；「注册→入职」为整体转化率。报名 / 入职按该渠道注册用户去重计。</div>
    </div>

    <div class="grid g-2" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>渠道转化漏斗对比</h3><span class="t-xs">入职最多的前 5 个渠道</span></div>
        <div class="card__bd">
          <div v-for="r in top" :key="r.code" class="fn">
            <div class="fn-h t-sm"><span class="strong">{{ r.name }}</span><span class="num">{{ pct(r.hired, r.registrations) }}</span></div>
            <div class="fn-b">
              <template v-for="s in STAGES" :key="s.key">
                <div v-if="r[s.key] > 0" :style="{ flex: r[s.key], background: s.color }" class="mono">{{ r[s.key] }}</div>
              </template>
            </div>
          </div>
          <div v-if="!top.length" class="t-sm dim">暂无数据</div>
          <div class="legend">
            <span v-for="s in STAGES" :key="s.key"><i :style="{ background: s.color }" />{{ s.label }}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>渠道 → 归属规则</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>公司二维码 / 驻场分享</dt><dd>绑定本公司 · <span class="tag tag--private">私域</span></dd></dl>
          <dl class="kv"><dt>已入职员工分享</dt><dd>平台 · <span class="tag tag--public">公域</span></dd></dl>
          <dl class="kv"><dt>花名册导入</dt><dd>绑定本公司 · <span class="tag tag--private">私域</span></dd></dl>
          <div class="note note--info" style="margin-top: 10px">已入职员工分享注册的用户归属为<b>平台</b>而非该员工所在公司 —— 这是裂变渠道与公司二维码的关键差异。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini { display: flex; flex-direction: column; gap: 2px; }
.mini i { display: block; height: 4px; border-radius: 2px; }
.fn { margin-bottom: 14px; }
.fn-h { display: flex; justify-content: space-between; margin-bottom: 6px; }
.fn-b { display: flex; gap: 2px; height: 24px; border-radius: 3px; overflow: hidden; }
.fn-b > div { display: grid; place-items: center; color: #fff; font-size: 11px; min-width: 22px; }
.legend { display: flex; gap: 14px; margin-top: 6px; font-size: 11.5px; color: var(--ink-500); }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
</style>
