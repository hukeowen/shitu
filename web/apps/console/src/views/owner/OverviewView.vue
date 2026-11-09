<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type MonthlyBill, type OwnerOverview } from '@shitu/api-client'
import { useMeStore } from '@/stores/me'
import { fmtYuan } from '@/utils/format'

/**
 * A-14 公司数据总览（T-401，仅老板）：只展示聚合统计，不含单个求职者隐私信息。
 * 右下「最近账单」取费用账单第一条，账单接口失败不影响总览。
 */
const router = useRouter()
const meStore = useMeStore()
const data = ref<OwnerOverview | null>(null)
const loading = ref(false)
const loadError = ref('')
const bill = ref<MonthlyBill | null>(null)

const PALETTE = ['var(--signal)', 'var(--info)', 'var(--temp)', 'var(--ok)', 'var(--ink-500)']

const projects = computed(() => [...(data.value?.projects ?? [])].sort((a, b) => b.employed - a.employed))
const maxEmployed = computed(() => Math.max(1, ...projects.value.map((p) => p.employed)))
/** 分布：前 4 个项目 + 其他 */
const dist = computed(() => {
  const ps = projects.value.filter((p) => p.employed > 0)
  const top = ps.slice(0, 4).map((p, i) => ({ name: p.name, n: p.employed, color: PALETTE[i] }))
  const rest = ps.slice(4)
  if (rest.length) top.push({ name: `其他 ${rest.length} 个项目`, n: rest.reduce((s, p) => s + p.employed, 0), color: PALETTE[4] })
  return top
})
const distTotal = computed(() => dist.value.reduce((s, d) => s + d.n, 0))
const net = computed(() => (data.value ? data.value.hiredThisMonth - data.value.resignedThisMonth : 0))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await tenantApi.reportOverview()
  } catch (e) {
    loadError.value = errorMessage(e, '总览加载失败')
    data.value = null
  } finally {
    loading.value = false
  }
  try {
    const r = await tenantApi.bills(1, 12)
    bill.value = [...r.records].sort((a, b) => b.billMonth.localeCompare(a.billMonth))[0] ?? null
  } catch {
    bill.value = null
  }
}
onMounted(load)

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n)
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>公司数据总览</h2>
        <p>{{ meStore.me?.company.name }} · 仅展示聚合统计数据，不含单个求职者隐私信息</p>
      </div>
      <span class="spacer" />
      <span class="ref">功能 <b>T-401</b></span>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="load">重试</el-button>
    </el-alert>

    <div v-loading="loading" class="grid g-4">
      <div class="stat"><div class="stat-l">总入职人数（累计）</div><div class="stat-v">{{ data?.totalHired ?? '—' }}</div><div class="stat-d">含已离职</div></div>
      <div class="stat stat--signal"><div class="stat-l">当前在岗总人数</div><div class="stat-v">{{ data?.employed ?? '—' }}</div><div class="stat-d">本月净增 {{ data ? signed(net) : '—' }}</div></div>
      <div class="stat"><div class="stat-l">当月入职</div><div class="stat-v" style="color: var(--ok)">{{ data?.hiredThisMonth ?? '—' }}</div><div class="stat-d">按入职日期</div></div>
      <div class="stat"><div class="stat-l">当月离职</div><div class="stat-v">{{ data?.resignedThisMonth ?? '—' }}</div><div class="stat-d">按离职日期</div></div>
      <div class="stat stat--link" @click="router.push('/site/follow')"><div class="stat-l">私域待匹配</div><div class="stat-v">{{ data?.privatePool ?? '—' }}</div><div class="stat-d">本公司归属、尚未报名 →</div></div>
      <div class="stat stat--link" @click="router.push('/circulation/ledger')"><div class="stat-l">流入在岗（流转）</div><div class="stat-v" style="color: var(--danger)">{{ data?.transferIn ?? '—' }}</div><div class="stat-d">来源为其他公司 · 应付流转费 →</div></div>
      <div class="stat stat--link" @click="router.push('/circulation/ledger')"><div class="stat-l">流出在岗（流转）</div><div class="stat-v" style="color: var(--ok)">{{ data?.transferOut ?? '—' }}</div><div class="stat-d">本公司来源、在别家在岗 · 应收 →</div></div>
      <div class="stat"><div class="stat-l">诚信分</div><div class="stat-v">{{ meStore.me?.company.creditScore ?? '—' }}</div><div class="stat-d">公司状态影响岗位曝光</div></div>
    </div>

    <div class="grid g-23" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>各项目在岗人数分布</h3><span class="tag">{{ distTotal }} 人</span></div>
        <div class="card__bd">
          <div v-if="distTotal" class="stack">
            <i v-for="d in dist" :key="d.name" :style="{ flex: d.n, background: d.color }" :title="`${d.name} ${d.n}`" />
          </div>
          <div v-for="d in dist" :key="d.name" class="hbar">
            <span class="hn"><i class="dot" :style="{ background: d.color }" />{{ d.name }}</span>
            <div class="bar"><i :style="{ width: `${Math.round((d.n / (dist[0]?.n || 1)) * 100)}%`, background: d.color }" /></div>
            <span class="hv num">{{ d.n }}</span>
          </div>
          <div v-if="!distTotal" class="t-sm dim">暂无在岗人员</div>
        </div>
      </div>

      <div class="card">
        <div class="card__hd"><h3>项目明细</h3><span class="t-xs">{{ projects.length }} 个项目</span></div>
        <el-table :data="projects" row-key="projectId" size="small" max-height="420">
          <el-table-column label="项目" min-width="160">
            <template #default="{ row }"><b>{{ row.name }}</b><div class="t-xs">{{ row.city || '—' }}</div></template>
          </el-table-column>
          <el-table-column label="项目经理 / 驻场" min-width="130">
            <template #default="{ row }"><span class="t-sm">{{ row.managers || '未分配' }}</span></template>
          </el-table-column>
          <el-table-column label="在岗" width="110" align="right">
            <template #default="{ row }">
              <b class="num">{{ row.employed }}</b>
              <div class="bar" style="margin-top: 3px"><i class="sig" :style="{ width: `${Math.round((row.employed / maxEmployed) * 100)}%` }" /></div>
            </template>
          </el-table-column>
          <el-table-column label="当月入职" width="86" align="right">
            <template #default="{ row }"><span class="num" style="color: var(--ok)">{{ row.hiredThisMonth }}</span></template>
          </el-table-column>
          <el-table-column label="当月离职" width="86" align="right">
            <template #default="{ row }"><span class="num">{{ row.resignedThisMonth }}</span></template>
          </el-table-column>
          <el-table-column label="净增" width="70" align="right">
            <template #default="{ row }">
              <span class="num" :style="{ color: row.hiredThisMonth - row.resignedThisMonth > 0 ? 'var(--ok)' : row.hiredThisMonth - row.resignedThisMonth < 0 ? 'var(--danger)' : undefined }">{{ signed(row.hiredThisMonth - row.resignedThisMonth) }}</span>
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="70" :description="loadError ? '加载失败' : '暂无项目'" /></template>
        </el-table>
      </div>
    </div>

    <div class="grid g-3" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>权限管控</h3><span class="tag tag--info">老板视图</span></div>
        <div class="card__bd t-sm perm">
          <div><span class="y">✓</span>查看公司整体与项目聚合统计</div>
          <div><span class="y">✓</span>查看渠道转化报表、费用账单、流转账本</div>
          <div><span class="y">✓</span>预支登记拨款、工资表导入</div>
          <div class="divider" style="margin: 8px 0" />
          <div><span class="n">✕</span>查看单个求职者姓名 / 手机号 / 证件号</div>
          <div><span class="n">✕</span>查看求职者 AI 画像与简历详情</div>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>快捷入口</h3></div>
        <div class="card__bd grid g-2 quick" style="gap: 8px">
          <el-button @click="router.push('/owner/channel-report')">渠道转化</el-button>
          <el-button @click="router.push('/owner/bills')">费用账单</el-button>
          <el-button @click="router.push('/pm/advance')">预支拨款</el-button>
          <el-button @click="router.push('/payroll/batches')">工资表导入</el-button>
          <el-button @click="router.push('/pm/kb')">知识库</el-button>
          <el-button @click="router.push('/settings/org')">组织与权限</el-button>
        </div>
      </div>
      <div class="card">
        <div class="card__hd">
          <h3>最近账单{{ bill ? ` · ${bill.billMonth}` : '' }}</h3>
          <el-button size="small" @click="router.push('/owner/bills')">账单详情</el-button>
        </div>
        <div class="card__bd">
          <template v-if="bill">
            <dl class="kv"><dt>增长技术服务费</dt><dd class="num">{{ fmtYuan(bill.serviceFee) }}</dd></dl>
            <dl class="kv"><dt>流转费应付</dt><dd class="num" style="color: var(--danger)">{{ fmtYuan(bill.transferPayable) }}</dd></dl>
            <dl class="kv"><dt>流转费应收</dt><dd class="num" style="color: var(--ok)">{{ fmtYuan(bill.transferReceivable) }}</dd></dl>
            <div class="divider" />
            <dl class="kv"><dt><b class="strong">应付合计</b></dt><dd class="num" style="font-size: 18px; color: var(--signal)">{{ fmtYuan(bill.payable) }}</dd></dl>
            <div class="t-xs" style="margin-top: 6px">应收与应付不轧差，应收流转费单独结算到账。</div>
          </template>
          <div v-else class="t-sm dim">暂无账单 · 每月最后一天自动生成</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stack { display: flex; gap: 2px; height: 14px; border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
.stack i { display: block; min-width: 3px; }
.hbar { display: grid; grid-template-columns: minmax(120px, 38%) 1fr 48px; gap: 10px; align-items: center; padding: 6px 0; }
.hn { font-size: 12.5px; color: var(--ink-700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv { text-align: right; font-size: 13px; font-weight: 600; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.perm { line-height: 2; }
.quick .el-button { margin-left: 0; }
.perm .y { color: var(--ok); margin-right: 8px; }
.perm .n { color: var(--danger); margin-right: 8px; }
</style>
