<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { errorMessage, opsApi } from '@shitu/api-client'
import { IconBuildingComplex, IconCalendar, IconClock, IconInbox, IconLock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { isNetwork } from '@/composables/boxSubmit'
import { fmtDate, fmtDateTime, fmtNum } from '@/utils/format'

/** P-03 花名册与存量基数：免费期倒计时、到期自动锁定的存量基数、锁定记录、当前在岗人数（第 2 类：统计卡 → 筛选栏 → 表格 → 分页） */
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
const offline = ref(false)
/** 拿到过一次数据之前（加载中、加载失败）指标和页签不显示数字 */
const loaded = ref(false)
const companyId = ref('')
const filter = ref<'all' | 'free' | 'locked' | 'soon'>('all')

async function load() {
  loading.value = true
  loaded.value = false
  error.value = ''
  offline.value = false
  try {
    rows.value = (await opsApi.stockBases(companyId.value.trim() || undefined)) as unknown as StockRow[]
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
  filter.value = 'all'
  void load()
}

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
// 前端分页：接口一次返回全部（最多 500 家）
const page = ref(1)
const pageSize = ref(20)
watch([filter, rows], () => (page.value = 1))
const paged = computed(() => shown.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const n = (v: number) => (loaded.value ? String(v) : '—')
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>花名册与存量锁定</h2>
        <p>新入驻企业免费期内导入花名册；免费期到期自动锁定存量基数，之后只对基数外的增量在岗人数收取增长技术服务费</p>
      </div>
    </div>

    <div class="grid g-4 kpis">
      <div class="stat stat--icon"><div class="stat-l">已入驻企业</div><IconBuildingComplex :size="20" class="stat-i" /><div class="stat-v">{{ n(counts.all) }}</div><div class="stat-d">有入驻日期的企业（最多 500 家）</div></div>
      <div class="stat stat--icon"><div class="stat-l">免费期内</div><IconClock :size="20" class="stat-i" /><div class="stat-v">{{ n(counts.free) }}</div><div class="stat-d">可继续导入花名册</div></div>
      <div class="stat stat--icon"><div class="stat-l">7 天内到期</div><IconCalendar :size="20" class="stat-i" /><div class="stat-v">{{ n(counts.soon) }}</div><div class="stat-d">提醒企业尽快完成导入</div></div>
      <div class="stat stat--icon"><div class="stat-l">已锁定存量</div><IconLock :size="20" class="stat-i" /><div class="stat-v">{{ n(counts.locked) }}</div><div class="stat-d">开始按增量计费</div></div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: filter === t.value }" @click="filter = t.value">
            {{ t.label }}<span v-if="loaded" class="n">{{ counts[t.value] }}</span>
          </button>
        </div>
        <div class="spacer" />
        <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 160px" @keyup.enter="load" @clear="load" />
        <el-button type="primary" @click="load">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <el-table v-loading="loading" :data="paged" class="ops-table tbl-48" row-key="companyId">
        <el-table-column label="公司" min-width="180">
          <template #default="{ row }"><span class="strong">{{ row.name }}</span><div class="t-xs">{{ row.companyId }}</div></template>
        </el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag type="CompanyStatus" :value="row.companyStatus" /></template></el-table-column>
        <el-table-column label="入驻日" width="120"><template #default="{ row }"><span class="tnum">{{ fmtDate(row.onboardDate) }}</span></template></el-table-column>
        <el-table-column label="免费期" min-width="150">
          <template #default="{ row }">
            <span class="tnum">至 {{ fmtDate(row.freePeriodEnd) }}</span>
            <div class="free">
              <span v-if="isLocked(row)" class="status-tag">已结束</span>
              <span v-else-if="inFree(row)" class="status-tag" :class="soon(row) ? 'status-tag--warning' : 'status-tag--success'">剩 {{ row.freeDaysLeft }} 天</span>
              <span v-else class="status-tag status-tag--danger">已到期 · 待锁定</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="花名册导入" width="110" align="right"><template #default="{ row }"><span class="tnum">{{ fmtNum(row.stockImported) }}</span></template></el-table-column>
        <el-table-column label="当前在岗" width="100" align="right"><template #default="{ row }"><span class="tnum">{{ fmtNum(row.activeCount) }}</span></template></el-table-column>
        <el-table-column label="存量基数" width="100" align="right">
          <template #default="{ row }"><span v-if="row.baseCount != null" class="tnum strong">{{ fmtNum(row.baseCount) }}</span><span v-else class="dim">未锁定</span></template>
        </el-table-column>
        <el-table-column label="锁定记录" min-width="150">
          <template #default="{ row }">
            <template v-if="row.lockedAt"><span class="tnum">{{ fmtDateTime(row.lockedAt) }}</span><div class="t-xs">{{ row.lockedBy ?? '系统自动' }}</div></template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loading" class="tbl-wait" />
          <div v-else-if="error" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>存量数据加载失败</h4>
            <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
            <el-button type="primary" @click="load">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ rows.length ? '这个分类下没有企业' : companyId.trim() ? '没有找到这家公司' : '还没有已入驻的企业' }}</h4>
            <p>{{ rows.length ? '切换上方页签查看其他企业' : companyId.trim() ? '核对公司 ID 后再查，或点「重置」' : '入驻审核通过的企业会出现在这里，并开始计算免费期' }}</p>
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
.tbl-wait { height: 160px; }
.free { margin-top: var(--space-1); }
</style>
