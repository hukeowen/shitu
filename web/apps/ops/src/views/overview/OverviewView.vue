<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { errorMessage, opsApi, type OpsOverview } from '@shitu/api-client'
import { fmtDate, fmtMoney, fmtNum } from '@/utils/format'

/** P-01 运营总览：平台 KPI、昨日计费、本月服务费、近 14 日注册趋势 */
const data = shallowRef<OpsOverview | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await opsApi.overview()
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const kpis = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { l: '入驻企业数', v: d.companies, s: d.pendingCompanies > 0 ? `${d.pendingCompanies} 家待审核` : '无待审核', warn: d.pendingCompanies > 0, to: '/companies/list' },
    { l: '在职总人数', v: d.employed, s: `今日入职 ${fmtNum(d.hiredToday)} 人` },
    { l: '今日新注册', v: d.registeredToday, s: '求职者注册' },
    { l: '今日报名', v: d.applicationsToday, s: '报名单创建数' },
    { l: '公域求职者', v: d.publicSeekers, s: '无归属，可被任一公司推荐' },
    { l: '招聘中岗位', v: d.recruitingJobs, s: '审核通过且在招' },
  ]
})

/** 趋势图：纯 SVG 柱状图 */
const W = 560
const H = 160
const PAD = { l: 34, r: 8, t: 12, b: 22 }
/** 补齐近 14 天：后端只返回有注册的日期，没有数据的日子按 0 画出来（按北京日期） */
const trend = computed(() => {
  const by = new Map((data.value?.trend ?? []).map((p) => [p.d, p]))
  const end = Date.now() + 8 * 3600_000
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(end - (13 - i) * 86400_000).toISOString().slice(0, 10)
    return by.get(d) ?? { d, registrations: 0 }
  })
})
const chart = computed(() => {
  const pts = trend.value
  const max = Math.max(1, ...pts.map((p) => p.registrations))
  // 坐标刻度取整到「好看」的数
  const step = niceStep(max / 4)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const bw = pts.length ? iw / pts.length : 0
  const bars = pts.map((p, i) => {
    const h = (p.registrations / top) * ih
    return { x: PAD.l + i * bw + bw * 0.18, y: PAD.t + ih - h, w: bw * 0.64, h, p, label: p.d.slice(5) }
  })
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push({ v, y: PAD.t + ih - (v / top) * ih })
  return { bars, ticks, bw }
})
function niceStep(raw: number): number {
  if (raw <= 1) return 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}
