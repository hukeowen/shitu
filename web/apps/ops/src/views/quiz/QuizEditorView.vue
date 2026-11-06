<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, opsApi, type QuizView } from '@shitu/api-client'
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
const saving = ref(false)
const publishing = ref(false)

const name = ref('')
const qs = ref<EditQuestion[]>([])
const savedSnapshot = ref('')
const showIssues = ref(false)

const readonly = computed(() => view.value?.status !== 'DRAFT')
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
  try {
    apply(await opsApi.quizVersion(versionId.value))
  } catch (e) {
    view.value = null
    loadError.value = isApiError(e) && e.status === 404 ? '题库版本不存在' : errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
watch(versionId, load, { immediate: true })

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
    ElMessage.error(errorMessage(e, '保存失败'))
    return false
  } finally {
    saving.value = false
  }
}

async function publish() {
  const v = view.value
  if (!v || v.status === 'ACTIVE') return
  const rollback = v.status === 'ARCHIVED'
  if (dirty.value && !(await save())) return
  const ok = await confirmAction(
    rollback ? '回滚题库版本' : '发布题库版本',
    `${rollback ? '回滚至' : '发布'}「${v.name}」（${v.questions.length} 道题）后将立即影响全平台所有用户的问薪与匹配结果，原生效版本将被归档。确定继续？`,
    true,
  )
  if (!ok) return
  publishing.value = true
  try {
    apply(await opsApi.publishQuiz(v.versionId))
    ElMessage.success(rollback ? '已回滚，该版本已生效' : '已发布生效')
  } catch (e) {
    ElMessage.error(errorMessage(e, '发布失败'))
  } finally {
    publishing.value = false
  }
}

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
  <div>
    <div class="page-hd">
      <div>
        <h2 class="ttl">
          <span class="mono">v{{ versionId }}</span>
          <span>{{ view?.name ?? '题库版本' }}</span>
          <span v-if="view" class="tag" :class="QUIZ_STATUS[view.status]?.cls">{{ QUIZ_STATUS[view.status]?.label }}</span>
          <span v-if="dirty" class="tag tag--signal">未保存</span>
        </h2>
        <p v-if="view">
          <template v-if="view.status === 'DRAFT'">草稿编辑：保存为整体替换，发布后对全平台生效</template>
          <template v-else-if="view.status === 'ACTIVE'">当前生效版本，{{ fmtDateTime(view.publishedAt) }} 发布 · 只读；修改请新建草稿</template>
          <template v-else>已归档版本 · 只读{{ view.publishedAt ? `，曾于 ${fmtDateTime(view.publishedAt)} 发布` : '' }}</template>
        </p>
      </div>
      <div class="spacer" />
      <span class="ref">原型 <b>P-12</b></span>
      <el-button @click="router.push('/engine/quiz')">返回列表</el-button>
      <template v-if="view">
        <el-button v-if="view.status === 'ACTIVE'" @click="newDraft">基于此版本新建草稿</el-button>
        <el-button v-if="view.status === 'DRAFT'" type="primary" :loading="saving" :disabled="!dirty" @click="save">保存草稿</el-button>
        <el-tooltip v-if="view.status !== 'ACTIVE' && !canPublish" content="仅超级管理员可发布 / 回滚" placement="bottom">
          <span><el-button disabled>{{ view.status === 'DRAFT' ? '发布生效' : '回滚至此版本' }}</el-button></span>
        </el-tooltip>
        <el-button
          v-else-if="view.status !== 'ACTIVE'"
          :type="view.status === 'DRAFT' ? 'danger' : 'warning'"
          :loading="publishing"
          :disabled="saving || (view.status === 'DRAFT' && errors.length > 0)"
          @click="publish"
        >{{ view.status === 'DRAFT' ? (dirty ? '保存并发布' : '发布生效') : '回滚至此版本' }}</el-button>
      </template>
    </div>

    <div v-if="loading && !view" v-loading="true" class="card loading-box" />
    <div v-else-if="!view" class="card">
      <el-empty :image-size="64" :description="loadError || '加载失败'">
        <el-button size="small" @click="load">重试</el-button>
      </el-empty>
    </div>

    <div v-else class="layout">
      <div class="left">
        <div class="card meta">
          <div class="card__bd row">
            <label class="lbl">版本名称</label>
            <el-input v-model="name" :disabled="readonly" maxlength="40" show-word-limit style="max-width: 360px" placeholder="如：v1.3 住宿题简化" />
            <div class="spacer" />
            <span class="t-sm dim">{{ qs.length }} / {{ MAX_QUESTIONS }} 题 · 硬过滤题必须前置</span>
          </div>
        </div>

        <div v-if="showIssues && issues.length" class="notice" :class="errors.length ? 'notice--danger' : 'notice--warn'">
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
              <span class="mono qn">Q{{ i + 1 }}</span>
              <span class="tag" :class="q.matchRole === 'HARD_FILTER' ? 'tag--danger' : 'tag--signal'">{{ q.matchRole === 'HARD_FILTER' ? '硬过滤' : '软打分' }}</span>
              <span class="tag tag--ink">{{ QUESTION_TYPES.find((t) => t.value === q.questionType)?.label }}</span>
              <span class="mono t-xs">{{ q.profileField }}</span>
            </div>
            <div v-if="!readonly" class="qops">
              <el-button size="small" :disabled="i === 0" @click="move(qs, i, -1)">上移</el-button>
              <el-button size="small" :disabled="i === qs.length - 1" @click="move(qs, i, 1)">下移</el-button>
              <el-button size="small" type="danger" plain @click="removeQuestion(i)">删除</el-button>
            </div>
          </div>
          <div class="card__bd">
            <el-form label-width="76px" label-position="left" size="default" :disabled="readonly" @submit.prevent>
              <div class="frow">
                <el-form-item label="题型">
                  <el-select v-model="q.questionType" style="width: 120px">
                    <el-option v-for="t in QUESTION_TYPES" :key="t.value" :value="t.value" :label="t.label" />
                  </el-select>
                </el-form-item>
                <el-form-item label="画像字段">
                  <el-select v-model="q.profileField" style="width: 230px" @change="onFieldChange(q)">
                    <el-option
                      v-for="f in FIELDS"
                      :key="f.field"
                      :value="f.field"
                      :label="`${f.label}（${f.field}）`"
                      :disabled="f.field !== q.profileField && usedFields.has(f.field)"
                    />
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
                <el-input v-model="q.stem" :maxlength="STEM_MAX" show-word-limit placeholder="如：你能接受进工厂上班吗？" />
              </el-form-item>
              <el-form-item label="提示">
                <el-input v-model="q.hint" maxlength="60" placeholder="选填，题干下方的补充说明" />
              </el-form-item>
            </el-form>

            <div class="opts">
              <div class="orow ohd" :class="`k-${fieldMeta(q.profileField)?.kind ?? 'enum'}`">
                <span>编码</span><span>选项文字</span><span>副标题</span>
                <template v-if="fieldMeta(q.profileField)?.kind === 'range'"><span>min（元）</span><span>max（元）</span></template>
                <span v-else>画像值 value</span>
                <span>{{ q.profileField === 'locked_region' ? '需选城市' : '' }}</span>
                <span />
              </div>
              <div v-for="(o, j) in q.options" :key="o.key" class="orow" :class="`k-${fieldMeta(q.profileField)?.kind ?? 'enum'}`">
                <el-input v-model="o.code" :disabled="readonly" maxlength="4" class="mono" />
                <el-input v-model="o.label" :disabled="readonly" maxlength="40" placeholder="选项文字" />
                <el-input v-model="o.sub" :disabled="readonly" maxlength="20" placeholder="选填" />
                <template v-if="fieldMeta(q.profileField)?.kind === 'range'">
                  <el-input-number v-model="o.min" :disabled="readonly" :min="0" :max="100000" :step="500" controls-position="right" />
                  <el-input-number v-model="o.max" :disabled="readonly" :min="0" :max="100000" :step="500" controls-position="right" />
                </template>
                <el-input v-else-if="fieldMeta(q.profileField)?.kind === 'number'" v-model="o.value" :disabled="readonly" maxlength="2" placeholder="年限，如 1" class="mono" />
                <el-select v-else v-model="o.value" :disabled="readonly" filterable allow-create clearable placeholder="选择画像值">
                  <el-option v-for="v in fieldMeta(q.profileField)?.values?.() ?? []" :key="v.value" :value="v.value" :label="`${v.label}（${v.value}）`" />
                </el-select>
                <span class="cc">
                  <el-checkbox v-if="q.profileField === 'locked_region'" v-model="o.needRegion" :disabled="readonly" />
                </span>
                <span v-if="!readonly" class="oops">
                  <el-button link size="small" :disabled="j === 0" aria-label="上移" @click="move(q.options, j, -1)">↑</el-button>
                  <el-button link size="small" :disabled="j === q.options.length - 1" aria-label="下移" @click="move(q.options, j, 1)">↓</el-button>
                  <el-button link size="small" type="danger" :disabled="q.options.length <= 2" aria-label="删除选项" @click="q.options.splice(j, 1)">✕</el-button>
                </span>
                <span v-else />
              </div>
              <el-button v-if="!readonly" size="small" class="addopt" :disabled="q.options.length >= MAX_OPTIONS" @click="addOption(q)">
                + 新增选项（{{ q.options.length }} / {{ MAX_OPTIONS }}）
              </el-button>
            </div>
            <ul v-if="showIssues && issuesOf(i).length" class="qissues">
              <li v-for="(it, k) in issuesOf(i)" :key="k" :class="{ w: it.warn }">{{ it.msg }}</li>
            </ul>
          </div>
        </div>

        <div v-if="!readonly" class="card addq">
          <div class="card__bd row">
            <span class="t-sm">新增题目</span>
            <template v-if="qs.length < MAX_QUESTIONS && unusedFields.length">
              <el-button v-for="f in unusedFields" :key="f.field" size="small" @click="addQuestion(f.field)">+ {{ f.label }}</el-button>
            </template>
            <span v-else class="t-sm dim">{{ qs.length >= MAX_QUESTIONS ? `已达 ${MAX_QUESTIONS} 题上限` : '7 个画像字段均已使用' }}</span>
          </div>
        </div>
      </div>

      <aside class="right">
        <div class="sticky">
          <div class="sec-title">C 端预览 <small>点选不保存</small></div>
          <QuizPreview :questions="preview" />
          <div v-if="!readonly" class="vsum">
            <span v-if="errors.length" class="tag tag--danger">{{ errors.length }} 处错误</span>
            <span v-if="warns.length" class="tag tag--warn">{{ warns.length }} 条提示</span>
            <span v-if="!issues.length" class="tag tag--ok">校验通过</span>
            <el-button v-if="issues.length" link size="small" type="primary" @click="showIssues = true">查看</el-button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ttl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ttl .tag { font-family: var(--f-cn); }
