<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type BlacklistRow, type KycReviewRow, type KycReviewType, type ReviewStatus } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
import { promptRemark } from '@/composables/useRemark'
import { ATTRIBUTION_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDateTime } from '@/utils/format'

/** P-14 实名与合规：人工复核队列（身份证占用申诉 / 失信申诉 / 低置信度 / 疑似冒用）+ 平台黑名单 */
const router = useRouter()
const auth = useAuthStore()
const canAttribution = computed(() => auth.hasAnyRole(ATTRIBUTION_ROLES))
const { label, options } = useDict()
const tab = ref<'reviews' | 'blacklist'>('reviews')

// ---------------------------------------------------------------- 复核队列
const rStatus = ref<ReviewStatus | ''>('PENDING')
const rType = ref<KycReviewType | ''>('')
const reviews = shallowRef<KycReviewRow[]>([])
const rLoading = ref(false)
const rError = ref('')
async function loadReviews() {
  rLoading.value = true
  rError.value = ''
  try {
    reviews.value = await opsApi.kycReviews({ status: rStatus.value || undefined, type: rType.value || undefined })
  } catch (e) {
    rError.value = errorMessage(e, '加载失败，请稍后重试')
    reviews.value = []
  } finally {
    rLoading.value = false
  }
}
const statusTabs = computed(() => [...options('ReviewStatus'), { value: '', label: '全部' }])
function setRStatus(v: string) {
  rStatus.value = v as ReviewStatus | ''
  void loadReviews()
}

const dec = reactive({ visible: false, row: null as KycReviewRow | null, approve: true, remark: '', error: '', loading: false })
function openDecide(r: KycReviewRow, approve: boolean) {
  Object.assign(dec, { visible: true, row: r, approve, remark: '', error: '' })
}
const blockedApprove = computed(() => dec.approve && dec.row?.reviewType === 'ID_OCCUPIED_APPEAL' && dec.row.occupant != null && !dec.row.occupant.releasable)
const approveHint = computed(() => {
  switch (dec.row?.reviewType) {
    case 'ID_OCCUPIED_APPEAL':
      return '通过后将解除原账号的实名绑定，身份证可由申诉人重新实名。'
    case 'BLACKLIST_APPEAL':
      return '通过后将解除该用户命中的全部有效黑名单记录。'
    default:
      return '通过后该用户的实名认证视为有效。'
  }
})
async function submitDecide() {
  if (!dec.row) return
  const remark = dec.remark.trim()
  if (!remark) {
    dec.error = '请填写处理意见'
    return
  }
  dec.loading = true
  try {
    await opsApi.kycDecide(dec.row.id, dec.approve, remark)
    ElMessage.success(dec.approve ? '申诉已通过' : '申诉已驳回')
    dec.visible = false
    await loadReviews()
    if (dec.row.reviewType === 'BLACKLIST_APPEAL') void loadBlacklist()
  } catch (e) {
    dec.error = errorMessage(e)
  } finally {
    dec.loading = false
  }
}

// ---------------------------------------------------------------- 黑名单
const bStatus = ref<'ACTIVE' | 'LIFTED' | ''>('ACTIVE')
const blacklist = shallowRef<BlacklistRow[]>([])
const bLoading = ref(false)
const bError = ref('')
async function loadBlacklist() {
  bLoading.value = true
  bError.value = ''
  try {
    blacklist.value = await opsApi.blacklist(bStatus.value || undefined)
  } catch (e) {
    bError.value = errorMessage(e, '加载失败，请稍后重试')
    blacklist.value = []
  } finally {
    bLoading.value = false
  }
}
const bTabs = [
  { value: 'ACTIVE', label: '生效中' },
  { value: 'LIFTED', label: '已解除' },
  { value: '', label: '全部' },
] as const
function setBStatus(v: (typeof bTabs)[number]['value']) {
  bStatus.value = v
  void loadBlacklist()
}

