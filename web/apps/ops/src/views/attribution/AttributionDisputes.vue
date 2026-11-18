<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type AttributionDispute } from '@shitu/api-client'
import { IconInbox, IconInfo, IconPlus, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { isBlocked, isNetwork } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'

/**
 * 归属争议（P-08）：传 userId 时显示这个人的全部争议并可登记新的；不传时显示全平台待处理的争议。
 * 来源归属注册时锁定、不可更改，处理结论只留痕。
 */
const props = defineProps<{ userId?: string }>()
const emit = defineEmits<{ open: [userId: string] }>()

const rows = ref<AttributionDispute[]>([])
const loading = ref(false)
const loadError = ref('')
const offline = ref(false)
// 前端分页：接口一次返回全部（最多 200 条）
const page = ref(1)
const pageSize = ref(10)
/** 写结论被后端拒绝的争议：只置灰这一条的「写结论」，原因留在表格上方 */
const blocked = ref<Record<number, string>>({})

async function load() {
  // 「重新加载」先切回加载中，重试期间不闪空状态
  loading.value = true
  loadError.value = ''
  offline.value = false
  blocked.value = {}
  try {
    rows.value = await opsApi.attributionDisputes(props.userId)
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '争议记录加载失败')
    offline.value = isNetwork(e)
  } finally {
    loading.value = false
  }
}
watch(() => props.userId, () => {
  page.value = 1
  void load()
}, { immediate: true })

const paged = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const opsWidth = computed(() => actionsColWidth([{ labels: ['写结论'] }], 80))

const add = reactive({ open: false, companyId: '', content: '', saving: false, error: '', why: '' })
function openAdd() {
  Object.assign(add, { open: true, companyId: '', content: '', error: '', why: '' })
}
async function submitAdd() {
  if (!props.userId || add.saving) return
  if (add.content.trim().length < 5) return void (add.error = '请写明争议内容（至少 5 个字）')
  add.saving = true
  try {
    await opsApi.addAttributionDispute({ userId: props.userId, companyId: add.companyId.trim() || undefined, content: add.content.trim() })
    ElMessage.success('已登记')
    add.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '登记失败'))
    // 后端业务拒绝：原因留在弹窗里、「登记」置灰，改了内容再放开；断网只提示
    if (isBlocked(e)) add.why = `暂时不能登记：${errorMessage(e)}`
  } finally {
    add.saving = false
  }
}
function editAdd() {
  add.error = ''
  add.why = ''
}

const res = reactive({ open: false, row: null as AttributionDispute | null, conclusion: '', saving: false, error: '', why: '' })
function openResolve(row: AttributionDispute) {
  Object.assign(res, { open: true, row, conclusion: '', error: '', why: '' })
}
async function submitResolve() {
  const row = res.row
  if (!row || res.saving) return
  if (res.conclusion.trim().length < 5) return void (res.error = '请写明处理结论（至少 5 个字）')
  res.saving = true
  try {
    await opsApi.resolveAttributionDispute(row.id, res.conclusion.trim())
    ElMessage.success('已结案')
    res.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
    if (isBlocked(e)) {
      res.why = `暂时不能结案：${errorMessage(e)}`
      blocked.value = { ...blocked.value, [row.id]: res.why }
    }
  } finally {
    res.saving = false
  }
}
</script>

