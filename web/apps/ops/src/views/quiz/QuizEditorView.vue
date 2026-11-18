<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, opsApi, type QuizView } from '@shitu/api-client'
import { IconChevronDown, IconChevronUp, IconInbox, IconPlus, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'
import { confirmInBox, isBlocked, isNetwork } from '@/composables/boxSubmit'
import { confirmAction } from '@/composables/useRemark'
import { QUIZ_PUBLISH_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDateTime } from '@/utils/format'
import QuizPreview from './QuizPreview.vue'
import {
  FIELDS,
  MATCH_ROLES,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  QUESTION_TYPES,
  QUIZ_STATUS,
  STEM_MAX,
  blankOption,
  blankQuestion,
  fieldMeta,
  toEditQuestion,
  toQuizQuestions,
  validate,
  type EditQuestion,
} from './quizMeta'

/** P-12 题库版本详情：草稿可编辑（题目顺序、画像字段、匹配作用、选项），其余版本只读 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canPublish = computed(() => auth.hasAnyRole(QUIZ_PUBLISH_ROLES))

const versionId = computed(() => Number(route.params.versionId))
const view = shallowRef<QuizView | null>(null)
const loading = ref(false)
const loadError = ref('')
/** 版本不存在（给「返回列表」）和加载失败（给「重新加载」，断网与否分文案）分开 */
const missing = ref(false)
const offline = ref(false)
const saving = ref(false)
/** 保存 / 发布被后端业务拒绝的原因：留在页面头按钮下方，被拒的按钮置灰；改动内容后再放开保存 */
const saveWhy = ref('')
const publishWhy = ref('')
const publishing = ref(false)

const name = ref('')
const qs = ref<EditQuestion[]>([])
const savedSnapshot = ref('')
const showIssues = ref(false)

const readonly = computed(() => view.value?.status !== 'DRAFT')
/**
 * 页头只显示一次版本号和状态：名称常以版本号开头（「v2 草稿」「v1.0 初始题库」），
 * 去掉开头的版本号；剩下的部分若只是状态名（已由状态标签表达）或为空，就不再显示。
 */
const titleName = computed(() => {
  const v = view.value
  if (!v) return '题库版本'
  const rest = (dirty.value || !readonly.value ? name.value : v.name).trim().replace(new RegExp(`^v${versionId.value}(\\.\\d+)*(?!\\d)\\s*`, 'i'), '').trim()
  return rest === QUIZ_STATUS[v.status]?.label ? '' : rest
})
const snapshot = () => JSON.stringify({ n: name.value.trim(), q: toQuizQuestions(qs.value) })
const dirty = computed(() => !readonly.value && !!view.value && snapshot() !== savedSnapshot.value)

function apply(v: QuizView) {
  view.value = v
  name.value = v.name
  qs.value = v.questions.map(toEditQuestion)
  savedSnapshot.value = snapshot()
  showIssues.value = false
}

async function load() {
  loading.value = true
  loadError.value = ''
  missing.value = false
  offline.value = false
  saveWhy.value = ''
  publishWhy.value = ''
  try {
    apply(await opsApi.quizVersion(versionId.value))
  } catch (e) {
    view.value = null
    missing.value = isApiError(e) && e.status === 404
    offline.value = isNetwork(e)
    loadError.value = missing.value ? '题库版本不存在' : errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
watch(versionId, load, { immediate: true })
// 改了内容就重新放开「保存草稿」
watch(() => (view.value ? snapshot() : ''), () => (saveWhy.value = ''))

// ---------- 校验 / 预览 ----------
const issues = computed(() => (readonly.value ? [] : validate(qs.value)))
const errors = computed(() => issues.value.filter((i) => !i.warn))
const warns = computed(() => issues.value.filter((i) => i.warn))
const issuesOf = (i: number) => issues.value.filter((x) => x.q === i)
const preview = computed(() => toQuizQuestions(qs.value))
const usedFields = computed(() => new Set(qs.value.map((q) => q.profileField)))
const unusedFields = computed(() => FIELDS.filter((f) => !usedFields.value.has(f.field)))

// ---------- 编辑操作 ----------
function move<T>(arr: T[], i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= arr.length) return
  const [x] = arr.splice(i, 1)
  arr.splice(j, 0, x)
}
function addQuestion(field: string) {
  if (qs.value.length >= MAX_QUESTIONS) return
  const q = blankQuestion(field)
  // 硬过滤题插到最后一道硬过滤题之后，保持「硬过滤在前」
  if (q.matchRole === 'HARD_FILTER') {
    const lastHard = qs.value.map((x) => x.matchRole).lastIndexOf('HARD_FILTER')
    qs.value.splice(lastHard + 1, 0, q)
  } else qs.value.push(q)
}
async function removeQuestion(i: number) {
  const q = qs.value[i]
  if (q.stem.trim() && !(await confirmAction('删除题目', `确定删除 Q${i + 1}「${q.stem}」？保存后生效。`, true))) return
  qs.value.splice(i, 1)
}
function onFieldChange(q: EditQuestion) {
  if (fieldMeta(q.profileField)?.hardOnly) q.matchRole = 'HARD_FILTER'
  if (q.profileField !== 'locked_region') q.options.forEach((o) => (o.needRegion = false))
}
function addOption(q: EditQuestion) {
  if (q.options.length < MAX_OPTIONS) q.options.push(blankOption(q.options))
}

// ---------- 保存 / 发布 ----------
async function save(): Promise<boolean> {
  if (!view.value || readonly.value) return false
  showIssues.value = true
  if (errors.value.length) {
    ElMessage.error(`还有 ${errors.value.length} 处问题需要修正`)
    return false
  }
  saving.value = true
  try {
    const v = await opsApi.saveQuizDraft(view.value.versionId, name.value.trim() || undefined, toQuizQuestions(qs.value))
    apply(v)
    ElMessage.success('草稿已保存')
    return true
  } catch (e) {
    // 先复位提交中再弹提示
    saving.value = false
    ElMessage.error(errorMessage(e, '保存失败'))
    if (isBlocked(e)) saveWhy.value = `暂时不能保存草稿：${errorMessage(e)}`
    return false
  } finally {
    saving.value = false
  }
}

async function publish() {
  const v = view.value
  if (!v || v.status === 'ACTIVE') return
  const rollback = v.status === 'ARCHIVED'
  publishing.value = true
  try {
    if (dirty.value && !(await save())) return
    // 确认框里提交（规范「Page States」），确认按钮危险色描边：发布 / 回滚立即对全平台生效
    const ok = await confirmInBox({
      title: rollback ? '回滚题库版本' : '发布题库版本',
      text: `${rollback ? '回滚至' : '发布'}「${v.name}」（${v.questions.length} 道题）后将立即影响全平台所有用户的问薪与匹配结果，原生效版本将被归档。确定继续？`,
      action: rollback ? '回滚' : '发布',
      danger: true,
      api: async () => apply(await opsApi.publishQuiz(v.versionId)),
      onBlocked: (why) => (publishWhy.value = why),
    })
    if (ok) ElMessage.success(rollback ? '已回滚，该版本已生效' : '已发布生效')
  } finally {
    publishing.value = false
  }
}

/** 操作条里置灰的按钮为什么不能点（规范「本来就不能做的操作直接置灰写原因」） */
const opHint = computed(() => {
  const v = view.value
  if (!v) return loading.value ? '题库版本加载中…' : '题库版本没加载出来，不能保存或发布'
  const r: string[] = []
  if (v.status === 'ACTIVE') r.push('生效版本只读：修改请新建草稿')
  else if (v.status === 'ARCHIVED') r.push('归档版本只读，不能保存或发布')
  else if (!dirty.value) r.push('草稿没有未保存的修改')
  else r.push('有未保存的修改，发布时会先保存')
  if (v.status === 'DRAFT' && errors.value.length) r.push(`还有 ${errors.value.length} 处错误，修正后才能保存和发布`)
  if (v.status !== 'ARCHIVED') r.push('回滚只针对归档版本')
  if (!canPublish.value) r.push('发布 / 回滚需超级管理员操作')
  return r.join('；')
})

async function newDraft() {
  try {
    const d = await opsApi.createQuizDraft()
    ElMessage.success(d.versionId === versionId.value ? '已是草稿' : `已打开草稿「${d.name}」`)
    void router.push(`/engine/quiz/${d.versionId}`)
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

// ---------- 离开提醒 ----------
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  return confirmAction('放弃修改', '草稿有未保存的修改，离开后将丢失。确定离开？', true)
})
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div class="editor">
    <div class="page-hd">
      <div>
        <h2 class="ttl">
          <span>v{{ versionId }}</span>
          <span v-if="titleName">{{ titleName }}</span>
          <span v-if="view" class="status-tag" :class="`status-tag--${QUIZ_STATUS[view.status]?.tone ?? 'neutral'}`">{{ QUIZ_STATUS[view.status]?.label }}</span>
          <span v-if="dirty" class="status-tag status-tag--warning">未保存</span>
        </h2>
        <p v-if="view">
          <template v-if="view.status === 'DRAFT'">草稿编辑：保存为整体替换，发布后对全平台生效</template>
          <template v-else-if="view.status === 'ACTIVE'">当前生效版本，{{ fmtDateTime(view.publishedAt) }} 发布 · 只读；修改请新建草稿</template>
          <template v-else>已归档版本 · 只读{{ view.publishedAt ? `，曾于 ${fmtDateTime(view.publishedAt)} 发布` : '' }}</template>
        </p>
      </div>
      <div class="spacer" />
      <div class="hd-acts">
        <el-button v-if="view?.status === 'ACTIVE'" @click="newDraft">基于此版本新建草稿</el-button>
        <el-button @click="router.push('/engine/quiz')">返回列表</el-button>
      </div>
    </div>

    <!-- 有版本的配置（第 11 类）：保存草稿 / 发布 / 回滚的位置固定，长表单往下滚时吸顶；用不了时置灰，原因写在左边 -->
    <div class="card op-bar">
      <div class="op-why">
        <span v-if="saveWhy || publishWhy" class="blocked-why hd-why" role="alert">{{ saveWhy || publishWhy }}</span>
        <span v-else class="t-xs">{{ opHint }}</span>
      </div>
      <div class="op-acts">
        <el-button class="btn-steady" type="primary" :loading="saving && !publishing" :disabled="view?.status !== 'DRAFT' || !dirty || !!saveWhy || publishing" @click="save">保存草稿</el-button>
        <el-button
          class="btn-steady"
          :loading="publishing && view?.status === 'DRAFT'"
          :disabled="view?.status !== 'DRAFT' || !canPublish || !!publishWhy || errors.length > 0 || (saving && !publishing)"
          @click="publish"
        >发布生效</el-button>
        <el-button class="btn-steady" :loading="publishing && view?.status === 'ARCHIVED'" :disabled="view?.status !== 'ARCHIVED' || !canPublish || !!publishWhy" @click="publish">回滚至此版本</el-button>
      </div>
    </div>

    <div v-if="loading && !view" v-loading="true" class="card loading-box" />
    <div v-else-if="!view" class="card">
      <div v-if="missing" class="state-box">
        <IconInbox :size="48" />
        <h4>题库版本不存在</h4>
        <p>v{{ versionId }} 可能已被删除，回到版本列表看看现有的版本</p>
        <el-button type="primary" @click="router.push('/engine/quiz')">返回列表</el-button>
      </div>
      <div v-else class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>题库版本加载失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : loadError || '加载失败，可以稍后重新加载' }}</p>
        <el-button type="primary" :loading="loading" @click="load">重新加载</el-button>
      </div>
    </div>

    <div v-else class="layout">
      <div class="left">
        <div class="card meta">
          <div class="card__bd row">
            <label class="lbl" for="quiz-name">版本名称</label>
            <el-input id="quiz-name" v-model="name" :disabled="readonly" maxlength="40" :show-word-limit="!readonly" class="name-in" :placeholder="readonly ? '—' : '如：v1.3 住宿题简化'" />
            <div class="spacer" />
            <span class="t-xs">{{ qs.length }} / {{ MAX_QUESTIONS }} 题 · 硬过滤题必须前置</span>
          </div>
        </div>

        <div v-if="showIssues && issues.length" class="notice-bar" :class="errors.length ? 'notice-bar--danger' : 'notice-bar--warn'">
          <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
          <div>
            <b>{{ errors.length ? `${errors.length} 处错误需修正后才能保存` : '可以保存，但请留意以下提示' }}</b>
            <ul class="issues">
              <li v-for="(it, i) in issues" :key="i" :class="{ w: it.warn }">{{ it.warn ? '提示' : '错误' }} · {{ it.msg }}</li>
            </ul>
          </div>
        </div>

        <div v-for="(q, i) in qs" :key="q.key" class="card qcard" :class="{ bad: showIssues && issuesOf(i).some((x) => !x.warn) }">
          <div class="card__hd">
            <div class="qhd">
              <span class="qn">Q{{ i + 1 }}</span>
              <span class="status-tag" :class="q.matchRole === 'HARD_FILTER' ? 'status-tag--warning' : 'status-tag--info'">{{ q.matchRole === 'HARD_FILTER' ? '硬过滤' : '软打分' }}</span>
              <span class="status-tag">{{ QUESTION_TYPES.find((t) => t.value === q.questionType)?.label }}</span>
              <span class="t-xs" :title="q.profileField">{{ fieldMeta(q.profileField)?.label ?? q.profileField }}</span>
            </div>
            <div v-if="!readonly" class="qops">
              <el-button size="small" :disabled="i === 0" @click="move(qs, i, -1)">上移</el-button>
              <el-button size="small" :disabled="i === qs.length - 1" @click="move(qs, i, 1)">下移</el-button>
              <el-button size="small" @click="removeQuestion(i)">删除</el-button>
            </div>
          </div>
          <div class="card__bd">
            <el-form label-width="76px" label-position="left" size="default" :disabled="readonly" @submit.prevent>
              <div class="frow">
                <el-form-item label="题型">
                  <el-select v-model="q.questionType" class="w-type">
                    <el-option v-for="t in QUESTION_TYPES" :key="t.value" :value="t.value" :label="t.label" />
                  </el-select>
                </el-form-item>
                <el-form-item label="画像字段">
                  <el-select v-model="q.profileField" class="w-field" @change="onFieldChange(q)">
                    <el-option
                      v-for="f in FIELDS"
                      :key="f.field"
                      :value="f.field"
                      :label="f.label"
                      :disabled="f.field !== q.profileField && usedFields.has(f.field)"
                    >
                      <span class="opt-l">{{ f.label }}</span><span class="opt-c">{{ f.field }}</span>
                    </el-option>
                  </el-select>
                </el-form-item>
                <el-form-item label="匹配作用">
                  <el-radio-group v-model="q.matchRole">
                    <el-radio-button v-for="r in MATCH_ROLES" :key="r.value" :value="r.value">{{ r.label }}</el-radio-button>
                  </el-radio-group>
                </el-form-item>
              </div>
              <p v-if="fieldMeta(q.profileField)" class="fdesc t-xs">{{ fieldMeta(q.profileField)?.desc }}</p>
              <el-form-item label="题干" required>
                <el-input v-model="q.stem" :maxlength="STEM_MAX" :show-word-limit="!readonly" :placeholder="readonly ? '—' : '如：你能接受进工厂上班吗？'" />
              </el-form-item>
              <el-form-item label="提示">
                <el-input v-model="q.hint" maxlength="60" :placeholder="readonly ? '—' : '选填，题干下方的补充说明'" />
              </el-form-item>
            </el-form>

            <div class="opts">
              <div class="orow ohd" :class="`k-${fieldMeta(q.profileField)?.kind ?? 'enum'}`">
                <span>编码</span><span>选项文字</span><span>副标题</span>
                <template v-if="fieldMeta(q.profileField)?.kind === 'range'"><span>最低（元）</span><span>最高（元）</span></template>
                <span v-else>{{ fieldMeta(q.profileField)?.kind === 'number' ? '年限（年）' : '画像值' }}</span>
                <span>{{ q.profileField === 'locked_region' ? '需选城市' : '' }}</span>
                <span />
              </div>
              <div v-for="(o, j) in q.options" :key="o.key" class="orow" :class="`k-${fieldMeta(q.profileField)?.kind ?? 'enum'}`">
                <el-input v-model="o.code" :disabled="readonly" maxlength="4" />
                <el-input v-model="o.label" :disabled="readonly" maxlength="40" :placeholder="readonly ? '—' : '选项文字'" />
                <el-input v-model="o.sub" :disabled="readonly" maxlength="20" :placeholder="readonly ? '—' : '选填'" />
                <template v-if="fieldMeta(q.profileField)?.kind === 'range'">
                  <el-input-number v-model="o.min" :disabled="readonly" :controls="!readonly" :min="0" :max="100000" :step="500" controls-position="right" />
                  <el-input-number v-model="o.max" :disabled="readonly" :controls="!readonly" :min="0" :max="100000" :step="500" controls-position="right" />
                </template>
                <el-input v-else-if="fieldMeta(q.profileField)?.kind === 'number'" v-model="o.value" :disabled="readonly" maxlength="2" :placeholder="readonly ? '—' : '年限，如 1'" />
                <el-select v-else v-model="o.value" :disabled="readonly" filterable allow-create clearable :placeholder="readonly ? '—' : '选择画像值'">
                  <el-option v-for="v in fieldMeta(q.profileField)?.values?.() ?? []" :key="v.value" :value="v.value" :label="v.label">
                    <span class="opt-l">{{ v.label }}</span><span class="opt-c">{{ v.value }}</span>
                  </el-option>
                </el-select>
                <span class="cc">
                  <el-checkbox v-if="q.profileField === 'locked_region'" v-model="o.needRegion" :disabled="readonly" />
                </span>
                <span v-if="!readonly" class="oops">
                  <el-button link size="small" :disabled="j === 0" aria-label="上移" @click="move(q.options, j, -1)"><IconChevronUp :size="16" /></el-button>
                  <el-button link size="small" :disabled="j === q.options.length - 1" aria-label="下移" @click="move(q.options, j, 1)"><IconChevronDown :size="16" /></el-button>
                  <el-button link size="small" type="danger" :disabled="q.options.length <= 2" aria-label="删除选项" @click="q.options.splice(j, 1)"><IconX :size="16" /></el-button>
                </span>
                <span v-else />
              </div>
              <el-button v-if="!readonly" size="small" class="addopt" :disabled="q.options.length >= MAX_OPTIONS" @click="addOption(q)">
                <IconPlus :size="14" />新增选项（{{ q.options.length }} / {{ MAX_OPTIONS }}）
              </el-button>
            </div>
            <ul v-if="showIssues && issuesOf(i).length" class="qissues">
              <li v-for="(it, k) in issuesOf(i)" :key="k" :class="{ w: it.warn }">{{ it.msg }}</li>
            </ul>
          </div>
        </div>

        <div v-if="!readonly" class="card addq">
          <div class="card__bd row">
            <span class="lbl">新增题目</span>
            <template v-if="qs.length < MAX_QUESTIONS && unusedFields.length">
              <el-button v-for="f in unusedFields" :key="f.field" size="small" @click="addQuestion(f.field)"><IconPlus :size="14" />{{ f.label }}</el-button>
            </template>
            <span v-else class="t-xs">{{ qs.length >= MAX_QUESTIONS ? `已达 ${MAX_QUESTIONS} 题上限` : '7 个画像字段均已使用' }}</span>
          </div>
        </div>
      </div>

      <aside class="right">
        <div class="sticky">
          <div class="pv-t">求职者端预览 <small>点选不保存</small></div>
          <QuizPreview :questions="preview" />
          <div v-if="!readonly" class="vsum">
            <span v-if="errors.length" class="status-tag status-tag--danger">{{ errors.length }} 处错误</span>
            <span v-if="warns.length" class="status-tag status-tag--warning">{{ warns.length }} 条提示</span>
            <span v-if="!issues.length" class="status-tag status-tag--success">校验通过</span>
            <el-button v-if="issues.length" link size="small" type="primary" @click="showIssues = true">查看</el-button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ttl { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
/* 操作条定高（按钮一行、原因最多两行），被拒原因出现时不推动下面的内容；右侧预览吸在它下面 */
.editor { --op-bar-h: calc(2 * var(--space-3) + 2lh); }
.op-bar { font-size: var(--font-size-aux); line-height: 1.6; }
.hd-acts { display: flex; gap: var(--space-2); flex: none; }
.hd-acts .el-button + .el-button { margin-left: 0; }
.op-bar { position: sticky; top: var(--layout-top-height); z-index: 10; display: flex; align-items: center; gap: var(--space-4); height: var(--op-bar-h); padding: 0 var(--space-4); margin-bottom: var(--space-gap); }
.op-why { flex: 1; min-width: 0; line-height: 1.6; }
.op-acts { display: flex; gap: var(--space-2); flex: none; }
.op-acts .el-button + .el-button { margin-left: 0; }
.loading-box { height: 320px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 352px; gap: var(--space-gap); align-items: start; }
/* 1280 宽也保持左表单、右预览两栏，预览缩到 320 */
@media (max-width: 1280px) { .layout { grid-template-columns: minmax(0, 1fr) 320px; } }
.left { display: grid; gap: var(--space-3); min-width: 0; }
.sticky { position: sticky; top: calc(var(--layout-top-height) + var(--op-bar-h) + var(--space-gap)); }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.spacer { flex: 1; }
.lbl { font-size: var(--font-size-aux); color: var(--text-2); font-weight: var(--font-weight-medium); }
.name-in { max-width: 360px; }
.meta .card__bd { padding: var(--space-3) var(--space-4); }
.issues { margin: var(--space-1) 0 0; padding-left: 18px; line-height: 1.8; }
.issues li.w, .qissues li.w { color: var(--warning-text); }
.qcard.bad { border-color: var(--danger-text); }
.qhd { display: flex; align-items: center; gap: var(--space-2); }
.qn { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.qops { display: flex; gap: var(--space-1); }
.qops .el-button + .el-button { margin-left: 0; }
.frow { display: flex; gap: var(--space-4); flex-wrap: wrap; }
.frow :deep(.el-form-item) { margin-bottom: var(--space-3); }
.w-type { width: 120px; }
.w-field { width: 230px; }
.fdesc { margin: calc(-1 * var(--space-2)) 0 var(--space-3) 76px; }
.opts { margin-top: var(--space-1); border: 1px solid var(--border); border-radius: var(--radius-control); padding: var(--space-2) var(--space-3) var(--space-3); background: var(--bg-fill); }
.orow { display: grid; gap: var(--space-2); align-items: center; padding: var(--space-1) 0; }
.orow.k-enum, .orow.k-number { grid-template-columns: 64px minmax(140px, 2fr) minmax(72px, 1fr) minmax(130px, 1.4fr) 64px 84px; }
.orow.k-range { grid-template-columns: 64px minmax(140px, 2fr) minmax(72px, 1fr) 110px 110px 0 84px; }
.ohd { font-size: var(--font-size-min); color: var(--text-2); font-weight: var(--font-weight-medium); padding-bottom: var(--space-1); }
/* 下拉选项：左边中文名，右边编码 */
.opt-l { margin-right: var(--space-3); }
.opt-c { float: right; font-size: var(--font-size-min); color: var(--text-3); }
.orow :deep(.el-input-number) { width: 100%; }
.cc { display: flex; justify-content: center; }
.oops { display: flex; justify-content: flex-end; }
/* 上移、下移、删除图标的点击区补到 24 */
.oops .el-button { min-width: 24px; min-height: 24px; }
.oops .el-button + .el-button { margin-left: var(--space-1); }
.addopt { margin-top: var(--space-2); }
.addopt svg, .addq .el-button svg { margin-right: var(--space-1); }
.qissues { margin: var(--space-3) 0 0; padding-left: 18px; font-size: var(--font-size-min); color: var(--danger-text); line-height: 1.8; }
.addq .card__bd { padding: var(--space-3) var(--space-4); }
.addq .el-button + .el-button { margin-left: 0; }
.pv-t { display: flex; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.pv-t small { font-size: var(--font-size-min); font-weight: var(--font-weight-regular); color: var(--text-3); }
.vsum { display: flex; align-items: center; justify-content: center; gap: var(--space-2); margin-top: var(--space-3); }
</style>
