<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, opsApi, type OpsOverview } from '@shitu/api-client'
import {
  IconBriefcase,
  IconBuildingComplex,
  IconChartColumn,
  IconClipboardList,
  IconTrendingUp,
  IconTriangleExclamationPoint,
  IconUserCheck,
  IconUsers,
} from '@shitu/ui-icons'
import { fmtDate, fmtMoney, fmtNum } from '@/utils/format'

/** P-01 运营总览：平台 KPI、昨日计费、本月服务费、近 14 日注册趋势 */
const data = shallowRef<OpsOverview | null>(null)
const loading = ref(false)
const error = ref('')
/** 失败是断网、超时（提示检查网络），还是后端给了原因 */
const offline = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  offline.value = false
  try {
    data.value = await opsApi.overview()
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    offline.value = isApiError(e) && e.code === 'NETWORK'
    // 已有数据时刷新失败：保留上一次的数据，用轻提示说明
    if (data.value) ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 没拿到数据时指标显示「—」，说明不下结论（规范「Page States」） */
const kpis = computed(() => {
  const d = data.value
  return [
    { l: '入驻企业数', icon: IconBuildingComplex, v: d?.companies, s: d ? (d.pendingCompanies > 0 ? `${d.pendingCompanies} 家待审核` : '无待审核') : '—', to: '/companies/list' },
    { l: '在职总人数', icon: IconUserCheck, v: d?.employed, s: d ? `今日入职 ${fmtNum(d.hiredToday)} 人` : '—' },
    { l: '今日新注册', icon: IconTrendingUp, v: d?.registeredToday, s: '求职者注册' },
    { l: '今日报名', icon: IconClipboardList, v: d?.applicationsToday, s: '报名单创建数' },
    { l: '公域求职者', icon: IconUsers, v: d?.publicSeekers, s: '无归属，可被任一公司推荐' },
    { l: '招聘中岗位', icon: IconBriefcase, v: d?.recruitingJobs, s: '审核通过且在招' },
  ]
})

/** 趋势图：手写 SVG 柱状图，按容器的实际像素宽画（不拉伸，字号才是真的 12px） */
const chartBox = ref<HTMLElement>()
const W = ref(560)
const H = 180
const PAD = { l: 36, r: 8, t: 12, b: 24 }
const ro = new ResizeObserver(([e]) => {
  if (e.contentRect.width > 0) W.value = Math.round(e.contentRect.width)
})
// 卡片体会随「加载失败 → 重新加载成功」卸载又重新挂载：节点换了就改观察新节点
watch(chartBox, (el, old) => {
  if (old) ro.unobserve(old)
  if (el) ro.observe(el)
}, { flush: 'post', immediate: true })
onBeforeUnmount(() => ro.disconnect())

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
  const iw = W.value - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const bw = pts.length ? iw / pts.length : 0
  const bars = pts.map((p, i) => {
    const h = (p.registrations / top) * ih
    return { x: PAD.l + i * bw + bw * 0.2, y: PAD.t + ih - h, w: bw * 0.6, h, p, label: p.d.slice(5) }
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
      <div class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>运营数据加载失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" :loading="loading" @click="load">重新加载</el-button>
      </div>
    </div>

    <div v-else v-loading="loading && !data">
      <div class="grid g-3 kpis">
        <component :is="k.to ? 'router-link' : 'div'" v-for="k in kpis" :key="k.l" :to="k.to" class="stat stat--icon" :class="{ 'stat--link': k.to }">
          <div class="stat-l">{{ k.l }}</div>
          <component :is="k.icon" :size="20" class="stat-i" />
          <div class="stat-v">{{ fmtNum(k.v) }}</div>
          <div class="stat-d">{{ k.s }}</div>
        </component>
      </div>

      <div class="grid fees">
        <div class="card">
          <div class="card__hd">
            <h3>昨日计费</h3>
            <span class="t-xs">{{ data ? fmtDate(data.yesterday.date) : '' }}</span>
          </div>
          <div class="card__bd">
            <div class="grid g-2 fee-grid">
              <div class="fee">
                <div class="stat-l">增长技术服务费</div>
                <div class="fee-v money">{{ fmtMoney(data?.yesterday.serviceFee) }}<small v-if="data">元</small></div>
              </div>
              <div class="fee">
                <div class="stat-l">人才流转费</div>
                <div class="fee-v money">{{ fmtMoney(data?.yesterday.transferFee) }}<small v-if="data">元</small></div>
                <div v-if="data" class="stat-d">流转 {{ fmtNum(data.yesterday.transferCount) }} 人·天</div>
              </div>
              <div class="fee">
                <div class="stat-l">平台流转收入</div>
                <div class="fee-v money">{{ fmtMoney(data?.yesterday.platformTake) }}<small v-if="data">元</small></div>
                <template v-if="data">
                  <div class="stat-d">抽佣 {{ fmtMoney(data.yesterday.transferCommission) }}</div>
                  <div class="stat-d">全额 {{ fmtMoney(data.yesterday.transferFullIncome) }}</div>
                </template>
              </div>
              <div class="fee">
                <div class="stat-l">本月累计服务费</div>
                <div class="fee-v money">{{ fmtMoney(data?.monthServiceFee) }}<small v-if="data">元</small></div>
                <template v-if="data">
                  <div class="stat-d">截至昨日日结</div>
                  <div class="stat-d">流转抽佣 {{ fmtMoney(data.monthTransferCommission) }}</div>
                  <div class="stat-d">流转全额 {{ fmtMoney(data.monthTransferFullIncome) }}</div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__hd">
            <h3>近 14 日注册趋势</h3>
            <span v-if="data" class="t-xs">合计 <b class="total">{{ fmtNum(trendTotal) }}</b> 人</span>
          </div>
          <div ref="chartBox" class="card__bd chart-bd">
            <template v-if="data">
              <div v-if="trendTotal === 0" class="state-box">
                <IconChartColumn :size="48" />
                <h4>近 14 日没有新注册</h4>
                <p>有求职者注册后，这里按天显示注册人数</p>
              </div>
              <template v-else>
                <div class="chart">
                  <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="近 14 日注册人数柱状图">
                    <g v-for="t in chart.ticks" :key="t.v">
                      <line :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" class="grid-l" />
                      <text :x="PAD.l - 6" :y="t.y + 4" text-anchor="end" class="ax">{{ t.v }}</text>
                    </g>
                    <g v-for="(b, i) in chart.bars" :key="b.p.d" @mouseenter="hover = i" @mouseleave="hover = null">
                      <rect :x="b.x - chart.bw * 0.2" :y="PAD.t" :width="chart.bw" :height="H - PAD.t - PAD.b" fill="transparent" />
                      <rect :x="b.x" :y="b.y" :width="b.w" :height="Math.max(b.h, b.p.registrations > 0 ? 1 : 0)" rx="2" class="bar" :class="{ on: hover === i }" />
                      <text v-if="i % 2 === 1" :x="b.x + b.w / 2" :y="H - 6" text-anchor="middle" class="ax">{{ b.label }}</text>
                    </g>
                  </svg>
                  <div v-if="hover !== null && chart.bars[hover]" class="tip">
                    {{ chart.bars[hover].p.d }} · 注册 <b>{{ fmtNum(chart.bars[hover].p.registrations) }}</b> 人
                  </div>
                </div>
                <div class="chart-legend"><span><i class="lg-bar" />每日注册人数</span></div>
              </template>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { gap: var(--space-gap); margin-bottom: var(--space-gap); }
.fees { gap: var(--space-gap); grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); align-items: start; }
@media (max-width: 1180px) { .fees { grid-template-columns: 1fr; } }
.fee-grid { row-gap: var(--space-5); }
/* 计费说明逐行写，一行一条，不折行（两卡顶部对齐，不强拉同高） */
.fee .stat-d { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fee-v { display: block; font-size: var(--font-size-title); margin-top: var(--space-1); }
.fee-v small { font-size: var(--font-size-min); font-weight: var(--font-weight-regular); color: var(--text-3); margin-left: 3px; }
.total { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.chart-bd { min-height: 220px; }
.chart { position: relative; }
.chart svg { display: block; overflow: visible; }
/* 规范「Charts」：单一系列用 --chart-1，坐标轴和网格线用分隔线色，坐标标签 12px 二级文字 */
.grid-l { stroke: var(--divider); stroke-width: 1; }
.ax { font-size: var(--font-size-min); fill: var(--text-2); }
.bar { fill: var(--chart-1); }
.bar.on { fill: var(--chart-1); fill-opacity: .72; }
.lg-bar { background: var(--chart-1); }
.chart-legend { margin-top: var(--space-2); }
.tip { position: absolute; top: 0; right: 0; font-size: var(--font-size-min); color: var(--text-2); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-tag); padding: 2px var(--space-2); box-shadow: var(--shadow-popup); }
.tip b { color: var(--text-1); }
</style>
