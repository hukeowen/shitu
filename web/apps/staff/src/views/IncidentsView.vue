<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type IncidentRow, type IncidentSeverity, type ProjectView } from '@shitu/api-client'
import { IconCheck, IconCircleExclamationPoint, IconShieldCheck, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'
import { useAuthStore } from '@/stores/auth'
import { fmtFull, parseLocal } from '@/utils/time'

/** 工伤上报（T-405）：现场第一时间上报，老板和项目经理立刻收到站内信与短信；处理完由项目经理登记结论结案 */
const router = useRouter()
const auth = useAuthStore()
/** 结案只对项目经理 / 老板开放（后端同样限制），驻场只能上报和查看 */
const canClose = computed(() => (auth.me?.roles ?? []).some((r) => r === 'PM' || r === 'OWNER'))
const { label, options } = useDict()
const SEV_TONE: Record<IncidentSeverity, string> = { MINOR: 'status-tag--info', SERIOUS: 'status-tag--warning', CRITICAL: 'status-tag--danger' }

const rows = ref<IncidentRow[]>([])
const projects = ref<ProjectView[]>([])
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await tenantApi.incidents()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  void load()
  try {
    projects.value = await tenantApi.projects()
  } catch {
    projects.value = []
  }
})

function nowLocal() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
}
type Field = 'projectId' | 'personName' | 'occurredAt' | 'detail'
const form = reactive({ open: false, projectId: '', personName: '', severity: 'SERIOUS' as IncidentSeverity, occurredAt: '', detail: '', saving: false })
/** 校验没通过：原因写在字段下方；提交被拒：原因留在提交按钮上方，业务拒绝时按钮置灰，改了内容后可再提交 */
const errs = reactive<Partial<Record<Field, string>>>({})
const submitError = ref('')
const rejected = ref(false)
watch(() => [form.projectId, form.personName, form.severity, form.occurredAt, form.detail], () => {
  rejected.value = false
  submitError.value = ''
})
function openReport() {
  Object.assign(form, { open: true, projectId: projects.value.length === 1 ? projects.value[0].projectId : '', personName: '', severity: 'SERIOUS', occurredAt: nowLocal(), detail: '' })
  for (const k of Object.keys(errs) as Field[]) delete errs[k]
}
function invalid(field: Field, msg: string) {
  errs[field] = msg
  showToast(msg)
  void nextTick(() => document.querySelector(`.sheet [data-field="${field}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}
async function submit() {
  for (const k of Object.keys(errs) as Field[]) delete errs[k]
  if (!form.projectId) return invalid('projectId', '请选择项目')
  if (!form.personName.trim()) return invalid('personName', '请填写受伤人员姓名')
  if (!form.occurredAt) return invalid('occurredAt', '请填写发生时间')
  if (form.detail.trim().length < 5) return invalid('detail', '请描述事发经过（至少 5 个字）')
  form.saving = true
  submitError.value = ''
  try {
    await tenantApi.reportIncident({
      projectId: form.projectId, personName: form.personName.trim(), severity: form.severity, occurredAt: form.occurredAt + ':00', detail: form.detail.trim(),
    })
    showToast('已上报，老板和项目经理会立刻收到通知')
    form.open = false
    await load()
  } catch (e) {
    showToast(errorMessage(e, '上报失败'))
    submitError.value = errorMessage(e, '上报失败')
    rejected.value = isApiError(e) && e.code !== 'NETWORK'
  } finally {
    form.saving = false
  }
}

/** 结案：登记处理结论（必填，至少 2 个字）。被后端业务拒绝时按钮置灰、原因留在按钮上方，改了结论后可再提交 */
const closing = reactive({ open: false, row: null as IncidentRow | null, note: '', saving: false })
const noteError = ref('')
const closeError = ref('')
const closeRejected = ref(false)
watch(() => closing.note, () => {
  noteError.value = ''
  closeError.value = ''
  closeRejected.value = false
})
function openClose(row: IncidentRow) {
  Object.assign(closing, { open: true, row, note: '' })
  noteError.value = ''
  closeError.value = ''
  closeRejected.value = false
}
async function submitClose() {
  const row = closing.row
  if (!row || closing.saving) return
  const note = closing.note.trim()
  if (note.length < 2) {
    noteError.value = '请填写处理结论'
    showToast('请填写处理结论')
    return
  }
  closing.saving = true
  closeError.value = ''
  try {
    await tenantApi.closeIncident(row.id, note)
    showSuccessToast('已结案')
    closing.open = false
    await load()
  } catch (e) {
    showToast(errorMessage(e, '操作失败'))
    closeError.value = errorMessage(e, '操作失败')
    closeRejected.value = isApiError(e) && e.code !== 'NETWORK'
  } finally {
    closing.saving = false
  }
}

const full = (v?: string) => {
  const d = parseLocal(v)
  return d ? fmtFull(d) : '—'
}
function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/me')
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="工伤上报" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <div class="pad stack">
      <div class="tipbar tipbar--danger">
        <IconTriangleExclamationPoint :size="20" />
        <p class="tipbar-d first">人员安全第一：先拨打 120 / 送医并保护现场，再来这里上报。</p>
      </div>

      <div class="sec-hd"><h2>上报记录</h2></div>
      <div v-if="loading && rows.length === 0" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ loadError }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="load">重新加载</van-button>
      </div>
      <div v-else-if="rows.length === 0" class="state-block">
        <IconShieldCheck :size="48" />
        <p class="state-block-t">暂无工伤记录</p>
        <p class="state-block-d">发生工伤时点下方「上报工伤」</p>
      </div>
      <article v-for="r in rows" :key="r.id" class="acard">
        <div class="item-hd">
          <h3>{{ r.personName }}</h3>
          <span class="tags">
            <span class="status-tag" :class="SEV_TONE[r.severity]">{{ label('IncidentSeverity', r.severity) }}</span>
            <span class="status-tag" :class="r.status === 'OPEN' ? 'status-tag--warning' : 'status-tag--success'">{{ label('IncidentStatus', r.status) }}</span>
          </span>
        </div>
        <p class="item-meta">{{ r.projectName }} · {{ full(r.occurredAt) }}</p>
        <p class="content">{{ r.detail }}</p>
        <p class="item-meta">{{ r.reportedByName || '—' }} 上报</p>
        <!-- .reply 保留换行（pre-wrap），结论和结案人写在同一行模板里，避免多出空行 -->
        <div v-if="r.handleNote" class="reply"><b>处理结论</b>{{ r.handleNote }}<p v-if="r.closedByName || r.closedAt" class="reply-by">{{ r.closedByName || '—' }} 结案<template v-if="r.closedAt"> · {{ full(r.closedAt) }}</template></p></div>
        <div v-if="canClose && r.status === 'OPEN'" class="acts">
          <van-button plain type="primary" class="act" @click="openClose(r)">结案</van-button>
        </div>
      </article>
      <div class="bottom-bar-gap" />
    </div>
    <div class="bottom-bar">
      <van-button block type="primary" size="large" @click="openReport">上报工伤</van-button>
    </div>

    <van-popup v-model:show="form.open" position="bottom" round safe-area-inset-bottom :close-on-click-overlay="false" class="sheet">
      <div class="sheet-hd">
        <h3>上报工伤</h3>
        <button type="button" class="x" aria-label="关闭" @click="form.open = false"><IconX :size="20" /></button>
      </div>
      <div class="sheet-bd">
        <van-cell-group inset class="grp">
          <van-field label="项目" required data-field="projectId" :error-message="errs.projectId">
            <template #input>
              <select v-model="form.projectId" class="ctl">
                <option value="" disabled>选择发生工伤的项目</option>
                <option v-for="p in projects" :key="p.projectId" :value="p.projectId">{{ p.name }}</option>
              </select>
            </template>
          </van-field>
          <van-field v-model="form.personName" label="受伤人员" required maxlength="30" placeholder="姓名" data-field="personName" :error-message="errs.personName" />
          <van-field label="伤情" required center>
            <template #input>
              <div class="seg" role="radiogroup" aria-label="伤情">
                <button
                  v-for="o in options('IncidentSeverity')"
                  :key="o.value"
                  type="button"
                  role="radio"
                  :aria-checked="form.severity === o.value"
                  :class="{ on: form.severity === o.value }"
                  @click="form.severity = o.value as IncidentSeverity"
                >
                  <IconCheck v-if="form.severity === o.value" :size="14" :stroke-width="2.25" />{{ o.label }}
                </button>
              </div>
            </template>
          </van-field>
          <van-field label="发生时间" required data-field="occurredAt" :error-message="errs.occurredAt">
            <template #input><input v-model="form.occurredAt" type="datetime-local" class="ctl" :max="nowLocal()" /></template>
          </van-field>
          <van-field
            v-model="form.detail"
            label="事发经过"
            required
            type="textarea"
            rows="4"
            maxlength="500"
            show-word-limit
            label-align="top"
            placeholder="哪里、怎么受的伤、现在人在哪、已经做了什么处置"
            data-field="detail"
            :error-message="errs.detail"
          />
        </van-cell-group>
      </div>
      <div class="foot">
        <p v-if="submitError" class="bar-why err" role="status">没有上报成功：{{ submitError }}</p>
        <van-button block type="primary" size="large" :loading="form.saving" loading-text="上报中…" :disabled="rejected" @click="submit">立即上报</van-button>
      </div>
    </van-popup>

    <van-popup v-model:show="closing.open" position="bottom" round safe-area-inset-bottom :close-on-click-overlay="false" class="sheet">
      <div class="sheet-hd">
        <h3>登记处理结论</h3>
        <button type="button" class="x" aria-label="关闭" @click="closing.open = false"><IconX :size="20" /></button>
      </div>
      <div v-if="closing.row" class="sheet-bd">
        <div class="close-sum">
          <p class="close-who"><b>{{ closing.row.personName }}</b> · {{ closing.row.projectName }} · {{ full(closing.row.occurredAt) }}</p>
          <p class="content box">{{ closing.row.detail }}</p>
        </div>
        <van-cell-group inset class="grp">
          <van-field
            v-model="closing.note"
            label="处理结论"
            required
            type="textarea"
            rows="4"
            maxlength="500"
            show-word-limit
            label-align="top"
            placeholder="救治情况、是否已申报工伤认定、费用如何处理等"
            :error-message="noteError"
          />
        </van-cell-group>
        <p class="close-hint">这里只做内部留痕。工伤认定须在事故发生之日起 30 日内向社保部门申请。</p>
      </div>
      <div class="foot">
        <p v-if="closeError" class="bar-why err" role="status">暂时不能结案：{{ closeError }}</p>
        <van-button block type="primary" size="large" :loading="closing.saving" loading-text="提交中…" :disabled="closeRejected" @click="submitClose">结案</van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; }
.tipbar-d.first { margin-top: 0; }
.sec-hd { min-height: 32px; }
.tags { flex: none; display: inline-flex; gap: var(--space-1); }
.content { margin: var(--space-2) 0 var(--space-1); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.reply { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--success-soft); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.reply b { margin-right: var(--space-2); font-weight: var(--font-weight-semibold); color: var(--success-text); }
.reply-by { margin-top: var(--space-1); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.acts { display: flex; margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.act { flex: 1; min-width: 0; font-weight: var(--font-weight-medium); }
.close-sum { padding: 0 var(--space-4) var(--space-3); }
.close-who { font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); overflow-wrap: anywhere; }
.close-who b { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.box { max-height: 132px; overflow-y: auto; margin-bottom: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-card); }
.close-hint { padding: var(--space-3) var(--space-4) 0; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.sheet { display: flex; flex-direction: column; max-height: 90vh; background: var(--bg-page); }
.sheet-hd { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-4) 0; }
.sheet-hd h3 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.x { width: 44px; height: 44px; display: grid; place-items: center; margin-right: calc(var(--space-3) * -1); padding: 0; border: 0; background: none; color: var(--text-3); }
.sheet-bd { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-2) 0; }
.grp { margin: 0; }
.ctl { width: 100%; min-width: 0; padding: 0; border: 0; background: none; font: inherit; font-size: var(--font-size-body); color: var(--text-1); }
.seg { display: flex; gap: var(--space-2); width: 100%; }
.seg button { flex: 1; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-height: 44px; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-body); color: var(--text-2); }
.seg button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
/* 选中除了变色还带勾；三格等宽，带勾不改变宽度 */
.seg button.on { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.foot { padding: var(--space-2) var(--space-4); background: var(--bg-card); border-top: 1px solid var(--border); }
.foot .bar-why { justify-content: flex-start; margin-bottom: var(--space-2); text-align: left; }
</style>
