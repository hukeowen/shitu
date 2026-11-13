<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type MonthlyBill, type OwnerOverview } from '@shitu/api-client'
import { IconBuildingComplex, IconCheck, IconChevronRight, IconCircleExclamationPoint, IconShieldCheck, IconTrendingUp, IconUserCheck, IconUserMinus, IconUsers, IconX } from '@shitu/ui-icons'
import { useMeStore } from '@/stores/me'
import { fmtSigned } from '@/utils/format'

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
const billLoading = ref(false)
const billError = ref('')
/** 账单接口返回过（没返回前不说「暂无账单」） */
const billReady = ref(false)

/** 图表分类色：前 4 个项目 --chart-1…4，「其他」用灰蓝 --chart-6（规范 Color Roles 图表分类色） */
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-6)']

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
  loadBill()
}
/** 最近账单单独请求：失败不影响总览，但写明失败、给重新加载，不说成「暂无账单」 */
async function loadBill() {
  billLoading.value = true
  billError.value = ''
  billReady.value = false
  try {
    const r = await tenantApi.bills(1, 12)
    bill.value = [...r.records].sort((a, b) => b.billMonth.localeCompare(a.billMonth))[0] ?? null
    billReady.value = true
  } catch (e) {
    bill.value = null
    billError.value = errorMessage(e, '最近账单加载失败')
  } finally {
    billLoading.value = false
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
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div v-loading="loading" class="body">
      <div class="kpis">
        <div class="stat stat--icon stat--signal">
          <IconUsers :size="20" class="stat-i" />
          <div class="stat-l">当前在岗总人数</div><div class="stat-v">{{ data?.employed ?? '—' }}</div><div class="stat-d">本月净增 {{ data ? signed(net) : '—' }}</div>
        </div>
        <div class="stat stat--icon">
          <IconUserCheck :size="20" class="stat-i" />
          <div class="stat-l">当月入职</div><div class="stat-v">{{ data?.hiredThisMonth ?? '—' }}</div><div class="stat-d">按入职日期</div>
        </div>
        <div class="stat stat--icon">
          <IconUserMinus :size="20" class="stat-i" />
          <div class="stat-l">当月离职</div><div class="stat-v">{{ data?.resignedThisMonth ?? '—' }}</div><div class="stat-d">按离职日期</div>
        </div>
        <div class="stat stat--icon">
          <IconTrendingUp :size="20" class="stat-i" />
          <div class="stat-l">总入职人数（累计）</div><div class="stat-v">{{ data?.totalHired ?? '—' }}</div><div class="stat-d">含已离职</div>
        </div>
        <div class="stat stat--icon">
          <IconShieldCheck :size="20" class="stat-i" />
          <div class="stat-l">诚信分</div><div class="stat-v">{{ meStore.me?.company.creditScore ?? '—' }}</div><div class="stat-d">公司状态影响岗位曝光</div>
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
      <div v-else-if="data && !projects.length" class="card fail">
        <div class="state-box">
          <IconBuildingComplex :size="48" />
          <h4>还没有项目在岗数据</h4>
          <p>公司还没有项目，或项目下还没有员工入职；在「项目与甲方」建好项目、员工入职后，这里按项目显示在岗人数</p>
          <el-button @click="router.push('/settings/projects')">前往项目与甲方</el-button>
        </div>
      </div>
      <template v-else>
        <div class="charts">
          <div class="card">
            <div class="card__hd"><h3>各项目在岗人数分布</h3><span class="hint">{{ data ? `${distTotal} 人` : '' }}</span></div>
            <div class="card__bd">
              <template v-if="distTotal">
                <div class="stack">
                  <i v-for="d in dist" :key="d.name" :style="{ flex: d.n, background: d.color }" :title="`${d.name} ${d.n}`" />
                </div>
                <div v-for="d in dist" :key="d.name" class="hbar">
                  <span class="hn"><i class="dot" :style="{ background: d.color }" />{{ d.name }}</span>
                  <div class="track"><i :style="{ width: `${Math.round((d.n / (dist[0]?.n || 1)) * 100)}%`, background: d.color }" /></div>
                  <span class="hv">{{ d.n }}</span>
                </div>
              </template>
              <p v-else-if="data" class="hint">暂无在岗人员</p>
            </div>
          </div>

          <div class="card">
            <div class="card__hd"><h3>项目明细</h3><span class="hint">{{ data ? `${projects.length} 个项目` : '' }}</span></div>
            <el-table :data="projects" row-key="projectId" max-height="420">
              <el-table-column label="项目" min-width="130">
                <template #default="{ row }"><b class="pname">{{ row.name }}</b><div class="hint">{{ row.city || '—' }}</div></template>
              </el-table-column>
              <el-table-column label="项目经理 / 驻场" min-width="110">
                <template #default="{ row }">{{ row.managers || '未分配' }}</template>
              </el-table-column>
              <el-table-column label="在岗" width="104" align="right">
                <template #default="{ row }">
                  <b>{{ row.employed }}</b>
                  <div class="track track--sm"><i :style="{ width: `${Math.round((row.employed / maxEmployed) * 100)}%`, background: 'var(--chart-1)' }" /></div>
                </template>
              </el-table-column>
              <el-table-column label="当月入职" width="84" align="right"><template #default="{ row }">{{ row.hiredThisMonth }}</template></el-table-column>
              <el-table-column label="当月离职" width="84" align="right"><template #default="{ row }">{{ row.resignedThisMonth }}</template></el-table-column>
              <el-table-column label="净增" width="68" align="right"><template #default="{ row }">{{ signed(row.hiredThisMonth - row.resignedThisMonth) }}</template></el-table-column>
              <template #empty><span v-if="data" class="hint">暂无项目</span><span v-else /></template>
            </el-table>
          </div>
        </div>
      </template>
    </div>

    <div class="sub">
      <div class="card">
        <div class="card__hd"><h3>私域与流转</h3><span class="hint">点击查看明细</span></div>
        <div class="card__bd links">
          <button type="button" class="lnk" @click="router.push('/site/follow')">
            <span class="lnk-t">私域待匹配<small>本公司归属、尚未报名</small></span><b>{{ data?.privatePool ?? '—' }}</b><IconChevronRight :size="16" />
          </button>
          <button type="button" class="lnk" @click="router.push('/circulation/ledger')">
            <span class="lnk-t">流入在岗（流转）<small>来源为其他公司 · 应付流转费</small></span><b>{{ data?.transferIn ?? '—' }}</b><IconChevronRight :size="16" />
          </button>
          <button type="button" class="lnk" @click="router.push('/circulation/ledger')">
            <span class="lnk-t">流出在岗（流转）<small>本公司来源、在别家在岗 · 应收</small></span><b>{{ data?.transferOut ?? '—' }}</b><IconChevronRight :size="16" />
          </button>
        </div>
      </div>
      <div class="card">
        <div class="card__hd">
          <h3>最近账单{{ bill ? ` · ${bill.billMonth}` : '' }}</h3>
          <el-button size="small" @click="router.push('/owner/bills')">账单详情</el-button>
        </div>
        <div v-loading="billLoading" class="card__bd bill">
          <template v-if="bill">
            <dl class="kv"><dt>增长技术服务费</dt><dd class="money">{{ fmtSigned(bill.serviceFee, 'out') }}</dd></dl>
            <dl class="kv"><dt>流转费应付</dt><dd class="money">{{ fmtSigned(bill.transferPayable, 'out') }}</dd></dl>
            <dl class="kv"><dt>流转费应收</dt><dd class="money">{{ fmtSigned(bill.transferReceivable, 'in') }}</dd></dl>
            <dl class="kv"><dt><b>应付合计</b></dt><dd class="money total">{{ fmtSigned(bill.payable, 'out') }}</dd></dl>
            <p class="hint fine">应收与应付不轧差，应收流转费单独结算到账。</p>
          </template>
          <div v-else-if="billError" class="bill-fail">
            <span class="hint" :title="billError">最近账单加载失败</span>
            <el-button size="small" @click="loadBill">重新加载</el-button>
          </div>
          <p v-else-if="billReady" class="hint">暂无账单 · 每月最后一天自动生成</p>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>快捷入口</h3></div>
        <div class="card__bd quick">
          <el-button @click="router.push('/owner/channel-report')">渠道转化</el-button>
          <el-button @click="router.push('/owner/bills')">费用账单</el-button>
          <el-button @click="router.push('/pm/advance')">预支拨款</el-button>
          <el-button @click="router.push('/payroll/batches')">工资表导入</el-button>
          <el-button @click="router.push('/pm/kb')">知识库</el-button>
          <el-button @click="router.push('/settings/org')">组织与权限</el-button>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>权限管控</h3><span class="status-tag status-tag--info">老板视图</span></div>
        <div class="card__bd perm">
          <div><IconCheck :size="16" class="y" />查看公司整体与项目聚合统计</div>
          <div><IconCheck :size="16" class="y" />查看渠道转化报表、费用账单、流转账本</div>
          <div><IconCheck :size="16" class="y" />预支登记拨款、工资表导入</div>
          <div class="sep" />
          <div><IconX :size="16" class="n" />查看单个求职者姓名 / 手机号 / 证件号</div>
          <div><IconX :size="16" class="n" />查看求职者 AI 画像与简历详情</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-gap); }
