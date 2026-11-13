<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { errorMessage, tenantApi, type AdvanceRecon } from '@shitu/api-client'
import { fmtDate, fmtDateTime, fmtYuan } from '@/utils/format'

/** 预支抵扣对账（T-505，只读）：某个工资月份抵扣了谁、抵扣后还欠多少；截至现在谁还有欠款 */
const month = ref('')
const data = ref<AdvanceRecon | null>(null)
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await tenantApi.advanceRecon(month.value || undefined)
    month.value = data.value.month
  } catch (e) {
    loadError.value = errorMessage(e, '对账数据加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>预支抵扣对账</h2>
        <p>工资表导入时系统自动从实发里抵扣预支欠款 · 这里核对每个月扣了谁、还欠多少</p>
      </div>
      <span class="spacer" />
      <el-select v-model="month" placeholder="工资月份" style="width: 140px" :disabled="loading" @change="load">
        <el-option v-for="m in data?.months ?? []" :key="m" :label="m" :value="m" />
        <el-option v-if="month && !(data?.months ?? []).includes(month)" :label="month" :value="month" />
      </el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px" />

    <div v-loading="loading">
      <div v-if="data" class="grid g-4">
        <div class="stat"><div class="stat-l">{{ data.month }} 工资抵扣</div><div class="stat-v">{{ fmtYuan(data.summary.deductTotal) }}</div><div class="stat-d">{{ data.summary.deductCount }} 人</div></div>
        <div class="stat"><div class="stat-l">{{ data.month }} 新拨款</div><div class="stat-v">{{ fmtYuan(data.summary.payoutTotal) }}</div><div class="stat-d">{{ data.summary.payoutCount }} 笔</div></div>
        <div class="stat"><div class="stat-l">当前未还欠款</div><div class="stat-v">{{ fmtYuan(data.summary.outstandingTotal) }}</div><div class="stat-d">{{ data.summary.outstandingCount }} 人</div></div>
        <div class="stat" :class="{ 'stat--danger': data.summary.outstandingLeftCount > 0 }"><div class="stat-l">其中已离职</div><div class="stat-v">{{ data.summary.outstandingLeftCount }}<small>人</small></div><div class="stat-d">需线下追收</div></div>
      </div>

      <div class="card" style="margin-top: 14px">
        <div class="card__hd"><h3>{{ data?.month ?? '' }} 工资抵扣明细</h3><span class="t-xs">按抵扣金额从高到低</span></div>
        <el-table :data="data?.deductions ?? []" row-key="payslipId">
          <el-table-column label="员工" min-width="200">
            <template #default="{ row }">
              <div class="nowrap"><b>{{ row.seekerName }}</b><span v-if="row.employeeNo" class="t-xs mono"> · {{ row.employeeNo }}</span></div>
              <div class="t-xs ellip" :title="row.projectName ?? ''">{{ row.projectName || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="应发" min-width="120" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.grossPay) }}</span></template></el-table-column>
          <el-table-column label="预支抵扣" min-width="120" align="right"><template #default="{ row }"><b class="num">{{ fmtYuan(row.advanceDeduct) }}</b></template></el-table-column>
          <el-table-column label="实发" min-width="120" align="right"><template #default="{ row }"><span class="num">{{ fmtYuan(row.netPay) }}</span></template></el-table-column>
          <el-table-column label="抵扣后欠款" min-width="130" align="right">
            <template #default="{ row }">
              <span v-if="row.debtAfter == null" class="t-xs">—</span>
              <span v-else-if="Number(row.debtAfter) === 0" class="tag tag--ok">已还清</span>
              <b v-else class="num warn">{{ fmtYuan(row.debtAfter) }}</b>
            </template>
          </el-table-column>
          <el-table-column label="工资条" min-width="180" show-overflow-tooltip><template #default="{ row }"><span class="mono t-xs">{{ row.payslipId }}</span></template></el-table-column>
          <template #empty><el-empty :description="loadError ? '加载失败' : '这个月没有工资抵扣'" :image-size="70" /></template>
        </el-table>
      </div>

      <div class="card" style="margin-top: 14px">
        <div class="card__hd"><h3>当前仍有欠款的人员</h3><span class="t-xs">截至现在，不随月份切换 · 已离职的排在前面</span></div>
        <el-table :data="data?.outstanding ?? []" row-key="userId">
          <el-table-column label="员工" min-width="200">
            <template #default="{ row }">
              <div class="nowrap"><b>{{ row.seekerName }}</b><span v-if="row.employeeNo" class="t-xs mono"> · {{ row.employeeNo }}</span></div>
              <div class="t-xs ellip" :title="row.projectName ?? ''">{{ row.projectName || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="在职情况" min-width="170">
            <template #default="{ row }">
              <span v-if="row.endDate" class="tag tag--danger">已离职 {{ fmtDate(row.endDate) }}</span>
              <span v-else class="tag tag--ok">在职</span>
            </template>
          </el-table-column>
          <el-table-column label="未还欠款" min-width="130" align="right"><template #default="{ row }"><b class="num warn">{{ fmtYuan(row.debt) }}</b></template></el-table-column>
          <el-table-column label="最近变动" min-width="160"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.lastChangeAt) }}</span></template></el-table-column>
          <el-table-column label="后续处理" min-width="300">
            <template #default="{ row }"><span class="t-xs">{{ row.endDate ? '工资已无法抵扣，需线下追收；系统已标记平台失信' : '下次导入工资表时自动抵扣' }}</span></template>
          </el-table-column>
          <template #empty><el-empty :description="loadError ? '加载失败' : '没有未还清的预支'" :image-size="70" /></template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.warn { color: var(--danger); }
</style>
