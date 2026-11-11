<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { confirmAction } from '@/composables/useRemark'
import { PENDING_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDate, fmtDateTime } from '@/utils/format'
import { PENALTY_LEVELS, creditRuleLabel, penaltyLabel, truthy } from './riskMeta'

/** P-07 诚信与处罚：诚信分、变更记录、三级处罚、人工调分（留痕） */
interface CreditCompany {
  companyId: string
  name: string
  creditScore: number
  penaltyLevel: number
  penaltyUntil?: string | null
  feeRightsRevoked: boolean | number
  companyStatus: string
}
interface CreditLog {
  delta: number
  scoreAfter: number
  ruleCode: string
  refType?: string
  refId?: string
  remark?: string
  operatorId?: string
  createdAt: string
}
interface PenaltyRow {
  level: number
  reason: string
  startDate: string
  endDate?: string | null
  createdBy?: string
  createdAt: string
  companyId?: string
}
interface CreditDetail {
  company: CreditCompany
  logs: CreditLog[]
  penalties: PenaltyRow[]
}
const REVOKE_BELOW = 30

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canSearchCompanies = computed(() => auth.hasAnyRole(PENDING_ROLES))

const companyId = ref(typeof route.query.companyId === 'string' ? route.query.companyId : '')
const detail = shallowRef<CreditDetail | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  const id = companyId.value.trim()
  if (!id) {
    detail.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    detail.value = (await opsApi.companyCredit(id)) as unknown as CreditDetail
    if (route.query.companyId !== id) void router.replace({ query: { companyId: id } })
  } catch (e) {
    detail.value = null
    error.value = errorMessage(e, '未找到该公司或加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(
  () => route.query.companyId,
  (v) => {
    if (typeof v === 'string' && v !== companyId.value) {
      companyId.value = v
      void load()
    }
  },
)

/** 公司名称联想（仅 SUPER / OPERATOR 有公司列表接口权限；风控角色直接输入公司 ID） */
function suggest(q: string, cb: (items: { value: string; name: string }[]) => void) {
  void suggestAsync(q, cb)
}

async function suggestAsync(q: string, cb: (items: { value: string; name: string }[]) => void) {
  if (!canSearchCompanies.value || !q.trim()) return cb([])
  try {
    const r = await opsApi.companies({ keyword: q.trim(), pageSize: 10 })
    cb(r.records.map((c) => ({ value: c.companyId, name: c.name })))
  } catch {
    cb([])
  }
}
function onPick() {
  void load()
}

const c = computed(() => detail.value?.company)
const scoreTone = computed(() => {
  const s = c.value?.creditScore ?? 100
  return s < REVOKE_BELOW ? 'danger' : s < 60 ? 'warn' : 'ok'
})

// ---------- 全平台处罚记录
const allPenalties = shallowRef<PenaltyRow[]>([])
const penLoading = ref(false)
async function loadPenalties() {
  penLoading.value = true
  try {
    allPenalties.value = (await opsApi.penalties()) as unknown as PenaltyRow[]
  } catch {
    allPenalties.value = []
  } finally {
    penLoading.value = false
  }
}
onMounted(loadPenalties)

// ---------- 人工调分
const adj = reactive({ visible: false, delta: -5, remark: '', error: '', loading: false })
function openAdjust() {
  Object.assign(adj, { visible: true, delta: -5, remark: '', error: '' })
}
const adjPreview = computed(() => Math.max(0, Math.min(100, (c.value?.creditScore ?? 0) + (adj.delta ?? 0))))
async function submitAdjust() {
  if (!c.value) return
  const remark = adj.remark.trim()
  if (!adj.delta) {
    adj.error = '调整分值不能为 0'
    return
  }
  if (!remark) {
    adj.error = '人工调分必须填写原因'
    return
  }
  adj.loading = true
  try {
    const after = await opsApi.adjustCredit(c.value.companyId, adj.delta, remark)
    ElMessage.success(`已调整，当前诚信分 ${after}`)
    adj.visible = false
    await load()
  } catch (e) {
    adj.error = errorMessage(e)
  } finally {
    adj.loading = false
  }
}

// ---------- 处罚
const pen = reactive({ visible: false, level: 1 as 1 | 2 | 3, reason: '', confirmId: '', error: '', loading: false })
function openPenalty() {
  Object.assign(pen, { visible: true, level: 1, reason: '', confirmId: '', error: '' })
}
const level3Ready = computed(() => pen.level !== 3 || pen.confirmId.trim() === c.value?.companyId)
async function submitPenalty() {
  if (!c.value) return
  const reason = pen.reason.trim()
  if (!reason) {
    pen.error = '请填写处罚原因'
    return
  }
  if (!level3Ready.value) {
    pen.error = '三级处罚请输入公司 ID 以确认'
    return
  }
  const ok = await confirmAction(
    `确认${penaltyLabel(pen.level)}`,
    `对「${c.value.name}」执行${penaltyLabel(pen.level)}。${PENALTY_LEVELS[pen.level].desc}。处罚将通知企业并写入审计日志，确定继续？`,
    true,
  )
  if (!ok) return
  pen.loading = true
  try {
    await opsApi.penalize(c.value.companyId, pen.level, reason)
    ElMessage.success('处罚已执行')
    pen.visible = false
    await Promise.all([load(), loadPenalties()])
  } catch (e) {
    pen.error = errorMessage(e)
  } finally {
    pen.loading = false
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>诚信与处罚</h2>
        <p>公司诚信分（0–100）、变更记录、三级处罚（警告 / 限流 30 天 / 封禁）、人工调分（必须留痕）· 诚信分低于 {{ REVOKE_BELOW }} 自动取消收费服务权限</p>
      </div>
      <div class="spacer" />
    </div>

    <div class="card">
      <div class="toolbar">
        <el-autocomplete
          v-model="companyId"
          :fetch-suggestions="suggest"
          clearable
          :placeholder="canSearchCompanies ? '公司 ID 或公司名称' : '公司 ID，如 C10002'"
          style="width: 280px"
          :trigger-on-focus="false"
          @select="onPick"
          @keyup.enter="load"
        >
          <template #default="{ item }">
            <span>{{ item.name }}</span> <span class="mono dim t-xs">{{ item.value }}</span>
          </template>
        </el-autocomplete>
        <el-button type="primary" :loading="loading" @click="load">查询</el-button>
        <span v-if="error" class="err">{{ error }}</span>
        <div class="spacer" />
        <template v-if="c">
          <el-button @click="openAdjust">人工调分</el-button>
          <el-button type="danger" plain @click="openPenalty">处罚</el-button>
        </template>
      </div>

      <div v-if="!c" class="card__bd">
        <el-empty :image-size="64" description="输入公司 ID 查看诚信分与处罚记录（也可从投诉管理 / 降权与限流页点击公司进入）" />
      </div>
      <div v-else v-loading="loading" class="card__bd">
        <div class="head">
          <div class="score" :class="scoreTone">
            <div class="stat-l">诚信分</div>
            <div class="sv">{{ c.creditScore }}<small>/100</small></div>
            <div class="bar"><i :style="{ width: `${c.creditScore}%` }" /></div>
          </div>
          <dl class="kv-grid info">
            <div class="kv"><dt>公司</dt><dd>{{ c.name }} <span class="mono dim">{{ c.companyId }}</span></dd></div>
            <div class="kv"><dt>公司状态</dt><dd><StatusTag type="CompanyStatus" :value="c.companyStatus" /></dd></div>
            <div class="kv"><dt>当前处罚</dt><dd><span class="tag" :class="PENALTY_LEVELS[c.penaltyLevel]?.cls">{{ penaltyLabel(c.penaltyLevel) }}</span></dd></div>
            <div class="kv"><dt>限流至</dt><dd class="mono">{{ fmtDate(c.penaltyUntil) }}</dd></div>
            <div class="kv"><dt>收费服务权限</dt><dd><span v-if="truthy(c.feeRightsRevoked)" class="tag tag--danger">已取消</span><span v-else class="tag tag--ok">正常</span></dd></div>
          </dl>
        </div>

        <div class="grid g-2 lists">
          <div>
            <div class="sec-title">诚信分变更记录 <small>最近 200 条</small></div>
            <el-table :data="detail?.logs ?? []" class="ops-table" size="small" max-height="420">
              <el-table-column label="时间" width="140"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
              <el-table-column label="变动" width="70" align="right">
                <template #default="{ row }"><span class="mono strong" :class="row.delta < 0 ? 'neg' : 'pos'">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</span></template>
              </el-table-column>
              <el-table-column label="变更后" width="64" align="right"><template #default="{ row }"><span class="mono">{{ row.scoreAfter }}</span></template></el-table-column>
              <el-table-column label="规则 / 原因" min-width="180">
                <template #default="{ row }">
                  <span class="tag">{{ creditRuleLabel(row.ruleCode) }}</span>
                  <div v-if="row.remark" class="t-sm rm">{{ row.remark }}</div>
                  <div class="t-xs mono">{{ row.operatorId ?? '系统' }}<template v-if="row.refId"> · {{ row.refType }} {{ row.refId }}</template></div>
                </template>
              </el-table-column>
              <template #empty><el-empty :image-size="48" description="暂无变更" /></template>
            </el-table>
          </div>
          <div>
            <div class="sec-title">处罚记录</div>
            <el-empty v-if="(detail?.penalties ?? []).length === 0" :image-size="48" description="暂无处罚" />
            <ul v-else class="tl">
              <li v-for="(p, i) in detail?.penalties" :key="i" :class="p.level === 3 ? 'fail' : 'now'">
                <div class="tl-t"><span class="tag" :class="PENALTY_LEVELS[p.level]?.cls">{{ penaltyLabel(p.level) }}</span></div>
                <div class="tl-m">{{ fmtDate(p.startDate) }} ~ {{ p.endDate ? fmtDate(p.endDate) : p.level === 2 ? '—' : '长期' }} · {{ p.createdBy ?? '' }}</div>
                <div class="tl-r">{{ p.reason }}</div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div class="card below">
      <div class="card__hd"><h3>全平台处罚记录</h3><span class="t-xs">最近 200 条</span></div>
      <el-table v-loading="penLoading" :data="allPenalties" class="ops-table" size="small" max-height="360">
        <el-table-column label="时间" width="150"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column v-if="allPenalties.some((p) => p.companyId)" label="公司" width="110">
          <template #default="{ row }"><span class="link-cell mono" @click="companyId = row.companyId; load()">{{ row.companyId }}</span></template>
        </el-table-column>
        <el-table-column label="等级" width="150"><template #default="{ row }"><span class="tag" :class="PENALTY_LEVELS[row.level]?.cls">{{ penaltyLabel(row.level) }}</span></template></el-table-column>
        <el-table-column label="期间" width="200"><template #default="{ row }"><span class="mono t-sm">{{ fmtDate(row.startDate) }} ~ {{ row.endDate ? fmtDate(row.endDate) : '—' }}</span></template></el-table-column>
        <el-table-column label="原因" min-width="240"><template #default="{ row }"><span class="t-sm">{{ row.reason }}</span></template></el-table-column>
        <el-table-column label="操作人" width="110"><template #default="{ row }"><span class="mono t-sm">{{ row.createdBy ?? '—' }}</span></template></el-table-column>
        <template #empty><el-empty :image-size="48" description="暂无处罚记录" /></template>
      </el-table>
    </div>

    <el-dialog v-model="adj.visible" title="人工调分" width="460px" destroy-on-close :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="调整分值（-100 ~ 100）" required>
          <el-input-number v-model="adj.delta" :min="-100" :max="100" :step="1" />
          <span class="unit">{{ c?.creditScore }} → <b :class="adjPreview < REVOKE_BELOW ? 'neg' : ''">{{ adjPreview }}</b></span>
        </el-form-item>
        <div v-if="adjPreview < REVOKE_BELOW && !truthy(c?.feeRightsRevoked)" class="notice notice--danger gap">调整后低于 {{ REVOKE_BELOW }} 分，将自动取消该公司的收费服务权限。</div>
        <el-form-item label="原因（必填，留痕）" required>
          <el-input v-model="adj.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="调分依据，将写入诚信分变更记录与审计日志" @input="adj.error = ''" />
        </el-form-item>
      </el-form>
      <div v-if="adj.error" class="notice notice--danger">{{ adj.error }}</div>
      <template #footer>
        <el-button @click="adj.visible = false">取消</el-button>
        <el-button type="primary" :loading="adj.loading" @click="submitAdjust">确认调分</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pen.visible" title="处罚公司" width="520px" destroy-on-close :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="处罚等级" required>
          <el-radio-group v-model="pen.level" class="lv" @change="pen.error = ''">
            <el-radio v-for="lv in [1, 2, 3] as const" :key="lv" :value="lv" border>{{ penaltyLabel(lv) }}</el-radio>
          </el-radio-group>
          <div class="t-xs hint">{{ PENALTY_LEVELS[pen.level].desc }}</div>
        </el-form-item>
        <div v-if="pen.level === 3" class="notice notice--danger gap">
          <div>
            三级处罚<b>不可撤销</b>：公司将被封禁，并<b>永久取消收费服务权限</b>。请输入公司 ID <b class="mono">{{ c?.companyId }}</b> 确认。
            <el-input v-model="pen.confirmId" class="confirm-in" placeholder="输入公司 ID 确认" @input="pen.error = ''" />
          </div>
        </div>
        <el-form-item label="处罚原因（必填，将通知企业）" required>
          <el-input v-model="pen.reason" type="textarea" :rows="3" maxlength="500" show-word-limit @input="pen.error = ''" />
        </el-form-item>
      </el-form>
      <div v-if="pen.error" class="notice notice--danger">{{ pen.error }}</div>
      <template #footer>
        <el-button @click="pen.visible = false">取消</el-button>
        <el-button type="danger" :loading="pen.loading" :disabled="!level3Ready" @click="submitPenalty">执行处罚</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.err { color: var(--danger); font-size: 12.5px; }
.head { display: flex; gap: 24px; align-items: flex-start; margin-bottom: 8px; }
.score { width: 200px; flex: none; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-2); }
.sv { font-family: var(--f-dis); font-size: 36px; font-weight: 700; line-height: 1.1; margin-top: 4px; }
.sv small { font-size: 13px; font-weight: 400; color: var(--ink-400); margin-left: 2px; }
.bar { height: 6px; border-radius: 3px; background: var(--line); margin-top: 8px; overflow: hidden; }
.bar i { display: block; height: 100%; background: currentColor; }
.score.ok { color: var(--ok); }
.score.warn { color: var(--warn); }
.score.danger { color: var(--danger); }
.info { flex: 1; min-width: 0; }
.lists { margin-top: 8px; }
.rm { color: var(--ink-800); white-space: pre-wrap; }
.neg { color: var(--danger); }
.pos { color: var(--ok); }
.below { margin-top: 14px; }
.unit { margin-left: 10px; font-size: 13px; color: var(--ink-600); }
.gap { margin-bottom: 14px; }
.lv { display: flex; gap: 8px; }
.lv :deep(.el-radio) { margin-right: 0; }
.hint { margin-top: 6px; width: 100%; }
.confirm-in { margin-top: 8px; width: 220px; }
</style>
