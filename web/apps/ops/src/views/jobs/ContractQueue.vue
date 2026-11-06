<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type ClientContractStatus, type ContractView } from '@shitu/api-client'
import FileViewButton from '@/components/FileViewButton.vue'
import StatusTag from '@/components/StatusTag.vue'
import { usePagedList } from '@/composables/usePagedList'
import { promptRemark } from '@/composables/useRemark'
import { usePendingStore } from '@/stores/pending'
import { daysUntil, fmtDate, fmtDateTime } from '@/utils/format'

const { options } = useDict()
const pending = usePendingStore()

const status = ref<ClientContractStatus | ''>('PENDING')
const companyId = ref('')
const tabs = computed(() => [...options('ClientContractStatus'), { value: '', label: '全部' }])

const list = usePagedList<ContractView>((p) =>
  opsApi.contracts({ ...p, status: status.value || undefined, companyId: companyId.value.trim() || undefined }),
)
watch(status, () => list.search())

const acting = ref<string | null>(null)
async function run(id: string, fn: () => Promise<unknown>, okMsg: string) {
  acting.value = id
  try {
    await fn()
    ElMessage.success(okMsg)
    list.load()
    pending.refresh()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = null
  }
}

async function approve(row: ContractView) {
  const expired = (daysUntil(row.validTo) ?? 0) < 0
  const remark = await promptRemark({
    title: '合同备案通过',
    message: `${row.companyName ?? row.companyId} ↔ ${row.clientName ?? row.clientId}，有效期 ${fmtDate(row.validFrom)} ~ ${fmtDate(row.validTo)}。${expired ? '注意：该合同已过有效期，备案后也不会生效。' : '请确认已查看合同文件，甲乙双方与有效期无误。'}`,
    confirmText: '通过',
  })
  if (remark === null) return
  await run(row.contractId, () => opsApi.approveContract(row.contractId, remark || undefined), '合同已备案')
}
async function reject(row: ContractView) {
  const remark = await promptRemark({ title: '驳回合同备案', message: '驳回原因将展示给劳务公司。', required: true, danger: true, confirmText: '驳回' })
  if (remark === null) return
  await run(row.contractId, () => opsApi.rejectContract(row.contractId, remark), '已驳回')
}

onMounted(() => list.load())
</script>

<template>
  <div class="card">
    <div class="toolbar">
      <div class="filter-tabs">
        <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="status = t.value as ClientContractStatus | ''">
          {{ t.label }}<span v-if="t.value === 'PENDING' && pending.counts" class="n">{{ pending.counts.contracts }}</span>
        </button>
      </div>
      <div class="spacer" />
      <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 140px" @keyup.enter="list.search()" @clear="list.search()" />
      <el-button type="primary" @click="list.search()">查询</el-button>
    </div>

    <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table" row-key="contractId">
      <el-table-column label="劳务公司" min-width="170">
        <template #default="{ row }">
          <b class="strong">{{ row.companyName ?? '—' }}</b>
          <div class="t-xs mono">{{ row.companyId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="甲方" min-width="170">
        <template #default="{ row }">{{ row.clientName ?? row.clientId }}</template>
      </el-table-column>
      <el-table-column label="有效期" min-width="190">
        <template #default="{ row }">
          <span class="mono t-sm">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span>
          <span v-if="(daysUntil(row.validTo) ?? 0) < 0" class="tag tag--danger ml">已过期</span>
        </template>
      </el-table-column>
      <el-table-column label="备案状态" width="100">
        <template #default="{ row }"><StatusTag type="ClientContractStatus" :value="row.auditStatus" /></template>
      </el-table-column>
      <el-table-column label="生效" width="80">
        <template #default="{ row }"><span class="tag" :class="{ 'tag--ok': row.effective }">{{ row.effective ? '生效中' : '未生效' }}</span></template>
      </el-table-column>
      <el-table-column label="提交时间" width="140">
        <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="审核说明" min-width="140">
        <template #default="{ row }">
          <span class="t-sm">{{ row.auditRemark || '—' }}</span>
          <div v-if="row.auditedAt" class="t-xs mono">{{ fmtDateTime(row.auditedAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="合同" width="70">
        <template #default="{ row }"><FileViewButton :file-key="row.fileKey" /></template>
      </el-table-column>
      <el-table-column label="操作" width="140" align="right" fixed="right">
        <template #default="{ row }">
          <template v-if="row.auditStatus === 'PENDING'">
            <el-button size="small" type="danger" plain :disabled="acting === row.contractId" @click="reject(row)">驳回</el-button>
            <el-button size="small" type="primary" :loading="acting === row.contractId" @click="approve(row)">通过</el-button>
          </template>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="list.error.value" :image-size="64" :description="list.error.value">
          <el-button size="small" @click="list.load()">重试</el-button>
        </el-empty>
        <el-empty v-else :image-size="64" :description="status === 'PENDING' ? '暂无待备案合同' : '暂无数据'" />
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
</template>

<style scoped>
.ml { margin-left: 4px; }
</style>
