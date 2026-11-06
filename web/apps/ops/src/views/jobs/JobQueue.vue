<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { opsApi, useDict, type JobStatus, type JobView } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { usePagedList } from '@/composables/usePagedList'
import { usePendingStore } from '@/stores/pending'
import { fmtDateTime, fmtSalary } from '@/utils/format'
import JobDrawer from './JobDrawer.vue'

const route = useRoute()
const { options, label } = useDict()
const pending = usePendingStore()

const status = ref<JobStatus | ''>('PENDING_AUDIT')
const keyword = ref('')
const companyId = ref(typeof route.query.companyId === 'string' ? route.query.companyId : '')

const tabs = computed(() => [...options('JobStatus'), { value: '', label: '全部' }])

const list = usePagedList<JobView>((p) =>
  opsApi.jobs({
    ...p,
    status: status.value || undefined,
    keyword: keyword.value.trim() || undefined,
    companyId: companyId.value.trim() || undefined,
  }),
)
watch(status, () => list.search())

const drawerId = ref<string | null>(null)
function onChanged() {
  list.load()
  pending.refresh()
}
function rowClass({ row }: { row: JobView }) {
  return row.status === 'PENDING_AUDIT' ? 'is-hl' : ''
}

onMounted(() => list.load())
</script>

<template>
  <div class="card">
    <div class="toolbar">
      <div class="filter-tabs">
        <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="status = t.value as JobStatus | ''">
          {{ t.label }}<span v-if="t.value === 'PENDING_AUDIT' && pending.counts" class="n">{{ pending.counts.jobs }}</span>
        </button>
      </div>
      <div class="spacer" />
      <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 130px" @keyup.enter="list.search()" @clear="list.search()" />
      <el-input v-model="keyword" clearable placeholder="岗位名称 / 岗位 ID" style="width: 200px" @keyup.enter="list.search()" @clear="list.search()" />
      <el-button type="primary" @click="list.search()">查询</el-button>
    </div>

    <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table" :row-class-name="rowClass" row-key="jobId" @row-dblclick="(r: JobView) => (drawerId = r.jobId)">
      <el-table-column label="岗位" min-width="200">
        <template #default="{ row }">
          <span class="link-cell" @click="drawerId = row.jobId">{{ row.title }}</span>
          <div class="t-xs"><span class="mono">{{ row.jobId }}</span> · {{ label('JobType', row.jobType) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="发布企业" min-width="150">
        <template #default="{ row }">
          {{ row.companyName ?? '—' }}
          <div class="t-xs mono">{{ row.companyId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="项目 / 城市" min-width="140">
        <template #default="{ row }">
          {{ row.projectName ?? '—' }}
          <div class="t-xs">{{ row.city ?? '' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="关联甲方" min-width="140">
        <template #default="{ row }"><span class="t-sm">{{ row.clientName ?? row.clientId }}</span></template>
      </el-table-column>
      <el-table-column label="薪资（元/月）" width="120">
        <template #default="{ row }"><span class="mono t-sm">{{ fmtSalary(row.salaryMin, row.salaryMax) }}</span></template>
      </el-table-column>
      <el-table-column label="名额" width="90" align="right">
        <template #default="{ row }">
          <span class="mono">{{ row.quotaRemaining }}</span><span class="t-xs"> / {{ row.quotaTotal }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }"><StatusTag type="JobStatus" :value="row.status" /></template>
      </el-table-column>
      <el-table-column label="提交时间" width="140">
        <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.submittedAt) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="90" align="right" fixed="right">
        <template #default="{ row }">
          <el-button size="small" :type="row.status === 'PENDING_AUDIT' ? 'primary' : 'default'" @click="drawerId = row.jobId">
            {{ row.status === 'PENDING_AUDIT' ? '审核' : '详情' }}
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="list.error.value" :image-size="64" :description="list.error.value">
          <el-button size="small" @click="list.load()">重试</el-button>
        </el-empty>
        <el-empty v-else :image-size="64" :description="status === 'PENDING_AUDIT' ? '暂无待审核岗位' : '暂无数据'" />
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

    <JobDrawer :job-id="drawerId" @close="drawerId = null" @changed="onChanged" />
  </div>
</template>
