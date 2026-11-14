<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { opsApi, useDict, type JobStatus, type JobView } from '@shitu/api-client'
import { IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { usePagedList } from '@/composables/usePagedList'
import { usePendingStore } from '@/stores/pending'
import { actionsColWidth } from '@/utils/actionsWidth'
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
function reset() {
  keyword.value = ''
  companyId.value = ''
  list.search()
}
const opsWidth = computed(() => actionsColWidth([{ labels: ['审核'] }], 72))

onMounted(() => list.load())
</script>

<template>
  <div class="card tbl-card">
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
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table tbl-48" row-key="jobId" @row-dblclick="(r: JobView) => (drawerId = r.jobId)">
      <el-table-column label="岗位" min-width="175">
        <template #default="{ row }">
          <span class="link-cell" @click="drawerId = row.jobId">{{ row.title }}</span>
          <div class="t-xs">{{ row.jobId }} · {{ label('JobType', row.jobType) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="发布企业" min-width="120">
        <template #default="{ row }">
          {{ row.companyName ?? '—' }}
          <div class="t-xs">{{ row.companyId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="项目 · 城市 / 关联甲方" min-width="190">
        <template #default="{ row }">
          {{ row.projectName ?? '—' }}<template v-if="row.city"> · {{ row.city }}</template>
          <div class="t-xs">{{ row.clientName ?? row.clientId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="薪资（元/月）" width="120" align="right">
        <template #default="{ row }"><span class="tnum">{{ fmtSalary(row.salaryMin, row.salaryMax) }}</span></template>
      </el-table-column>
      <el-table-column label="名额" width="80" align="right">
        <template #default="{ row }">
          <span class="tnum">{{ row.quotaRemaining }}</span><span class="t-xs"> / {{ row.quotaTotal }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><StatusTag type="JobStatus" :value="row.status" /></template>
      </el-table-column>
      <el-table-column label="提交时间" width="150">
        <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.submittedAt) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="drawerId = row.jobId">{{ row.status === 'PENDING_AUDIT' ? '审核' : '详情' }}</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <div v-if="list.loading.value" class="tbl-wait" />
        <div v-else-if="list.error.value" class="state-box">
          <IconTriangleExclamationPoint :size="48" />
          <h4>岗位列表加载失败</h4>
          <p>{{ list.offline.value ? '请检查网络后重新加载' : list.error.value }}</p>
          <el-button type="primary" @click="list.load()">重新加载</el-button>
        </div>
        <div v-else class="state-box">
          <IconInbox :size="48" />
          <h4>{{ keyword.trim() || companyId.trim() ? '没有符合条件的岗位' : status === 'PENDING_AUDIT' ? '暂无待审核岗位' : '暂无数据' }}</h4>
          <p>{{ keyword.trim() || companyId.trim() ? '换个条件再查，或点「重置」' : status === 'PENDING_AUDIT' ? '劳务公司提交岗位审核后会出现在这里' : '切换上方页签查看其他状态的岗位' }}</p>
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

    <JobDrawer :job-id="drawerId" @close="drawerId = null" @changed="onChanged" />
  </div>
</template>

<style scoped>
.tbl-wait { height: 160px; }
</style>
