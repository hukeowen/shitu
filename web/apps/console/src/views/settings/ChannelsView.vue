<script setup lang="ts">
import RowActions from '@/components/RowActions.vue'
import { opsColWidth, type RowAction } from '@/utils/rowActions'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type ChannelItem, type MemberView, type ProjectView } from '@shitu/api-client'
import QrImage from '@/components/QrImage.vue'
import { useMeStore } from '@/stores/me'
import { copyText, fmtDate } from '@/utils/format'
import { downloadQrPng } from '@/utils/qr'

/** T-501 渠道二维码（原型 A-18）：公司码 / 成员码 / 项目码，扫码注册归属本公司（私域） */
const meStore = useMeStore()
const canManage = computed(() => meStore.can('CHANNEL_MANAGE'))
const canMine = computed(() => meStore.can('CHANNEL_MINE'))
const companyName = computed(() => meStore.me?.company.shortName || meStore.me?.company.name || '')

// ---------------------------------------------------------------- 我的专属码
const mine = ref<ChannelItem | null>(null)
const mineLoading = ref(false)
const mineError = ref('')
async function loadMine() {
  if (!canMine.value) return
  mineLoading.value = true
  mineError.value = ''
  try {
    mine.value = await tenantApi.myChannelCode()
  } catch (e) {
    mineError.value = errorMessage(e, '专属码加载失败')
  } finally {
    mineLoading.value = false
  }
}

// ---------------------------------------------------------------- 全部渠道码
const loading = ref(false)
const loadError = ref('')
const list = ref<ChannelItem[]>([])
const statusFilter = ref<'ALL' | 'ACTIVE' | 'DISABLED'>('ACTIVE')
const keyword = ref('')

async function load() {
  if (!canManage.value) return
  loading.value = true
  loadError.value = ''
  try {
    list.value = await tenantApi.channelCodes()
  } catch (e) {
    loadError.value = errorMessage(e, '渠道码加载失败')
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  const k = keyword.value.trim()
  return list.value.filter(
    (c) =>
      (statusFilter.value === 'ALL' || c.status === statusFilter.value) &&
      (!k || [c.name, c.code, c.memberName, c.projectName].some((s) => s?.includes(k))),
  )
})
const totals = computed(() => {
  const active = list.value.filter((c) => c.status === 'ACTIVE')
  return {
    active: active.length,
    disabled: list.value.length - active.length,
    visits: list.value.reduce((s, c) => s + (c.visits ?? 0), 0),
    registrations: list.value.reduce((s, c) => s + (c.registrations ?? 0), 0),
  }
})
const countOf = (s: 'ALL' | 'ACTIVE' | 'DISABLED') => (s === 'ALL' ? list.value.length : list.value.filter((c) => c.status === s).length)

function conv(c: ChannelItem) {
  if (!c.visits) return '—'
  return `${((c.registrations / c.visits) * 100).toFixed(1)}%`
}

function kindOf(c: ChannelItem) {
  if (c.kind === 'MEMBER') return { label: '成员码', tone: 'signal' }
  if (c.kind === 'PROJECT') return { label: '项目码', tone: 'info' }
  return { label: '公司码', tone: 'temp' }
}

// ---------------------------------------------------------------- 操作
async function copy(c: ChannelItem) {
  if (await copyText(c.url)) ElMessage.success('链接已复制')
  else ElMessage.error('复制失败，请手动复制：' + c.url)
}

async function download(c: ChannelItem) {
  try {
    const sub = [companyName.value, c.memberName, c.projectName].filter(Boolean).join(' · ')
    await downloadQrPng({ url: c.url, title: c.name, subtitle: sub || c.url, filename: `渠道码-${c.name}-${c.code}` })
  } catch (e) {
    ElMessage.error(errorMessage(e, '下载失败'))
  }
}

