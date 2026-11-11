<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { opsApi, useDict, type CompanyStatus, type CompanyView } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { usePagedList } from '@/composables/usePagedList'
import { usePendingStore } from '@/stores/pending'
import { daysUntil, fmtDate, fmtDateTime } from '@/utils/format'
import CompanyDrawer from './CompanyDrawer.vue'

const route = useRoute()
const router = useRouter()
const { options } = useDict()
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
function rowClass({ row }: { row: CompanyView }) {
  return row.status === 'PENDING_AUDIT' ? 'is-hl' : ''
}

onMounted(() => list.load())
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>劳务公司管理</h2><p>入驻审核 · 状态管理（正常 / 限流 / 封禁）· 营业执照与合作合同查看</p></div>
      <div class="spacer" />
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="setStatus(t.value)">
            {{ t.label }}<span v-if="t.value === 'PENDING_AUDIT' && pending.counts" class="n">{{ pending.counts.companies }}</span>
          </button>
        </div>
        <div class="spacer" />
        <el-input v-model="keyword" clearable placeholder="公司名称 / 公司 ID / 统一社会信用代码" style="width: 280px" @keyup.enter="list.search()" @clear="list.search()" />
        <el-button type="primary" @click="list.search()">查询</el-button>
      </div>

      <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table" :row-class-name="rowClass" row-key="companyId" @row-dblclick="open">
        <el-table-column label="公司" min-width="220">
          <template #default="{ row }">
            <span class="link-cell" @click="open(row)">{{ row.name }}</span>
            <div class="t-xs">
              <span class="mono">{{ row.companyId }}</span><template v-if="row.shortName"> · {{ row.shortName }}</template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="统一社会信用代码" min-width="180">
          <template #default="{ row }"><span class="mono t-sm">{{ row.unifiedCreditCode }}</span></template>
        </el-table-column>
        <el-table-column label="联系人" min-width="130">
          <template #default="{ row }">
            {{ row.contactName }}
            <div class="t-xs mono">{{ row.contactPhone ?? '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><StatusTag type="CompanyStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.submittedAt) }}</span></template>
        </el-table-column>
        <el-table-column label="入驻日 / 免费期至" min-width="160">
          <template #default="{ row }">
            <template v-if="row.onboardDate">
              <span class="mono t-sm">{{ fmtDate(row.onboardDate) }}</span>
              <div class="t-xs">
                免费期至 <span class="mono">{{ fmtDate(row.freePeriodEnd) }}</span>
                <span v-if="(freeLeft(row) ?? -1) >= 0" class="tag tag--warn ml">剩 {{ freeLeft(row) }} 天</span>
              </div>
            </template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="right" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :type="row.status === 'PENDING_AUDIT' ? 'primary' : 'default'" @click="open(row)">
              {{ row.status === 'PENDING_AUDIT' ? '审核' : '详情' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="list.error.value" :image-size="64" :description="list.error.value">
            <el-button size="small" @click="list.load()">重试</el-button>
          </el-empty>
          <el-empty v-else :image-size="64" :description="status === 'PENDING_AUDIT' ? '暂无待审核的入驻申请' : '暂无数据'" />
        </template>
      </el-table>
      <div class="pager">
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
.ml { margin-left: 4px; }
</style>
