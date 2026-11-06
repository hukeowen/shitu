<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { opsApi, useDict, type AuditLogEntry } from '@shitu/api-client'
import { usePagedList } from '@/composables/usePagedList'
import { fmtDateTimeSec, prettyJson } from '@/utils/format'

const { options, label } = useDict()

const filters = reactive({ actorDomain: '', actorId: '', companyId: '', action: '', targetType: '', targetId: '' })
const range = ref<[string, string] | undefined>(undefined)

/** AuthDomain 字典只有三套账号域，审计日志另有 SYSTEM（定时任务 / 系统动作） */
const domainOptions = computed(() => [...options('AuthDomain'), { value: 'SYSTEM', label: label('ActorRole', 'SYSTEM') || 'SYSTEM' }])
function domainLabel(v: string) {
  return v === 'SYSTEM' ? label('ActorRole', 'SYSTEM') : label('AuthDomain', v)
}
const DOMAIN_TAG: Record<string, string> = { OPS: 'tag--temp', TENANT: 'tag--info', SEEKER: 'tag--ok', SYSTEM: '' }

const list = usePagedList<AuditLogEntry>((p) => {
  const t = (s: string) => s.trim() || undefined
  return opsApi.auditLogs({
    ...p,
    actorDomain: filters.actorDomain || undefined,
    actorId: t(filters.actorId),
    companyId: t(filters.companyId),
    action: t(filters.action),
    targetType: t(filters.targetType),
    targetId: t(filters.targetId),
    from: range.value?.[0],
    to: range.value?.[1],
  })
}, 50)

function reset() {
  Object.assign(filters, { actorDomain: '', actorId: '', companyId: '', action: '', targetType: '', targetId: '' })
  range.value = undefined
  list.search()
}

onMounted(() => list.load())
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>系统审计日志</h2><p>关键操作全程留痕：登录、入驻审核、岗位审核 / 强制下架、合同备案、账号与权限变更</p></div>
      <div class="spacer" />
      <span class="ref">原型 <b>P-11</b></span>
    </div>

    <div class="card">
      <el-form class="filters" :model="filters" label-position="top" @submit.prevent="list.search()">
        <el-form-item label="操作方">
          <el-select v-model="filters.actorDomain" clearable placeholder="全部">
            <el-option v-for="o in domainOptions" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="操作人 ID"><el-input v-model="filters.actorId" clearable /></el-form-item>
        <el-form-item label="公司 ID"><el-input v-model="filters.companyId" clearable /></el-form-item>
        <el-form-item label="动作"><el-input v-model="filters.action" clearable placeholder="如 JOB_APPROVE" /></el-form-item>
        <el-form-item label="对象类型"><el-input v-model="filters.targetType" clearable placeholder="如 JOB / COMPANY" /></el-form-item>
        <el-form-item label="对象 ID"><el-input v-model="filters.targetId" clearable /></el-form-item>
        <el-form-item label="日期" class="wide">
          <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" unlink-panels />
        </el-form-item>
        <el-form-item label=" " class="btns">
          <el-button type="primary" native-type="submit">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table" row-key="id">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="exp">
              <div class="t-xs">详情 detail</div>
              <pre v-if="row.detail" class="codeblk">{{ prettyJson(row.detail) }}</pre>
              <span v-else class="dim t-sm">无详情</span>
              <div class="t-xs mono meta">#{{ row.id }} · traceId {{ row.traceId ?? '—' }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTimeSec(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="操作方" width="110">
          <template #default="{ row }"><span class="tag" :class="DOMAIN_TAG[row.actorDomain]">{{ domainLabel(row.actorDomain) }}</span></template>
        </el-table-column>
        <el-table-column label="操作人 ID" min-width="120">
          <template #default="{ row }"><span class="mono t-sm">{{ row.actorId ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="公司 ID" min-width="110">
          <template #default="{ row }"><span class="mono t-sm">{{ row.companyId ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="动作" min-width="170">
          <template #default="{ row }"><span class="mono t-sm strong">{{ row.action }}</span></template>
        </el-table-column>
        <el-table-column label="对象" min-width="190">
          <template #default="{ row }">
            <span v-if="row.targetType || row.targetId" class="mono t-sm"><span class="dim">{{ row.targetType ?? '' }}</span> {{ row.targetId ?? '' }}</span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="IP" width="130">
          <template #default="{ row }"><span class="mono t-xs">{{ row.ip ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="traceId" min-width="150">
          <template #default="{ row }"><span class="mono t-xs">{{ row.traceId ?? '—' }}</span></template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="list.error.value" :image-size="64" :description="list.error.value">
            <el-button size="small" @click="list.load()">重试</el-button>
          </el-empty>
          <el-empty v-else :image-size="64" description="没有符合条件的日志" />
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
  </div>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 0 12px; padding: 12px 14px 0; border-bottom: 1px solid var(--line); background: var(--surface-2); border-radius: var(--r-md) var(--r-md) 0 0; }
.filters :deep(.el-form-item) { margin-bottom: 12px; }
.filters :deep(.el-form-item__label) { font-size: 12px; margin-bottom: 4px !important; line-height: 18px; }
.filters .wide { grid-column: span 2; }
.filters :deep(.el-date-editor) { width: 100%; }
.filters :deep(.el-select) { width: 100%; }
.btns :deep(.el-form-item__content) { flex-wrap: nowrap; }
.exp { padding: 8px 48px 12px; }
.exp .codeblk { margin-top: 6px; max-height: 360px; }
.meta { margin-top: 6px; }
</style>
