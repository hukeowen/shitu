<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type NotifyChannel, type NotifyTemplateView } from '@shitu/api-client'
import DictTags from '@/components/DictTags.vue'
import { confirmAction } from '@/composables/useRemark'
import { fmtDateTime, fmtOperator } from '@/utils/format'

/** P-16 通知模板：文案、渠道（站内信 / 短信）、是否遵守免打扰、启停；保存即生效，无需发版 */
const { options } = useDict()

const rows = shallowRef<NotifyTemplateView[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await opsApi.templates()
  } catch (e) {
    error.value = errorMessage(e, '加载失败，请稍后重试')
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
const shown = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return rows.value
  return rows.value.filter((r) => r.templateCode.toLowerCase().includes(k) || r.title.toLowerCase().includes(k) || r.content.toLowerCase().includes(k))
})

// ---------- 编辑抽屉
const TITLE_MAX = 64
const CONTENT_MAX = 500
const editing = shallowRef<NotifyTemplateView | null>(null)
const form = reactive({ title: '', content: '', channels: [] as NotifyChannel[], smsTemplateId: '', respectQuietHours: false, enabled: true })
const saving = ref(false)
const saveError = ref('')
const contentRef = ref<{ textarea?: HTMLTextAreaElement } | null>(null)
const titleRef = ref<{ input?: HTMLInputElement } | null>(null)
const lastFocus = ref<'title' | 'content'>('content')

const visible = computed({
  get: () => editing.value != null,
  set: (v) => {
    if (!v) void close()
  },
})
const snap = () => JSON.stringify(form)
let saved = ''
const dirty = computed(() => editing.value != null && snap() !== saved)

function open(t: NotifyTemplateView) {
  editing.value = t
  Object.assign(form, {
    title: t.title,
    content: t.content,
    channels: [...t.channels],
    smsTemplateId: t.smsTemplateId ?? '',
    respectQuietHours: t.respectQuietHours,
    enabled: t.enabled,
  })
  saved = snap()
  saveError.value = ''
}
function onBeforeClose() {
  void close()
}
async function close() {
  if (dirty.value && !(await confirmAction('放弃修改', '模板有未保存的修改，确定关闭？', true))) return
  editing.value = null
}

