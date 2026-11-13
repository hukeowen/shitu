<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { errorMessage, opsApi } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { fmtDate, fmtDateTime, fmtNum, fmtOperator } from '@/utils/format'

/** P-03 花名册与存量基数：免费期倒计时、到期自动锁定的存量基数、锁定记录、当前在岗人数 */
interface StockRow {
  companyId: string
  name: string
  companyStatus: string
  onboardDate?: string
  freePeriodEnd?: string
  freeDaysLeft?: number
  baseCount?: number | null
  lockedAt?: string | null
  lockedBy?: string | null
  activeCount: number
  stockImported: number
}

const rows = shallowRef<StockRow[]>([])
const loading = ref(false)
const error = ref('')
const companyId = ref('')
const filter = ref<'all' | 'free' | 'locked' | 'soon'>('all')

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = (await opsApi.stockBases(companyId.value.trim() || undefined)) as unknown as StockRow[]
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

const isLocked = (r: StockRow) => r.lockedAt != null
const inFree = (r: StockRow) => !isLocked(r) && (r.freeDaysLeft ?? 0) > 0
const soon = (r: StockRow) => inFree(r) && (r.freeDaysLeft ?? 99) <= 7
const counts = computed(() => ({
  all: rows.value.length,
  free: rows.value.filter(inFree).length,
  soon: rows.value.filter(soon).length,
  locked: rows.value.filter(isLocked).length,
}))
const shown = computed(() => {
  switch (filter.value) {
    case 'free':
      return rows.value.filter(inFree)
    case 'soon':
      return rows.value.filter(soon)
    case 'locked':
      return rows.value.filter(isLocked)
    default:
      return rows.value
  }
})
const tabs = [
  { value: 'all', label: '全部' },
  { value: 'free', label: '免费期内' },
  { value: 'soon', label: '7 天内到期' },
  { value: 'locked', label: '已锁定' },
] as const
function rowClass({ row }: { row: StockRow }) {
  return soon(row) ? 'is-hl' : ''
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>花名册与存量锁定</h2>
        <p>新入驻企业免费期内导入花名册；免费期到期自动锁定存量基数，之后只对基数外的增量在岗人数收取增长技术服务费</p>
      </div>
      <div class="spacer" />
    </div>

    <div class="grid g-4 stats">
      <div class="stat"><div class="stat-l">已入驻企业</div><div class="stat-v">{{ counts.all }}</div><div class="stat-d">有入驻日期的企业（最多 500 家）</div></div>
      <div class="stat"><div class="stat-l">免费期内</div><div class="stat-v">{{ counts.free }}</div><div class="stat-d">可继续导入花名册</div></div>
      <div class="stat"><div class="stat-l">7 天内到期</div><div class="stat-v" :class="{ warn: counts.soon > 0 }">{{ counts.soon }}</div><div class="stat-d">提醒企业尽快完成导入</div></div>
      <div class="stat"><div class="stat-l">已锁定存量</div><div class="stat-v">{{ counts.locked }}</div><div class="stat-d">开始按增量计费</div></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: filter === t.value }" @click="filter = t.value">
            {{ t.label }}<span class="n">{{ counts[t.value] }}</span>
          </button>
        </div>
        <div class="spacer" />
        <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 160px" @keyup.enter="load" @clear="load" />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
      <el-table v-loading="loading" :data="shown" class="ops-table" row-key="companyId" :row-class-name="rowClass">
        <el-table-column label="公司" min-width="200">
          <template #default="{ row }"><span class="strong">{{ row.name }}</span><div class="t-xs mono">{{ row.companyId }}</div></template>
        </el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag type="CompanyStatus" :value="row.companyStatus" /></template></el-table-column>
        <el-table-column label="入驻日" width="110"><template #default="{ row }"><span class="mono t-sm">{{ fmtDate(row.onboardDate) }}</span></template></el-table-column>
        <el-table-column label="免费期" min-width="170">
          <template #default="{ row }">
            <span class="mono t-sm">至 {{ fmtDate(row.freePeriodEnd) }}</span>
            <div>
              <span v-if="isLocked(row)" class="tag">已结束</span>
              <span v-else-if="inFree(row)" class="tag" :class="soon(row) ? 'tag--warn' : 'tag--ok'">剩 {{ row.freeDaysLeft }} 天</span>
              <span v-else class="tag tag--danger">已到期 · 待锁定</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="花名册导入" width="110" align="right"><template #default="{ row }"><span class="mono">{{ fmtNum(row.stockImported) }}</span></template></el-table-column>
        <el-table-column label="当前在岗" width="100" align="right"><template #default="{ row }"><span class="mono">{{ fmtNum(row.activeCount) }}</span></template></el-table-column>
        <el-table-column label="存量基数" width="100" align="right">
          <template #default="{ row }"><span v-if="row.baseCount != null" class="mono strong">{{ fmtNum(row.baseCount) }}</span><span v-else class="dim">未锁定</span></template>
        </el-table-column>
        <el-table-column label="锁定记录" min-width="160">
          <template #default="{ row }">
            <template v-if="row.lockedAt"><span class="mono t-sm">{{ fmtDateTime(row.lockedAt) }}</span><div class="t-xs">{{ fmtOperator(row.lockedBy, '系统自动') }}</div></template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="error" :image-size="64" :description="error"><el-button size="small" @click="load">重试</el-button></el-empty>
          <el-empty v-else :image-size="64" description="暂无数据" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.stats { margin-bottom: 14px; }
.stat-v.warn { color: var(--warn); }
</style>
