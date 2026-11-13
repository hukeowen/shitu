<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, opsApi, type EngineVersion } from '@shitu/api-client'
import { IconInbox, IconPlus, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import StatusTag from '@/components/StatusTag.vue'
import { boxSubmit, isBlocked, isNetwork } from '@/composables/boxSubmit'
import { confirmAction } from '@/composables/useRemark'
import { ENGINE_PUBLISH_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDateTime } from '@/utils/format'
import { DEFAULTS, FACTORS, diff, normalize, toPayload, validate, weightSum, type EngineConfig } from './engineMeta'

/** P-13 匹配引擎参数：版本化（草稿 → 发布，可回滚），结构化编辑 + 与生效版本对比 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canPublish = computed(() => auth.hasAnyRole(ENGINE_PUBLISH_ROLES))

const versions = shallowRef<EngineVersion[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const offline = ref(false)
const active = computed(() => versions.value.find((v) => v.status === 'ACTIVE') ?? null)
const draft = computed(() => versions.value.find((v) => v.status === 'DRAFT') ?? null)

const current = shallowRef<EngineVersion | null>(null)
const form = ref<EngineConfig | null>(null)
const saved = ref('')
const saving = ref(false)
const acting = ref(false)
/** 保存 / 发布 / 回滚被后端业务拒绝的原因：留在操作条下面，被拒的按钮置灰（断网只弹提示） */
const saveWhy = ref('')
const publishWhy = ref('')

const readonly = computed(() => current.value?.status !== 'DRAFT')
const snapshot = () => (form.value ? JSON.stringify(toPayload(form.value)) : '')
const dirty = computed(() => !readonly.value && !!form.value && snapshot() !== saved.value)
// 改了内容就重新放开「保存草稿」
watch(() => (form.value ? snapshot() : ''), () => (saveWhy.value = ''))

async function loadList(): Promise<boolean> {
  loading.value = true
  error.value = ''
  offline.value = false
  try {
    versions.value = await opsApi.engineVersions()
    loaded.value = true
    return true
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    offline.value = isNetwork(e)
    if (!loaded.value) versions.value = []
    else ElMessage.error(error.value)
    return false
  } finally {
    loading.value = false
  }
}

function show(v: EngineVersion) {
  current.value = v
  form.value = normalize(v.config)
  saved.value = snapshot()
  saveWhy.value = ''
  publishWhy.value = ''
  if (route.query.v !== String(v.versionId)) void router.replace({ query: { v: String(v.versionId) } })
}

async function select(id: number) {
  if (current.value?.versionId === id) return
  if (dirty.value && !(await confirmAction('放弃修改', '当前草稿有未保存的修改，切换版本将丢失这些修改。确定切换？', true))) return
  try {
    show(await opsApi.engineVersion(id))
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

/** 首次进入和「重新加载」：拉版本列表，按地址里的 v、草稿、生效版本的顺序选一个 */
async function init() {
  if (!(await loadList())) return
  const want = Number(route.query.v)
  const pick = versions.value.find((v) => v.versionId === want) ?? draft.value ?? active.value ?? versions.value[0]
  if (pick) show(pick)
}
onMounted(init)

// ---------- 草稿：新建 / 保存 / 删除
async function createDraft() {
  if (draft.value) return select(draft.value.versionId)
  acting.value = true
  try {
    const d = await opsApi.engineDraft()
    ElMessage.success(`已从生效版本复制草稿 v${d.versionId}`)
    await loadList()
    show(d)
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = false
  }
}

const localErrors = computed(() => (form.value && !readonly.value ? validate(form.value) : []))

async function save(): Promise<boolean> {
  if (!form.value || !current.value) return false
  if (localErrors.value.length) {
    ElMessage.error(localErrors.value[0])
    return false
  }
  saving.value = true
  try {
    const v = await opsApi.engineUpdate(current.value.versionId, toPayload(form.value))
    ElMessage.success('草稿已保存')
    current.value = v
    form.value = normalize(v.config)
    saved.value = snapshot()
    await loadList()
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

function discard() {
  if (current.value) show(current.value)
}

/** 确认框里提交（规范「Page States」）；删除、发布、回滚不可撤回，确认按钮危险色描边 */
async function confirmIn(title: string, text: string, act: string, api: () => Promise<void>, onBlocked?: (why: string) => void): Promise<boolean> {
  let done = false
  const s = boxSubmit(text, act, async () => {
    await api()
    done = true
  }, onBlocked)
  try {
    await ElMessageBox.confirm(s.message, title, {
      type: 'warning',
      confirmButtonText: act,
      confirmButtonClass: 'el-button--danger is-plain btn-reject',
      cancelButtonText: '取消',
      beforeClose: s.beforeClose,
    })
  } catch {
    // 取消
  }
  return done
}

async function remove(v: EngineVersion) {
  const ok = await confirmIn('删除草稿', `确定删除草稿 v${v.versionId}？删除后不可恢复。`, '删除', async () => {
    acting.value = true
    try {
      await opsApi.engineDelete(v.versionId)
    } finally {
      acting.value = false
    }
  })
  if (!ok) return
  ElMessage.success('草稿已删除')
  saved.value = snapshot() // 避免离开提示
  await loadList()
  const next = active.value ?? versions.value[0]
  if (next) show(next)
  else current.value = form.value = null
}

async function publish(v: EngineVersion) {
  if (v.status === 'DRAFT' && current.value?.versionId === v.versionId && dirty.value) {
    if (!(await save())) return
  }
  const rollback = v.status === 'ARCHIVED'
  const changes = active.value ? diff(normalize(active.value.config), normalize(v.config)).length : 0
  const out: { v: EngineVersion | null } = { v: null }
  const ok = await confirmIn(
    rollback ? '回滚引擎参数' : '发布引擎参数',
    `${rollback ? '回滚至' : '发布'} v${v.versionId}（相对当前生效版本 ${changes} 项变化）后，将立即影响全平台的匹配打分、岗位权重与展示结果。${active.value ? `当前生效版本 v${active.value.versionId} 将被归档。` : ''}确定继续？`,
    rollback ? '回滚' : '发布',
    async () => {
      acting.value = true
      try {
        out.v = await opsApi.enginePublish(v.versionId)
      } finally {
        acting.value = false
      }
    },
    (why) => (publishWhy.value = why),
  )
  const done = out.v
  if (!ok || !done) return
  ElMessage.success(rollback ? `已回滚至 v${done.versionId}` : `v${done.versionId} 已发布生效`)
  await loadList()
  show(done)
}

/** 对比：滚到「与生效版本的差异」 */
const diffCard = ref<HTMLElement>()
function compare() {
  diffCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 固定操作条「保存草稿 / 对比 / 发布 / 回滚」：按钮一直在，不能用时置灰，原因写在操作条里 */
const isActive = computed(() => !!current.value && current.value.versionId === active.value?.versionId)
const canCompare = computed(() => !!active.value && !!current.value && !isActive.value)
const barHint = computed(() => {
  const c = current.value
  if (!c) return ''
  if (c.status === 'ACTIVE') return '生效版本只读：如需调整请新建草稿；对比、发布、回滚针对草稿或归档版本'
  if (c.status === 'ARCHIVED') return canPublish.value ? '归档版本只读，可回滚至此版本' : '归档版本只读；回滚需超级管理员操作'
  if (!canPublish.value) return '发布需超级管理员操作'
  return dirty.value ? '' : '草稿没有未保存的修改'
})
const draftState = computed(() => {
  const d = draft.value
  if (!d) return '无草稿'
  if (current.value?.versionId === d.versionId && dirty.value) return `v${d.versionId} 有未保存的修改`
  return `v${d.versionId} 已保存，待发布`
})

// ---------- 分档编辑
function addTier(list: { [k: string]: number | null }[], key: string, template: Record<string, number | null>) {
  // 插在「以上」档之前；新上限 = 前一档上限 + 10
  const prev = list.length >= 2 ? list[list.length - 2][key] : null
  list.splice(Math.max(0, list.length - 1), 0, { ...template, [key]: (prev ?? 0) + 10 })
}
function addDistance() {
  if (form.value) addTier(form.value.distanceScore as never, 'maxKm', { maxKm: null, score: 50 })
}
function addDecay() {
  if (form.value) addTier(form.value.decay as never, 'maxDays', { maxDays: null, factor: 0.5 })
}
function addCredit() {
  if (!form.value) return
  const used = new Set(form.value.credit.map((t) => t.minScore))
  let s = 50
  while (used.has(s) && s < 100) s += 5
  form.value.credit.push({ minScore: s, factor: 1 })
  form.value.credit.sort((a, b) => b.minScore - a.minScore)
}
function sortCredit() {
  form.value?.credit.sort((a, b) => b.minScore - a.minScore)
}
type Optional = 'lowConversion' | 'penalty' | 'quota' | 'newJobBoost'
function toggle(key: Optional, on: boolean) {
  if (!form.value) return
  ;(form.value as unknown as Record<Optional, unknown>)[key] = on ? { ...DEFAULTS[key] } : null
}

const sum = computed(() => (form.value ? weightSum(form.value.factorWeights) : 0))
const changes = computed(() => {
  if (!form.value || !active.value || current.value?.versionId === active.value.versionId) return []
  return diff(normalize(active.value.config), form.value)
})

// ---------- 未保存提示
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  return confirmAction('放弃修改', '当前草稿有未保存的修改，离开将丢失这些修改。确定离开？', true)
})
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>匹配引擎参数</h2>
        <p>软打分因子权重、距离分档、挂岗衰减、诚信 / 处罚 / 名额系数、展示阈值与同公司上限 · 版本化：草稿 → 发布（仅超管），可回滚</p>
      </div>
      <div class="spacer" />
      <el-button :type="current?.status === 'DRAFT' ? 'default' : 'primary'" :loading="acting && !current" :disabled="!loaded" @click="createDraft">{{ draft ? '继续编辑草稿' : '新建草稿' }}</el-button>
    </div>

    <div v-if="!loaded" v-loading="loading" class="card">
      <div v-if="loading" class="wait" />
      <div v-else class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>引擎参数加载失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" @click="init">重新加载</el-button>
      </div>
    </div>

    <div v-else-if="versions.length === 0" class="card">
      <div class="state-box">
        <IconInbox :size="48" />
        <h4>还没有引擎参数版本</h4>
        <p>新建草稿，调好参数后发布生效</p>
        <el-button type="primary" :loading="acting" @click="createDraft"><IconPlus :size="16" />新建草稿</el-button>
      </div>
    </div>

    <template v-else>
      <!-- 有版本的配置（第 11 类）：顶部信息条「当前生效版本 · 草稿状态」，保存草稿 / 对比 / 发布 / 回滚的位置固定 -->
      <div class="card ver-bar">
        <div class="vb-row">
          <div class="vb-info">
            <span class="vb-k">当前生效版本</span>
            <b class="vb-v">{{ active ? `v${active.versionId}` : '暂无' }}</b>
            <span v-if="active?.publishedAt" class="t-xs">{{ fmtDateTime(active.publishedAt) }} 发布</span>
            <span class="vb-sep">·</span>
            <span class="vb-k">草稿状态</span>
            <b class="vb-v">{{ draftState }}</b>
          </div>
          <div class="vb-acts">
            <el-button type="primary" :loading="saving" :disabled="current?.status !== 'DRAFT' || !dirty || !!saveWhy" @click="save">保存草稿</el-button>
            <el-button :disabled="!canCompare" @click="compare">对比</el-button>
            <el-button type="danger" plain class="btn-reject" :loading="acting && current?.status === 'DRAFT'" :disabled="current?.status !== 'DRAFT' || !canPublish || saving || !!publishWhy" @click="current && publish(current)">发布</el-button>
            <el-button type="danger" plain class="btn-reject" :loading="acting && current?.status === 'ARCHIVED'" :disabled="current?.status !== 'ARCHIVED' || !canPublish || !!publishWhy" @click="current && publish(current)">回滚</el-button>
          </div>
        </div>
        <div v-if="current" class="vb-row vb-sub">
          <div class="vb-info">
            <span class="vb-k">正在查看</span>
            <b class="vb-v">v{{ current.versionId }}</b>
            <StatusTag type="VersionStatus" :value="current.status" />
            <span v-if="dirty" class="status-tag status-tag--warning">未保存</span>
            <template v-if="current.status === 'DRAFT'">
              <el-button link type="primary" :disabled="!dirty" @click="discard">撤销修改</el-button>
              <el-button link type="danger" :disabled="acting || saving" @click="remove(current)">删除草稿</el-button>
            </template>
          </div>
          <span v-if="barHint" class="t-xs">{{ barHint }}</span>
        </div>
        <p v-if="saveWhy || publishWhy" class="blocked-why vb-why" role="alert">{{ saveWhy || publishWhy }}</p>
      </div>

      <div class="layout">
        <div class="card side">
          <div class="card__hd"><h3>版本</h3><span v-if="!canPublish" class="t-xs">发布需超管</span></div>
          <div class="vlist">
            <button
              v-for="v in versions"
              :key="v.versionId"
              type="button"
              class="vitem"
              :class="{ on: current?.versionId === v.versionId }"
              @click="select(v.versionId)"
            >
              <div class="vrow">
                <b>v{{ v.versionId }}</b>
                <StatusTag type="VersionStatus" :value="v.status" />
              </div>
              <div class="t-xs">{{ v.publishedAt ? `${fmtDateTime(v.publishedAt)} 发布` : `${fmtDateTime(v.createdAt)} 创建` }}</div>
              <div v-if="v.publishedBy" class="t-xs">{{ v.publishedBy }}</div>
            </button>
          </div>
        </div>

        <div class="main">
          <div v-if="!current || !form" class="card">
            <div class="state-box"><IconInbox :size="48" /><h4>请选择版本</h4><p>在左边的版本列表里点一个版本查看参数</p></div>
          </div>
          <template v-else>
          <div v-if="localErrors.length" class="notice-bar notice-bar--warn gap">
            <IconTriangleExclamationPoint :size="16" class="notice-bar-i" />
            <div>
              <b>保存前需修正：</b>
              <ul class="errs"><li v-for="e in localErrors" :key="e">{{ e }}</li></ul>
            </div>
          </div>

          <fieldset class="fs" :disabled="readonly">
            <!-- 因子权重 -->
            <div class="card sec">
              <div class="card__hd">
                <h3>软打分因子权重</h3>
                <span class="sum" :class="sum === 100 ? 'ok' : 'bad'">合计 <b>{{ sum }}</b> / 100</span>
              </div>
              <div class="card__bd">
                <div class="factors">
                  <div v-for="f in FACTORS" :key="f.key" class="factor">
                    <label>{{ f.label }}</label>
                    <el-input-number v-model="form.factorWeights[f.key]" :min="0" :max="100" :step="1" :precision="0" :disabled="readonly" controls-position="right" />
                  </div>
                </div>
                <div class="wbar">
                  <i v-for="(f, i) in FACTORS" :key="f.key" :style="{ flex: form.factorWeights[f.key] || 0 }" :class="`c${i}`" :title="`${f.label} ${form.factorWeights[f.key]}`" />
                  <i v-if="sum < 100" class="gapw" :style="{ flex: 100 - sum }" />
                </div>
                <div class="chart-legend wlegend">
                  <span v-for="(f, k) in FACTORS" :key="f.key"><i :class="`c${k}`" />{{ f.label }}</span>
                </div>
              </div>
            </div>

            <div class="grid g-2">
              <!-- 距离分档 -->
              <div class="card sec">
                <div class="card__hd"><h3>距离得分分档</h3><el-button v-if="!readonly" size="small" link type="primary" @click="addDistance">+ 添加一档</el-button></div>
                <div class="card__bd">
                  <table class="tiers">
                    <thead><tr><th>距离 ≤ (km)</th><th>得分 0–100</th><th /></tr></thead>
                    <tbody>
                      <tr v-for="(t, i) in form.distanceScore" :key="i">
                        <td>
                          <span v-if="i === form.distanceScore.length - 1" class="above">以上（不限）</span>
                          <el-input-number v-else :model-value="t.maxKm ?? undefined" @update:model-value="(v: number | undefined) => (t.maxKm = v ?? null)" :min="1" :step="5" :precision="0" size="small" :disabled="readonly" controls-position="right" />
                        </td>
                        <td><el-input-number v-model="t.score" :min="0" :max="100" :step="5" :precision="0" size="small" :disabled="readonly" controls-position="right" /></td>
                        <td><el-button v-if="!readonly && form.distanceScore.length > 1" link size="small" type="danger" @click="form.distanceScore.splice(i, 1)">删除</el-button></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- 挂岗衰减 -->
              <div class="card sec">
                <div class="card__hd"><h3>挂岗天数衰减</h3><el-button v-if="!readonly" size="small" link type="primary" @click="addDecay">+ 添加一档</el-button></div>
                <div class="card__bd">
                  <table class="tiers">
                    <thead><tr><th>挂岗 ≤ (天)</th><th>系数 0–1</th><th /></tr></thead>
                    <tbody>
                      <tr v-for="(t, i) in form.decay" :key="i">
                        <td>
                          <span v-if="i === form.decay.length - 1" class="above">以上（不限）</span>
                          <el-input-number v-else :model-value="t.maxDays ?? undefined" @update:model-value="(v: number | undefined) => (t.maxDays = v ?? null)" :min="1" :step="1" :precision="0" size="small" :disabled="readonly" controls-position="right" />
                        </td>
                        <td><el-input-number v-model="t.factor" :min="0" :max="1" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></td>
                        <td><el-button v-if="!readonly && form.decay.length > 1" link size="small" type="danger" @click="form.decay.splice(i, 1)">删除</el-button></td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="row-opt">
                    <el-checkbox v-model="form.resetDecayOnHire" :disabled="readonly">有人入职后重置衰减计时</el-checkbox>
                  </div>
                </div>
              </div>

              <!-- 低转化 -->
              <div class="card sec">
                <div class="card__hd">
                  <h3>低转化降权</h3>
                  <el-switch :model-value="form.lowConversion != null" :disabled="readonly" @update:model-value="(v: string | number | boolean) => toggle('lowConversion', !!v)" />
                </div>
                <div class="card__bd">
                  <template v-if="form.lowConversion">
                    <div class="fields">
                      <label>挂岗满（天）<el-input-number v-model="form.lowConversion.minPostedDays" :min="0" :precision="0" size="small" :disabled="readonly" controls-position="right" /></label>
                      <label>且转化率 ≤<el-input-number v-model="form.lowConversion.maxConversionRate" :min="0" :max="1" :step="0.01" :precision="2" size="small" :disabled="readonly" controls-position="right" /></label>
                      <label>乘以系数<el-input-number v-model="form.lowConversion.factor" :min="0" :max="1" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></label>
                    </div>
                    <div class="fields">
                      <label>与挂岗衰减合并方式
                        <el-radio-group v-model="form.combineDecayAndConversion" size="small" :disabled="readonly">
                          <el-radio-button value="MIN">取较小值 MIN</el-radio-button>
                          <el-radio-button value="MULTIPLY">相乘 MULTIPLY</el-radio-button>
                        </el-radio-group>
                      </label>
                    </div>
                  </template>
                  <div v-else class="t-xs">未启用：不按转化率降权</div>
                </div>
              </div>

              <!-- 诚信分档 -->
              <div class="card sec">
                <div class="card__hd"><h3>诚信分系数</h3><el-button v-if="!readonly" size="small" link type="primary" @click="addCredit">+ 添加一档</el-button></div>
                <div class="card__bd">
                  <table class="tiers">
                    <thead><tr><th>诚信分 ≥</th><th>系数 0–2</th><th /></tr></thead>
                    <tbody>
                      <tr v-for="(t, i) in form.credit" :key="i">
                        <td><el-input-number v-model="t.minScore" :min="0" :max="100" :precision="0" size="small" :disabled="readonly" controls-position="right" @blur="sortCredit" /></td>
                        <td><el-input-number v-model="t.factor" :min="0" :max="2" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></td>
                        <td><el-button v-if="!readonly && form.credit.length > 1" link size="small" type="danger" @click="form.credit.splice(i, 1)">删除</el-button></td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="t-xs">从高到低匹配第一档；必须包含 0 分档兜底</div>
                </div>
              </div>

              <!-- 处罚 / 名额 / 新岗 -->
              <div class="card sec">
                <div class="card__hd">
                  <h3>处罚系数</h3>
                  <el-switch :model-value="form.penalty != null" :disabled="readonly" @update:model-value="(v: string | number | boolean) => toggle('penalty', !!v)" />
                </div>
                <div class="card__bd">
                  <div v-if="form.penalty" class="fields">
                    <label>二级（限流）<el-input-number v-model="form.penalty.level2" :min="0" :max="1" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></label>
                    <label>三级（封禁）<el-input-number v-model="form.penalty.level3" :min="0" :max="1" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></label>
                  </div>
                  <div v-else class="t-xs">未启用：处罚不影响匹配权重</div>
                </div>
              </div>

              <div class="card sec">
                <div class="card__hd">
                  <h3>名额将满 · 新岗加权</h3>
                </div>
                <div class="card__bd">
                  <div class="fields">
                    <el-switch :model-value="form.quota != null" :disabled="readonly" active-text="名额将满降权" @update:model-value="(v: string | number | boolean) => toggle('quota', !!v)" />
                  </div>
                  <div v-if="form.quota" class="fields">
                    <label>剩余名额 ≤<el-input-number v-model="form.quota.lowRemaining" :min="0" :precision="0" size="small" :disabled="readonly" controls-position="right" /></label>
                    <label>乘以系数<el-input-number v-model="form.quota.factor" :min="0" :max="1" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></label>
                  </div>
                  <div class="fields">
                    <el-switch :model-value="form.newJobBoost != null" :disabled="readonly" active-text="新岗位加权" @update:model-value="(v: string | number | boolean) => toggle('newJobBoost', !!v)" />
                  </div>
                  <div v-if="form.newJobBoost" class="fields">
                    <label>上架 ≤（天）<el-input-number v-model="form.newJobBoost.maxDays" :min="0" :precision="0" size="small" :disabled="readonly" controls-position="right" /></label>
                    <label>乘以系数<el-input-number v-model="form.newJobBoost.factor" :min="0" :max="2" :step="0.05" :precision="2" size="small" :disabled="readonly" controls-position="right" /></label>
                  </div>
                </div>
              </div>
            </div>

            <!-- 展示 -->
            <div class="card sec">
              <div class="card__hd"><h3>结果展示</h3></div>
              <div class="card__bd">
                <div class="fields">
                  <label>展示阈值（匹配分 ≥）<el-input-number v-model="form.displayThreshold" :min="0" :max="100" :precision="0" size="small" :disabled="readonly" controls-position="right" /></label>
                  <label>结果条数（1–20）<el-input-number v-model="form.resultCount" :min="1" :max="20" :precision="0" size="small" :disabled="readonly" controls-position="right" /></label>
                  <label>公域同公司上限（≤ 结果条数）<el-input-number v-model="form.maxPerCompanyPublic" :min="1" :max="form.resultCount" :precision="0" size="small" :disabled="readonly" controls-position="right" /></label>
                </div>
              </div>
            </div>
          </fieldset>

          <!-- 与生效版本对比（操作条上的「对比」滚到这里） -->
          <div v-if="active && current.versionId !== active.versionId" ref="diffCard" class="card sec diff">
            <div class="card__hd">
              <h3>与生效版本 v{{ active.versionId }} 的差异</h3>
              <span class="t-xs">{{ changes.length }} 项{{ dirty ? '（含未保存修改）' : '' }}</span>
            </div>
            <div v-if="changes.length === 0" class="state-box"><IconInbox :size="48" /><h4>与生效版本完全一致</h4><p>改动参数后，这里逐项列出和生效版本的差别</p></div>
            <el-table v-else :data="changes" class="ops-table tbl-48" row-key="path">
              <el-table-column label="参数" min-width="220"><template #default="{ row }">{{ row.label }}</template></el-table-column>
              <el-table-column label="生效版本" width="160"><template #default="{ row }"><span class="dim">{{ row.before }}</span></template></el-table-column>
              <el-table-column label="本版本" width="160"><template #default="{ row }"><span class="strong">{{ row.after }}</span></template></el-table-column>
            </el-table>
          </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wait { height: 320px; }
.ver-bar { padding: var(--space-3) var(--space-4); margin-bottom: var(--space-gap); }
.vb-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.vb-sub { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.vb-info { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--font-size-aux); min-width: 0; }
.vb-info .el-button { margin-left: var(--space-2); }
.vb-k { color: var(--text-2); }
.vb-v { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.vb-sep { color: var(--text-3); margin: 0 var(--space-2); }
/* 四个按钮固定在操作条右侧，同一顺序，不能用时只置灰不隐藏 */
.vb-acts { display: flex; gap: var(--space-2); margin-left: auto; }
.vb-acts .el-button + .el-button { margin-left: 0; }
.vb-why { margin-top: var(--space-2); text-align: right; }
.layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: var(--space-gap); align-items: start; }
.side { position: sticky; top: calc(var(--layout-top-height) + var(--space-4)); }
.vlist { padding: var(--space-2); }
.vitem { display: block; width: 100%; text-align: left; padding: var(--space-2) var(--space-3); border: 1px solid transparent; border-radius: var(--radius-control); background: transparent; cursor: pointer; font-family: inherit; margin-bottom: 2px; }
.vitem:hover { background: var(--bg-hover); }
.vitem.on { border-color: var(--primary-line); background: var(--primary-bg); }
.vrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.vrow b { color: var(--text-1); font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); }
.main { min-width: 0; }
.gap { margin-bottom: var(--space-3); }
.errs { margin: var(--space-1) 0 0; padding-left: 18px; }
.fs { border: 0; margin: 0; padding: 0; min-width: 0; }
.sec { margin-bottom: var(--space-3); }
.grid.g-2 { gap: var(--space-3); margin-bottom: var(--space-3); }
.grid.g-2 .sec { margin-bottom: 0; }
.sum { font-size: var(--font-size-aux); color: var(--text-2); }
.sum b { font-variant-numeric: tabular-nums; }
.sum.ok b { color: var(--success-text); }
.sum.bad { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
.factors { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--space-3); }
@media (max-width: 1280px) { .factors { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.factor label { display: block; font-size: var(--font-size-min); color: var(--text-2); margin-bottom: var(--space-1); }
.factor :deep(.el-input-number) { width: 100%; }
/* 权重占比条：六个因子用图表分类色 --chart-1…6，不足 100 的部分用浅危险底斜纹 */
.wbar { display: flex; height: 8px; border-radius: var(--radius-tag); overflow: hidden; margin-top: var(--space-3); background: var(--bg-fill); }
.wbar i { display: block; min-width: 0; }
.wbar .c0, .wlegend .c0 { background: var(--chart-1); }
.wbar .c1, .wlegend .c1 { background: var(--chart-2); }
.wbar .c2, .wlegend .c2 { background: var(--chart-3); }
.wbar .c3, .wlegend .c3 { background: var(--chart-4); }
.wbar .c4, .wlegend .c4 { background: var(--chart-5); }
.wbar .c5, .wlegend .c5 { background: var(--chart-6); }
.wbar .gapw { background: repeating-linear-gradient(45deg, var(--danger-soft), var(--danger-soft) 4px, transparent 4px, transparent 8px); }
.wlegend { margin-top: var(--space-2); }
.tiers { width: 100%; border-collapse: collapse; font-size: var(--font-size-aux); }
.tiers th { text-align: left; font-weight: var(--font-weight-medium); color: var(--text-2); font-size: var(--font-size-min); padding: 0 var(--space-2) var(--space-2) 0; }
.tiers td { padding: var(--space-1) var(--space-2) var(--space-1) 0; }
.tiers :deep(.el-input-number) { width: 130px; }
.above { display: inline-block; width: 130px; color: var(--text-2); font-size: var(--font-size-min); }
.row-opt { margin-top: var(--space-2); }
.fields { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-4); align-items: center; margin-bottom: var(--space-2); }
.fields label { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-2); }
.fields :deep(.el-input-number) { width: 130px; }
</style>
