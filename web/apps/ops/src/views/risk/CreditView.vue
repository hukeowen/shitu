<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, opsApi } from '@shitu/api-client'
import { IconInbox, IconInfo, IconSearch, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { useCompanyNames } from '@/composables/useCompanyNames'
import { confirmInBox, isBlocked, isNetwork } from '@/composables/boxSubmit'
import { PENDING_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDate, fmtDateTime, fmtOperator } from '@/utils/format'
import { PENALTY_LEVELS, creditRuleLabel, penaltyLabel, penaltyTone, truthy } from './riskMeta'

/**
 * P-07 诚信与处罚：诚信分、变更记录、三级处罚、人工调分（留痕）
 * 第 17 类查询：查询卡片 → 结果区（没查询给引导、查不到写明原因）；查到后变更记录、处罚记录各自一张白卡片带区块标题
 */
const { companyName } = useCompanyNames()
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
/** 结果区除了「还没查询」「查到了」之外的两种情况：查不到（写明原因）、加载失败（断网与否分文案） */
const notFound = ref('')
const error = ref('')
const offline = ref(false)
/** 最近一次查询的公司，「重新加载」照它再查 */
const asked = ref('')

async function load() {
  const id = companyId.value.trim()
  if (!id) {
    detail.value = null
    asked.value = ''
    notFound.value = ''
    error.value = ''
    return
  }
  asked.value = id
  loading.value = true
  notFound.value = ''
  error.value = ''
  offline.value = false
  // 换了条件不留上一次的结果，加载中只显示遮罩
  detail.value = null
  try {
    detail.value = (await opsApi.companyCredit(id)) as unknown as CreditDetail
    logPage.value = 1
    if (route.query.companyId !== id) void router.replace({ query: { companyId: id } })
  } catch (e) {
    if (isApiError(e, 'SYS_4040')) notFound.value = `公司「${id}」不存在，请核对公司 ID 后再查`
    else {
      error.value = errorMessage(e, '加载失败，请稍后重试')
      offline.value = isNetwork(e)
    }
  } finally {
    loading.value = false
  }
}
function retry() {
  companyId.value = asked.value
  void load()
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
    // 联想失败不影响直接输入公司 ID 查询，下拉里不给候选
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

// 变更记录前端分页（最近 200 条）
const logPage = ref(1)
const logSize = ref(20)
const logs = computed(() => detail.value?.logs ?? [])
const pagedLogs = computed(() => logs.value.slice((logPage.value - 1) * logSize.value, logPage.value * logSize.value))

// ---------- 全平台处罚记录
const allPenalties = shallowRef<PenaltyRow[]>([])
const penLoading = ref(false)
const penError = ref('')
const penOffline = ref(false)
const penPage = ref(1)
const penSize = ref(20)
const pagedPenalties = computed(() => allPenalties.value.slice((penPage.value - 1) * penSize.value, penPage.value * penSize.value))
async function loadPenalties() {
  penLoading.value = true
  penError.value = ''
  penOffline.value = false
  try {
    allPenalties.value = (await opsApi.penalties()) as unknown as PenaltyRow[]
  } catch (e) {
    penError.value = errorMessage(e, '加载失败，请稍后重试')
    penOffline.value = isNetwork(e)
    allPenalties.value = []
  } finally {
    penLoading.value = false
    penPage.value = 1
  }
}
onMounted(loadPenalties)
function openCompany(id: string) {
  companyId.value = id
  void load()
}

// ---------- 人工调分：弹窗里提交，被拒原因留在弹窗里
const adj = reactive({ visible: false, delta: -5, remark: '', error: '', why: '', loading: false })
function openAdjust() {
  Object.assign(adj, { visible: true, delta: -5, remark: '', error: '', why: '', loading: false })
}
function editAdjust() {
  adj.error = ''
  adj.why = ''
}
const adjPreview = computed(() => Math.max(0, Math.min(100, (c.value?.creditScore ?? 0) + (adj.delta ?? 0))))
async function submitAdjust() {
  if (!c.value || adj.loading) return
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
    ElMessage.error(errorMessage(e))
    // 后端业务拒绝：「确认调分」置灰，改了分值或原因再放开；断网只提示
    if (isBlocked(e)) adj.why = `暂时不能调分：${errorMessage(e)}`
  } finally {
    adj.loading = false
  }
}

// ---------- 处罚：表单校验后弹确认框，在确认框里提交；被拒原因只写在确认框里（处罚弹窗不重复），关掉确认框可以改了再试
const pen = reactive({ visible: false, level: 1 as 1 | 2 | 3, reason: '', confirmId: '', error: '' })
function openPenalty() {
  Object.assign(pen, { visible: true, level: 1, reason: '', confirmId: '', error: '' })
}
function editPenalty() {
  pen.error = ''
}
const level3Ready = computed(() => pen.level !== 3 || pen.confirmId.trim() === c.value?.companyId)
async function submitPenalty() {
  const co = c.value
  if (!co) return
  const reason = pen.reason.trim()
  if (!reason) {
    pen.error = '请填写处罚原因'
    return
  }
  if (!level3Ready.value) {
    pen.error = '三级处罚请输入公司 ID 以确认'
    return
  }
  const level = pen.level
  const ok = await confirmInBox({
    title: `确认${penaltyLabel(level)}`,
    text: `对「${co.name}」执行${penaltyLabel(level)}。${PENALTY_LEVELS[level].desc}。处罚将通知企业并写入审计日志，确定继续？`,
    action: '执行处罚',
    confirmText: '确定',
    danger: true,
    api: () => opsApi.penalize(co.companyId, level, reason),
  })
  if (!ok) return
  ElMessage.success('处罚已执行')
  pen.visible = false
  await Promise.all([load(), loadPenalties()])
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>诚信与处罚</h2>
        <p>公司诚信分（0–100）、变更记录、三级处罚（警告 / 限流 30 天 / 封禁）、人工调分（必须留痕）· 诚信分低于 {{ REVOKE_BELOW }} 自动取消收费服务权限</p>
      </div>
    </div>

    <div class="card query">
      <div class="query-row">
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
            <span>{{ item.name }}</span> <span class="dim t-xs">{{ item.value }}</span>
          </template>
        </el-autocomplete>
        <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      </div>
    </div>

    <div v-loading="loading" class="card result">
      <div v-if="loading" class="result-wait" />
      <div v-else-if="notFound" class="state-box">
        <IconInbox :size="48" />
        <h4>没有找到这家公司</h4>
        <p>{{ notFound }}</p>
      </div>
      <div v-else-if="error" class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>诚信信息加载失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" @click="retry">重新加载</el-button>
      </div>
      <div v-else-if="!c" class="state-box">
        <IconSearch :size="48" />
        <h4>输入公司 ID 查看诚信分与处罚记录</h4>
        <p>也可以从投诉管理、降权与限流页点公司进入</p>
      </div>
      <div v-else class="card__bd">
        <section class="blk">
          <div class="who">
            <b>{{ c.name }}</b>
            <span class="who-m">{{ c.companyId }}</span>
            <StatusTag type="CompanyStatus" :value="c.companyStatus" />
            <span class="spacer" />
            <el-button @click="openAdjust">人工调分</el-button>
            <el-button type="danger" plain class="btn-reject" @click="openPenalty">处罚</el-button>
          </div>
          <div class="head">
            <div class="score" :class="scoreTone">
              <div class="stat-l">诚信分</div>
              <div class="sv">{{ c.creditScore }}<small>/100</small></div>
              <div class="bar"><i :style="{ width: `${c.creditScore}%` }" /></div>
            </div>
            <dl class="desc-list info">
              <div><dt>当前处罚</dt><dd><span class="status-tag" :class="penaltyTone(c.penaltyLevel)">{{ penaltyLabel(c.penaltyLevel) }}</span></dd></div>
              <div><dt>限流至</dt><dd class="tnum">{{ fmtDate(c.penaltyUntil) }}</dd></div>
              <div><dt>收费服务权限</dt><dd><span v-if="truthy(c.feeRightsRevoked)" class="status-tag status-tag--danger">已取消</span><span v-else class="status-tag status-tag--success">正常</span></dd></div>
              <div><dt>自动取消收费权限</dt><dd>诚信分低于 {{ REVOKE_BELOW }}</dd></div>
            </dl>
          </div>
        </section>
      </div>
    </div>

    <div v-if="c && !loading" class="grid g-2 lists">
      <div class="card tbl-card logs">
        <div class="card__hd"><h3>诚信分变更记录</h3><span class="t-xs">最近 200 条</span></div>
        <el-table :data="pagedLogs" class="ops-table tbl-48">
          <el-table-column label="时间" width="150"><template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
          <el-table-column label="变动" width="64" align="right">
            <template #default="{ row }"><span class="tnum strong">{{ row.delta > 0 ? '+' : row.delta < 0 ? '−' : '' }}{{ Math.abs(row.delta) }}</span></template>
          </el-table-column>
          <el-table-column label="变更后" width="70" align="right"><template #default="{ row }"><span class="tnum">{{ row.scoreAfter }}</span></template></el-table-column>
          <el-table-column label="规则 / 原因" min-width="160">
            <template #default="{ row }">
              <span class="status-tag">{{ creditRuleLabel(row.ruleCode) }}</span>
              <div v-if="row.remark" class="pre t-sm">{{ row.remark }}</div>
              <div class="t-xs">{{ fmtOperator(row.operatorId) }}<template v-if="row.refId"> · {{ row.refId }}</template></div>
            </template>
          </el-table-column>
          <template #empty>
            <div class="state-box"><IconInbox :size="48" /><h4>暂无变更</h4><p>投诉属实、刷单注册、人工调分等会记在这里</p></div>
          </template>
        </el-table>
        <div v-if="logs.length" class="pager">
          <el-pagination v-model:current-page="logPage" v-model:page-size="logSize" :total="logs.length" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" background />
        </div>
      </div>
      <div class="card penalties">
        <div class="card__hd"><h3>处罚记录</h3><span class="t-xs">这家公司受过的处罚</span></div>
        <div class="card__bd">
          <div v-if="(detail?.penalties ?? []).length === 0" class="state-box"><IconInbox :size="48" /><h4>暂无处罚</h4><p>执行处罚后会记在这里</p></div>
          <ul v-else class="tl">
            <li v-for="(p, i) in detail?.penalties" :key="i" :class="p.level === 3 ? 'fail' : 'now'">
              <div class="tl-t"><span class="status-tag" :class="penaltyTone(p.level)">{{ penaltyLabel(p.level) }}</span></div>
              <div class="tl-m">{{ fmtDate(p.startDate) }} ~ {{ p.endDate ? fmtDate(p.endDate) : p.level === 2 ? '—' : '长期' }} · {{ fmtOperator(p.createdBy) }}</div>
              <div class="tl-r">{{ p.reason }}</div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card tbl-card all-pen">
      <div class="card__hd"><h3>全平台处罚记录</h3><span class="t-xs">最近 200 条</span></div>
      <el-table v-loading="penLoading" :data="pagedPenalties" class="ops-table tbl-48">
        <el-table-column label="时间" width="150"><template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column v-if="allPenalties.some((p) => p.companyId)" label="公司" min-width="170">
          <template #default="{ row }">
            <span class="link-cell" @click="openCompany(row.companyId)">{{ companyName(row.companyId) || row.companyId }}</span>
            <div v-if="companyName(row.companyId)" class="t-xs">{{ row.companyId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="150"><template #default="{ row }"><span class="status-tag" :class="penaltyTone(row.level)">{{ penaltyLabel(row.level) }}</span></template></el-table-column>
        <el-table-column label="期间" width="210"><template #default="{ row }"><span class="tnum">{{ fmtDate(row.startDate) }} ~ {{ row.endDate ? fmtDate(row.endDate) : '—' }}</span></template></el-table-column>
        <el-table-column label="原因" min-width="240"><template #default="{ row }"><span class="pre">{{ row.reason }}</span></template></el-table-column>
        <el-table-column label="操作人" width="130" show-overflow-tooltip><template #default="{ row }">{{ fmtOperator(row.createdBy) }}</template></el-table-column>
        <template #empty>
          <div v-if="penLoading" class="tbl-wait" />
          <div v-else-if="penError" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>处罚记录加载失败</h4>
            <p>{{ penOffline ? '请检查网络后重新加载' : penError }}</p>
            <el-button type="primary" @click="loadPenalties">重新加载</el-button>
          </div>
          <div v-else class="state-box"><IconInbox :size="48" /><h4>暂无处罚记录</h4><p>平台对任何公司执行处罚后会记在这里</p></div>
        </template>
      </el-table>
      <div v-if="allPenalties.length" class="pager">
        <el-pagination v-model:current-page="penPage" v-model:page-size="penSize" :total="allPenalties.length" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <el-dialog v-model="adj.visible" title="人工调分" width="480px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="调整分值（-100 ~ 100）" required>
          <el-input-number v-model="adj.delta" :min="-100" :max="100" :step="1" @change="editAdjust" />
          <span class="unit">{{ c?.creditScore }} → <b>{{ adjPreview }}</b></span>
        </el-form-item>
        <div v-if="adjPreview < REVOKE_BELOW && !truthy(c?.feeRightsRevoked)" class="notice-bar notice-bar--warn gap"><IconInfo :size="16" class="notice-bar-i" />调整后低于 {{ REVOKE_BELOW }} 分，将自动取消该公司的收费服务权限。</div>
        <el-form-item label="原因（必填，留痕）" required>
          <el-input v-model="adj.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="调分依据，将写入诚信分变更记录与审计日志" @input="editAdjust" />
        </el-form-item>
      </el-form>
      <p v-if="adj.error" class="form-err" role="alert">{{ adj.error }}</p>
      <p v-if="adj.why" class="blocked-why" role="alert">{{ adj.why }}</p>
      <template #footer>
        <el-button @click="adj.visible = false">取消</el-button>
        <el-button type="primary" class="btn-steady" :loading="adj.loading" :disabled="!!adj.why" @click="submitAdjust">确认调分</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pen.visible" title="处罚公司" width="560px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="处罚等级" required>
          <el-radio-group v-model="pen.level" class="lv" @change="editPenalty">
            <el-radio v-for="lv in [1, 2, 3] as const" :key="lv" :value="lv" border>{{ penaltyLabel(lv) }}</el-radio>
          </el-radio-group>
          <div class="t-xs hint">{{ PENALTY_LEVELS[pen.level].desc }}</div>
        </el-form-item>
        <div v-if="pen.level === 3" class="notice-bar notice-bar--danger gap">
          <IconInfo :size="16" class="notice-bar-i" />
          <div>
            三级处罚<b>不可撤销</b>：公司将被封禁，并<b>永久取消收费服务权限</b>。请输入公司 ID <b>{{ c?.companyId }}</b> 确认。
            <el-input v-model="pen.confirmId" class="confirm-in" placeholder="输入公司 ID 确认" @input="editPenalty" />
          </div>
        </div>
        <el-form-item label="处罚原因（必填，将通知企业）" required>
          <el-input v-model="pen.reason" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="写违规事实。原文会发给企业，不要写限流、降权、权重等平台内部措施" @input="editPenalty" />
        </el-form-item>
      </el-form>
      <p v-if="pen.error" class="form-err" role="alert">{{ pen.error }}</p>
      <template #footer>
        <el-button @click="pen.visible = false">取消</el-button>
        <el-button type="danger" plain class="btn-reject" :disabled="!level3Ready" @click="submitPenalty">执行处罚</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.query { padding: var(--space-4); }
.query-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.result { margin-top: var(--space-gap); }
.result-wait { height: 200px; }
.who { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4); }
.who b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.who-m { font-size: var(--font-size-aux); color: var(--text-2); font-variant-numeric: tabular-nums; }
.who .spacer { flex: 1; }
.who .el-button + .el-button { margin-left: 0; }
/* 诚信分卡和四项信息均分三列：分数卡一列，两列描述列表占两列 */
.head { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
.score { padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); }
.sv { font-size: var(--font-size-metric); font-weight: var(--font-weight-semibold); line-height: 1.2; margin-top: var(--space-1); color: var(--text-1); font-variant-numeric: tabular-nums; }
.sv small { font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); color: var(--text-3); margin-left: var(--space-1); }
.bar { height: 6px; border-radius: var(--radius-tag); background: var(--bg-fill); margin-top: var(--space-2); overflow: hidden; }
.bar i { display: block; height: 100%; }
.score.ok .bar i { background: var(--success-solid); }
.score.warn .bar i { background: var(--warning-solid); }
.score.danger .bar i { background: var(--danger-solid); }
.info { grid-column: span 2; min-width: 0; }
.lists { gap: var(--space-gap); margin-top: var(--space-gap); }
.all-pen { margin-top: var(--space-gap); }
.tbl-wait { height: 160px; }
.pre { white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.unit { margin-left: var(--space-3); font-size: var(--font-size-aux); color: var(--text-2); }
.unit b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.gap { margin-bottom: var(--space-4); }
.lv { display: flex; gap: var(--space-2); }
.lv :deep(.el-radio) { margin-right: 0; }
.hint { margin-top: var(--space-1); width: 100%; }
.confirm-in { margin-top: var(--space-2); width: 220px; }
</style>
