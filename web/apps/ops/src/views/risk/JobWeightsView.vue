<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, opsApi } from '@shitu/api-client'
import { fmtNum } from '@/utils/format'
import { PENALTY_LEVELS, penaltyLabel, truthy } from './riskMeta'

/** P-05 降权与限流：招聘中岗位的真实匹配权重（仅平台可见，企业无感知）；权重 < 0.3 标记僵尸岗位 */
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
const companyId = ref('')
const onlyZombie = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = (await opsApi.jobWeights(companyId.value.trim() || undefined)) as unknown as WeightRow[]
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

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
function rowClass({ row }: { row: WeightRow }) {
  return row.zombie ? 'is-hl' : ''
}
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
      <div class="spacer" />
    </div>

    <div class="grid g-4 stats">
      <div class="stat"><div class="stat-l">招聘中岗位</div><div class="stat-v">{{ fmtNum(stats.n) }}</div><div class="stat-d">按权重从低到高，最多 500 条</div></div>
      <div class="stat"><div class="stat-l">平均权重</div><div class="stat-v">{{ stats.n ? stats.avg.toFixed(2) : '—' }}</div><div class="stat-d">1.00 为未降权</div></div>
      <div class="stat"><div class="stat-l">明显降权</div><div class="stat-v warn">{{ fmtNum(stats.low) }}</div><div class="stat-d">权重 0.3 – 0.7</div></div>
      <div class="stat"><div class="stat-l">僵尸岗位</div><div class="stat-v danger">{{ fmtNum(stats.zombie) }}</div><div class="stat-d">权重 &lt; 0.3，几乎不再曝光</div></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <el-checkbox v-model="onlyZombie">只看僵尸岗位</el-checkbox>
        <div class="spacer" />
        <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 160px" @keyup.enter="load" @clear="load" />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
      <el-table v-loading="loading" :data="shown" class="ops-table" row-key="jobId" :row-class-name="rowClass">
        <el-table-column label="岗位" min-width="200">
          <template #default="{ row }"><span class="strong">{{ row.title }}</span><div class="t-xs mono">{{ row.jobId }}</div></template>
        </el-table-column>
        <el-table-column label="公司" min-width="160">
          <template #default="{ row }">
            <span class="link-cell" @click="toCredit(row.companyId)">{{ row.companyName }}</span>
            <div class="t-xs mono">{{ row.companyId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="匹配权重" width="170">
          <template #default="{ row }">
            <div class="wt" :class="tone(row)">
              <span class="mono strong">{{ w(row).toFixed(2) }}</span>
              <span class="track"><i :style="{ width: `${Math.min(100, w(row) * 100)}%` }" /></span>
            </div>
            <span v-if="row.zombie" class="tag tag--danger">僵尸岗位</span>
          </template>
        </el-table-column>
        <el-table-column label="挂岗天数" width="90" align="right"><template #default="{ row }"><span class="mono">{{ row.postedDays }}</span></template></el-table-column>
        <el-table-column label="剩余名额" width="90" align="right"><template #default="{ row }"><span class="mono">{{ row.quotaRemaining ?? '—' }}</span></template></el-table-column>
        <el-table-column label="投诉属实" width="90" align="right">
          <template #default="{ row }"><span class="mono" :class="row.complaintVerified > 0 ? 'warn-t' : 'dim'">{{ row.complaintVerified }}</span></template>
        </el-table-column>
        <el-table-column label="公司诚信 / 处罚" min-width="220">
          <template #default="{ row }">
            <span class="t-sm">诚信分 <b class="num">{{ row.creditScore }}</b></span>
            <span class="dim"> · </span>
            <span v-if="row.penaltyLevel > 0" class="tag" :class="PENALTY_LEVELS[row.penaltyLevel]?.cls">{{ penaltyLabel(row.penaltyLevel) }}</span>
            <span v-else class="t-sm dim">无处罚</span>
            <span v-if="truthy(row.feeRightsRevoked)" class="tag tag--danger ml">收费权限已取消</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="error" :image-size="64" :description="error"><el-button size="small" @click="load">重试</el-button></el-empty>
          <el-empty v-else :image-size="64" description="暂无招聘中岗位" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.stats { margin-bottom: 14px; }
.stat-v.warn { color: var(--warn); }
.stat-v.danger { color: var(--danger); }
.wt { display: flex; align-items: center; gap: 8px; }
.track { flex: 1; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
.track i { display: block; height: 100%; background: currentColor; }
.wt.ok { color: var(--ok); }
.wt.warn { color: var(--warn); }
.wt.danger { color: var(--danger); }
.wt .strong { color: inherit; }
.warn-t { color: var(--warn); font-weight: 600; }
.ml { margin-left: 4px; }
</style>
