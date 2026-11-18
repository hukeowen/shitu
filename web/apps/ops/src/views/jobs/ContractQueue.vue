<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { opsApi, useDict, type ClientContractStatus, type ContractView } from '@shitu/api-client'
import { IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import FileViewButton from '@/components/FileViewButton.vue'
import StatusTag from '@/components/StatusTag.vue'
import { remarkInBox } from '@/composables/boxSubmit'
import { usePagedList } from '@/composables/usePagedList'
import { usePendingStore } from '@/stores/pending'
import { actionsColWidth } from '@/utils/actionsWidth'
import { daysUntil, fmtDate, fmtDateTime } from '@/utils/format'

/** 合同备案（第 8 类：表格操作列里「驳回」在左、「通过」在右，原因在确认框里填，同 console 离职审核） */
const { options } = useDict()
const pending = usePendingStore()

const status = ref<ClientContractStatus | ''>('PENDING')
const companyId = ref('')
const tabs = computed(() => [...options('ClientContractStatus'), { value: '', label: '全部' }])

const list = usePagedList<ContractView>((p) =>
  opsApi.contracts({ ...p, status: status.value || undefined, companyId: companyId.value.trim() || undefined }),
)
watch(status, () => search())
function reset() {
  companyId.value = ''
  search()
}

/** 后端拒绝过的通过 / 驳回：只置灰这一条的这个操作，原因用提醒色写在表格上方，重新加载后重新判断 */
const blocked = reactive<Record<string, { name: string; act: 'approve' | 'reject'; text: string }>>({})
// 重新加载、查询、切页签、翻页都清掉被拒记录，换了一批数据重新判断
const clearBlocked = () => Object.keys(blocked).forEach((k) => delete blocked[k])
async function load() {
  clearBlocked()
  await list.load()
}
function search() {
  clearBlocked()
  return list.search()
}
function onPage(p: number) {
  clearBlocked()
  return list.onPageChange(p)
}
function onSize(s: number) {
  clearBlocked()
  return list.onSizeChange(s)
}
/** 待审核页签的数：列表拿到数据后才显示；停在待审核页签时就是列表的条数 */
const pendN = computed(() => (list.loading.value || list.error.value ? null : status.value === 'PENDING' ? list.total.value : pending.counts?.contracts))
function done(okMsg: string) {
  ElMessage.success(okMsg)
  void load()
  pending.refresh()
}
const who = (row: ContractView) => `${row.companyName ?? row.companyId} ↔ ${row.clientName ?? row.clientId}`
/** 被拒原因写明是哪一条：同一家公司常有几份合同，带上合同编号 */
const whoId = (row: ContractView) => `合同 ${row.contractId}（${who(row)}）`

async function approve(row: ContractView) {
  const expired = (daysUntil(row.validTo) ?? 0) < 0
  const ok = await remarkInBox({
    title: '合同备案通过',
    text: `${who(row)}，有效期 ${fmtDate(row.validFrom)} ~ ${fmtDate(row.validTo)}。${expired ? '注意：该合同已过有效期，备案后也不会生效。' : '请确认已查看合同文件，甲乙双方与有效期无误。'}`,
    action: '通过',
    api: (remark) => opsApi.approveContract(row.contractId, remark || undefined),
    onBlocked: (text) => (blocked[row.contractId] = { name: whoId(row), act: 'approve', text }),
  })
  if (ok) done('合同已备案')
}
async function reject(row: ContractView) {
  const ok = await remarkInBox({
    title: '驳回合同备案',
    text: '驳回原因将展示给劳务公司。',
    action: '驳回',
    required: true,
    danger: true,
    api: (remark) => opsApi.rejectContract(row.contractId, remark),
    onBlocked: (text) => (blocked[row.contractId] = { name: whoId(row), act: 'reject', text }),
  })
  if (ok) done('已驳回')
}

/** 操作列宽按本页实际出现的按钮算：审核按钮是带边框的小号按钮 */
const opsWidth = computed(() => actionsColWidth(list.rows.value.map((r) => ({ labels: r.auditStatus === 'PENDING' ? ['驳回', '通过'] : [] })), 72, true))

onMounted(load)
</script>

<template>
  <div class="card tbl-card">
    <div class="toolbar">
      <div class="filter-tabs">
        <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="status = t.value as ClientContractStatus | ''">
          {{ t.label }}<span v-if="t.value === 'PENDING' && pendN != null" class="n">{{ pendN }}</span>
        </button>
      </div>
      <div class="spacer" />
      <el-input v-model="companyId" clearable placeholder="公司 ID" style="width: 140px" @keyup.enter="search" @clear="search" />
      <el-button @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ b.name }}：{{ b.text }}</p>
    <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table tbl-48" row-key="contractId">
      <el-table-column label="劳务公司 / 甲方" min-width="230">
        <template #default="{ row }">
          <span class="strong">{{ row.companyName ?? '—' }}</span>
          <div class="t-xs">{{ row.companyId }} · {{ row.clientName ?? row.clientId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="有效期" min-width="190">
        <template #default="{ row }">
          <span class="tnum">{{ fmtDate(row.validFrom) }} ~ {{ fmtDate(row.validTo) }}</span>
          <div v-if="(daysUntil(row.validTo) ?? 0) < 0"><span class="status-tag status-tag--danger">已过期</span></div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <StatusTag type="ClientContractStatus" :value="row.auditStatus" />
          <div class="eff"><span class="status-tag" :class="{ 'status-tag--success': row.effective }">{{ row.effective ? '生效中' : '未生效' }}</span></div>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="150">
        <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="审核说明" min-width="130">
        <template #default="{ row }">
          <span class="t-sm">{{ row.auditRemark || '—' }}</span>
          <div v-if="row.auditedAt" class="t-xs">{{ fmtDateTime(row.auditedAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="合同" width="64">
        <template #default="{ row }"><FileViewButton :file-key="row.fileKey" /></template>
      </el-table-column>
      <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
        <template #default="{ row }">
          <template v-if="row.auditStatus === 'PENDING'">
            <el-button size="small" type="danger" plain class="btn-reject" :disabled="blocked[row.contractId]?.act === 'reject'" @click="reject(row)">驳回</el-button>
            <el-button size="small" type="primary" :disabled="blocked[row.contractId]?.act === 'approve'" @click="approve(row)">通过</el-button>
          </template>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <div v-if="list.loading.value" class="tbl-wait" />
        <div v-else-if="list.error.value" class="state-box">
          <IconTriangleExclamationPoint :size="48" />
          <h4>合同列表加载失败</h4>
          <p>{{ list.offline.value ? '请检查网络后重新加载' : list.error.value }}</p>
          <el-button type="primary" @click="load">重新加载</el-button>
        </div>
        <div v-else class="state-box">
          <IconInbox :size="48" />
          <h4>{{ companyId.trim() ? '没有符合条件的合同' : status === 'PENDING' ? '暂无待备案合同' : '暂无数据' }}</h4>
          <p>{{ companyId.trim() ? '换个公司 ID 再查，或点「重置」' : status === 'PENDING' ? '劳务公司上传与甲方的合作合同后会出现在这里' : '切换上方页签查看其他状态的合同' }}</p>
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
        @current-change="onPage"
        @size-change="onSize"
      />
    </div>
  </div>
</template>

<style scoped>
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.tbl-wait { height: 160px; }
.eff { margin-top: var(--space-1); }
</style>