/** 在光标处插入 ${name} */
function insertVar(name: string) {
  const token = `\${${name}}`
  const isTitle = lastFocus.value === 'title'
  const el = isTitle ? titleRef.value?.input : contentRef.value?.textarea
  const key = isTitle ? 'title' : 'content'
  const cur = form[key]
  const start = el?.selectionStart ?? cur.length
  const end = el?.selectionEnd ?? cur.length
  form[key] = cur.slice(0, start) + token + cur.slice(end)
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

const usedVars = computed(() => {
  const s = new Set<string>()
  for (const m of `${form.title} ${form.content}`.matchAll(/\$\{([a-zA-Z][a-zA-Z0-9]*)}/g)) s.add(m[1])
  return s
})
const unknownVars = computed(() => [...usedVars.value].filter((v) => !editing.value?.variables.includes(v)))
const localError = computed(() => {
  if (!form.title.trim()) return '标题必填'
  if (form.title.trim().length > TITLE_MAX) return `标题最多 ${TITLE_MAX} 字`
  if (!form.content.trim()) return '内容必填'
  if (form.content.trim().length > CONTENT_MAX) return `内容最多 ${CONTENT_MAX} 字`
  if (form.channels.length === 0) return '至少选择一个渠道'
  if (unknownVars.value.length) return `不支持的变量：${unknownVars.value.map((v) => `\${${v}}`).join('、')}`
  if (/\$\{(?![a-zA-Z][a-zA-Z0-9]*})/.test(form.content)) return '变量格式应为 ${变量名}'
  return ''
})

// ---------- 预览：变量替换成示例值（本地即时渲染；后端预览接口只会把变量换成【变量名】，看不出实际效果）
/** 模板变量的中文含义与示例值；未登记的变量预览时显示为【变量名】 */
const VAR_META: Record<string, { label: string; sample: string }> = {
  seekerName: { label: '求职者姓名', sample: '张伟' },
  userName: { label: '用户姓名', sample: '张伟' },
  name: { label: '姓名 / 名称', sample: '张伟' },
  jobTitle: { label: '岗位名称', sample: '电子厂普工（长白班）' },
  companyName: { label: '公司名称', sample: '苏州恒达人力资源有限公司' },
  projectName: { label: '项目名称', sample: '昆山电子厂项目' },
  amount: { label: '金额（元）', sample: '500.00' },
  payable: { label: '应付金额（元）', sample: '1,280.00' },
  month: { label: '月份', sample: '2026-10' },
  result: { label: '处理结果', sample: '已通过' },
  reason: { label: '原因', sample: '资料不完整，请补充后重新提交' },
  level: { label: '处罚等级', sample: '二' },
  days: { label: '天数', sample: '3' },
  count: { label: '数量', sample: '5' },
  remaining: { label: '剩余数量', sample: '2' },
  stage: { label: '环节', sample: '驻场审核' },
  termEnd: { label: '合同到期日', sample: '2026-12-31' },
  disputeDeadline: { label: '异议截止日', sample: '2026-11-19' },
  interviewAt: { label: '面试时间', sample: '2026-11-15 09:30' },
  address: { label: '地址', sample: '昆山市开发区前进东路 88 号 1 号门' },
  documents: { label: '需携带的证件', sample: '身份证原件、银行卡' },
  signUrl: { label: '签署链接', sample: 'https://example.com/sign/abc123' },
  question: { label: '问题', sample: '宿舍几人间？' },
  answer: { label: '回答', sample: '4 人间，带空调和独立卫生间' },
  reply: { label: '回复内容', sample: '您反馈的问题已处理，感谢支持' },
  message: { label: '消息内容', sample: '请于明早 8 点前到厂门口集合' },
  content: { label: '内容', sample: '请于明早 8 点前到厂门口集合' },
  detail: { label: '详情', sample: '详见消息中心' },
}
const varLabel = (v: string) => VAR_META[v]?.label ?? ''
const render = (s: string) => s.replace(/\$\{([a-zA-Z][a-zA-Z0-9]*)}/g, (_, v: string) => VAR_META[v]?.sample ?? `【${v}】`)
const preview = computed(() => ({ title: render(form.title), content: render(form.content) }))
const noSampleVars = computed(() => [...usedVars.value].filter((v) => !VAR_META[v]))

async function save() {
  if (!editing.value) return
  if (localError.value) {
    saveError.value = localError.value
    return
  }
  if (!form.enabled && editing.value.enabled) {
    const ok = await confirmAction('停用模板', `停用后「${editing.value.templateCode}」将不再发送任何通知（站内信与短信），确定停用？`, true)
    if (!ok) return
  }
  saving.value = true
  saveError.value = ''
  try {
    const r = await opsApi.updateTemplate(editing.value.templateCode, {
      title: form.title.trim(),
      content: form.content.trim(),
      channels: form.channels,
      smsTemplateId: form.smsTemplateId.trim(),
      respectQuietHours: form.respectQuietHours,
      enabled: form.enabled,
    })
    ElMessage.success('模板已保存，立即生效')
    saved = snap()
    editing.value = null
    rows.value = rows.value.map((x) => (x.templateCode === r.templateCode ? r : x))
  } catch (e) {
    saveError.value = errorMessage(e, '保存失败')
  } finally {
    saving.value = false
  }
}
const highlight = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\$\{([a-zA-Z][a-zA-Z0-9]*)}/g, '<span class="var">${$1}</span>')
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>通知模板</h2>
        <p>站内信 / 短信文案、渠道、是否遵守免打扰时段、启停 · 文案只能使用模板已有变量，保存即生效</p>
      </div>
      <div class="spacer" />
    </div>

    <div class="card">
      <div class="toolbar">
        <el-input v-model="keyword" clearable placeholder="模板编码 / 标题 / 内容" style="width: 260px" />
        <div class="spacer" />
        <span class="t-xs">共 {{ rows.length }} 个模板</span>
        <el-button @click="load">刷新</el-button>
      </div>
      <el-table v-loading="loading" :data="shown" class="ops-table" row-key="templateCode" @row-dblclick="open">
        <el-table-column label="模板" min-width="220">
          <template #default="{ row }">
            <span class="link-cell" @click="open(row)">{{ row.title }}</span>
            <div class="t-xs mono">{{ row.templateCode }}</div>
          </template>
        </el-table-column>
        <el-table-column label="内容" min-width="320">
          <template #default="{ row }"><div class="t-sm content" v-html="highlight(row.content)" /></template>
        </el-table-column>
        <el-table-column label="渠道" width="130"><template #default="{ row }"><DictTags type="NotifyChannel" :values="row.channels" /></template></el-table-column>
        <el-table-column label="免打扰" width="80" align="center">
          <template #default="{ row }"><span :class="row.respectQuietHours ? 'tag tag--info' : 'dim'">{{ row.respectQuietHours ? '遵守' : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }"><span class="st-pill" :style="{ color: row.enabled ? 'var(--ok)' : 'var(--ink-400)' }"><i />{{ row.enabled ? '启用' : '停用' }}</span></template>
        </el-table-column>
        <el-table-column label="更新" width="160">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.updatedAt) }}</span><div class="t-xs">{{ row.updatedBy ? fmtOperator(row.updatedBy) : '' }}</div></template>
        </el-table-column>
        <el-table-column label="操作" class-name="ops-col" width="80" align="right" fixed="right">
          <template #default="{ row }"><el-button size="small" @click="open(row)">编辑</el-button></template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="error" :image-size="64" :description="error"><el-button size="small" @click="load">重试</el-button></el-empty>
          <el-empty v-else :image-size="64" description="暂无模板" />
        </template>
      </el-table>
    </div>

    <el-drawer v-model="visible" size="640px" destroy-on-close class="ops-drawer" :before-close="onBeforeClose">
      <template #header>
        <div class="dh">
          <h3>编辑模板</h3>
          <span class="mono t-sm dim">{{ editing?.templateCode }}</span>
          <span v-if="dirty" class="tag tag--signal">未保存</span>
        </div>
      </template>
      <template v-if="editing">
        <el-form label-position="top" @submit.prevent>
          <el-form-item label="可用变量（点击插入到光标处）">
            <div class="chips">
              <button v-for="v in editing.variables" :key="v" type="button" class="chip" :class="{ used: usedVars.has(v) }" @mousedown.prevent @click="insertVar(v)">
                <span v-if="varLabel(v)" class="chip-l">{{ varLabel(v) }}</span><span class="mono">{{ '${' + v + '}' }}</span>
              </button>
              <span v-if="editing.variables.length === 0" class="t-xs">该模板没有变量</span>
            </div>
          </el-form-item>
          <el-form-item label="标题" required>
            <el-input ref="titleRef" v-model="form.title" :maxlength="TITLE_MAX" show-word-limit @focus="lastFocus = 'title'" />
          </el-form-item>
          <el-form-item label="内容" required>
            <el-input ref="contentRef" v-model="form.content" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" :maxlength="CONTENT_MAX" show-word-limit @focus="lastFocus = 'content'" />
          </el-form-item>

          <div class="preview">
            <div class="pv-hd">
              <span class="t-xs">预览（变量以示例值替换）</span>
            </div>
            <div class="pv-title">{{ preview.title || '（标题为空）' }}</div>
            <div class="pv-body">{{ preview.content || '（内容为空）' }}</div>
            <div v-if="noSampleVars.length" class="t-xs pv-foot">【】中的变量暂无示例值，发送时会替换为实际内容。</div>
          </div>

          <div class="grid g-2 opts">
            <el-form-item label="发送渠道" required>
              <el-checkbox-group v-model="form.channels">
                <el-checkbox v-for="o in options('NotifyChannel')" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="短信模板 ID">
              <el-input v-model="form.smsTemplateId" :disabled="!form.channels.includes('SMS')" placeholder="短信服务商审核通过的模板 ID" />
            </el-form-item>
            <el-form-item label="免打扰时段">
              <el-switch v-model="form.respectQuietHours" active-text="遵守（夜间延后发送）" />
            </el-form-item>
            <el-form-item label="状态">
              <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
            </el-form-item>
          </div>
          <div v-if="form.channels.includes('SMS') && !form.smsTemplateId.trim()" class="notice notice--warn">已勾选短信渠道但未填写短信模板 ID，短信可能无法发出。</div>
          <div v-if="!form.enabled" class="notice notice--danger gap-t">停用后该模板不会发送任何通知。</div>
        </el-form>
        <div v-if="saveError || localError" class="notice notice--danger gap-t">{{ saveError || localError }}</div>
      </template>
      <template #footer>
        <div class="drawer-actions">
          <el-button @click="close">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="!dirty || !!localError" @click="save">保存</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.content { color: var(--ink-700); white-space: pre-wrap; }
.content :deep(.var), .pv-body :deep(.var) { font-family: var(--f-mono); font-size: 11.5px; color: var(--signal-700); background: var(--signal-50); border-radius: 3px; padding: 0 3px; }
.dh { display: flex; align-items: center; gap: 10px; }
.dh h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 12px; line-height: 1.5; padding: 3px 9px; border-radius: 6px; border: 1px dashed var(--signal-300); background: var(--surface); color: var(--signal-700); cursor: pointer; }
.chip-l { color: var(--ink-700); }
.pv-foot { margin-top: 6px; }
.chip:hover { background: var(--signal-50); }
.chip.used { border-style: solid; background: var(--signal-50); }
.preview { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-2); padding: 10px 14px; margin-bottom: 16px; }
.pv-hd { display: flex; justify-content: space-between; margin-bottom: 6px; }
.pv-title { font-weight: 700; color: var(--ink-900); font-size: 13.5px; }
.pv-body { font-size: 13px; color: var(--ink-700); margin-top: 4px; white-space: pre-wrap; }

.opts { column-gap: 20px; row-gap: 0; }
.gap-t { margin-top: 10px; }
</style>
