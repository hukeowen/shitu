<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { useCompanyNames } from '@/composables/useCompanyNames'
import { useFileUrls } from '@/composables/useFileUrls'
import { fmtDateTime } from '@/utils/format'

/** P-06 投诉管理：核实 / 驳回；同岗属实满 3 次自动下架并扣 10 分 */
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
const { companyName } = useCompanyNames()

const router = useRouter()
const { label, options } = useDict()
const status = ref<'' | 'PENDING' | 'VERIFIED' | 'REJECTED'>('PENDING')
const rows = shallowRef<ComplaintRow[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = (await opsApi.complaints(status.value || undefined)) as unknown as ComplaintRow[]
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
const tabs = computed(() => [...options('ComplaintStatus'), { value: '', label: '全部' }])
function setStatus(v: string) {
  status.value = v as typeof status.value
  void load()
}

const dlg = reactive({ visible: false, row: null as ComplaintRow | null, verified: true, remark: '', error: '', loading: false })
function openHandle(r: ComplaintRow) {
  Object.assign(dlg, { visible: true, row: r, verified: true, remark: '', error: '' })
}
const willOffline = computed(() => dlg.verified && dlg.row != null && dlg.row.complaintVerified + 1 >= AUTO_OFFLINE_AT && dlg.row.complaintVerified < AUTO_OFFLINE_AT)
async function submit() {
  if (!dlg.row) return
  const remark = dlg.remark.trim()
  if (!remark) {
    dlg.error = '请填写处理说明'
    return
  }
  dlg.loading = true
  try {
    await opsApi.handleComplaint(dlg.row.id, dlg.verified, remark)
    ElMessage.success(dlg.verified ? (willOffline.value ? '已核实属实，岗位已达 3 次属实，自动下架并扣分' : '已核实属实') : '已驳回投诉')
    dlg.visible = false
    await load()
  } catch (e) {
    dlg.error = errorMessage(e)
  } finally {
    dlg.loading = false
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
      <div class="spacer" />
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in tabs" :key="t.value" type="button" :class="{ on: status === t.value }" @click="setStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <span class="t-xs">最近 200 条</span>
        <el-button @click="load">刷新</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" class="ops-table" row-key="id">
        <el-table-column label="#" width="70"><template #default="{ row }"><span class="mono dim">{{ row.id }}</span></template></el-table-column>
        <el-table-column label="岗位" min-width="170">
          <template #default="{ row }">
            <span class="strong">{{ row.title }}</span>
            <div class="t-xs mono">{{ row.jobId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="公司" min-width="170">
          <template #default="{ row }">
            <span class="link-cell" :class="{ mono: !companyName(row.companyId) }" @click="toCredit(row.companyId)">{{ companyName(row.companyId) || row.companyId }}</span>
            <div v-if="companyName(row.companyId)" class="t-xs mono">{{ row.companyId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="类别" width="130"><template #default="{ row }"><span class="tag">{{ label('ComplaintCategory', row.category) }}</span></template></el-table-column>
        <el-table-column label="投诉内容" min-width="220">
          <template #default="{ row }">
            <div class="t-sm content">{{ row.content }}</div>
            <div v-if="row.images?.length" class="imgs">
              <el-button v-for="(k, i) in row.images" :key="k" size="small" link type="primary" @click="files.openInTab(k)">图片 {{ i + 1 }}</el-button>
            </div>
            <div class="t-xs mono">{{ row.userId }} · {{ fmtDateTime(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="本岗属实" width="90" align="center">
          <template #default="{ row }">
            <span class="mono" :class="row.complaintVerified >= AUTO_OFFLINE_AT ? 'danger' : row.complaintVerified > 0 ? 'warn' : 'dim'">
              {{ row.complaintVerified }}/{{ AUTO_OFFLINE_AT }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag type="ComplaintStatus" :value="row.status" /></template></el-table-column>
        <el-table-column label="处理说明" min-width="170">
          <template #default="{ row }">
            <template v-if="row.status !== 'PENDING'">
              <div class="t-sm content">{{ row.handleRemark || '—' }}</div>
              <div class="t-xs mono">{{ fmtDateTime(row.handledAt) }}</div>
            </template>
            <span v-else class="dim">待核实</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" class-name="ops-col" width="110" align="right" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'PENDING'" size="small" type="primary" @click="openHandle(row)">核实处理</el-button>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="error" :image-size="64" :description="error"><el-button size="small" @click="load">重试</el-button></el-empty>
          <el-empty v-else :image-size="64" :description="status === 'PENDING' ? '暂无待核实投诉' : '暂无数据'" />
        </template>
      </el-table>
    </div>

    <el-dialog v-model="dlg.visible" title="核实投诉" width="500px" destroy-on-close :close-on-click-modal="false">
      <template v-if="dlg.row">
        <dl class="kv-grid one">
          <div class="kv"><dt>岗位</dt><dd>{{ dlg.row.title }} <span class="mono dim">{{ dlg.row.jobId }}</span></dd></div>
          <div class="kv"><dt>公司</dt><dd>{{ companyName(dlg.row.companyId) }} <span class="mono dim">{{ dlg.row.companyId }}</span></dd></div>
          <div class="kv"><dt>类别</dt><dd>{{ label('ComplaintCategory', dlg.row.category) }}</dd></div>
          <div class="kv block"><dt>投诉内容</dt><dd>{{ dlg.row.content || '（未填写说明）' }}</dd></div>
          <div v-if="dlg.row.images?.length" class="kv block"><dt>图片凭证</dt><dd>
            <el-button v-for="(k, i) in dlg.row.images" :key="k" size="small" @click="files.openInTab(k)">查看图片 {{ i + 1 }}</el-button>
          </dd></div>
        </dl>
        <el-form label-position="top" class="form">
          <el-form-item label="核实结论" required>
            <el-radio-group v-model="dlg.verified">
              <el-radio :value="true" border>属实</el-radio>
              <el-radio :value="false" border>不属实（驳回）</el-radio>
            </el-radio-group>
          </el-form-item>
          <div v-if="willOffline" class="notice notice--danger gap">
            该岗位已有 {{ dlg.row.complaintVerified }} 次属实投诉，本次核实属实后将<b>自动强制下架</b>并扣公司诚信分 10 分。
          </div>
          <el-form-item label="处理说明" required>
            <el-input v-model="dlg.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="核实过程与结论（必填，记录审计日志）" @input="dlg.error = ''" />
          </el-form-item>
        </el-form>
        <div v-if="dlg.error" class="notice notice--danger">{{ dlg.error }}</div>
      </template>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button :type="dlg.verified ? 'danger' : 'primary'" :loading="dlg.loading" @click="submit">{{ dlg.verified ? '确认属实' : '驳回投诉' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.content { white-space: pre-wrap; color: var(--ink-800); }
.danger { color: var(--danger); font-weight: 700; }
.warn { color: var(--warn); font-weight: 600; }
.form { margin-top: 14px; }
.gap { margin-bottom: 14px; }
</style>