<template>
  <div class="card disputes">
    <div class="card__hd">
      <h3>{{ userId ? '该用户的归属争议' : '待处理的归属争议' }}</h3>
      <span class="hd-r">
        <span class="t-xs">来源归属注册时锁定、不可更改；这里登记争议并记录核查结论</span>
        <el-button v-if="userId" @click="openAdd"><IconPlus :size="16" />登记争议</el-button>
      </span>
    </div>
    <p v-for="(why, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">争议 #{{ id }} {{ why }}</p>
    <el-table v-loading="loading" :data="paged" class="ops-table tbl-48" row-key="id">
      <el-table-column label="登记时间" width="150"><template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template></el-table-column>
      <el-table-column v-if="!userId" label="用户" width="170">
        <template #default="{ row }"><el-button link type="primary" class="mono" @click="emit('open', row.userId)">{{ row.userId }}</el-button></template>
      </el-table-column>
      <el-table-column label="提出异议的公司" min-width="160">
        <template #default="{ row }">{{ row.companyName ?? '—' }}<div v-if="row.companyId" class="t-xs">{{ row.companyId }}</div></template>
      </el-table-column>
      <el-table-column label="争议内容 / 结论" min-width="320">
        <template #default="{ row }">
          <div class="content">{{ row.content }}</div>
          <div class="t-xs">{{ row.createdByName ?? '—' }} 登记</div>
          <div v-if="row.conclusion" class="reply"><b>结论</b>{{ row.conclusion }}<span class="t-xs"> · {{ row.resolvedByName }} {{ fmtDateTime(row.resolvedAt) }}</span></div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <span class="status-tag" :class="row.status === 'OPEN' ? 'status-tag--warning' : 'status-tag--success'">{{ row.status === 'OPEN' ? '待处理' : '已结案' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
        <template #default="{ row }">
          <el-button v-if="row.status === 'OPEN'" link type="primary" size="small" :disabled="!!blocked[row.id]" @click="openResolve(row)">写结论</el-button>
          <span v-else class="t-xs">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <div v-if="loading" class="tbl-wait" />
        <div v-else-if="loadError" class="state-box">
          <IconTriangleExclamationPoint :size="48" />
          <h4>争议记录加载失败</h4>
          <p>{{ offline ? '请检查网络后重新加载' : loadError }}</p>
          <el-button type="primary" @click="load">重新加载</el-button>
        </div>
        <div v-else class="state-box">
          <IconInbox :size="48" />
          <h4>{{ userId ? '该用户没有归属争议' : '没有待处理的归属争议' }}</h4>
          <p>{{ userId ? '有公司对这个人的归属提出异议时，点右上角「登记争议」记下来' : '登记的争议结案后不再出现在这里；查某个人的全部争议请在上方按用户查询' }}</p>
        </div>
      </template>
    </el-table>
    <div v-if="rows.length" class="pager">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="rows.length" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" background />
    </div>

    <el-dialog v-model="add.open" title="登记归属争议" width="520px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <el-form label-width="120px" @submit.prevent>
        <el-form-item label="用户">{{ userId }}</el-form-item>
        <el-form-item label="提出异议的公司">
          <el-input v-model="add.companyId" placeholder="公司 ID，如 C10001（可不填）" @input="editAdd" />
        </el-form-item>
        <el-form-item label="争议内容" required>
          <el-input v-model="add.content" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="谁提出、主张什么、依据是什么" @input="editAdd" />
        </el-form-item>
      </el-form>
      <p v-if="add.error" class="form-err" role="alert">{{ add.error }}</p>
      <p v-if="add.why" class="blocked-why" role="alert">{{ add.why }}</p>
      <template #footer>
        <el-button @click="add.open = false">取消</el-button>
        <el-button type="primary" :loading="add.saving" :disabled="!!add.why" @click="submitAdd">登记</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="res.open" title="写处理结论" width="520px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <template v-if="res.row">
        <div class="content box">{{ res.row.content }}</div>
        <el-input v-model="res.conclusion" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="核查了什么（注册渠道、状态日志、报名与任职记录）、结论是什么" class="concl" @input="res.error = ''" />
        <div class="notice-bar dlg-gap"><IconInfo :size="16" class="notice-bar-i" />结案只留痕，不会改动来源归属和当前归属。需要释放当前归属的，由该公司在后台操作。</div>
        <p v-if="res.error" class="form-err dlg-gap" role="alert">{{ res.error }}</p>
        <p v-if="res.why" class="blocked-why dlg-gap" role="alert">{{ res.why }}</p>
      </template>
      <template #footer>
        <el-button @click="res.open = false">取消</el-button>
        <el-button type="primary" :loading="res.saving" :disabled="!!res.why" @click="submitResolve">结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.disputes { margin-top: var(--space-gap); }
.hd-r { display: flex; align-items: center; gap: var(--space-3); }
.hd-r .el-button svg { margin-right: var(--space-1); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.tbl-wait { height: 160px; }
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; color: var(--text-1); }
.box { padding: var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); max-height: 200px; overflow: auto; }
.concl { margin-top: var(--space-3); }
.dlg-gap { margin-top: var(--space-3); }
.reply { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--bg-fill); border-radius: var(--radius-control); line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.reply b { color: var(--success-text); margin-right: var(--space-2); font-size: var(--font-size-min); font-weight: var(--font-weight-semibold); }
</style>
