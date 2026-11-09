<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type EngineVersion } from '@shitu/api-client'
import StatusTag from '@/components/StatusTag.vue'
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
const loading = ref(false)
const error = ref('')
const active = computed(() => versions.value.find((v) => v.status === 'ACTIVE') ?? null)
const draft = computed(() => versions.value.find((v) => v.status === 'DRAFT') ?? null)

const current = shallowRef<EngineVersion | null>(null)
const form = ref<EngineConfig | null>(null)
const saved = ref('')
const saving = ref(false)
const acting = ref(false)
const serverError = ref('')

const readonly = computed(() => current.value?.status !== 'DRAFT')
const snapshot = () => (form.value ? JSON.stringify(toPayload(form.value)) : '')
const dirty = computed(() => !readonly.value && !!form.value && snapshot() !== saved.value)

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    versions.value = await opsApi.engineVersions()
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    versions.value = []
  } finally {
    loading.value = false
  }
}

function show(v: EngineVersion) {
  current.value = v
  form.value = normalize(v.config)
  saved.value = snapshot()
  serverError.value = ''
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

onMounted(async () => {
  await loadList()
  const want = Number(route.query.v)
  const pick = versions.value.find((v) => v.versionId === want) ?? draft.value ?? active.value ?? versions.value[0]
  if (pick) show(pick)
})

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
  serverError.value = ''
  if (localErrors.value.length) {
    serverError.value = localErrors.value[0]
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
    serverError.value = errorMessage(e, '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

function discard() {
  if (current.value) show(current.value)
}

async function remove(v: EngineVersion) {
  if (!(await confirmAction('删除草稿', `确定删除草稿 v${v.versionId}？删除后不可恢复。`, true))) return
  acting.value = true
  try {
    await opsApi.engineDelete(v.versionId)
    ElMessage.success('草稿已删除')
    saved.value = snapshot() // 避免离开提示
    await loadList()
    const next = active.value ?? versions.value[0]
    if (next) show(next)
    else current.value = form.value = null
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = false
  }
}

async function publish(v: EngineVersion) {
  if (v.status === 'DRAFT' && current.value?.versionId === v.versionId && dirty.value) {
    if (!(await save())) return
  }
  const rollback = v.status === 'ARCHIVED'
  const changes = active.value ? diff(normalize(active.value.config), normalize(v.config)).length : 0
  const ok = await confirmAction(
    rollback ? '回滚引擎参数' : '发布引擎参数',
    `${rollback ? '回滚至' : '发布'} v${v.versionId}（相对当前生效版本 ${changes} 项变化）后，将立即影响全平台的匹配打分、岗位权重与展示结果。${active.value ? `当前生效版本 v${active.value.versionId} 将被归档。` : ''}确定继续？`,
    true,
  )
  if (!ok) return
  acting.value = true
  try {
    const r = await opsApi.enginePublish(v.versionId)
    ElMessage.success(rollback ? `已回滚至 v${r.versionId}` : `v${r.versionId} 已发布生效`)
    await loadList()
    show(r)
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = false
  }
}

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
      <span class="ref">原型 <b>P-13</b></span>
      <el-button type="primary" :loading="acting && !current" @click="createDraft">{{ draft ? '继续编辑草稿' : '新建草稿' }}</el-button>
    </div>

    <div class="layout">
      <div class="card side">
        <div class="card__hd"><h3>版本</h3><span v-if="!canPublish" class="t-xs">发布需超管</span></div>
        <div v-loading="loading" class="vlist">
          <el-empty v-if="error" :image-size="48" :description="error"><el-button size="small" @click="loadList">重试</el-button></el-empty>
          <el-empty v-else-if="versions.length === 0 && !loading" :image-size="48" description="暂无版本" />
          <button
            v-for="v in versions"
            :key="v.versionId"
            type="button"
            class="vitem"
            :class="{ on: current?.versionId === v.versionId }"
            @click="select(v.versionId)"
          >
            <div class="vrow">
              <b class="mono">v{{ v.versionId }}</b>
              <StatusTag type="VersionStatus" :value="v.status" variant="tag" />
            </div>
            <div class="t-xs mono">{{ v.publishedAt ? `${fmtDateTime(v.publishedAt)} 发布` : `${fmtDateTime(v.createdAt)} 创建` }}</div>
            <div v-if="v.publishedBy" class="t-xs mono">{{ v.publishedBy }}</div>
          </button>
        </div>
      </div>

      <div class="main">
        <div v-if="!current || !form" class="card"><el-empty :image-size="64" description="请选择版本" /></div>
        <template v-else>
          <div class="card bar">
            <div class="bar-l">
              <h3>v{{ current.versionId }}</h3>
              <StatusTag type="VersionStatus" :value="current.status" variant="tag" />
              <span v-if="dirty" class="tag tag--signal">未保存</span>
              <span v-if="readonly" class="t-xs">只读 · {{ current.status === 'ACTIVE' ? '如需调整请新建草稿' : '归档版本可回滚' }}</span>
            </div>
            <div class="bar-r">
              <template v-if="current.status === 'DRAFT'">
                <el-button :disabled="acting || saving" @click="remove(current)">删除草稿</el-button>
                <el-button :disabled="!dirty" @click="discard">撤销修改</el-button>
                <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存草稿</el-button>
                <el-button v-if="canPublish" type="danger" :loading="acting" :disabled="saving" @click="publish(current)">发布</el-button>
              </template>
              <el-button v-else-if="current.status === 'ARCHIVED' && canPublish" type="warning" :loading="acting" @click="publish(current)">回滚至此版本</el-button>
              <el-button v-else-if="current.status === 'ACTIVE'" type="primary" plain :loading="acting" @click="createDraft">{{ draft ? '编辑草稿' : '基于此版本新建草稿' }}</el-button>
            </div>
          </div>

          <div v-if="serverError" class="notice notice--danger gap">{{ serverError }}</div>
          <div v-else-if="localErrors.length" class="notice notice--warn gap">
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
                <span class="sum" :class="sum === 100 ? 'ok' : 'bad'">合计 <b class="mono">{{ sum }}</b> / 100</span>
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

          <!-- 与生效版本对比 -->
          <div v-if="active && current.versionId !== active.versionId" class="card sec">
            <div class="card__hd">
              <h3>与生效版本 v{{ active.versionId }} 的差异</h3>
              <span class="t-xs">{{ changes.length }} 项{{ dirty ? '（含未保存修改）' : '' }}</span>
            </div>
            <el-empty v-if="changes.length === 0" :image-size="40" description="与生效版本完全一致" />
            <el-table v-else :data="changes" class="ops-table" size="small" row-key="path">
              <el-table-column label="参数" min-width="220"><template #default="{ row }">{{ row.label }}</template></el-table-column>
              <el-table-column label="生效版本" width="160"><template #default="{ row }"><span class="mono dim">{{ row.before }}</span></template></el-table-column>
              <el-table-column label="本版本" width="160"><template #default="{ row }"><span class="mono strong">{{ row.after }}</span></template></el-table-column>
            </el-table>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 14px; align-items: start; }
.side { position: sticky; top: 66px; }
.vlist { padding: 6px; min-height: 80px; }
.vitem { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; cursor: pointer; font-family: inherit; margin-bottom: 2px; }
.vitem:hover { background: var(--surface-2); }
.vitem.on { border-color: var(--signal-300); background: var(--signal-50); }
.vrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.vrow b { color: var(--ink-900); font-size: 13px; }
.main { min-width: 0; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; margin-bottom: 12px; flex-wrap: wrap; }
.bar-l { display: flex; align-items: center; gap: 8px; }
.bar-l h3 { margin: 0; font-size: 16px; font-family: var(--f-mono); color: var(--ink-900); }
.bar-r { display: flex; gap: 6px; }
.gap { margin-bottom: 12px; }
.errs { margin: 4px 0 0; padding-left: 18px; }
.fs { border: 0; margin: 0; padding: 0; min-width: 0; }
.sec { margin-bottom: 12px; }
.grid.g-2 { gap: 12px; }
.grid.g-2 .sec { margin-bottom: 0; }
.grid.g-2 { margin-bottom: 12px; }
.sum { font-size: 12.5px; }
.sum.ok { color: var(--ok); }
.sum.bad { color: var(--danger); font-weight: 600; }
.factors { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 1280px) { .factors { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.factor label { display: block; font-size: 12px; color: var(--ink-500); margin-bottom: 4px; }
.factor :deep(.el-input-number) { width: 100%; }
.wbar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 12px; background: var(--line); }
.wbar i { display: block; min-width: 0; }
.wbar .c0 { background: var(--signal); }
.wbar .c1 { background: var(--temp); }
.wbar .c2 { background: var(--info); }
.wbar .c3 { background: var(--ok); }
.wbar .c4 { background: var(--warn); }
.wbar .c5 { background: var(--ink-400); }
.wbar .gapw { background: repeating-linear-gradient(45deg, var(--danger-bg), var(--danger-bg) 4px, transparent 4px, transparent 8px); }
.tiers { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tiers th { text-align: left; font-weight: 600; color: var(--ink-500); font-size: 12px; padding: 0 6px 6px 0; }
.tiers td { padding: 3px 6px 3px 0; }
.tiers :deep(.el-input-number) { width: 130px; }
.above { display: inline-block; width: 130px; color: var(--ink-500); font-size: 12px; }
.row-opt { margin-top: 8px; }
.fields { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-bottom: 8px; }
.fields label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-600); }
.fields :deep(.el-input-number) { width: 130px; }
</style>