.loading-box { height: 320px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
@media (max-width: 1280px) { .layout { grid-template-columns: 1fr; } .right { order: -1; } }
.left { display: grid; gap: 12px; min-width: 0; }
.sticky { position: sticky; top: 68px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }
.lbl { font-size: 13px; color: var(--ink-600); font-weight: 600; }
.meta .card__bd { padding: 12px 16px; }
.issues { margin: 4px 0 0; padding-left: 18px; line-height: 1.8; }
.issues li.w, .qissues li.w { color: var(--warn); }
.qcard.bad { border-color: var(--danger-line); }
.qhd { display: flex; align-items: center; gap: 8px; }
.qn { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.qops { display: flex; gap: 4px; }
.frow { display: flex; gap: 18px; flex-wrap: wrap; }
.frow :deep(.el-form-item) { margin-bottom: 12px; }
.fdesc { margin: -6px 0 12px 76px; }
.opts { margin-top: 4px; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 8px 10px 10px; background: var(--surface-2); }
.orow { display: grid; gap: 8px; align-items: center; padding: 4px 0; }
.orow.k-enum, .orow.k-number { grid-template-columns: 64px minmax(160px, 2fr) minmax(90px, 1fr) minmax(150px, 1.4fr) 64px 84px; }
.orow.k-range { grid-template-columns: 64px minmax(160px, 2fr) minmax(90px, 1fr) 120px 120px 0 84px; }
.ohd { font-size: 11.5px; color: var(--ink-500); font-weight: 600; padding-bottom: 2px; }
.orow :deep(.el-input-number) { width: 100%; }
.cc { display: flex; justify-content: center; }
.oops { display: flex; justify-content: flex-end; gap: 0; }
.addopt { margin-top: 6px; }
.qissues { margin: 10px 0 0; padding-left: 18px; font-size: 12px; color: var(--danger); line-height: 1.8; }
.addq .card__bd { padding: 12px 16px; }
.vsum { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; }
</style>
