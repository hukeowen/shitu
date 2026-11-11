<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, tenantApi, useDict, type IncidentRow, type IncidentSeverity, type ProjectView } from '@shitu/api-client'
import { fmtFull, parseLocal } from '@/utils/time'

/** 工伤上报（T-405）：现场第一时间上报，老板和项目经理立刻收到站内信与短信 */
const router = useRouter()
const { label, options } = useDict()
const SEV_TAG: Record<IncidentSeverity, string> = { MINOR: 'tag-info', SERIOUS: 'tag-warn', CRITICAL: 'tag-danger' }

const rows = ref<IncidentRow[]>([])
const projects = ref<ProjectView[]>([])
const loading = ref(false)
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
const form = reactive({ open: false, projectId: '', personName: '', severity: 'SERIOUS' as IncidentSeverity, occurredAt: '', detail: '', saving: false })
function openReport() {
  Object.assign(form, { open: true, projectId: projects.value.length === 1 ? projects.value[0].projectId : '', personName: '', severity: 'SERIOUS', occurredAt: nowLocal(), detail: '' })
}
async function submit() {
  if (!form.projectId) return void showToast('请选择项目')
  if (!form.personName.trim()) return void showToast('请填写受伤人员姓名')
  if (!form.occurredAt) return void showToast('请填写发生时间')
  if (form.detail.trim().length < 5) return void showToast('请描述事发经过（至少 5 个字）')
  form.saving = true
  try {
    await tenantApi.reportIncident({
      projectId: form.projectId, personName: form.personName.trim(), severity: form.severity, occurredAt: form.occurredAt + ':00', detail: form.detail.trim(),
    })
    showToast('已上报，老板和项目经理会立刻收到通知')
    form.open = false
    await load()
  } catch (e) {
    showToast(errorMessage(e, '上报失败'))
  } finally {
    form.saving = false
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
    <van-nav-bar title="工伤上报" left-arrow safe-area-inset-top @click-left="back" />
    <div class="pad stack">
      <div class="warn">人员安全第一：先拨打 120 / 送医并保护现场，再来这里上报。</div>
      <van-button block type="danger" class="btn-cta" @click="openReport">上报工伤</van-button>

      <div v-if="loading && rows.length === 0" class="state"><van-loading size="24" vertical>加载中…</van-loading></div>
      <van-empty v-else-if="loadError" image="error" :description="loadError">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
      <van-empty v-else-if="rows.length === 0" description="暂无工伤记录" />
      <section v-for="r in rows" :key="r.id" class="acard">
        <div class="acard-hd">
          <h4>{{ r.personName }} <span class="tag" :class="SEV_TAG[r.severity]">{{ label('IncidentSeverity', r.severity) }}</span></h4>
          <span class="tag" :class="r.status === 'OPEN' ? 'tag-warn' : 'tag-ok'">{{ label('IncidentStatus', r.status) }}</span>
        </div>
        <div class="t-xs">{{ r.projectName }} · <span class="num">{{ full(r.occurredAt) }}</span></div>
        <p class="content">{{ r.detail }}</p>
        <div class="t-xs">{{ r.reportedByName || '—' }} 上报</div>
        <div v-if="r.handleNote" class="reply"><b>处理结论</b>{{ r.handleNote }}</div>
      </section>
      <div class="page-bottom-gap" />
    </div>

    <van-popup v-model:show="form.open" position="bottom" round safe-area-inset-bottom :close-on-click-overlay="false" class="sheet">
      <div class="sheet-hd"><b>上报工伤</b><van-icon name="cross" @click="form.open = false" /></div>
      <div class="sheet-bd">
        <label class="fld"><span>项目</span>
          <select v-model="form.projectId">
            <option value="" disabled>选择发生工伤的项目</option>
            <option v-for="p in projects" :key="p.projectId" :value="p.projectId">{{ p.name }}</option>
          </select>
        </label>
        <label class="fld"><span>受伤人员</span><input v-model="form.personName" maxlength="30" placeholder="姓名" /></label>
        <div class="fld"><span>伤情</span>
          <div class="seg">
            <button v-for="o in options('IncidentSeverity')" :key="o.value" type="button" :class="{ on: form.severity === o.value }" @click="form.severity = o.value as IncidentSeverity">{{ o.label }}</button>
          </div>
        </div>
        <label class="fld"><span>发生时间</span><input v-model="form.occurredAt" type="datetime-local" :max="nowLocal()" /></label>
        <label class="fld col"><span>事发经过</span>
          <textarea v-model="form.detail" rows="4" maxlength="500" placeholder="哪里、怎么受的伤、现在人在哪、已经做了什么处置" />
        </label>
        <van-button block type="danger" class="btn-cta" :loading="form.saving" @click="submit">立即上报</van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; }
.state { padding: 40px 0; }
.warn { padding: 10px 12px; border-radius: var(--r-md); background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-line); font-size: 13px; line-height: 1.6; }
.content { margin: 8px 0 6px; font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--ink-800); }
.reply { margin-top: 8px; padding: 8px 10px; border-left: 3px solid var(--ok); background: var(--muted-bg); border-radius: var(--r-sm); font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.reply b { color: var(--ok); margin-right: 6px; font-size: 12px; }
.sheet-hd { display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 8px; font-size: 16px; }
.sheet-bd { padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.fld { display: flex; align-items: center; gap: 12px; font-size: 14px; }
.fld > span { width: 70px; flex: none; color: var(--ink-600); }
.fld.col { flex-direction: column; align-items: stretch; gap: 6px; }
.fld input, .fld select, .fld textarea { flex: 1; min-width: 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); font: inherit; color: var(--ink-900); }
.fld textarea { resize: none; line-height: 1.6; }
.seg { display: flex; gap: 8px; flex: 1; }
.seg button { flex: 1; padding: 8px 0; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); font: inherit; color: var(--ink-700); }
.seg button.on { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); font-weight: 700; }
</style>
