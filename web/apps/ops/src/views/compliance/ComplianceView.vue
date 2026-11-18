<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type BlacklistRow, type KycInterception, type KycReviewRow, type KycReviewType, type ReviewStatus } from '@shitu/api-client'
import { IconInbox, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { isBlocked, isNetwork, remarkInBox } from '@/composables/boxSubmit'
import { ATTRIBUTION_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime, fmtOperator } from '@/utils/format'

/**
 * P-14 实名与合规：人工复核队列（身份证占用申诉 / 失信申诉 / 低置信度 / 疑似冒用）+ 平台黑名单 + 拦截记录
 * 第 8 类审核处理：标签页 → 表格（展开看材料）→ 操作列「驳回 / 误报」在左危险色描边、「通过 / 确认刷单」在右主色 → 原因在弹窗里填
 */
const router = useRouter()
const auth = useAuthStore()
const canAttribution = computed(() => auth.hasAnyRole(ATTRIBUTION_ROLES))
const { label, options } = useDict()
const tab = ref<'reviews' | 'blacklist' | 'blocked'>('reviews')
const PAGE_SIZES = [20, 50, 100]

/** 前端分页（接口一次返回全部）：换一批数据回到第 1 页 */
function usePager<T>(rows: { value: T[] }) {
  const page = ref(1)
  const size = ref(20)
  const paged = computed(() => rows.value.slice((page.value - 1) * size.value, page.value * size.value))
  return { page, size, paged }
}

// ---------------------------------------------------------------- 拦截记录（只读）：未成年、证件被占用、失信、核验不一致
const BLOCK_TYPES = ['UNDERAGE', 'ID_OCCUPIED', 'BLACKLISTED', 'VERIFY_FAILED', 'ID_MISMATCH']
const blockType = ref('')
const blocked = shallowRef<KycInterception[]>([])
const bkLoading = ref(false)
const bkError = ref('')
const bkOffline = ref(false)
const bkPager = usePager(blocked)
let blockedLoaded = false
async function loadBlocked() {
  bkLoading.value = true
  bkError.value = ''
  bkOffline.value = false
  try {
    blocked.value = await opsApi.kycInterceptions(blockType.value || undefined)
    blockedLoaded = true
  } catch (e) {
    bkError.value = errorMessage(e, '加载失败，请稍后重试')
    bkOffline.value = isNetwork(e)
    blocked.value = []
  } finally {
    bkLoading.value = false
    bkPager.page.value = 1
  }
}
function resetBlocked() {
  blockType.value = ''
  void loadBlocked()
}
function showBlocked() {
  tab.value = 'blocked'
  if (!blockedLoaded) void loadBlocked()
}

// ---------------------------------------------------------------- 复核队列
const rStatus = ref<ReviewStatus | ''>('PENDING')
const rType = ref<KycReviewType | ''>('')
const reviews = shallowRef<KycReviewRow[]>([])
const rLoading = ref(false)
const rError = ref('')
const rOffline = ref(false)
const rPager = usePager(reviews)
/** 后端拒绝过的通过 / 驳回：只置灰这一条的这个操作，原因用提醒色写在表格上方；查询、切页签、翻页都清掉 */
const rBlocked = reactive<Record<number, { act: 'approve' | 'reject'; text: string }>>({})
const clearRBlocked = () => Object.keys(rBlocked).forEach((k) => delete rBlocked[Number(k)])
async function loadReviews() {
  clearRBlocked()
  rLoading.value = true
  rError.value = ''
  rOffline.value = false
  try {
    reviews.value = await opsApi.kycReviews({ status: rStatus.value || undefined, type: rType.value || undefined })
  } catch (e) {
    rError.value = errorMessage(e, '加载失败，请稍后重试')
    rOffline.value = isNetwork(e)
    reviews.value = []
  } finally {
    rLoading.value = false
    rPager.page.value = 1
  }
}
function resetReviews() {
  rType.value = ''
  void loadReviews()
}
watch(rPager.page, clearRBlocked)
watch(rPager.size, clearRBlocked)
const statusTabs = computed(() => [...options('ReviewStatus'), { value: '', label: '全部' }])
function setRStatus(v: string) {
  rStatus.value = v as ReviewStatus | ''
  void loadReviews()
}

/** 身份证占用申诉：原账号还在报名 / 待确权 / 在岗流程中，通过会被系统拒绝，「通过」一开始就置灰并写原因 */
const occupantBusy = (r: KycReviewRow) => r.reviewType === 'ID_OCCUPIED_APPEAL' && r.occupant != null && !r.occupant.releasable
const isFraudRow = (r: KycReviewRow) => r.reviewType === 'FRAUD_SUSPECT'
const rowLabels = (r: KycReviewRow) => (isFraudRow(r) ? ['误报', '确认刷单'] : ['驳回', '通过'])
/** 审核按钮是带边框的小号按钮 */
const rOpsWidth = computed(() => actionsColWidth(rPager.paged.value.map((r) => ({ labels: r.status === 'PENDING' ? rowLabels(r) : [] })), 72, true))
const whoOf = (r: KycReviewRow) => `${label('KycReviewType', r.reviewType)} ${r.userId}`

const dec = reactive({ visible: false, row: null as KycReviewRow | null, approve: true, remark: '', error: '', why: '', loading: false })
function openDecide(r: KycReviewRow, approve: boolean) {
  Object.assign(dec, { visible: true, row: r, approve, remark: '', error: '', why: '', loading: false })
}
const approveHint = computed(() => {
  switch (dec.row?.reviewType) {
    case 'ID_OCCUPIED_APPEAL':
      return '通过后将解除原账号的实名绑定，身份证可由申诉人重新实名。'
    case 'BLACKLIST_APPEAL':
      return '通过后将解除该用户命中的全部有效黑名单记录。'
    case 'FRAUD_SUSPECT': {
      const names = fraudCompanies(dec.row)
      return names.length
        ? '确认后，涉事账号的引流公司（' + names.join('、') + '）各扣诚信分一次，证件持有人所在公司不扣。'
        : '涉事账号没有引流公司（自然注册），确认后只留痕，不扣分。'
    }
    default:
      return '通过后该用户的实名认证视为有效。'
  }
})
const isFraud = computed(() => dec.row != null && isFraudRow(dec.row))
const decAction = computed(() => (isFraud.value ? (dec.approve ? '确认刷单并扣分' : '标记误报') : dec.approve ? '通过' : '驳回'))
function fraudCompanies(r: KycReviewRow): string[] {
  return [...new Set((r.accounts ?? []).filter((a) => !a.holder && a.sourceCompanyName).map((a) => a.sourceCompanyName as string))]
}
function editDecide() {
  dec.error = ''
}
async function submitDecide() {
  const row = dec.row
  if (!row || dec.loading) return
  const remark = dec.remark.trim()
  if (!remark) {
    dec.error = '请填写处理意见'
    return
  }
  dec.loading = true
  try {
    await opsApi.kycDecide(row.id, dec.approve, remark)
    ElMessage.success(isFraud.value ? (dec.approve ? '已确认刷单并扣分' : '已标记为误报') : dec.approve ? '申诉已通过' : '申诉已驳回')
    dec.visible = false
    await loadReviews()
    if (row.reviewType === 'BLACKLIST_APPEAL') void loadBlacklist()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    // 后端业务拒绝：原因留在弹窗里、确认置灰，表格里这一条的这个操作也置灰；断网只提示，可以直接再点
    if (isBlocked(e)) {
      dec.why = `暂时不能${decAction.value}：${errorMessage(e)}`
      rBlocked[row.id] = { act: dec.approve ? 'approve' : 'reject', text: `${whoOf(row)}：${dec.why}` }
    }
  } finally {
    dec.loading = false
  }
}

// ---------------------------------------------------------------- 黑名单
const bStatus = ref<'ACTIVE' | 'LIFTED' | ''>('ACTIVE')
const blacklist = shallowRef<BlacklistRow[]>([])
const bLoading = ref(false)
const bError = ref('')
const bOffline = ref(false)
const bPager = usePager(blacklist)
/** 解除被后端拒绝的记录：只置灰这一条的「解除」，切页签、翻页、重新加载都清掉 */
const liftBlocked = reactive<Record<number, string>>({})
const clearLiftBlocked = () => Object.keys(liftBlocked).forEach((k) => delete liftBlocked[Number(k)])
async function loadBlacklist() {
  clearLiftBlocked()
  bLoading.value = true
  bError.value = ''
  bOffline.value = false
  try {
    blacklist.value = await opsApi.blacklist(bStatus.value || undefined)
  } catch (e) {
    bError.value = errorMessage(e, '加载失败，请稍后重试')
    bOffline.value = isNetwork(e)
    blacklist.value = []
  } finally {
    bLoading.value = false
    bPager.page.value = 1
  }
}
watch(bPager.page, clearLiftBlocked)
watch(bPager.size, clearLiftBlocked)
const bTabs = [
  { value: 'ACTIVE', label: '生效中' },
  { value: 'LIFTED', label: '已解除' },
  { value: '', label: '全部' },
] as const
function setBStatus(v: (typeof bTabs)[number]['value']) {
  bStatus.value = v
  void loadBlacklist()
}
const bOpsWidth = computed(() => actionsColWidth(bPager.paged.value.map((r) => ({ labels: r.status === 'ACTIVE' ? ['解除'] : [] })), 72))

const add = reactive({ visible: false, userId: '', reasonCode: '', detail: '', error: '', why: '', loading: false })
function openAdd() {
  Object.assign(add, { visible: true, userId: '', reasonCode: '', detail: '', error: '', why: '', loading: false })
}
function editAdd() {
  add.error = ''
  add.why = ''
}
async function submitAdd() {
  if (add.loading) return
  if (!add.userId.trim()) return void (add.error = '请填写用户 ID')
  if (!add.reasonCode) return void (add.error = '请选择拉黑原因')
  if (!add.detail.trim()) return void (add.error = '请填写事实说明')
  add.loading = true
  try {
    await opsApi.blacklistAdd(add.userId.trim(), add.reasonCode, add.detail.trim())
    ElMessage.success('已加入平台黑名单')
    add.visible = false
    await loadBlacklist()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    // 被拒原因留在弹窗里、「确认拉黑」置灰，改了内容再放开；断网只提示
    if (isBlocked(e)) add.why = `暂时不能拉黑：${errorMessage(e)}`
  } finally {
    add.loading = false
  }
}

async function lift(r: BlacklistRow) {
  const ok = await remarkInBox({
    title: '解除黑名单',
    text: `解除用户 ${r.userId}（${label('BlacklistReason', r.reasonCode)}）的平台黑名单记录。`,
    action: '解除',
    required: true,
    placeholder: '解除原因（必填，记录审计日志）',
    api: (remark) => opsApi.blacklistLift(r.id, remark),
    onBlocked: (text) => (liftBlocked[r.id] = `黑名单 #${r.id}（${r.userId}）：${text}`),
  })
  if (!ok) return
  ElMessage.success('已解除')
  await loadBlacklist()
}

function toAttribution(userId: string) {
  void router.push({ path: '/ops/attribution', query: { userId } })
}

onMounted(() => {
  void loadReviews()
  void loadBlacklist()
})
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>实名与合规</h2>
        <p>实名拦截后的人工复核（身份证被占用申诉、失信申诉、疑似刷单注册）与平台黑名单 · 对外只显示「平台级失信」，不暴露具体原因</p>
      </div>
      <div class="spacer" />
      <el-button v-if="tab === 'blacklist'" type="primary" @click="openAdd">拉黑用户</el-button>
    </div>

    <div class="filter-tabs main-tabs">
      <button type="button" :class="{ on: tab === 'reviews' }" @click="tab = 'reviews'">人工复核队列</button>
      <button type="button" :class="{ on: tab === 'blacklist' }" @click="tab = 'blacklist'">平台黑名单</button>
      <button type="button" :class="{ on: tab === 'blocked' }" @click="showBlocked">拦截记录</button>
    </div>

    <!-- 复核队列 -->
    <div v-show="tab === 'reviews'" class="card tbl-card reviews">
      <div class="card__hd"><h3>人工复核队列</h3><span class="t-xs">点行首箭头展开材料，核实后在右侧处理</span></div>
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in statusTabs" :key="t.value" type="button" :class="{ on: rStatus === t.value }" @click="setRStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <!-- 「全部类型」是真实选项（空串不当成没选），显示成正文文字色，不是占位灰 -->
        <el-select v-model="rType" :empty-values="[null, undefined]" style="width: 180px" @change="loadReviews">
          <el-option value="" label="全部类型" />
          <el-option v-for="o in options('KycReviewType')" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button @click="loadReviews">查询</el-button>
        <el-button @click="resetReviews">重置</el-button>
      </div>
      <p v-for="(b, id) in rBlocked" :key="id" class="blocked-why tbl-tip" role="status">{{ b.text }}</p>
      <el-table v-loading="rLoading" :data="rPager.paged.value" class="ops-table tbl-48" row-key="id">
        <el-table-column type="expand" width="36">
          <template #default="{ row }">
            <div class="expand">
              <div v-if="row.reviewType === 'ID_OCCUPIED_APPEAL'">
                <div class="blk-t">身份证当前占用账号</div>
                <template v-if="row.occupant">
                  <dl class="desc-list">
                    <div><dt>账号</dt><dd class="tnum">{{ row.occupant.userId }} · {{ row.occupant.phoneMasked }}</dd></div>
                    <div><dt>状态</dt><dd>{{ label('UserStatus', row.occupant.userStatus) }}</dd></div>
                    <div><dt>注册时间</dt><dd class="tnum">{{ fmtDateTime(row.occupant.registeredAt) }}</dd></div>
                    <div><dt>当前归属</dt><dd>{{ row.occupant.boundCompanyId ?? '公域' }}</dd></div>
                  </dl>
                  <div v-if="row.occupant.releasable" class="notice-bar notice-bar--ok gap"><IconInfo :size="16" class="notice-bar-i" />原账号不在报名 / 待确权 / 在岗流程中，可以解除实名。</div>
                  <div v-else class="notice-bar notice-bar--warn gap"><IconInfo :size="16" class="notice-bar-i" />原账号正处于报名 / 待确权 / 在岗流程中，现在通过申诉会被系统拒绝；请待其流程结束后再处理，或驳回并说明原因。</div>
                </template>
                <p v-else class="t-sm dim">身份证当前未被其他账号占用（可能已被释放）。</p>
              </div>
              <div v-else-if="row.reviewType === 'FRAUD_SUSPECT'">
                <div class="blk-t">24 小时内用同一证件提交实名的账号</div>
                <el-table :data="row.accounts ?? []" class="ops-table" row-key="userId">
                  <el-table-column label="账号" min-width="210">
                    <template #default="{ row: a }"><span class="tnum">{{ a.userId }} · {{ a.phoneMasked }}</span> <span v-if="a.holder" class="status-tag status-tag--success">证件持有人</span></template>
                  </el-table-column>
                  <el-table-column label="引流公司" min-width="200">
                    <template #default="{ row: a }">{{ a.sourceCompanyName ?? '自然注册' }}<span v-if="a.channelCode" class="t-xs"> · 渠道码 {{ a.channelCode }}</span></template>
                  </el-table-column>
                  <el-table-column label="注册时间" width="150"><template #default="{ row: a }"><span class="tnum">{{ fmtDateTime(a.registeredAt) }}</span></template></el-table-column>
                  <el-table-column label="提交次数" width="90" align="right"><template #default="{ row: a }"><span class="tnum">{{ a.attempts }}</span></template></el-table-column>
                  <el-table-column label="最近提交" width="150"><template #default="{ row: a }"><span class="tnum">{{ fmtDateTime(a.lastAt) }}</span></template></el-table-column>
                </el-table>
                <div class="notice-bar gap"><IconInfo :size="16" class="notice-bar-i" />确认刷单后，除证件持有人外，其余账号的引流公司各扣一次诚信分。同一个人换号重新注册也会进这里，核实后标记误报即可。</div>
              </div>
              <div v-else-if="row.reviewType === 'BLACKLIST_APPEAL'">
                <div class="blk-t">命中的黑名单记录</div>
                <p v-if="!row.blacklist || row.blacklist.length === 0" class="t-sm dim">当前无有效黑名单记录</p>
                <ul v-else class="tl">
                  <li v-for="b in row.blacklist" :key="b.id" class="fail">
                    <div class="tl-t">{{ label('BlacklistReason', b.reasonCode) }} <span class="dim">#{{ b.id }}</span></div>
                    <div class="tl-m">{{ fmtDateTime(b.createdAt) }}</div>
                    <div v-if="b.detail" class="tl-r">{{ b.detail }}</div>
                  </li>
                </ul>
              </div>
              <p v-if="row.reviewerRemark" class="t-sm rr"><b>处理意见：</b>{{ row.reviewerRemark }} <span class="t-xs">{{ row.reviewerId }} · {{ fmtDateTime(row.reviewedAt) }}</span></p>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="136"><template #default="{ row }"><span class="status-tag status-tag--info">{{ label('KycReviewType', row.reviewType) }}</span></template></el-table-column>
        <el-table-column label="账号" min-width="160">
          <template #default="{ row }">
            <span v-if="canAttribution" class="link-cell cell-one" @click="toAttribution(row.userId)">{{ row.userId }}</span>
            <span v-else class="strong cell-one">{{ row.userId }}</span>
            <div class="t-xs one">{{ row.phoneMasked }} · {{ label('UserStatus', row.userStatus) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申诉理由 / 触发原因" min-width="154"><template #default="{ row }"><div class="pre">{{ row.remark }}</div></template></el-table-column>
        <el-table-column label="关键信息" min-width="136">
          <template #default="{ row }">
            <template v-if="row.reviewType === 'ID_OCCUPIED_APPEAL'">
              <template v-if="row.occupant">
                <div class="t-sm">占用者 <span class="tnum">{{ row.occupant.phoneMasked }}</span></div>
                <span v-if="row.occupant.releasable" class="status-tag status-tag--success">可解除</span>
                <p v-else-if="row.status === 'PENDING'" class="why-off">原账号在流程中，暂时不能通过</p>
                <span v-else class="status-tag status-tag--warning">流程中</span>
              </template>
              <span v-else class="dim t-sm">未被占用</span>
            </template>
            <template v-else-if="row.reviewType === 'BLACKLIST_APPEAL'">
              <span class="tags"><span v-for="b in row.blacklist ?? []" :key="b.id" class="status-tag status-tag--danger">{{ label('BlacklistReason', b.reasonCode) }}</span></span>
              <span v-if="!row.blacklist?.length" class="dim t-sm">无有效记录</span>
            </template>
            <template v-else-if="row.reviewType === 'FRAUD_SUSPECT'">
              <div class="t-sm">涉及 <b class="tnum">{{ row.accounts?.length ?? 0 }}</b> 个手机号</div>
              <div class="t-xs">{{ fraudCompanies(row).join('、') || '无引流公司' }}</div>
            </template>
            <span v-else class="dim t-sm">—</span>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="146"><template #default="{ row }"><span class="tnum one">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column label="状态" width="84"><template #default="{ row }"><StatusTag type="ReviewStatus" :value="row.status" /></template></el-table-column>
        <el-table-column label="操作" :width="rOpsWidth" class-name="ops-col">
          <template #default="{ row }">
            <template v-if="row.status === 'PENDING'">
              <el-button size="small" type="danger" plain class="btn-reject" :disabled="rBlocked[row.id]?.act === 'reject'" @click="openDecide(row, false)">{{ rowLabels(row)[0] }}</el-button>
              <el-button size="small" type="primary" :disabled="occupantBusy(row) || rBlocked[row.id]?.act === 'approve'" @click="openDecide(row, true)">{{ rowLabels(row)[1] }}</el-button>
            </template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="rLoading" class="tbl-wait" />
          <div v-else-if="rError" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>复核队列加载失败</h4>
            <p>{{ rOffline ? '请检查网络后重新加载' : rError }}</p>
            <el-button type="primary" @click="loadReviews">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ rType ? '没有这类复核记录' : rStatus === 'PENDING' ? '暂无待处理的复核' : '暂无复核记录' }}</h4>
            <p>{{ rType ? '换个类型再查，或点「重置」' : rStatus === 'PENDING' ? '求职者提交身份证被占用、失信申诉，或系统发现疑似刷单注册时会出现在这里' : '切换上方页签查看其他状态的记录' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="reviews.length" class="pager">
        <el-pagination v-model:current-page="rPager.page.value" v-model:page-size="rPager.size.value" :total="reviews.length" :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <!-- 拦截记录 -->
    <div v-show="tab === 'blocked'" class="card tbl-card intercepts">
      <div class="card__hd"><h3>拦截记录</h3><span class="t-xs">最近 300 条实名被拦截的记录，只读</span></div>
      <div class="toolbar">
        <el-select v-model="blockType" :empty-values="[null, undefined]" style="width: 180px" @change="loadBlocked">
          <el-option value="" label="全部类型" />
          <el-option v-for="t in BLOCK_TYPES" :key="t" :label="label('KycResult', t)" :value="t" />
        </el-select>
        <div class="spacer" />
        <el-button @click="loadBlocked">查询</el-button>
        <el-button @click="resetBlocked">重置</el-button>
      </div>
      <el-table v-loading="bkLoading" :data="bkPager.paged.value" class="ops-table tbl-48" row-key="id">
        <el-table-column label="时间" width="150"><template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column label="拦截原因" width="170">
          <template #default="{ row }"><span class="status-tag" :class="row.result === 'UNDERAGE' || row.result === 'BLACKLISTED' ? 'status-tag--danger' : 'status-tag--warning'">{{ label('KycResult', row.result) }}</span></template>
        </el-table-column>
        <el-table-column label="账号" min-width="190">
          <template #default="{ row }">
            <span v-if="canAttribution" class="link-cell cell-one" @click="toAttribution(row.userId)">{{ row.userId }}</span>
            <span v-else class="strong cell-one">{{ row.userId }}</span>
            <div class="t-xs">{{ row.phoneMasked }} · {{ label('KycStatus', row.kycStatus) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="引流公司" min-width="180"><template #default="{ row }">{{ row.sourceCompanyName ?? '自然注册' }}</template></el-table-column>
        <el-table-column label="出生日期" width="120"><template #default="{ row }"><span class="tnum">{{ row.birthDate ?? '—' }}</span></template></el-table-column>
        <el-table-column label="IP" width="140"><template #default="{ row }"><span class="tnum">{{ row.ip ?? '—' }}</span></template></el-table-column>
        <template #empty>
          <div v-if="bkLoading" class="tbl-wait" />
          <div v-else-if="bkError" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>拦截记录加载失败</h4>
            <p>{{ bkOffline ? '请检查网络后重新加载' : bkError }}</p>
            <el-button type="primary" @click="loadBlocked">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ blockType ? '没有这类拦截记录' : '暂无拦截记录' }}</h4>
            <p>{{ blockType ? '换个类型再查，或点「重置」' : '求职者实名时被未成年、证件占用、失信、核验不一致拦下会记在这里' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="blocked.length" class="pager">
        <el-pagination v-model:current-page="bkPager.page.value" v-model:page-size="bkPager.size.value" :total="blocked.length" :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <!-- 黑名单 -->
    <div v-show="tab === 'blacklist'" class="card tbl-card blacklist">
      <div class="card__hd"><h3>平台黑名单</h3><span class="t-xs">拉黑同时记录身份证，换号实名也会命中</span></div>
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in bTabs" :key="t.value" type="button" :class="{ on: bStatus === t.value }" @click="setBStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <el-button :loading="bLoading" @click="loadBlacklist">刷新</el-button>
      </div>
      <p v-for="(why, id) in liftBlocked" :key="id" class="blocked-why tbl-tip" role="status">{{ why }}</p>
      <el-table v-loading="bLoading" :data="bPager.paged.value" class="ops-table tbl-48" row-key="id">
        <el-table-column label="#" width="70"><template #default="{ row }"><span class="tnum dim">{{ row.id }}</span></template></el-table-column>
        <el-table-column label="用户" min-width="160">
          <template #default="{ row }">
            <span v-if="canAttribution" class="link-cell cell-one" @click="toAttribution(row.userId)">{{ row.userId }}</span>
            <span v-else class="strong cell-one">{{ row.userId }}</span>
            <div class="t-xs">{{ row.phoneMasked ?? '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="原因" width="130"><template #default="{ row }"><span class="status-tag status-tag--danger">{{ label('BlacklistReason', row.reasonCode) }}</span></template></el-table-column>
        <el-table-column label="事实说明" min-width="240"><template #default="{ row }"><div class="pre">{{ row.detail }}</div></template></el-table-column>
        <el-table-column label="拉黑" width="150">
          <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span><div class="t-xs">{{ fmtOperator(row.createdBy) }}</div></template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <span v-if="row.status === 'ACTIVE'" class="status-tag status-tag--danger">生效中</span>
            <template v-else><span class="status-tag">已解除</span><div class="t-xs">{{ fmtDateTime(row.liftedAt) }}</div></template>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="bOpsWidth" class-name="ops-col">
          <template #default="{ row }">
            <el-button v-if="row.status === 'ACTIVE'" link type="primary" size="small" :disabled="!!liftBlocked[row.id]" @click="lift(row)">解除</el-button>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="bLoading" class="tbl-wait" />
          <div v-else-if="bError" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>黑名单加载失败</h4>
            <p>{{ bOffline ? '请检查网络后重新加载' : bError }}</p>
            <el-button type="primary" @click="loadBlacklist">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ bStatus === 'ACTIVE' ? '暂无生效中的黑名单' : '暂无黑名单记录' }}</h4>
            <p>{{ bStatus === 'ACTIVE' ? '核实到严重失信行为时，点右上角「拉黑用户」加入' : '切换上方页签查看其他状态的记录' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="blacklist.length" class="pager">
        <el-pagination v-model:current-page="bPager.page.value" v-model:page-size="bPager.size.value" :total="blacklist.length" :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <el-dialog v-model="dec.visible" :title="isFraud ? (dec.approve ? '确认刷单' : '标记为误报') : dec.approve ? '通过申诉' : '驳回申诉'" width="520px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <template v-if="dec.row">
        <dl class="desc-list">
          <div><dt>类型</dt><dd>{{ label('KycReviewType', dec.row.reviewType) }}</dd></div>
          <div><dt>{{ isFraud ? '触发账号' : '申诉人' }}</dt><dd class="tnum">{{ dec.row.userId }} · {{ dec.row.phoneMasked }}</dd></div>
          <div class="full"><dt>{{ isFraud ? '触发原因' : '申诉理由' }}</dt><dd class="pre">{{ dec.row.remark }}</dd></div>
        </dl>
        <div v-if="dec.approve" class="notice-bar notice-bar--warn gap"><IconInfo :size="16" class="notice-bar-i" />{{ approveHint }}</div>
        <el-input v-model="dec.remark" type="textarea" :rows="3" maxlength="500" show-word-limit class="gap" :placeholder="isFraud ? '处理意见（必填，记入企业诚信记录）' : '处理意见（必填，将通知申诉人）'" @input="editDecide" />
        <p v-if="dec.error" class="form-err gap" role="alert">{{ dec.error }}</p>
        <p v-if="dec.why" class="blocked-why gap" role="alert">{{ dec.why }}</p>
      </template>
      <template #footer>
        <el-button @click="dec.visible = false">取消</el-button>
        <el-button v-if="dec.approve" type="primary" class="btn-steady" :loading="dec.loading" :disabled="!!dec.why" @click="submitDecide">{{ decAction }}</el-button>
        <el-button v-else type="danger" plain class="btn-reject btn-steady" :loading="dec.loading" :disabled="!!dec.why" @click="submitDecide">{{ decAction }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="add.visible" title="拉黑用户" width="480px" class="dlg-16" destroy-on-close :close-on-click-modal="false">
      <div class="notice-bar notice-bar--warn add-tip"><IconInfo :size="16" class="notice-bar-i" />拉黑同时记录该用户的身份证（如已实名），换号实名也会命中；对外只显示「平台级失信」。</div>
      <el-form label-width="88px" @submit.prevent>
        <el-form-item label="用户 ID" required><el-input v-model="add.userId" placeholder="如 U10001" @input="editAdd" /></el-form-item>
        <el-form-item label="原因" required>
          <el-select v-model="add.reasonCode" placeholder="选择原因" style="width: 100%" @change="editAdd">
            <el-option v-for="o in options('BlacklistReason')" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="事实说明" required>
          <el-input v-model="add.detail" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="具体事实与证据（内部可见）" @input="editAdd" />
        </el-form-item>
      </el-form>
      <p v-if="add.error" class="form-err" role="alert">{{ add.error }}</p>
      <p v-if="add.why" class="blocked-why" role="alert">{{ add.why }}</p>
      <template #footer>
        <el-button @click="add.visible = false">取消</el-button>
        <el-button type="danger" plain class="btn-reject btn-steady" :loading="add.loading" :disabled="!!add.why" @click="submitAdd">确认拉黑</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.main-tabs { margin-bottom: var(--space-3); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.tbl-wait { height: 160px; }
.expand { padding: var(--space-2) var(--space-5) var(--space-3) calc(var(--space-8) + var(--space-5)); }
.gap { margin-top: var(--space-3); }
.add-tip { margin-bottom: var(--space-4); }
.pre { white-space: pre-wrap; color: var(--text-1); }
/* 时间、账号状态这类短行不折行 */
.one { white-space: nowrap; }
.rr { margin: var(--space-3) 0 0; color: var(--text-2); }
/* 本来就不能做的「通过」：原因用提醒文字色写在这一行 */
.why-off { margin: var(--space-1) 0 0; font-size: var(--font-size-min); line-height: 1.5; color: var(--warning-text); }
</style>
