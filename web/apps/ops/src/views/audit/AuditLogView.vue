<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { opsApi, useDict, type AuditLogEntry } from '@shitu/api-client'
import { usePagedList } from '@/composables/usePagedList'
import { fmtDateTimeSec, prettyJson } from '@/utils/format'
import { AUDIT_ACTION_GROUPS, AUDIT_TARGET_OPTIONS, auditActionLabel, auditTargetLabel } from './auditMeta'

const { options, label } = useDict()

const filters = reactive({ actorDomain: '', actorId: '', companyId: '', action: '', targetType: '', targetId: '' })
const range = ref<[string, string] | undefined>(undefined)

/** AuthDomain 字典只有三套账号域，审计日志另有 SYSTEM（定时任务 / 系统动作） */
const systemLabel = () => {
  const l = label('ActorRole', 'SYSTEM')
  return !l || l === 'SYSTEM' ? '系统' : l
}
const domainOptions = computed(() => [...options('AuthDomain'), { value: 'SYSTEM', label: systemLabel() }])
function domainLabel(v: string) {
  return v === 'SYSTEM' ? systemLabel() : label('AuthDomain', v)
}
const actionGroups = AUDIT_ACTION_GROUPS.map((g) => ({ label: g.group, options: Object.entries(g.items).map(([value, text]) => ({ value, label: text })) }))

async function copy(text?: string | null) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请展开该行后手动选择复制')
  }
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
        <el-form-item label="动作">
          <el-select v-model="filters.action" clearable filterable placeholder="全部">
            <el-option-group v-for="g in actionGroups" :key="g.label" :label="g.label">
              <el-option v-for="o in g.options" :key="o.value" :value="o.value" :label="o.label" />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="对象类型">
          <el-select v-model="filters.targetType" clearable filterable placeholder="全部">
            <el-option v-for="o in AUDIT_TARGET_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
        </el-form-item>
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
              <div class="t-xs">操作详情</div>
              <pre v-if="row.detail" class="codeblk">{{ prettyJson(row.detail) }}</pre>
              <span v-else class="dim t-sm">无详情</span>
              <div class="t-xs meta">
                日志编号 <span class="mono">{{ row.id }}</span> · 追踪号 <span class="mono">{{ row.traceId ?? '—' }}</span>
                <el-button v-if="row.traceId" link type="primary" size="small" @click="copy(row.traceId)">复制</el-button>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="168" class-name="nowrap-col">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTimeSec(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="操作方" width="104">
          <template #default="{ row }"><span class="tag" :class="DOMAIN_TAG[row.actorDomain]">{{ domainLabel(row.actorDomain) }}</span></template>
        </el-table-column>
        <el-table-column label="操作人 ID" min-width="140" class-name="nowrap-col" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono t-sm">{{ row.actorId ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="公司 ID" width="96" class-name="nowrap-col">
          <template #default="{ row }"><span class="mono t-sm">{{ row.companyId ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="动作" min-width="180">
          <template #default="{ row }">
            <template v-if="auditActionLabel(row.action)">
              <span class="strong">{{ auditActionLabel(row.action) }}</span>
              <div class="t-xs mono wrap code">{{ row.action }}</div>
            </template>
            <span v-else class="mono t-sm">{{ row.action }}</span>
          </template>
        </el-table-column>
        <el-table-column label="对象" min-width="170">
          <template #default="{ row }">
            <template v-if="row.targetType || row.targetId">
              <span>{{ auditTargetLabel(row.targetType) ?? row.targetType ?? '' }}</span>
              <div v-if="row.targetId" class="t-xs mono wrap code">{{ row.targetId }}</div>
            </template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="IP" width="124" class-name="nowrap-col">
          <template #default="{ row }"><span class="mono t-xs">{{ row.ip ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="追踪号" width="100">
          <template #default="{ row }">
            <el-tooltip v-if="row.traceId" :content="`${row.traceId}（点击复制）`" placement="top-end">
              <button type="button" class="trace mono" @click="copy(row.traceId)">{{ row.traceId }}</button>
            </el-tooltip>
            <span v-else class="dim">—</span>
          </template>
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
.meta { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.code { color: var(--ink-400); word-break: break-all; }
.trace { display: block; width: 100%; padding: 0; border: 0; background: transparent; font-size: 12px; color: var(--ink-500); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.trace:hover { color: var(--signal-700); }
</style>
