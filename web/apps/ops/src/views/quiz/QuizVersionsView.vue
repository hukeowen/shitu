<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type QuizView } from '@shitu/api-client'
import { confirmAction } from '@/composables/useRemark'
import { QUIZ_PUBLISH_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDateTime } from '@/utils/format'
import { MAX_QUESTIONS, QUIZ_STATUS, fieldLabel } from './quizMeta'

/** P-12 AI 问薪题库：版本列表、新建草稿（复制生效版本）、发布 / 回滚（仅超管） */
const router = useRouter()
const auth = useAuthStore()
const canPublish = computed(() => auth.hasAnyRole(QUIZ_PUBLISH_ROLES))

const rows = shallowRef<QuizView[]>([])
const loading = ref(false)
const error = ref('')
const acting = ref<number | null>(null)
const creating = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await opsApi.quizVersions()
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

const active = computed(() => rows.value.find((v) => v.status === 'ACTIVE') ?? null)
const draft = computed(() => rows.value.find((v) => v.status === 'DRAFT') ?? null)
const hardCount = (v: QuizView) => v.questions.filter((q) => q.matchRole === 'HARD_FILTER').length
const judgeCount = (v: QuizView) => v.questions.filter((q) => q.questionType === 'JUDGE').length

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

async function publish(v: QuizView) {
  const rollback = v.status === 'ARCHIVED'
  const cur = active.value ? `当前生效版本「${active.value.name}」将被归档。` : ''
  const ok = await confirmAction(
    rollback ? '回滚题库版本' : '发布题库版本',
    `${rollback ? '回滚至' : '发布'}「${v.name}」（${v.questions.length} 道题）后将立即影响全平台所有用户的问薪与匹配结果。${cur}确定继续？`,
    true,
  )
  if (!ok) return
  acting.value = v.versionId
  try {
    await opsApi.publishQuiz(v.versionId)
    ElMessage.success(rollback ? `已回滚至「${v.name}」` : `「${v.name}」已发布生效`)
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = null
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>AI 问薪题库配置</h2>
        <p>平台唯一核心引擎的入口层 —— 最多 {{ MAX_QUESTIONS }} 道题决定用户画像，画像决定匹配范围与结果。题库版本化：草稿 → 发布，可回滚到任一归档版本</p>
      </div>
      <div class="spacer" />
      <el-button @click="router.push('/engine/match-snapshot')">匹配快照查询</el-button>
      <el-button type="primary" :loading="creating" @click="createDraft">{{ draft ? '继续编辑草稿' : '新建草稿' }}</el-button>
    </div>

    <div class="grid g-4 stats">
      <div class="stat">
        <div class="stat-l">生效版本</div>
        <div class="stat-v sm">{{ active?.name ?? '—' }}</div>
        <div class="stat-d">{{ active ? `${fmtDateTime(active.publishedAt)} 发布` : '暂无生效版本' }}</div>
      </div>
      <div class="stat">
        <div class="stat-l">题目总数</div>
        <div class="stat-v">{{ active?.questions.length ?? '—' }}</div>
        <div class="stat-d">{{ active ? `${judgeCount(active)} 判断题 + ${active.questions.length - judgeCount(active)} 选择题` : '—' }}</div>
      </div>
      <div class="stat">
        <div class="stat-l">硬过滤题</div>
        <div class="stat-v">{{ active ? hardCount(active) : '—' }}</div>
        <div class="stat-d">{{ active ? active.questions.filter((q) => q.matchRole === 'HARD_FILTER').map((q) => fieldLabel(q.profileField)).join(' · ') : '—' }}</div>
      </div>
      <div class="stat">
        <div class="stat-l">草稿</div>
        <div class="stat-v sm">{{ draft?.name ?? '无' }}</div>
        <div class="stat-d">{{ draft ? `${draft.questions.length} 道题 · 待发布` : '新建草稿会复制当前生效版本' }}</div>
      </div>
    </div>

    <div class="card">
      <div class="card__hd">
        <h3>版本列表</h3>
        <span v-if="!canPublish" class="t-xs">发布 / 回滚需超级管理员操作</span>
      </div>
      <el-table v-loading="loading" :data="rows" class="ops-table" row-key="versionId">
        <el-table-column label="版本" width="80">
          <template #default="{ row }"><span class="mono strong">v{{ row.versionId }}</span></template>
        </el-table-column>
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }"><span class="link-cell" @click="open(row)">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="tag" :class="QUIZ_STATUS[row.status]?.cls">{{ QUIZ_STATUS[row.status]?.label ?? row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="题目" width="160">
          <template #default="{ row }">
            <span class="num">{{ row.questions.length }}</span><span class="dim t-sm"> 道 · 硬过滤 {{ hardCount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="发布时间" width="160">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.publishedAt) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="open(row)">{{ row.status === 'DRAFT' ? '编辑' : '查看' }}</el-button>
            <el-button
              v-if="row.status === 'DRAFT' && canPublish"
              link
              type="danger"
              size="small"
              :loading="acting === row.versionId"
              :disabled="acting !== null"
              @click="publish(row)"
            >发布</el-button>
            <el-button
              v-if="row.status === 'ARCHIVED' && canPublish"
              link
              type="warning"
              size="small"
              :loading="acting === row.versionId"
              :disabled="acting !== null"
              @click="publish(row)"
            >回滚至此版本</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="error" :image-size="64" :description="error">
            <el-button size="small" @click="load">重试</el-button>
          </el-empty>
          <el-empty v-else :image-size="64" description="暂无题库版本" />
        </template>
      </el-table>
    </div>

    <div class="grid g-2 below">
      <div class="card">
        <div class="card__hd"><h3>答题漏斗</h3><span class="tag">待埋点</span></div>
        <div class="card__bd">
          <el-empty :image-size="56" description="各题进入 / 放弃人数需 C 端答题埋点，后续版本接入" />
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>硬性约束</h3></div>
        <div class="card__bd">
          <ul class="rules t-sm">
            <li>题目总数 <b>1–{{ MAX_QUESTIONS }}</b> 道，每题 <b>2–8</b> 个选项，选项编码与文字不能重复</li>
            <li>全部为<b>判断题 / 选择题</b>，禁止文字输入</li>
            <li><b>硬过滤题必须排在软打分题之前</b></li>
            <li>必须包含「进厂意愿 accept_factory」与「地域锁定 locked_region」两道题；每个画像字段最多出现一次</li>
            <li>发布 / 回滚立即对全平台生效，仅超级管理员可操作；匹配快照记录每次匹配使用的题库版本</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats { margin-bottom: 14px; }
.stat-v.sm { font-size: 18px; margin-top: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.below { margin-top: 14px; }
.rules { margin: 0; padding-left: 18px; line-height: 1.9; color: var(--ink-700); }
.rules b { color: var(--ink-900); }
</style>