const trendTotal = computed(() => trend.value.reduce((a, b) => a + b.registrations, 0))
const hover = ref<number | null>(null)
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>平台运营总览</h2>
        <p>入驻企业、在职人数、当日增量与计费 · 数据实时汇总，计费数据为昨日日结结果</p>
      </div>
      <div class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div v-if="error && !data" class="card">
      <el-empty :image-size="64" :description="error"><el-button size="small" @click="load">重试</el-button></el-empty>
    </div>

    <template v-else>
      <div v-loading="loading && !data" class="grid g-3 kpis">
        <component :is="k.to ? 'router-link' : 'div'" v-for="k in kpis" :key="k.l" :to="k.to" class="stat" :class="{ link: k.to }">
          <div class="stat-l">{{ k.l }}</div>
          <div class="stat-v">{{ fmtNum(k.v) }}</div>
          <div class="stat-d" :class="{ warn: k.warn }">{{ k.s }}</div>
        </component>
      </div>

      <div class="grid fees">
        <div class="card">
          <div class="card__hd">
            <h3>计费</h3>
            <span class="t-xs">按日结结果统计，金额单位：元</span>
          </div>
          <div class="card__bd">
            <div class="period">
              <b>昨日</b><span class="t-xs mono">{{ data ? fmtDate(data.yesterday.date) : '' }}</span>
            </div>
            <div class="fee-grid">
              <div class="fee">
                <div class="stat-l">增长技术服务费</div>
                <div class="fee-v">{{ fmtMoney(data?.yesterday.serviceFee) }}</div>
              </div>
              <div class="fee">
                <div class="stat-l">人才流转费总额</div>
                <div class="fee-v">{{ fmtMoney(data?.yesterday.transferFee) }}</div>
                <div class="stat-d">{{ fmtNum(data?.yesterday.transferCount) }} 人·天</div>
              </div>
              <div class="fee">
                <div class="stat-l">其中平台收入</div>
                <div class="fee-v">{{ fmtMoney(data?.yesterday.platformTake) }}</div>
              </div>
            </div>
            <dl class="split">
              <div><dt>平台抽佣</dt><dd>{{ fmtMoney(data?.yesterday.transferCommission) }}</dd></div>
              <div><dt>全额归平台</dt><dd>{{ fmtMoney(data?.yesterday.transferFullIncome) }}</dd></div>
            </dl>

            <div class="period second">
              <b>本月累计</b><span class="t-xs">截至昨日日结</span>
            </div>
            <div class="fee-grid">
              <div class="fee hl">
                <div class="stat-l">增长技术服务费</div>
                <div class="fee-v">{{ fmtMoney(data?.monthServiceFee) }}</div>
              </div>
              <div class="fee">
                <div class="stat-l">流转费平台抽佣</div>
                <div class="fee-v">{{ fmtMoney(data?.monthTransferCommission) }}</div>
              </div>
              <div class="fee">
                <div class="stat-l">流转费全额归平台</div>
                <div class="fee-v">{{ fmtMoney(data?.monthTransferFullIncome) }}</div>
              </div>
            </div>
            <p class="t-xs fee-note">平台抽佣：与来源公司分成后平台得到的部分；全额归平台：来源为平台或来源公司已注销的流转费。</p>
          </div>
        </div>

        <div class="card">
          <div class="card__hd">
            <h3>近 14 日注册趋势</h3>
            <span class="t-xs">合计 <b class="mono">{{ fmtNum(trendTotal) }}</b> 人</span>
          </div>
          <div class="card__bd">
            <el-empty v-if="trend.length === 0" :image-size="56" description="暂无数据" />
            <div v-else class="chart">
              <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" aria-label="近 14 日注册人数柱状图">
                <g v-for="t in chart.ticks" :key="t.v">
                  <line :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" class="grid-l" />
                  <text :x="PAD.l - 6" :y="t.y + 3" text-anchor="end" class="ax">{{ t.v }}</text>
                </g>
                <g v-for="(b, i) in chart.bars" :key="b.p.d" @mouseenter="hover = i" @mouseleave="hover = null">
                  <rect :x="b.x - chart.bw * 0.18" :y="PAD.t" :width="chart.bw" :height="H - PAD.t - PAD.b" fill="transparent" />
                  <!-- 0 人的日子不画柱子；类名不能叫 bar（主题里 .bar 带固定高度，会把柱子撑成色块压住日期） -->
                  <rect v-if="b.p.registrations > 0" :x="b.x" :y="b.y" :width="b.w" :height="Math.max(b.h, 1)" rx="2" class="col" :class="{ on: hover === i }" />
                  <text v-if="i % 2 === 1" :x="b.x + b.w / 2" :y="H - 6" text-anchor="middle" class="ax">{{ b.label }}</text>
                </g>
              </svg>
              <div v-if="hover !== null && chart.bars[hover]" class="tip">
                <span class="mono">{{ chart.bars[hover].p.d }}</span> · 注册 <b>{{ fmtNum(chart.bars[hover].p.registrations) }}</b> 人
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kpis { margin-bottom: 14px; }
.stat.link { text-decoration: none; transition: border-color .14s; }
.stat.link:hover { border-color: var(--signal-300); }
.stat-d.warn { color: var(--warn); font-weight: 600; }
.fees { grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); }
@media (max-width: 1180px) { .fees { grid-template-columns: 1fr; } }
.period { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.period b { font-size: 13.5px; font-weight: 600; color: var(--ink-900); }
.period.second { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
.fee-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.fee .stat-l { white-space: nowrap; }
.fee .stat-d { white-space: nowrap; }
.fee-v { font-family: var(--f-dis); font-size: 22px; font-weight: 650; color: var(--ink-900); margin-top: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.split { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 10px 0 0; font-size: 12.5px; }
.split > div { display: flex; gap: 8px; white-space: nowrap; }
.split dt { color: var(--ink-500); }
.split dd { margin: 0; color: var(--ink-800); font-weight: 600; font-variant-numeric: tabular-nums; }
.fee-note { margin: 14px 0 0; line-height: 1.7; }
.fee.hl .fee-v { color: var(--signal-700); }
.chart { position: relative; }
.chart svg { width: 100%; height: 180px; display: block; }
.grid-l { stroke: var(--line); stroke-width: 1; }
.ax { font-size: 10px; fill: var(--ink-400); font-family: var(--f-mono); }
.col { fill: var(--signal); opacity: .85; }
.col.on { opacity: 1; fill: var(--signal-700); }
.tip { position: absolute; top: 0; right: 0; font-size: 12px; color: var(--ink-600); background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-xs); padding: 2px 8px; }
</style>
