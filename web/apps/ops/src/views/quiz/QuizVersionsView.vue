<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type QuizFunnel, type QuizView } from '@shitu/api-client'
import { IconChartColumn, IconClipboardList, IconInbox, IconListFilter, IconPlus, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { confirmInBox, isNetwork } from '@/composables/boxSubmit'
import { QUIZ_PUBLISH_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'
import { MAX_QUESTIONS, QUIZ_STATUS, fieldLabel } from './quizMeta'

/** P-12 AI 问薪题库：版本列表、新建草稿（复制生效版本）、发布 / 回滚（仅超管） */
const router = useRouter()
const auth = useAuthStore()
const canPublish = computed(() => auth.hasAnyRole(QUIZ_PUBLISH_ROLES))

const rows = shallowRef<QuizView[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const offline = ref(false)
const creating = ref(false)
/** 发布 / 回滚被后端拒绝的版本：只置灰这一条的那个操作，原因留在表格上方 */
const blocked = ref<Record<number, string>>({})

async function load() {
  loading.value = true
  error.value = ''
  offline.value = false
  try {
    rows.value = await opsApi.quizVersions()
    loaded.value = true
    blocked.value = {}
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    offline.value = isNetwork(e)
    rows.value = []
    loaded.value = false
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 前端分页：接口一次返回全部版本
const page = ref(1)
const pageSize = ref(10)
const paged = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

/**
 * 答题漏斗：打开答题页 → 提交答案 → 匹配到岗位 → 报名，四步都是按人去重的人数。和版本列表是两个独立区块，各自加载、各自重新加载。
 * 「打开答题页」来自单独的打开记录，后三步来自匹配会话，两者不是同一批人的逐级筛选：
 * 打开记录不完整时会出现「提交人数 > 打开人数」，此时不计算转化率，并明确提示原因。
 */
const funnelDays = ref(7)
const funnel = ref<QuizFunnel | null>(null)
const funnelLoading = ref(false)
const funnelError = ref('')
const funnelOffline = ref(false)
async function loadFunnel() {
  funnelLoading.value = true
  funnelError.value = ''
  funnelOffline.value = false
  // 切换时间范围：加载中不显示上一个范围的数字
  funnel.value = null
  try {
    funnel.value = await opsApi.quizFunnel(funnelDays.value)
  } catch (e) {
    funnelError.value = errorMessage(e, '漏斗数据加载失败')
    funnelOffline.value = isNetwork(e)
  } finally {
    funnelLoading.value = false
  }
}
onMounted(loadFunnel)
const funnelEmpty = computed(() => !!funnel.value && funnel.value.opened === 0 && funnel.value.submitted === 0)
const funnelSteps = computed(() => {
  const f = funnel.value
  if (!f) return []
  const steps = [
    { label: '打开答题页', n: f.opened },
    { label: '提交答案', n: f.submitted },
    { label: '匹配到岗位', n: f.matched },
    { label: '报名', n: f.applied },
  ]
  const top = Math.max(...steps.map((s) => s.n), 1)
  return steps.map((s, i) => {
    const prev = i === 0 ? null : steps[i - 1].n
    // 超过上一步说明两步的统计来源不一致，不显示（也不截断成 100%）转化率
    const over = prev != null && s.n > prev
    return {
      ...s,
      width: s.n === 0 ? 0 : Math.max(2, Math.round((s.n / top) * 100)),
      over,
      rate: prev == null ? '' : over ? '高于上一步，不计转化率' : prev === 0 ? '' : `上一步的 ${Math.round((s.n / prev) * 100)}%`,
    }
  })
})
const funnelOver = computed(() => funnelSteps.value.some((s) => s.over))

const active = computed(() => rows.value.find((v) => v.status === 'ACTIVE') ?? null)
const draft = computed(() => rows.value.find((v) => v.status === 'DRAFT') ?? null)
const hardCount = (v: QuizView) => v.questions.filter((q) => q.matchRole === 'HARD_FILTER').length
const judgeCount = (v: QuizView) => v.questions.filter((q) => q.questionType === 'JUDGE').length

const actLabels = (v: QuizView) => [v.status === 'DRAFT' ? '编辑' : '查看', ...(canPublish.value && v.status === 'DRAFT' ? ['发布'] : []), ...(canPublish.value && v.status === 'ARCHIVED' ? ['回滚至此版本'] : [])]
const opsWidth = computed(() => actionsColWidth(rows.value.map((v) => ({ labels: actLabels(v) })), 80))

function open(v: QuizView) {
  void router.push(`/engine/quiz/${v.versionId}`)
}

async function createDraft() {
  if (draft.value) {
    open(draft.value)
    return
  }
  creating.value = true
  try {
    const d = await opsApi.createQuizDraft()
    ElMessage.success(`已从生效版本复制草稿「${d.name}」`)
    void router.push(`/engine/quiz/${d.versionId}`)
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

/** 发布 / 回滚：确认框里提交，确认按钮危险色描边（立即对全平台生效） */
async function publish(v: QuizView) {
  const rollback = v.status === 'ARCHIVED'
  const cur = active.value ? `当前生效版本「${active.value.name}」将被归档。` : ''
  const ok = await confirmInBox({
    title: rollback ? '回滚题库版本' : '发布题库版本',
    text: `${rollback ? '回滚至' : '发布'}「${v.name}」（${v.questions.length} 道题）后将立即影响全平台所有用户的问薪与匹配结果。${cur}确定继续？`,
    action: rollback ? '回滚' : '发布',
    danger: true,
    api: () => opsApi.publishQuiz(v.versionId),
    onBlocked: (why) => (blocked.value = { ...blocked.value, [v.versionId]: why }),
  })
  if (!ok) return
  ElMessage.success(rollback ? `已回滚至「${v.name}」` : `「${v.name}」已发布生效`)
  await load()
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div class="hd-main">
        <h2>AI 问薪题库配置</h2>
        <p>平台唯一核心引擎的入口层 —— 最多 {{ MAX_QUESTIONS }} 道题决定用户画像，画像决定匹配范围与结果。题库版本化：草稿 → 发布，可回滚到任一归档版本</p>
      </div>
      <div class="hd-acts">
        <el-button @click="router.push('/engine/match-snapshot')">匹配快照查询</el-button>
        <el-button type="primary" :loading="creating" @click="createDraft">{{ draft ? '继续编辑草稿' : '新建草稿' }}</el-button>
      </div>
    </div>

    <!-- 有版本的配置（第 11 类）：顶部信息条「当前生效版本 · 草稿状态」 -->
    <div class="card ver-bar">
      <span class="vb-k">当前生效版本</span>
      <template v-if="!loaded"><span class="vb-v">—</span></template>
      <template v-else-if="active">
        <span class="vb-v">v{{ active.versionId }}「{{ active.name }}」</span>
        <span class="t-xs">{{ fmtDateTime(active.publishedAt) }} 发布</span>
      </template>
      <span v-else class="vb-v">暂无生效版本</span>
      <span class="vb-sep">·</span>
      <span class="vb-k">草稿状态</span>
      <template v-if="!loaded"><span class="vb-v">—</span></template>
      <template v-else-if="draft">
        <span class="status-tag status-tag--info">草稿</span>
        <span class="vb-v">v{{ draft.versionId }}「{{ draft.name }}」</span>
        <span class="t-xs">{{ draft.questions.length }} 道题 · 待发布</span>
      </template>
      <template v-else>
        <span class="vb-v">无草稿</span>
        <span class="t-xs">新建草稿会复制当前生效版本</span>
      </template>
    </div>

    <div class="grid g-2 kpis">
      <div class="stat stat--icon">
        <div class="stat-l">题目总数</div>
        <IconClipboardList :size="20" class="stat-i" />
        <div class="stat-v">{{ active?.questions.length ?? '—' }}</div>
        <div class="stat-d">{{ active ? `${judgeCount(active)} 判断题 + ${active.questions.length - judgeCount(active)} 选择题` : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <div class="stat-l">硬过滤题</div>
        <IconListFilter :size="20" class="stat-i" />
        <div class="stat-v">{{ active ? hardCount(active) : '—' }}</div>
        <div class="stat-d">{{ active ? active.questions.filter((q) => q.matchRole === 'HARD_FILTER').map((q) => fieldLabel(q.profileField)).join(' · ') : '—' }}</div>
      </div>
    </div>

    <div class="card funnel">
      <div class="card__hd">
        <h3>答题漏斗</h3>
        <el-radio-group v-model="funnelDays" size="small" @change="loadFunnel">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
      </div>
      <div v-loading="funnelLoading" class="card__bd">
        <div v-if="funnelLoading" class="fn-wait" />
        <div v-else-if="funnelError" class="state-box">
          <IconTriangleExclamationPoint :size="48" />
          <h4>漏斗数据加载失败</h4>
          <p>{{ funnelOffline ? '请检查网络后重新加载' : funnelError }}</p>
          <el-button type="primary" @click="loadFunnel">重新加载</el-button>
        </div>
        <div v-else-if="funnelEmpty" class="state-box">
          <IconChartColumn :size="48" />
          <h4>近 {{ funnelDays }} 天还没有人打开答题页</h4>
          <p>求职者打开 AI 问薪答题页后，这里按人去重统计各步人数</p>
        </div>
        <template v-else-if="funnel">
          <div class="chart-legend fn-legend"><span><i class="fn-swatch" />人数（按人去重）</span></div>
          <div v-for="s in funnelSteps" :key="s.label" class="fn-row">
            <span class="fn-l">{{ s.label }}</span>
            <div class="fn-bar"><i :style="{ width: s.width + '%' }" /></div>
            <span class="fn-n">{{ s.n }} 人</span>
            <span class="fn-r" :class="{ warn: s.over }">{{ s.rate }}</span>
          </div>
          <div v-if="funnelOver" class="notice-bar notice-bar--warn fn-note">
            <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
            <span>「提交答案」人数高于「打开答题页」：打开人数取自答题页的打开记录，这项记录在功能上线后才开始积累，且不经答题页直接提交的不会计入，所以会偏低。这两步之间的转化率暂不可比，后三步之间的转化率不受影响。</span>
          </div>
          <div class="t-xs fn-note">四步均为统计期内按人去重的人数（{{ funnel.from }} 起）。</div>
        </template>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="card__hd">
        <h3>版本列表</h3>
        <span v-if="!canPublish" class="t-xs">发布 / 回滚需超级管理员操作</span>
      </div>
      <p v-for="(why, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">v{{ id }} {{ why }}</p>
      <el-table v-loading="loading" :data="paged" class="ops-table tbl-48" row-key="versionId">
        <el-table-column label="版本" width="80"><template #default="{ row }"><b class="ver">v{{ row.versionId }}</b></template></el-table-column>
        <el-table-column label="名称" min-width="200"><template #default="{ row }"><span class="link-cell" @click="open(row)">{{ row.name }}</span></template></el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><span class="status-tag" :class="`status-tag--${QUIZ_STATUS[row.status]?.tone ?? 'neutral'}`">{{ QUIZ_STATUS[row.status]?.label ?? row.status }}</span></template>
        </el-table-column>
        <el-table-column label="题目" width="150">
          <template #default="{ row }">{{ row.questions.length }} 道<span class="t-xs"> · 硬过滤 {{ hardCount(row) }}</span></template>
        </el-table-column>
        <el-table-column label="发布时间" width="160"><template #default="{ row }">{{ fmtDateTime(row.publishedAt) }}</template></el-table-column>
        <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="open(row)">{{ row.status === 'DRAFT' ? '编辑' : '查看' }}</el-button>
            <el-button v-if="row.status === 'DRAFT' && canPublish" link type="primary" size="small" :disabled="!!blocked[row.versionId]" @click="publish(row)">发布</el-button>
            <el-button v-if="row.status === 'ARCHIVED' && canPublish" link type="primary" size="small" :disabled="!!blocked[row.versionId]" @click="publish(row)">回滚至此版本</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loading" class="tbl-wait" />
          <div v-else-if="error" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>题库版本加载失败</h4>
            <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
            <el-button type="primary" @click="load">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>还没有题库版本</h4>
            <p>新建草稿，编辑好题目后发布生效</p>
            <el-button type="primary" :loading="creating" @click="createDraft"><IconPlus :size="16" />新建草稿</el-button>
          </div>
        </template>
      </el-table>
      <div v-if="rows.length" class="pager">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="rows.length" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <div class="grid below">
      <div class="card">
        <div class="card__hd"><h3>硬性约束</h3></div>
        <div class="card__bd">
          <ul class="rules">
            <li>题目总数 <b>1–{{ MAX_QUESTIONS }}</b> 道，每题 <b>2–8</b> 个选项，选项编码与文字不能重复</li>
            <li>全部为<b>判断题 / 选择题</b>，禁止文字输入</li>
            <li><b>硬过滤题必须排在软打分题之前</b></li>
            <li>必须包含「进厂意愿」与「地域锁定」两道题；每个画像字段最多出现一次</li>
            <li>发布 / 回滚立即对全平台生效，仅超级管理员可操作；匹配快照记录每次匹配使用的题库版本</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-hd { flex-wrap: nowrap; }
.hd-main { flex: 1; min-width: 0; }
.hd-acts { display: flex; gap: var(--space-2); flex: none; margin-left: auto; }
.hd-acts .el-button + .el-button { margin-left: 0; }
.ver-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-gap); font-size: var(--font-size-aux); }
.vb-k { color: var(--text-2); }
.vb-v { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.vb-sep { color: var(--text-3); margin: 0 var(--space-2); }
.kpis { gap: var(--space-gap); margin-bottom: var(--space-gap); }
.funnel { margin-bottom: var(--space-gap); }
.fn-wait { height: 160px; }
.fn-legend { margin-bottom: var(--space-2); }
.fn-swatch { background: var(--chart-1); }
.fn-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) 72px 150px; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; }
.fn-l { font-size: var(--font-size-aux); color: var(--text-2); }
.fn-bar { height: 12px; background: var(--bg-fill); border-radius: var(--radius-tag); overflow: hidden; }
.fn-bar i { display: block; height: 100%; background: var(--chart-1); border-radius: var(--radius-tag); }
.fn-n { text-align: right; font-size: var(--font-size-min); color: var(--text-2); font-variant-numeric: tabular-nums; }
.fn-r { font-size: var(--font-size-min); color: var(--text-3); white-space: nowrap; }
.fn-r.warn { color: var(--warning-text); }
.fn-note { margin-top: var(--space-2); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.tbl-wait { height: 160px; }
.ver { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.below { gap: var(--space-gap); margin-top: var(--space-gap); }
.plain { margin: 0; font-size: var(--font-size-aux); color: var(--text-2); }
.rules { margin: 0; padding-left: 18px; font-size: var(--font-size-aux); line-height: 1.9; color: var(--text-2); }
.rules b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.state-box .el-button svg { margin-right: var(--space-1); }
</style>