.fail, .charts { margin-top: var(--space-gap); }
.charts { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--space-gap); align-items: start; }
.sub { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: stretch; }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.stack { display: flex; gap: var(--space-1); height: 12px; border-radius: var(--radius-tag); overflow: hidden; margin-bottom: var(--space-3); }
.stack i { display: block; min-width: 3px; }
.hbar { display: grid; grid-template-columns: minmax(120px, 38%) minmax(0, 1fr) 48px; gap: var(--space-3); align-items: center; padding: var(--space-2) 0; }
.hn { font-size: var(--font-size-aux); color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv { text-align: right; font-size: var(--font-size-min); color: var(--text-2); font-variant-numeric: tabular-nums; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: var(--radius-tag); margin-right: var(--space-2); }
.track { height: 8px; border-radius: var(--radius-tag); background: var(--divider); overflow: hidden; }
.track > i { display: block; height: 100%; border-radius: var(--radius-tag); }
.track--sm { height: 4px; margin-top: var(--space-1); }
.pname { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.links { display: flex; flex-direction: column; padding-top: var(--space-2); padding-bottom: var(--space-2); }
.lnk { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; border: 0; border-bottom: 1px solid var(--divider); background: none; font: inherit; color: var(--text-3); text-align: left; cursor: pointer; }
.lnk:last-child { border-bottom: 0; }
.lnk:hover .lnk-t { color: var(--primary-text); }
.lnk:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.lnk-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); color: var(--text-1); }
.lnk-t small { font-size: var(--font-size-min); color: var(--text-3); }
.lnk b { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); font-variant-numeric: tabular-nums; }
.bill { min-height: 120px; }
.total { font-size: var(--font-size-section); color: var(--primary-text); }
.kv dt b { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.fine { margin: var(--space-2) 0 0; }
.bill-fail { display: flex; align-items: center; gap: var(--space-3); }
.quick { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
.quick .el-button { margin-left: 0; }
.perm { font-size: var(--font-size-aux); line-height: 2; color: var(--text-1); }
.perm > div { display: flex; align-items: center; gap: var(--space-2); }
.perm .y { color: var(--success-text); flex: none; }
.perm .n { color: var(--danger-text); flex: none; }
.sep { height: 1px; background: var(--divider); margin: var(--space-2) 0; }
</style>
