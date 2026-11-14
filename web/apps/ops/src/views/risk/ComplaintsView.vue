<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict } from '@shitu/api-client'
import { IconInbox, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { isBlocked, isNetwork } from '@/composables/boxSubmit'
import { useFileUrls } from '@/composables/useFileUrls'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'

/**
 * P-06 投诉管理：核实 / 驳回；同岗属实满 3 次自动下架并扣 10 分
 * 第 8 类审核处理：页签 → 表格 → 「核实处理」弹窗里填说明，「驳回投诉」在左危险色描边、「确认属实」在右主色
 */
interface ComplaintRow {
  id: number
  jobId: string
  title: string
  companyId: string
  userId: string
  category: string
  content: string
  images?: string[]
  status: 'PENDING' | 'VERIFIED' | 'REJECTED'
  handleRemark?: string
  createdAt: string
  handledAt?: string
  complaintVerified: number
}
const AUTO_OFFLINE_AT = 3
const files = useFileUrls()

const router = useRouter()
const { label, options } = useDict()
const status = ref<'' | 'PENDING' | 'VERIFIED' | 'REJECTED'>('PENDING')
const rows = shallowRef<ComplaintRow[]>([])
const loading = ref(false)
const error = ref('')
const offline = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  offline.value = false
  try {
    rows.value = (await opsApi.complaints(status.value || undefined)) as unknown as ComplaintRow[]
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    offline.value = isNetwork(e)
    rows.value = []
  } finally {
    loading.value = false
    page.value = 1
  }
}
onMounted(load)
const tabs = computed(() => [...options('ComplaintStatus'), { value: '', label: '全部' }])
function setStatus(v: string) {
  status.value = v as typeof status.value
  void load()
}

// 前端分页：接口一次返回最近 200 条
const page = ref(1)
const pageSize = ref(20)
const paged = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const opsWidth = computed(() => actionsColWidth(paged.value.map((r) => ({ labels: r.status === 'PENDING' ? ['核实处理'] : [] })), 72))

/**
 * 核实弹窗：「驳回投诉」在左、「确认属实」在右（同其他审核页）。被后端拒绝时原因留在弹窗里，只置灰被拒的那个按钮，
 * 另一种结论照常可点；改了说明再放开。关掉弹窗后「核实处理」照常可点，重新打开从头来（同工单 23 调整状态弹窗）
 */
