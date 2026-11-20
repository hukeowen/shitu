<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type CancelRequestRow, type CancelRequestStatus } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInbox } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { boxSubmit } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'

/**
 * 待办清单「取消申请」页签：求职者不能自己取消报名，只能提交申请；驻场 / 项目经理在这里「同意并取消」或「不同意」（必填说明，求职者可见）。
 * 接口只对驻场 / 项目经理开放（限本人项目），老板看不到这个页签。文案与驻场手机端的取消申请页一致。
 */
const props = defineProps<{ projectId?: string }>()
const emit = defineEmits<{ changed: [] }>()

const STATUS_TEXT: Record<CancelRequestStatus, string> = { PENDING: '待处理', APPROVED: '已同意取消', REJECTED: '未同意', CLOSED: '已关闭' }
const STATUS_TONE: Record<CancelRequestStatus, string> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CLOSED: 'neutral' }

/** 默认只看待处理；关掉后是最近 200 条（待处理在前） */
const pendingOnly = ref(true)
const all = ref<CancelRequestRow[]>([])
const loading = ref(false)
const loadError = ref('')
/** 接口一次返回全部（不分页），表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const list = computed(() => (props.projectId ? all.value.filter((r) => r.projectId === props.projectId) : all.value))
const pageRows = computed(() => list.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))

/** 后端拒绝过的处理：这一条的两个按钮置灰，原因用提醒色写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<number, { name: string; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[Number(k)])
  try {
    all.value = await tenantApi.cancelRequests(pendingOnly.value ? 'PENDING' : undefined)
    pg.page = 1
  } catch (e) {
    loadError.value = errorMessage(e, '取消申请加载失败')
    all.value = []
  } finally {
    loading.value = false
  }
}
watch(pendingOnly, load)
watch(
  () => props.projectId,
  () => (pg.page = 1),
)
onMounted(load)

function done() {
  load()
  emit('changed')
}

/** 岗位名本身常带括号（如「长白班」），这里用书名号，避免括号套括号 */
const who = (r: CancelRequestRow) => `${r.seekerName} 的「${r.jobTitle ?? '—'}」报名`

async function approve(r: CancelRequestRow) {
  const s = boxSubmit(
    `同意后，${who(r)}会立即取消，求职者被释放、可以重新匹配，岗位名额退回。`,
    '同意取消',
    () => tenantApi.decideCancelRequest(r.id, true),
    (why) => (blocked[r.id] = { name: r.seekerName, text: why }),
  )
  try {
    await ElMessageBox.confirm(s.message, '同意取消报名', { type: 'warning', confirmButtonText: '同意并取消', cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('已同意，报名已取消')
  done()
}

async function reject(r: CancelRequestRow) {
  const s = boxSubmit(
    `${who(r)}申请了取消。请写明不同意的原因，求职者会看到这段说明，报名继续有效。`,
    '回复',
    (reply) => tenantApi.decideCancelRequest(r.id, false, reply),
    (why) => (blocked[r.id] = { name: r.seekerName, text: why }),
  )
  try {
    await ElMessageBox.prompt(s.message, '不同意取消', {
      confirmButtonText: '确认不同意',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请填写不同意的原因（必填，求职者可见）',
      inputValidator: (v) => (!v?.trim() ? '请填写不同意的原因' : v.trim().length > 255 ? '最多 255 个字' : true),
      type: 'warning',
      beforeClose: s.beforeClose,
    })
  } catch {
    return
  }
  ElMessage.success('已回复求职者')
  done()
}

const hasOps = computed(() => list.value.some((r) => r.status === 'PENDING'))
const opsWidth = actionsColWidth([{ labels: ['不同意', '同意并取消'] }])

defineExpose({ load })
</script>

<template>
  <div>
    <div class="cr-bar">
      <span class="t-sm">求职者不能自己取消报名，由驻场 / 项目经理同意后取消；不同意需写明原因，求职者会看到。</span>
      <span class="spacer" />
      <el-checkbox v-model="pendingOnly">只看待处理</el-checkbox>
    </div>
    <p v-for="(b, id) in blocked" :key="id" class="blocked-why cr-tip" role="status">「{{ b.name }}」{{ b.text }}{{ b.text.includes('刷新') ? '' : '。刷新后重新判断' }}</p>
    <el-table v-loading="loading" :data="loadError ? [] : pageRows" row-key="id">
      <el-table-column label="求职者" min-width="136">
        <template #default="{ row }">
          <PersonCell :name="row.seekerName" :sub="row.applicationId" mono />
        </template>
      </el-table-column>
      <el-table-column label="岗位 / 项目" min-width="140">
        <template #default="{ row }">
          <div class="strong-14">{{ row.jobTitle ?? '—' }}</div>
          <div class="t-xs">{{ row.projectName ?? '—' }}</div>
          <div class="app-st"><span class="t-xs">报名</span><DictTag type="ApplicationStatus" :value="row.applicationStatus" /></div>
        </template>
      </el-table-column>
      <el-table-column label="取消原因" min-width="200">
        <template #default="{ row }">
          <div class="reason">{{ row.reason }}</div>
          <div v-if="row.reply" class="t-xs reason">回复：{{ row.reply }}</div>
        </template>
      </el-table-column>
      <el-table-column label="申请时间" width="136">
        <template #default="{ row }"><span class="nowrap">{{ fmtDateTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="状态" width="136">
        <template #default="{ row }">
          <span class="status-tag" :class="`status-tag--${STATUS_TONE[row.status as CancelRequestStatus]}`">{{ STATUS_TEXT[row.status as CancelRequestStatus] }}</span>
          <div v-if="row.status === 'CLOSED'" class="t-xs">报名已因其他原因结束</div>
          <div v-else-if="row.handledByName" class="t-xs">{{ row.handledByName }}</div>
          <div v-if="row.handledAt" class="t-xs nowrap">{{ fmtDateTime(row.handledAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="hasOps" label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
        <template #default="{ row }">
          <div v-if="row.status === 'PENDING'" class="acts">
            <el-button link type="primary" size="small" :disabled="!!blocked[row.id]" @click="reject(row)">不同意</el-button>
            <el-button link type="primary" size="small" :disabled="!!blocked[row.id]" @click="approve(row)">同意并取消</el-button>
          </div>
          <span v-else class="t-xs">—</span>
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
          <IconInbox :size="48" />
          <h4>{{ pendingOnly ? '没有待处理的取消申请' : '暂无取消申请' }}</h4>
          <p>求职者在手机端申请取消报名后，会出现在这里</p>
        </div>
        <span v-else />
      </template>
    </el-table>
    <div v-if="list.length > 0" class="pager">
      <el-pagination
        v-model:current-page="pg.page"
        v-model:page-size="pg.pageSize"
        :total="list.length"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
        size="small"
        @size-change="pg.page = 1"
      />
    </div>
  </div>
</template>

<style scoped>
.cr-bar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--divider); }
.cr-tip { margin: var(--space-3) var(--space-4) 0; }
.strong-14 { font-size: var(--font-size-aux); color: var(--text-1); font-weight: var(--font-weight-medium); }
.app-st { display: flex; align-items: center; gap: var(--space-1); margin-top: var(--space-1); }
.reason { white-space: pre-wrap; overflow-wrap: anywhere; }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
</style>
