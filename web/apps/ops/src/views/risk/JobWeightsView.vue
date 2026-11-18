<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, opsApi } from '@shitu/api-client'
import { IconBan, IconBriefcase, IconGauge, IconInbox, IconSlidersHorizontal, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { isNetwork } from '@/composables/boxSubmit'
import { fmtNum } from '@/utils/format'
import { PENALTY_LEVELS, penaltyLabel, truthy } from './riskMeta'

/** P-05 降权与限流：招聘中岗位的真实匹配权重（仅平台可见，企业无感知）；权重 < 0.3 标记僵尸岗位（第 2 类：统计卡 → 筛选栏 → 表格 → 分页） */
interface WeightRow {
  jobId: string
  title: string
  companyId: string
  companyName: string
  matchWeight: number | string
  postedDays: number
  quotaRemaining?: number | null
  complaintVerified: number
  creditScore: number
  penaltyLevel: number
  feeRightsRevoked: boolean | number
  zombie: boolean
}

const router = useRouter()
const rows = shallowRef<WeightRow[]>([])
const loading = ref(false)
const error = ref('')
const offline = ref(false)
/** 拿到过一次数据之前（加载中、加载失败）指标不显示数字 */
const loaded = ref(false)
const companyId = ref('')
const onlyZombie = ref(false)

async function load() {
  loading.value = true
  loaded.value = false
  error.value = ''
  offline.value = false
  try {
    rows.value = (await opsApi.jobWeights(companyId.value.trim() || undefined)) as unknown as WeightRow[]
    loaded.value = true
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    offline.value = isNetwork(e)
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
function reset() {
  companyId.value = ''
  onlyZombie.value = false
  void load()
}

const w = (r: WeightRow) => Number(r.matchWeight)
const shown = computed(() => (onlyZombie.value ? rows.value.filter((r) => r.zombie) : rows.value))
const stats = computed(() => {
  const list = rows.value
  const n = list.length
  return {
    n,
    zombie: list.filter((r) => r.zombie).length,
    low: list.filter((r) => !r.zombie && w(r) < 0.7).length,
    avg: n ? list.reduce((a, r) => a + w(r), 0) / n : 0,
  }
})
function tone(r: WeightRow) {
  const v = w(r)
  return r.zombie ? 'danger' : v < 0.7 ? 'warn' : 'ok'
}
// 前端分页：接口一次返回全部（最多 500 条）
const page = ref(1)
const pageSize = ref(20)
watch([onlyZombie, rows], () => (page.value = 1))
const paged = computed(() => shown.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const n = (v: number) => (loaded.value ? fmtNum(v) : '—')
function toCredit(id: string) {
  void router.push({ path: '/governance/credit', query: { companyId: id } })
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>降权与限流</h2>
        <p>招聘中岗位的真实匹配权重 = 挂岗衰减 × 低转化 × 名额 × 诚信 × 处罚 × 新岗加权（参数见「匹配引擎参数」）· 降权不向企业做任何提示</p>
      </div>
    </div>

    <div class="grid g-4 kpis">
      <div class="stat stat--icon"><div class="stat-l">招聘中岗位</div><IconBriefcase :size="20" class="stat-i" /><div class="stat-v">{{ n(stats.n) }}</div><div class="stat-d">按权重从低到高，最多 500 条</div></div>
      <div class="stat stat--icon"><div class="stat-l">平均权重</div><IconGauge :size="20" class="stat-i" /><div class="stat-v">{{ loaded && stats.n ? stats.avg.toFixed(2) : '—' }}</div><div class="stat-d">1.00 为未降权</div></div>
      <div class="stat stat--icon"><div class="stat-l">明显降权</div><IconSlidersHorizontal :size="20" class="stat-i" /><div class="stat-v">{{ n(stats.low) }}</div><div class="stat-d">权重 0.3 – 0.7</div></div>
      <div class="stat stat--icon" :class="{ 'stat--danger': loaded && stats.zombie > 0 }"><div class="stat-l">僵尸岗位</div><IconBan :size="20" class="stat-i" /><div class="stat-v">{{ n(stats.zombie) }}</div><div class="stat-d">权重 &lt; 0.3，几乎不再曝光</div></div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 160px" @keyup.enter="load" @clear="load" />
        <el-checkbox v-model="onlyZombie">只看僵尸岗位</el-checkbox>
        <div class="spacer" />
        <el-button @click="load">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <el-table v-loading="loading" :data="paged" class="ops-table tbl-48" row-key="jobId">
        <el-table-column label="岗位" min-width="190">
          <template #default="{ row }"><span class="strong">{{ row.title }}</span><div class="t-xs">{{ row.jobId }}</div></template>
        </el-table-column>
        <el-table-column label="公司" min-width="230">
          <template #default="{ row }">
            <span class="link-cell" @click="toCredit(row.companyId)">{{ row.companyName }}</span>
            <div class="t-xs">{{ row.companyId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="匹配权重" width="170">
          <template #default="{ row }">
            <div class="wt" :class="tone(row)">
              <span class="tnum strong">{{ w(row).toFixed(2) }}</span>
              <span class="track"><i :style="{ width: `${Math.min(100, w(row) * 100)}%` }" /></span>
            </div>
            <span v-if="row.zombie" class="status-tag status-tag--danger">僵尸岗位</span>
          </template>
        </el-table-column>
        <el-table-column label="挂岗天数" width="80" align="right"><template #default="{ row }"><span class="tnum">{{ row.postedDays }}</span></template></el-table-column>
        <el-table-column label="剩余名额" width="80" align="right"><template #default="{ row }"><span class="tnum">{{ row.quotaRemaining ?? '—' }}</span></template></el-table-column>
        <el-table-column label="投诉属实" width="80" align="right">
          <template #default="{ row }"><span class="tnum" :class="row.complaintVerified > 0 ? 'warn-t' : 'dim'">{{ row.complaintVerified }}</span></template>
        </el-table-column>
        <el-table-column label="公司诚信 / 处罚" min-width="200">
          <template #default="{ row }">
            <span class="t-sm">诚信分 <b class="tnum">{{ row.creditScore }}</b></span>
            <span class="dim"> · </span>
            <span v-if="row.penaltyLevel > 0" class="status-tag" :class="`status-tag--${PENALTY_LEVELS[row.penaltyLevel]?.tone ?? 'neutral'}`">{{ penaltyLabel(row.penaltyLevel) }}</span>
            <span v-else class="t-sm dim">无处罚</span>
            <span v-if="truthy(row.feeRightsRevoked)" class="status-tag status-tag--danger ml">收费权限已取消</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loading" class="tbl-wait" />
          <div v-else-if="error" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>岗位权重加载失败</h4>
            <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
            <el-button type="primary" @click="load">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ rows.length ? '没有僵尸岗位' : companyId.trim() ? '这家公司没有招聘中的岗位' : '暂无招聘中岗位' }}</h4>
            <p>{{ rows.length ? '权重低于 0.3 的岗位会出现在这里；取消「只看僵尸岗位」查看全部' : companyId.trim() ? '核对公司 ID 后再查，或点「重置」' : '岗位审核通过、上架招聘后会出现在这里' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="shown.length" class="pager">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="shown.length" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { gap: var(--space-gap); margin-bottom: var(--space-gap); }
.stat--danger .stat-v, .stat--danger .stat-i { color: var(--danger-text); }
.tbl-wait { height: 160px; }
.wt { display: flex; align-items: center; gap: var(--space-2); }
.track { flex: 1; height: 6px; border-radius: var(--radius-tag); background: var(--bg-fill); overflow: hidden; }
.track i { display: block; height: 100%; background: currentColor; }
.wt.ok { color: var(--success-text); }
.wt.warn { color: var(--warning-text); }
.wt.danger { color: var(--danger-text); }
.wt .strong { color: var(--text-1); }
.wt + .status-tag { margin-top: var(--space-1); }
.warn-t { color: var(--warning-text); font-weight: var(--font-weight-semibold); }
.ml { margin-left: var(--space-1); }
</style>