const add = reactive({ visible: false, userId: '', reasonCode: '', detail: '', error: '', loading: false })
function openAdd() {
  Object.assign(add, { visible: true, userId: '', reasonCode: '', detail: '', error: '' })
}
async function submitAdd() {
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
    add.error = errorMessage(e)
  } finally {
    add.loading = false
  }
}

async function lift(r: BlacklistRow) {
  const remark = await promptRemark({
    title: '解除黑名单',
    message: `解除用户 ${r.userId}（${label('BlacklistReason', r.reasonCode)}）的平台黑名单记录。`,
    required: true,
    placeholder: '解除原因（必填，记录审计日志）',
    confirmText: '解除',
  })
  if (remark == null) return
  try {
    await opsApi.blacklistLift(r.id, remark)
    ElMessage.success('已解除')
    await loadBlacklist()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
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
        <p>实名拦截后的人工复核（身份证被占用申诉、失信申诉）与平台黑名单 · 对外只显示「平台级失信」，不暴露具体原因</p>
      </div>
      <div class="spacer" />
      <span class="ref">原型 <b>P-14</b></span>
      <el-button v-if="tab === 'blacklist'" type="danger" plain @click="openAdd">拉黑用户</el-button>
    </div>

    <div class="filter-tabs main-tabs">
      <button type="button" :class="{ on: tab === 'reviews' }" @click="tab = 'reviews'">人工复核队列</button>
      <button type="button" :class="{ on: tab === 'blacklist' }" @click="tab = 'blacklist'">平台黑名单</button>
    </div>

    <!-- 复核队列 -->
    <div v-show="tab === 'reviews'" class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in statusTabs" :key="t.value" type="button" :class="{ on: rStatus === t.value }" @click="setRStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <el-select v-model="rType" clearable placeholder="全部类型" style="width: 180px" @change="loadReviews">
          <el-option v-for="o in options('KycReviewType')" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button @click="loadReviews">刷新</el-button>
      </div>
      <el-table v-loading="rLoading" :data="reviews" class="ops-table" row-key="id">
        <el-table-column type="expand" width="36">
          <template #default="{ row }">
            <div class="expand">
              <div v-if="row.reviewType === 'ID_OCCUPIED_APPEAL'">
                <div class="sec-title">身份证当前占用账号</div>
                <template v-if="row.occupant">
                  <dl class="kv-grid">
                    <div class="kv"><dt>账号</dt><dd class="mono">{{ row.occupant.userId }} · {{ row.occupant.phoneMasked }}</dd></div>
                    <div class="kv"><dt>状态</dt><dd>{{ label('UserStatus', row.occupant.userStatus) }}</dd></div>
                    <div class="kv"><dt>注册时间</dt><dd class="mono">{{ fmtDateTime(row.occupant.registeredAt) }}</dd></div>
                    <div class="kv"><dt>当前归属</dt><dd class="mono">{{ row.occupant.boundCompanyId ?? '公域' }}</dd></div>
                  </dl>
                  <div v-if="row.occupant.releasable" class="notice notice--ok note">原账号不在报名 / 待确权 / 在岗流程中，可以解除实名。</div>
                  <div v-else class="notice notice--danger note">原账号正处于报名 / 待确权 / 在岗流程中，<b>现在通过申诉会被系统拒绝</b>；请待其流程结束后再处理，或驳回并说明原因。</div>
                </template>
                <div v-else class="t-xs">身份证当前未被其他账号占用（可能已被释放）。</div>
              </div>
              <div v-else-if="row.reviewType === 'BLACKLIST_APPEAL'">
                <div class="sec-title">命中的黑名单记录</div>
                <el-empty v-if="!row.blacklist || row.blacklist.length === 0" :image-size="40" description="当前无有效黑名单记录" />
                <ul v-else class="tl">
                  <li v-for="b in row.blacklist" :key="b.id" class="fail">
                    <div class="tl-t">{{ label('BlacklistReason', b.reasonCode) }} <span class="mono dim">#{{ b.id }}</span></div>
                    <div class="tl-m">{{ fmtDateTime(b.createdAt) }}</div>
                    <div v-if="b.detail" class="tl-r">{{ b.detail }}</div>
                  </li>
                </ul>
              </div>
              <div v-if="row.reviewerRemark" class="t-sm rr"><b>处理意见：</b>{{ row.reviewerRemark }} <span class="t-xs mono">{{ row.reviewerId }} · {{ fmtDateTime(row.reviewedAt) }}</span></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="150"><template #default="{ row }"><span class="tag tag--info">{{ label('KycReviewType', row.reviewType) }}</span></template></el-table-column>
        <el-table-column label="申诉人" min-width="170">
          <template #default="{ row }">
            <span v-if="canAttribution" class="link-cell mono" @click="toAttribution(row.userId)">{{ row.userId }}</span>
            <span v-else class="mono strong">{{ row.userId }}</span>
            <div class="t-xs mono">{{ row.phoneMasked }} · {{ label('UserStatus', row.userStatus) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申诉理由" min-width="240"><template #default="{ row }"><div class="t-sm pre">{{ row.remark }}</div></template></el-table-column>
        <el-table-column label="关键信息" min-width="190">
          <template #default="{ row }">
            <template v-if="row.reviewType === 'ID_OCCUPIED_APPEAL'">
              <template v-if="row.occupant">
                <div class="t-sm">占用者 <span class="mono">{{ row.occupant.phoneMasked }}</span></div>
                <span v-if="row.occupant.releasable" class="tag tag--ok">可解除</span>
                <span v-else class="tag tag--danger">流程中 · 不可解除</span>
              </template>
              <span v-else class="dim t-sm">未被占用</span>
            </template>
            <template v-else-if="row.reviewType === 'BLACKLIST_APPEAL'">
              <span class="tags"><span v-for="b in row.blacklist ?? []" :key="b.id" class="tag tag--danger">{{ label('BlacklistReason', b.reasonCode) }}</span></span>
              <span v-if="!row.blacklist?.length" class="dim t-sm">无有效记录</span>
            </template>
            <span v-else class="dim t-sm">—</span>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="140"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column label="状态 / 操作" width="170" align="right" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'PENDING'">
              <el-button size="small" type="danger" plain @click="openDecide(row, false)">驳回</el-button>
              <el-button size="small" type="primary" @click="openDecide(row, true)">通过</el-button>
            </template>
            <StatusTag v-else type="ReviewStatus" :value="row.status" />
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="rError" :image-size="64" :description="rError"><el-button size="small" @click="loadReviews">重试</el-button></el-empty>
          <el-empty v-else :image-size="64" :description="rStatus === 'PENDING' ? '暂无待处理的申诉' : '暂无数据'" />
        </template>
      </el-table>
    </div>

    <!-- 黑名单 -->
    <div v-show="tab === 'blacklist'" class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in bTabs" :key="t.value" type="button" :class="{ on: bStatus === t.value }" @click="setBStatus(t.value)">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <el-button @click="loadBlacklist">刷新</el-button>
      </div>
      <el-table v-loading="bLoading" :data="blacklist" class="ops-table" row-key="id">
        <el-table-column label="#" width="70"><template #default="{ row }"><span class="mono dim">{{ row.id }}</span></template></el-table-column>
        <el-table-column label="用户" min-width="160">
          <template #default="{ row }">
            <span v-if="canAttribution" class="link-cell mono" @click="toAttribution(row.userId)">{{ row.userId }}</span>
            <span v-else class="mono strong">{{ row.userId }}</span>
            <div class="t-xs mono">{{ row.phoneMasked ?? '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="原因" width="130"><template #default="{ row }"><span class="tag tag--danger">{{ label('BlacklistReason', row.reasonCode) }}</span></template></el-table-column>
        <el-table-column label="事实说明" min-width="240"><template #default="{ row }"><div class="t-sm pre">{{ row.detail }}</div></template></el-table-column>
        <el-table-column label="拉黑" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span><div class="t-xs mono">{{ row.createdBy ?? '系统' }}</div></template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <span v-if="row.status === 'ACTIVE'" class="tag tag--danger">生效中</span>
            <template v-else><span class="tag">已解除</span><div class="t-xs mono">{{ fmtDateTime(row.liftedAt) }}</div></template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="right" fixed="right">
          <template #default="{ row }"><el-button v-if="row.status === 'ACTIVE'" size="small" @click="lift(row)">解除</el-button></template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="bError" :image-size="64" :description="bError"><el-button size="small" @click="loadBlacklist">重试</el-button></el-empty>
          <el-empty v-else :image-size="64" description="暂无黑名单记录" />
        </template>
      </el-table>
    </div>

    <el-dialog v-model="dec.visible" :title="dec.approve ? '通过申诉' : '驳回申诉'" width="500px" destroy-on-close :close-on-click-modal="false">
      <template v-if="dec.row">
        <dl class="kv-grid one">
          <div class="kv"><dt>类型</dt><dd>{{ label('KycReviewType', dec.row.reviewType) }}</dd></div>
          <div class="kv"><dt>申诉人</dt><dd class="mono">{{ dec.row.userId }} · {{ dec.row.phoneMasked }}</dd></div>
          <div class="kv block"><dt>申诉理由</dt><dd>{{ dec.row.remark }}</dd></div>
        </dl>
        <div v-if="blockedApprove" class="notice notice--danger gap">
          身份证占用者 <span class="mono">{{ dec.row.occupant?.phoneMasked }}</span> 当前处于「{{ label('UserStatus', dec.row.occupant?.userStatus) }}」，正处于报名 / 待确权 / 在岗流程中，通过申诉会被系统拒绝。
        </div>
        <div v-else-if="dec.approve" class="notice notice--warn gap">{{ approveHint }}</div>
        <el-input v-model="dec.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="处理意见（必填，将通知申诉人）" @input="dec.error = ''" />
        <div v-if="dec.error" class="notice notice--danger err">{{ dec.error }}</div>
      </template>
      <template #footer>
        <el-button @click="dec.visible = false">取消</el-button>
        <el-button :type="dec.approve ? 'primary' : 'danger'" :loading="dec.loading" @click="submitDecide">{{ dec.approve ? '通过' : '驳回' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="add.visible" title="拉黑用户" width="480px" destroy-on-close :close-on-click-modal="false">
      <div class="notice notice--warn gap">拉黑同时记录该用户的身份证（如已实名），换号实名也会命中；对外只显示「平台级失信」。</div>
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="用户 ID" required><el-input v-model="add.userId" placeholder="如 U10001" @input="add.error = ''" /></el-form-item>
        <el-form-item label="原因" required>
          <el-select v-model="add.reasonCode" placeholder="选择原因" style="width: 100%" @change="add.error = ''">
            <el-option v-for="o in options('BlacklistReason')" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="事实说明" required>
          <el-input v-model="add.detail" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="具体事实与证据（内部可见）" @input="add.error = ''" />
        </el-form-item>
      </el-form>
      <div v-if="add.error" class="notice notice--danger">{{ add.error }}</div>
      <template #footer>
        <el-button @click="add.visible = false">取消</el-button>
        <el-button type="danger" :loading="add.loading" @click="submitAdd">确认拉黑</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.main-tabs { margin-bottom: 12px; }
.expand { padding: 4px 20px 12px 52px; }
.note { margin-top: 10px; }
.pre { white-space: pre-wrap; color: var(--ink-800); }
.rr { margin-top: 10px; color: var(--ink-700); }
.gap { margin: 12px 0; }
.err { margin-top: 10px; }
</style>