const dlg = reactive({ visible: false, row: null as ComplaintRow | null, remark: '', error: '', why: '', off: null as boolean | null, loading: null as boolean | null })
function openHandle(r: ComplaintRow) {
  Object.assign(dlg, { visible: true, row: r, remark: '', error: '', why: '', off: null, loading: null })
}
function editHandle() {
  dlg.error = ''
  dlg.why = ''
  dlg.off = null
}
/** 本次核实属实就满 3 次：自动下架并扣分 */
const willOffline = computed(() => dlg.row != null && dlg.row.complaintVerified + 1 >= AUTO_OFFLINE_AT && dlg.row.complaintVerified < AUTO_OFFLINE_AT)
async function submit(verified: boolean) {
  const row = dlg.row
  if (!row || dlg.loading != null) return
  const remark = dlg.remark.trim()
  if (!remark) {
    dlg.error = '请填写处理说明'
    return
  }
  dlg.loading = verified
  try {
    await opsApi.handleComplaint(row.id, verified, remark)
    ElMessage.success(verified ? (willOffline.value ? '已核实属实，岗位已达 3 次属实，自动下架并扣分' : '已核实属实') : '已驳回投诉')
    dlg.visible = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    // 后端业务拒绝：原因留在弹窗里、确认置灰（换个结论或改说明再放开），表格里这一条也置灰；断网只提示
    if (isBlocked(e)) {
      dlg.why = `暂时不能${verified ? '确认属实' : '驳回投诉'}：${errorMessage(e)}`
      dlg.off = verified
    }
  } finally {
    dlg.loading = null
  }
}
function toCredit(companyId: string) {
  void router.push({ path: '/governance/credit', query: { companyId } })
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>投诉管理</h2>
        <p>求职者对岗位的投诉 · 核实属实 / 驳回；同一岗位属实满 {{ AUTO_OFFLINE_AT }} 次自动下架并扣公司诚信分 10 分（每岗只触发一次）</p>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="setStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <span class="t-xs">最近 200 条</span>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
      <el-table v-loading="loading" :data="paged" class="ops-table tbl-48" row-key="id">
        <el-table-column label="#" width="60"><template #default="{ row }"><span class="tnum dim">{{ row.id }}</span></template></el-table-column>
        <el-table-column label="岗位 / 公司" min-width="200">
          <template #default="{ row }">
            <span class="strong">{{ row.title }}</span>
            <div class="t-xs">
              {{ row.jobId }} ·
              <span class="link-cell co" @click="toCredit(row.companyId)">{{ row.companyId }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类别" width="110"><template #default="{ row }">{{ label('ComplaintCategory', row.category) }}</template></el-table-column>
        <el-table-column label="投诉内容" min-width="220">
          <template #default="{ row }">
            <div class="pre">{{ row.content }}</div>
            <div v-if="row.images?.length" class="imgs">
              <el-button v-for="(k, i) in row.images" :key="k" size="small" link type="primary" @click="files.openInTab(k)">图片 {{ i + 1 }}</el-button>
            </div>
            <div class="t-xs">{{ row.userId }} · {{ fmtDateTime(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="本岗属实" width="90" align="right">
          <template #default="{ row }">
            <span class="tnum" :class="row.complaintVerified >= AUTO_OFFLINE_AT ? 'n-danger' : row.complaintVerified > 0 ? 'n-warn' : 'dim'">{{ row.complaintVerified }}/{{ AUTO_OFFLINE_AT }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag type="ComplaintStatus" :value="row.status" /></template></el-table-column>
        <el-table-column label="处理结果" min-width="140">
          <template #default="{ row }">
            <template v-if="row.status !== 'PENDING'">
              <div class="pre t-sm">{{ row.handleRemark }}</div>
              <div class="t-xs">{{ fmtDateTime(row.handledAt) }}</div>
            </template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
          <template #default="{ row }">
            <el-button v-if="row.status === 'PENDING'" link type="primary" size="small" @click="openHandle(row)">核实处理</el-button>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loading" class="tbl-wait" />
          <div v-else-if="error" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>投诉列表加载失败</h4>
            <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
            <el-button type="primary" @click="load">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ status === 'PENDING' ? '暂无待核实投诉' : '暂无投诉' }}</h4>
            <p>{{ status === 'PENDING' ? '求职者在岗位详情里投诉后会出现在这里' : '切换上方页签查看其他状态的投诉' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="rows.length" class="pager">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="rows.length" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <el-dialog v-model="dlg.visible" title="核实投诉" width="520px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <template v-if="dlg.row">
        <dl class="desc-list">
          <div><dt>岗位</dt><dd>{{ dlg.row.title }} <span class="dim">{{ dlg.row.jobId }}</span></dd></div>
          <div><dt>类别</dt><dd>{{ label('ComplaintCategory', dlg.row.category) }}</dd></div>
          <div class="full"><dt>投诉内容</dt><dd class="pre">{{ dlg.row.content || '（未填写说明）' }}</dd></div>
          <div v-if="dlg.row.images?.length" class="full"><dt>图片凭证</dt><dd>
            <el-button v-for="(k, i) in dlg.row.images" :key="k" size="small" @click="files.openInTab(k)">查看图片 {{ i + 1 }}</el-button>
          </dd></div>
        </dl>
        <el-form label-position="top" class="form" @submit.prevent>
          <div v-if="willOffline" class="notice-bar notice-bar--warn gap">
            <IconInfo :size="16" class="notice-bar-i" />
            <span>该岗位已有 {{ dlg.row.complaintVerified }} 次属实投诉，核实属实后将<b>自动强制下架</b>并扣公司诚信分 10 分。</span>
          </div>
          <el-form-item label="处理说明" required>
            <el-input v-model="dlg.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="核实过程与结论（必填，记录审计日志）" @input="editHandle" />
          </el-form-item>
        </el-form>
        <p v-if="dlg.error" class="form-err" role="alert">{{ dlg.error }}</p>
        <p v-if="dlg.why" class="blocked-why" role="alert">{{ dlg.why }}</p>
      </template>
      <template #footer>
        <div class="rv-acts">
          <el-button @click="dlg.visible = false">取消</el-button>
          <span class="rv-gap" />
          <el-button type="danger" plain class="btn-reject btn-steady" :loading="dlg.loading === false" :disabled="dlg.loading === true || dlg.off === false" @click="submit(false)">驳回投诉</el-button>
          <el-button type="primary" class="btn-steady" :loading="dlg.loading === true" :disabled="dlg.loading === false || dlg.off === true" @click="submit(true)">确认属实</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tbl-wait { height: 160px; }
.pre { white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.co { font-weight: var(--font-weight-regular); }
.n-danger { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
.n-warn { color: var(--warning-text); font-weight: var(--font-weight-semibold); }
.form { margin-top: var(--space-4); }
.gap { margin-bottom: var(--space-4); }
</style>
