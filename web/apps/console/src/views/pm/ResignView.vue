<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type MemberView, type ResignRow } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInfo, IconUserMinus } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { boxSubmit } from '@/composables/boxSubmit'
import { useProjects } from '@/composables/useProjects'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'
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
/** 接口一次返回全部申请（不分页），表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => list.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))

const projectName = (id: string) => projects.value.find((p) => p.projectId === id)?.name ?? id
const memberName = (id?: string) => (id ? members.value.find((m) => m.memberId === id)?.name ?? id : '—')

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[Number(k)])
  try {
    list.value = await tenantApi.resignRequests(status.value)
    pg.page = 1
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
const showOps = computed(() => isPm.value && (status.value === 'PENDING' || status.value === 'SCHEDULED'))
const EMPTY_TEXT: Record<Status, string> = {
  PENDING: '没有待审核的离职申请',
  SCHEDULED: '没有待生效的离职',
  APPROVED: '还没有已通过的离职申请',
  REJECTED: '还没有被驳回的离职申请',
}

/** 后端拒绝过的确认 / 驳回：只置灰这一条的这个操作，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<number, { name: string; act: 'approve' | 'reject'; text: string }>>({})


async function approve(r: ResignRow) {
  const future = r.resignDate > ymd(shNow())
  // 确认框里提交（规范 Page States「后台确认框一律在框内提交」）；原来被拒时的「无法确认离职」弹框并进框里
  const s = boxSubmit(
    future
      ? `${r.name} 的离职日是 ${r.resignDate}，还没到。确认后进入「待生效」：离职日之前仍在岗、照常计费，不能再申请预支；${r.resignDate} 当天自动结束任职、归属清空变公域、合同终止。生效前可以撤销。`
      : `确认 ${r.name} 于 ${r.resignDate} 离职？确认后：归属清空变公域、增长技术服务费与流转费停止计费、劳动合同终止。此操作不可撤销。`,
    '确认离职',
    () => tenantApi.decideResign(r.id, true),
    (why) => (blocked[r.id] = { name: r.name, act: 'approve', text: why }),
  )
  try {
    await ElMessageBox.confirm(s.message, '确认离职', { type: 'warning', confirmButtonText: '确认离职', cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success(future ? `已确认，${r.resignDate} 当天自动生效` : '已确认离职')
  load()
}

async function reject(r: ResignRow) {
  const scheduled = r.status === 'SCHEDULED'
  const act = scheduled ? '撤销离职' : '驳回'
  const s = boxSubmit(
    scheduled ? `撤销 ${r.name} 原定 ${r.resignDate} 的离职，员工继续在岗。` : `驳回 ${r.name} 的离职申请，员工保持在岗。`,
    act,
    (remark) => tenantApi.decideResign(r.id, false, remark || undefined),
    (why) => (blocked[r.id] = { name: r.name, act: 'reject', text: why }),
  )
  try {
    await ElMessageBox.prompt(s.message, scheduled ? '撤销离职' : '驳回离职申请', {
      confirmButtonText: act,
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger is-plain btn-reject',
      inputType: 'textarea',
      inputPlaceholder: '说明（选填）',
      type: 'warning',
      beforeClose: s.beforeClose,
    })
  } catch {
    return
  }
  ElMessage.success(scheduled ? '已撤销，员工继续在岗' : '已驳回')
  load()
}

/** 操作列宽按本页实际出现的按钮算：审核按钮是带边框的小号按钮（规范第 8 类：驳回危险色描边、通过主色实心） */
const opsWidth = computed(() =>
  actionsColWidth(list.value.map((r) => ({ labels: r.status === 'PENDING' ? ['驳回', '确认离职'] : ['撤销离职'] })), 96, true),
)
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

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="status === t.key" :class="{ on: status === t.key }" @click="status = t.key">
            {{ t.label }}<span v-if="t.key === 'PENDING' && pendingCount != null" class="n">{{ pendingCount }}</span>
          </button>
        </div>
        <span class="spacer" />
        <span v-if="!isPm" class="ro">离职审核由项目经理处理，当前为只读</span>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.name }}」{{ b.text }}{{ b.text.includes('刷新') ? '' : '。刷新后重新判断' }}</p>
      <el-table v-loading="loading" :data="pageRows" row-key="id">
        <el-table-column label="员工" min-width="130">
          <template #default="{ row }">
            <div class="strong-t">{{ row.name }}</div>
            <div class="sub tnum" :title="row.employeeNo ?? row.employmentId">{{ row.employeeNo ? `工号 ${row.employeeNo}` : row.employmentId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="项目" min-width="150">
          <template #default="{ row }">{{ projectName(row.projectId) }}</template>
        </el-table-column>
        <el-table-column label="最后工作日" width="110">
          <template #default="{ row }"><span class="tnum strong-t">{{ row.resignDate }}</span></template>
        </el-table-column>
        <el-table-column label="离职原因" min-width="160">
          <template #default="{ row }">{{ row.reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="发起" width="150">
          <template #default="{ row }">
            <div>{{ memberName(row.requestedBy) }}</div>
            <div class="sub tnum">{{ fmtDateTime(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <DictTag type="ResignStatus" :value="row.status" />
            <div v-if="row.approvedBy" class="sub">{{ memberName(row.approvedBy) }}</div>
          </template>
        </el-table-column>
        <el-table-column v-if="showOps" label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <template v-if="row.status === 'PENDING'">
                <el-button size="small" type="danger" plain class="btn-reject" :disabled="blocked[row.id]?.act === 'reject'" @click="reject(row)">驳回</el-button>
                <el-button size="small" type="primary" :disabled="blocked[row.id]?.act === 'approve'" @click="approve(row)">确认离职</el-button>
              </template>
              <el-button v-else size="small" type="danger" plain class="btn-reject" :disabled="blocked[row.id]?.act === 'reject'" @click="reject(row)">撤销离职</el-button>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconUserMinus :size="48" />
            <h4>{{ EMPTY_TEXT[status] }}</h4>
            <p>驻场或项目经理在「人员管理」对在岗员工发起离职后，申请会出现在这里</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="list.length > 0" class="pager">
        <el-pagination
          v-model:current-page="pg.page"
          v-model:page-size="pg.pageSize"
          :total="list.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @size-change="pg.page = 1"
        />
      </div>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>离职后系统自动执行</h3></div>
        <div class="card__bd">
          <dl class="desc-list">
            <div><dt>当前归属</dt><dd>清空</dd></div>
            <div><dt>公域 / 私域</dt><dd><span class="status-tag status-tag--public">公域</span></dd></div>
            <div><dt>匹配范围</dt><dd>恢复为全平台</dd></div>
            <div><dt>增长技术服务费</dt><dd>停止计费</dd></div>
            <div><dt>人才流转费</dt><dd>停止计费</dd></div>
            <div><dt>薪酬预支</dt><dd>欠款从最后一笔工资抵扣，扣不完记平台失信</dd></div>
            <div><dt>劳动合同</dt><dd>变更为「已终止」</dd></div>
            <div><dt>来源归属</dt><dd>保持不变</dd></div>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>发起离职</h3></div>
        <div class="card__bd">
          <div class="notice-bar">
            <IconInfo :size="16" class="notice-bar-i" />
            <span>在「人员管理」对在岗员工点击「离职」发起申请（驻场 / 项目经理均可）。在职不久即离职的员工，建议先流转至人才经纪人尝试内部调岗。</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ro { font-size: var(--font-size-min); color: var(--text-3); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.strong-t { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
</style>
