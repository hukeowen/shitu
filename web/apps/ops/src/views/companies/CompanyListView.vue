<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { opsApi, useDict, type CompanyStatus, type CompanyView } from '@shitu/api-client'
import { IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { usePagedList } from '@/composables/usePagedList'
import { usePendingStore } from '@/stores/pending'
import { actionsColWidth } from '@/utils/actionsWidth'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { daysUntil, fmtDate, fmtDateTime } from '@/utils/format'
import CompanyDrawer from './CompanyDrawer.vue'

/** 劳务公司管理（第 8 类审核处理：页签 + 表格 → 抽屉里看材料 → 底部驳回 / 通过） */
const route = useRoute()
const router = useRouter()
const { label, options } = useDict()
const pending = usePendingStore()

const ALL = ''
const status = ref<CompanyStatus | ''>(typeof route.query.status === 'string' ? (route.query.status as CompanyStatus | '') : 'PENDING_AUDIT')
const keyword = ref('')

const tabs = computed(() => [...options('CompanyStatus'), { value: ALL, label: '全部' }])

const list = usePagedList<CompanyView>((p) =>
  opsApi.companies({ ...p, status: status.value || undefined, keyword: keyword.value.trim() || undefined }),
)

function setStatus(s: string) {
  status.value = s as CompanyStatus | ''
  router.replace({ query: { ...route.query, status: s } })
}
watch(status, () => list.search())
function reset() {
  keyword.value = ''
  list.search()
}

/** 导出：按当前页签、关键词把所有页取完；字段同表格（联系电话按接口返回） */
const exporting = ref(false)
const EXPORT_COLUMNS: CsvColumn<CompanyView>[] = [
  { header: '公司', value: (c) => c.name },
  { header: '公司 ID', value: (c) => c.companyId, kind: 'text' },
  { header: '简称', value: (c) => c.shortName },
  { header: '统一社会信用代码', value: (c) => c.unifiedCreditCode, kind: 'text' },
  { header: '联系人', value: (c) => c.contactName },
  { header: '联系电话', value: (c) => c.contactPhone, kind: 'text' },
  { header: '状态', value: (c) => label('CompanyStatus', c.status) },
  { header: '提交时间', value: (c) => c.submittedAt, kind: 'datetime' },
  { header: '入驻日', value: (c) => c.onboardDate, kind: 'date' },
  { header: '免费期至', value: (c) => (c.onboardDate ? c.freePeriodEnd : ''), kind: 'date' },
]
function doExport() {
  const q = { status: status.value || undefined, keyword: keyword.value.trim() || undefined }
  return exportList({ name: '劳务公司', columns: EXPORT_COLUMNS, rows: (page, pageSize) => opsApi.companies({ ...q, page, pageSize }), loading: exporting })
}

const drawerId = ref<string | null>(null)
function open(row: CompanyView) {
  drawerId.value = row.companyId
}
function onChanged() {
  list.load()
  pending.refresh()
}

function freeLeft(row: CompanyView): number | null {
  return daysUntil(row.freePeriodEnd)
}
/** 待审核页签的数：列表拿到数据后才显示（加载中、失败不带数）；停在待审核页签时就是列表的条数，和表格一致 */
const pendN = computed(() => (list.loading.value || list.error.value ? null : status.value === 'PENDING_AUDIT' ? list.total.value : pending.counts?.companies))
const opsWidth = computed(() => actionsColWidth([{ labels: ['审核'] }], 72))
const EMPTY: Record<string, { title: string; desc: string }> = {
  PENDING_AUDIT: { title: '暂无待审核的入驻申请', desc: '劳务公司提交入驻申请后会出现在这里' },
}

onMounted(() => list.load())
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>劳务公司管理</h2><p>入驻审核 · 状态管理（正常 / 限流 / 封禁）· 营业执照与合作合同查看</p></div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="setStatus(t.value)">
            {{ t.label }}<span v-if="t.value === 'PENDING_AUDIT' && pendN != null" class="n">{{ pendN }}</span>
          </button>
        </div>
        <div class="spacer" />
        <el-input v-model="keyword" clearable placeholder="公司名称 / 公司 ID / 统一社会信用代码" style="width: 280px" @keyup.enter="list.search()" @clear="list.search()" />
        <el-button @click="list.search()">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button :loading="exporting" :disabled="!list.total.value" @click="doExport">导出</el-button>
      </div>

      <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table tbl-48" row-key="companyId" @row-dblclick="open">
        <el-table-column label="公司" min-width="200">
          <template #default="{ row }">
            <span class="link-cell" @click="open(row)">{{ row.name }}</span>
            <div class="t-xs">{{ row.companyId }}<template v-if="row.shortName"> · {{ row.shortName }}</template></div>
          </template>
        </el-table-column>
        <el-table-column label="统一社会信用代码" min-width="190">
          <template #default="{ row }"><span class="tnum">{{ row.unifiedCreditCode }}</span></template>
        </el-table-column>
        <el-table-column label="联系人" min-width="110">
          <template #default="{ row }">
            {{ row.contactName }}
            <div class="t-xs">{{ row.contactPhone ?? '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StatusTag type="CompanyStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.submittedAt) }}</span></template>
        </el-table-column>
        <el-table-column label="入驻日 / 免费期至" min-width="180">
          <template #default="{ row }">
            <template v-if="row.onboardDate">
              <span class="tnum">{{ fmtDate(row.onboardDate) }}</span>
              <div class="t-xs free">
                至 {{ fmtDate(row.freePeriodEnd) }}
                <span v-if="(freeLeft(row) ?? -1) >= 0" class="status-tag status-tag--warning">剩 {{ freeLeft(row) }} 天</span>
              </div>
            </template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="open(row)">{{ row.status === 'PENDING_AUDIT' ? '审核' : '详情' }}</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="list.loading.value" class="tbl-wait" />
          <div v-else-if="list.error.value" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>公司列表加载失败</h4>
            <p>{{ list.offline.value ? '请检查网络后重新加载' : list.error.value }}</p>
            <el-button type="primary" @click="list.load()">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ keyword.trim() ? '没有符合条件的公司' : EMPTY[status]?.title ?? '暂无数据' }}</h4>
            <p>{{ keyword.trim() ? '换个公司名称、公司 ID 或信用代码再查，或点「重置」' : EMPTY[status]?.desc ?? '切换上方页签查看其他状态的公司' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="list.total.value" class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="list.total.value"
          :current-page="list.page.value"
          :page-size="list.pageSize.value"
          :page-sizes="[20, 50, 100]"
          @current-change="list.onPageChange"
          @size-change="list.onSizeChange"
        />
      </div>
    </div>

    <CompanyDrawer :company-id="drawerId" @close="drawerId = null" @changed="onChanged" />
  </div>
</template>

<style scoped>
.tbl-wait { height: 160px; }
.free { display: flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
</style>