async function toggle(c: ChannelItem) {
  const disable = c.status === 'ACTIVE'
  try {
    await ElMessageBox.confirm(
      disable ? `停用后扫描「${c.name}」将无法注册归属本公司，已注册用户不受影响。确定停用？` : `确定重新启用「${c.name}」？`,
      disable ? '停用渠道码' : '启用渠道码',
      { type: 'warning', confirmButtonText: disable ? '停用' : '启用', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const r = disable ? await tenantApi.disableChannelCode(c.code) : await tenantApi.enableChannelCode(c.code)
    list.value = list.value.map((x) => (x.code === r.code ? { ...x, ...r } : x))
    ElMessage.success(disable ? '已停用' : '已启用')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

// ---------------------------------------------------------------- 新建
const dialog = reactive({ visible: false, saving: false })
const formRef = ref<FormInstance>()
const form = reactive({ name: '', memberId: '', projectId: '' })
const rules: FormRules = {
  name: [
    { required: true, message: '请填写名称', trigger: 'blur' },
    { max: 30, message: '名称最多 30 个字', trigger: 'blur' },
  ],
}
const members = ref<MemberView[]>([])
const projects = ref<ProjectView[]>([])

async function openCreate() {
  Object.assign(form, { name: '', memberId: '', projectId: '' })
  dialog.visible = true
  formRef.value?.clearValidate()
  try {
    const [m, p] = await Promise.all([tenantApi.members(), tenantApi.projects({ status: 'ACTIVE' })])
    members.value = m.filter((x) => x.status === 'NORMAL')
    projects.value = p
  } catch (e) {
    ElMessage.error(errorMessage(e, '成员 / 项目加载失败'))
  }
}

async function create() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  dialog.saving = true
  try {
    const c = await tenantApi.createChannelCode({
      name: form.name.trim(),
      memberId: form.memberId || undefined,
      projectId: form.projectId || undefined,
    })
    list.value = [c, ...list.value]
    statusFilter.value = 'ACTIVE'
    dialog.visible = false
    ElMessage.success('渠道码已生成')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    dialog.saving = false
  }
}

onMounted(() => {
  loadMine()
  load()
})

/** 行操作统一为文字链：下载 / 复制链接 / 停用（危险色）或启用 */
const rowActions = (c: ChannelItem): RowAction[] => [
  { key: 'download', label: '下载', link: true },
  { key: 'copy', label: '复制链接', link: true },
  c.status === 'ACTIVE' ? { key: 'toggle', label: '停用', link: true, type: 'danger' } : { key: 'toggle', label: '启用', link: true },
]
const opsWidth = computed(() => opsColWidth(filtered.value.map(rowActions)))
function onAct(key: string, c: ChannelItem) {
  if (key === 'download') download(c)
  else if (key === 'copy') copy(c)
  else toggle(c)
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>渠道二维码</h2>
        <p>公司专属二维码与分享链接 · 决定扫码注册用户的初始归属（本公司私域）</p>
      </div>
      <span class="spacer" />
      <el-button v-if="canManage" type="primary" @click="openCreate">+ 生成渠道码</el-button>
    </div>

    <div class="grid" :class="canManage ? 'g-32' : ''" style="margin-bottom: 14px">
      <div v-if="canMine" v-loading="mineLoading" class="card">
        <div class="card__hd"><h3>我的专属码</h3><span class="tag tag--private">私域</span></div>
        <div class="card__bd">
          <el-alert v-if="mineError" type="error" :title="mineError" show-icon :closable="false">
            <el-button size="small" @click="loadMine">重试</el-button>
          </el-alert>
          <div v-else-if="mine" class="mine">
            <QrImage :url="mine.url" :size="150" :dim="mine.status !== 'ACTIVE'" />
            <div class="mine-info">
              <dl class="kv"><dt>名称</dt><dd>{{ mine.name }}</dd></dl>
              <dl class="kv"><dt>初始归属</dt><dd>{{ companyName }} <span class="tag tag--private">私域</span></dd></dl>
              <dl class="kv"><dt>访问 / 注册</dt><dd class="num">{{ mine.visits }} / {{ mine.registrations }}</dd></dl>
              <dl class="kv"><dt>链接</dt><dd class="mono t-xs">{{ mine.url }}</dd></dl>
              <div class="row" style="margin-top: 10px">
                <el-button size="small" @click="download(mine)">下载二维码</el-button>
                <el-button size="small" @click="copy(mine)">复制链接</el-button>
              </div>
            </div>
          </div>
          <el-empty v-else-if="!mineLoading" :image-size="60" description="暂无专属码" />
        </div>
      </div>
      <div v-if="canManage" class="grid g-2" style="align-content: start">
        <div class="stat"><div class="stat-l">启用中的渠道码</div><div class="stat-v">{{ totals.active }}</div><div class="stat-d">已停用 {{ totals.disabled }}</div></div>
        <div class="stat"><div class="stat-l">累计访问 / 注册</div><div class="stat-v">{{ totals.visits }}<small class="t-sm"> / {{ totals.registrations }}</small></div><div class="stat-d">全部渠道码合计</div></div>
        <div class="note note--warn" style="grid-column: 1 / -1">
          <b>归属规则：</b>扫描本公司渠道码（公司码 / 驻场成员码 / 项目码）注册的求职者归属本公司（私域），仅匹配本公司岗位；已入职员工分享的注册用户归属平台（公域）。
        </div>
      </div>
    </div>

    <div v-if="canManage" class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button :class="{ on: statusFilter === 'ACTIVE' }" @click="statusFilter = 'ACTIVE'">启用中<span class="n">{{ countOf('ACTIVE') }}</span></button>
          <button :class="{ on: statusFilter === 'DISABLED' }" @click="statusFilter = 'DISABLED'">已停用<span class="n">{{ countOf('DISABLED') }}</span></button>
          <button :class="{ on: statusFilter === 'ALL' }" @click="statusFilter = 'ALL'">全部<span class="n">{{ countOf('ALL') }}</span></button>
        </div>
        <div class="tb-fields">
          <div class="tb-group">
            <el-input v-model="keyword" placeholder="名称 / 成员 / 项目 / 渠道码" clearable style="width: 220px" />
            <el-button @click="load">刷新</el-button>
          </div>
        </div>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" />
      <el-table v-loading="loading" :data="filtered" row-key="code" :row-class-name="({ row }) => (row.status === 'DISABLED' ? 'row-dim' : '')">
        <el-table-column label="二维码" min-width="104">
          <template #default="{ row }"><QrImage :url="row.url" :size="72" :dim="row.status !== 'ACTIVE'" /></template>
        </el-table-column>
        <el-table-column label="名称" min-width="220">
          <template #default="{ row }">
            <div class="row"><b class="clamp-2" :title="row.name">{{ row.name }}</b><span class="tag" :class="`tag--${kindOf(row).tone}`">{{ kindOf(row).label }}</span></div>
            <div class="t-xs mono ellip" style="margin-top: 3px" :title="row.code">{{ row.code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="归属成员 / 项目" min-width="160">
          <template #default="{ row }">
            <div class="t-sm ellip">{{ row.memberName || '—' }}</div>
            <div class="t-xs ellip" :title="row.projectName ?? ''">{{ row.projectName || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="访问" min-width="80" align="right">
          <template #default="{ row }"><span class="num">{{ row.visits }}</span></template>
        </el-table-column>
        <el-table-column label="注册" min-width="80" align="right">
          <template #default="{ row }"><span class="num">{{ row.registrations }}</span></template>
        </el-table-column>
        <el-table-column label="转化" min-width="80" align="right">
          <template #default="{ row }"><span class="mono t-sm">{{ conv(row) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" min-width="110">
          <template #default="{ row }">
            <span class="tag" :class="row.status === 'ACTIVE' ? 'tag--ok' : 'tag--muted'">{{ row.status === 'ACTIVE' ? '启用' : '已停用' }}</span>
            <div class="t-xs">{{ fmtDate(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
          <template #default="{ row }"><RowActions :actions="rowActions(row)" @act="(k) => onAct(k, row)" /></template>
        </el-table-column>
        <template #empty>
          <el-empty :image-size="80" :description="loadError ? '加载失败' : '暂无渠道码'">
            <el-button v-if="!loadError" type="primary" @click="openCreate">生成渠道码</el-button>
          </el-empty>
        </template>
      </el-table>
    </div>

    <el-dialog v-model="dialog.visible" title="生成渠道码" width="500px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="86px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="30" placeholder="如：抖音信息流 / 昆山二期门岗海报" />
        </el-form-item>
        <el-form-item label="归属成员">
          <el-select v-model="form.memberId" clearable filterable placeholder="不选则为公司码" style="width: 100%">
            <el-option v-for="m in members" :key="m.memberId" :label="`${m.name}（${m.phoneMasked}）`" :value="m.memberId" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联项目">
          <el-select v-model="form.projectId" clearable filterable placeholder="选填，用于分项目统计" style="width: 100%">
            <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="note note--info">指定成员后，扫码注册的用户记入该成员的渠道业绩；指定项目后可按项目统计来源。</div>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="create">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mine { display: flex; gap: 18px; align-items: flex-start; }
.mine-info { flex: 1; min-width: 0; }
.stat-v small { font-family: var(--f-dis); }
</style>
