<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type MemberView, type ResignRow } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import RowActions from '@/components/RowActions.vue'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'
import { opsColWidth, type RowAction } from '@/utils/rowActions'
import { shNow, ymd } from '@/utils/time'

/**
 * A-13 离职审核（T-308）：驻场 / 项目经理发起，项目经理确认；有预支欠款不拦截，从最后一笔工资抵扣（D-22）。
 * 离职日在未来的，确认后进入「待生效」，到离职日当天自动结束任职；生效前项目经理可以撤销（D-59）。
 */
type Status = 'PENDING' | 'SCHEDULED' | 'APPROVED' | 'REJECTED'
const TABS: { key: Status; label: string }[] = [
  { key: 'PENDING', label: '待审核' },
  { key: 'SCHEDULED', label: '待生效' },
  { key: 'APPROVED', label: '已通过' },
  { key: 'REJECTED', label: '已驳回' },
]
const meStore = useMeStore()
const { projects } = useProjects()
const isPm = computed(() => meStore.hasRole('PM'))

const status = ref<Status>('PENDING')
const list = ref<ResignRow[]>([])
const loading = ref(false)
const loadError = ref('')
const pendingCount = ref<number | null>(null)
const members = ref<MemberView[]>([])
const busy = ref<number | null>(null)

const projectName = (id: string) => projects.value.find((p) => p.projectId === id)?.name ?? id
const memberName = (id?: string) => (id ? members.value.find((m) => m.memberId === id)?.name ?? id : '—')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    list.value = await tenantApi.resignRequests(status.value)
    if (status.value === 'PENDING') pendingCount.value = list.value.length
  } catch (e) {
    loadError.value = errorMessage(e, '离职申请加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}
watch(status, load)
onMounted(async () => {
  load()
  if (status.value !== 'PENDING') tenantApi.resignRequests('PENDING').then((r) => (pendingCount.value = r.length)).catch(() => undefined)
  // 成员列表只有老板 / 项目经理可查，用于显示发起人姓名
  if (meStore.hasRole('PM', 'OWNER')) members.value = await tenantApi.members().catch(() => [])
})

/** 行操作：只有项目经理能审核；没有可用操作（只读角色、已通过 / 已驳回页签、空列表）时不渲染操作列 */
function rowActions(r: ResignRow): RowAction[] {
  if (!isPm.value) return []
  if (r.status === 'PENDING') return [{ key: 'approve', label: '确认离职', type: 'primary' }, { key: 'reject', label: '驳回', type: 'danger', plain: true }]
  if (r.status === 'SCHEDULED') return [{ key: 'reject', label: '撤销离职', type: 'danger', plain: true }]
  return []
}
const opsWidth = computed(() => opsColWidth(list.value.map(rowActions)))

async function approve(r: ResignRow) {
  const future = r.resignDate > ymd(shNow())
  try {
    await ElMessageBox.confirm(
      future
        ? `${r.name} 的离职日是 ${r.resignDate}，还没到。确认后进入「待生效」：离职日之前仍在岗、照常计费，不能再申请预支；${r.resignDate} 当天自动结束任职、归属清空变公域、合同终止。生效前可以撤销。`
        : `确认 ${r.name} 于 ${r.resignDate} 离职？确认后：归属清空变公域、增长服务费与流转费停止计费、劳动合同终止。此操作不可撤销。`,
      '确认离职',
      { type: 'warning', confirmButtonText: '确认离职', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busy.value = r.id
  try {
    await tenantApi.decideResign(r.id, true)
    ElMessage.success(future ? `已确认，${r.resignDate} 当天自动生效` : '已确认离职')
    load()
  } catch (e) {
    // 预支欠款等业务拦截：弹窗醒目提示
    await ElMessageBox.alert(errorMessage(e), '无法确认离职', { type: 'error', confirmButtonText: '知道了' }).catch(() => undefined)
  } finally {
    busy.value = null
  }
}

async function reject(r: ResignRow) {
  let remark = ''
  try {
    const scheduled = r.status === 'SCHEDULED'
    const res = await ElMessageBox.prompt(
      scheduled ? `撤销 ${r.name} 原定 ${r.resignDate} 的离职，员工继续在岗。` : `驳回 ${r.name} 的离职申请，员工保持在岗。`,
      scheduled ? '撤销离职' : '驳回离职申请', {
      confirmButtonText: scheduled ? '撤销离职' : '驳回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '说明（选填）',
      type: 'warning',
    })
    remark = res.value?.trim() ?? ''
  } catch {
    return
  }
  busy.value = r.id
  try {
    await tenantApi.decideResign(r.id, false, remark || undefined)
    ElMessage.success(r.status === 'SCHEDULED' ? '已撤销，员工继续在岗' : '已驳回')
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>离职审核</h2>
        <p>确认离职 → 归属清空 → 变更公域 → 计费停止 → 合同终止 · 离职日未到的先进入待生效，到期自动执行</p>
      </div>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="grid g-1">
      <div class="card">
        <div class="toolbar">
          <div class="filter-tabs">
            <button v-for="t in TABS" :key="t.key" :class="{ on: status === t.key }" @click="status = t.key">
              {{ t.label }}<span v-if="t.key === 'PENDING' && pendingCount != null" class="n">{{ pendingCount }}</span>
            </button>
          </div>
          <span class="spacer" />
          <span v-if="!isPm" class="t-xs">离职审核由项目经理处理，当前为只读</span>
        </div>
        <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
          <el-button size="small" @click="load">重试</el-button>
        </el-alert>
        <el-table v-loading="loading" :data="list" row-key="id">
          <el-table-column label="员工" min-width="150">
            <template #default="{ row }">
              <b class="strong ellip" :title="row.name">{{ row.name }}</b>
              <div class="t-xs mono ellip" :title="row.employmentId">{{ row.employmentId }}</div>
            </template>
          </el-table-column>
          <el-table-column label="项目" min-width="150">
            <template #default="{ row }"><span class="t-sm clamp-2" :title="projectName(row.projectId)">{{ projectName(row.projectId) }}</span></template>
          </el-table-column>
          <el-table-column label="最后工作日" min-width="116">
            <template #default="{ row }"><span class="mono t-sm strong">{{ row.resignDate }}</span></template>
          </el-table-column>
          <el-table-column label="离职原因" min-width="160">
            <template #default="{ row }"><span class="t-sm clamp-2" :title="row.reason ?? ''">{{ row.reason || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="发起" min-width="150">
            <template #default="{ row }">
              <div class="t-sm ellip">{{ memberName(row.requestedBy) }}</div>
              <div class="mono t-xs">{{ fmtDateTime(row.createdAt) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="96">
            <template #default="{ row }">
              <DictTag type="ResignStatus" :value="row.status" />
              <div v-if="row.approvedBy" class="t-xs ellip">{{ memberName(row.approvedBy) }}</div>
            </template>
          </el-table-column>
          <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
            <template #default="{ row }">
              <RowActions :actions="rowActions(row)" :loading="busy === row.id" @act="(k) => (k === 'approve' ? approve(row) : reject(row))" />
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无离职申请'" /></template>
        </el-table>
      </div>

      <div class="grid g-2 grid--top">
        <div class="card">
          <div class="card__hd"><h3>离职后系统自动执行</h3></div>
          <div class="card__bd">
            <dl class="kv"><dt>当前归属</dt><dd>清空</dd></dl>
            <dl class="kv"><dt>公域 / 私域</dt><dd><span class="tag tag--public">公域</span></dd></dl>
            <dl class="kv"><dt>匹配范围</dt><dd>恢复为全平台</dd></dl>
            <dl class="kv"><dt>增长技术服务费</dt><dd>停止计费</dd></dl>
            <dl class="kv"><dt>人才流转费</dt><dd>停止计费</dd></dl>
            <dl class="kv"><dt>薪酬预支</dt><dd>欠款从最后一笔工资抵扣，扣不完记平台失信</dd></dl>
            <dl class="kv"><dt>劳动合同</dt><dd>变更为「已终止」</dd></dl>
            <dl class="kv"><dt>来源归属</dt><dd>保持不变</dd></dl>
          </div>
        </div>
        <div class="card"><div class="card__hd"><h3>发起离职</h3></div><div class="card__bd">
        <p class="t-sm" style="line-height: 1.8">在「人员管理」对在岗员工点击「离职」发起申请（驻场 / 项目经理均可）。在职不久即离职的员工，建议先流转至人才经纪人尝试内部调岗。</p>
        </div></div>
      </div>
    </div>
  </div>
</template>
