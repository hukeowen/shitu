<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, tenantApi, type ChannelItem, type MemberView, type ProjectView } from '@shitu/api-client'
import {
  IconCircleExclamationPoint,
  IconCopy,
  IconDownload,
  IconEye,
  IconInfo,
  IconPlus,
  IconQrCode,
  IconUserCheck,
} from '@shitu/ui-icons'
import QrImage from '@/components/QrImage.vue'
import { boxSubmit, isBlocked } from '@/composables/boxSubmit'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { copyText, fmtDate } from '@/utils/format'
import { downloadQrPng } from '@/utils/qr'
import type { Tone } from '@/utils/tone'

/** T-501 渠道二维码（原型 A-18）：公司码 / 成员码 / 项目码，扫码注册归属本公司（私域） */
const meStore = useMeStore()
const canManage = computed(() => meStore.can('CHANNEL_MANAGE'))
const canMine = computed(() => meStore.can('CHANNEL_MINE'))
const companyName = computed(() => meStore.me?.company.shortName || meStore.me?.company.name || '')

// ---------------------------------------------------------------- 我的专属码（独立区块：自己的加载遮罩和「重新加载」）
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
    mine.value = null
    mineError.value = errorMessage(e, '专属码加载失败')
  } finally {
    mineLoading.value = false
  }
}

// ---------------------------------------------------------------- 全部渠道码
type StatusFilter = 'ALL' | 'ACTIVE' | 'DISABLED'
const DEFAULT_STATUS: StatusFilter = 'ACTIVE'
const loading = ref(false)
const loadError = ref('')
const list = ref<ChannelItem[]>([])
/** 拿到过列表（没拿到时指标和页签不显示数字） */
const ready = ref(false)
const statusFilter = ref<StatusFilter>(DEFAULT_STATUS)
const keyword = ref('')
/** 停用 / 启用被后端拒绝的渠道码：只置灰这一行的那个按钮，原因写在表格上方，重新查询后再判断 */
const blocked = reactive<Record<string, { name: string; text: string }>>({})

async function load() {
  if (!canManage.value) return
  loading.value = true
  loadError.value = ''
  ready.value = false
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    list.value = await tenantApi.channelCodes()
    ready.value = true
  } catch (e) {
    list.value = []
    loadError.value = errorMessage(e, '渠道码加载失败')
  } finally {
    loading.value = false
  }
}
/** 重置：状态回到「启用中」、关键词清空后重新查询 */
function reset() {
  statusFilter.value = DEFAULT_STATUS
  keyword.value = ''
  load()
}

const filtered = computed(() => {
  const k = keyword.value.trim()
  return list.value.filter(
    (c) =>
      (statusFilter.value === 'ALL' || c.status === statusFilter.value) &&
      (!k || [c.name, c.code, c.memberName, c.projectName].some((s) => s?.includes(k))),
  )
})
/** 接口一次返回全部渠道码，表格在前端分页；换筛选条件回到第一页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => filtered.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))
watch([statusFilter, keyword], () => (pg.page = 1))

const totals = computed(() => {
  const active = list.value.filter((c) => c.status === 'ACTIVE')
  return {
    active: active.length,
    disabled: list.value.length - active.length,
    visits: list.value.reduce((s, c) => s + (c.visits ?? 0), 0),
    registrations: list.value.reduce((s, c) => s + (c.registrations ?? 0), 0),
  }
})
const countOf = (s: StatusFilter) => (s === 'ALL' ? list.value.length : list.value.filter((c) => c.status === s).length)
const TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ACTIVE', label: '启用中' },
  { key: 'DISABLED', label: '已停用' },
  { key: 'ALL', label: '全部' },
]

function conv(c: ChannelItem) {
  if (!c.visits) return '—'
  return `${((c.registrations / c.visits) * 100).toFixed(1)}%`
}

function kindOf(c: ChannelItem): { label: string; tone: Tone } {
  if (c.kind === 'MEMBER') return { label: '成员码', tone: 'info' }
  if (c.kind === 'PROJECT') return { label: '项目码', tone: 'pending' }
  return { label: '公司码', tone: 'neutral' }
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
  const act = disable ? '停用' : '启用'
  let r: ChannelItem | undefined
  const s = boxSubmit(
    disable ? `停用后扫描「${c.name}」将无法注册归属本公司，已注册用户不受影响。确定停用？` : `确定重新启用「${c.name}」？`,
    act,
    async () => {
      r = disable ? await tenantApi.disableChannelCode(c.code) : await tenantApi.enableChannelCode(c.code)
    },
    (why) => (blocked[c.code] = { name: c.name, text: why }),
  )
  try {
    await ElMessageBox.confirm(s.message, disable ? '停用渠道码' : '启用渠道码', {
      type: 'warning',
      confirmButtonText: act,
      cancelButtonText: '取消',
      beforeClose: s.beforeClose,
    })
  } catch {
    return
  }
  const done = r
  if (done) list.value = list.value.map((x) => (x.code === done.code ? { ...x, ...done } : x))
  ElMessage.success(disable ? '已停用' : '已启用')
}

/** 操作列宽按本页实际出现的按钮算（规范 Page States「console 表格操作列宽」） */
const opsWidth = computed(() => actionsColWidth(pageRows.value.map((c) => ({ labels: ['下载', '复制链接', c.status === 'ACTIVE' ? '停用' : '启用'] }))))

// ---------------------------------------------------------------- 新建
const dialog = reactive({ visible: false, saving: false, why: '' })
const formRef = ref<FormInstance>()
const form = reactive({ name: '', memberId: '', projectId: '' })
// 生成被后端拒绝后置灰「生成」；改了内容再放开
watch(form, () => (dialog.why = ''))
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
  dialog.why = ''
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
    if (isBlocked(e)) dialog.why = `暂时不能生成：${errorMessage(e)}`
  } finally {
    dialog.saving = false
  }
}

onMounted(() => {
  loadMine()
  load()
})
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>渠道二维码</h2>
        <p>公司专属二维码与分享链接 · 决定扫码注册用户的初始归属（本公司私域）</p>
      </div>
      <span class="spacer" />
      <el-button v-if="canManage" type="primary" @click="openCreate"><IconPlus :size="16" class="btn-i" />生成渠道码</el-button>
    </div>

    <div v-if="canManage" class="kpis">
      <div class="stat stat--icon">
        <IconQrCode :size="20" class="stat-i" />
        <div class="stat-l">启用中的渠道码</div><div class="stat-v">{{ ready ? totals.active : '—' }}</div><div class="stat-d">已停用 {{ ready ? totals.disabled : '—' }}</div>
      </div>
      <div class="stat stat--icon">
        <IconEye :size="20" class="stat-i" />
        <div class="stat-l">累计访问</div><div class="stat-v">{{ ready ? totals.visits : '—' }}</div><div class="stat-d">全部渠道码合计</div>
      </div>
      <div class="stat stat--icon">
        <IconUserCheck :size="20" class="stat-i" />
        <div class="stat-l">累计注册</div><div class="stat-v">{{ ready ? totals.registrations : '—' }}</div><div class="stat-d">全部渠道码合计</div>
      </div>
    </div>

    <div class="top-row" :class="{ solo: !canManage }">
      <div v-if="canMine" v-loading="mineLoading" class="card mine-card">
        <div class="card__hd"><h3>我的专属码</h3><span class="status-tag status-tag--private">私域</span></div>
        <div class="card__bd">
          <div v-if="mineError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ mineError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="loadMine">重新加载</el-button>
          </div>
          <div v-else-if="mine" class="mine">
            <QrImage :url="mine.url" :size="150" :dim="mine.status !== 'ACTIVE'" />
            <div class="mine-info">
              <dl class="desc-list">
                <div><dt>名称</dt><dd>{{ mine.name }}</dd></div>
                <div><dt>初始归属</dt><dd>{{ companyName }} <span class="status-tag status-tag--private">私域</span></dd></div>
                <div><dt>访问 / 注册</dt><dd class="tnum">{{ mine.visits }} / {{ mine.registrations }}</dd></div>
                <div class="wide"><dt>链接</dt><dd class="url">{{ mine.url }}</dd></div>
              </dl>
              <div class="mine-acts">
                <el-button size="small" @click="download(mine)"><IconDownload :size="14" class="btn-i" />下载二维码</el-button>
                <el-button size="small" @click="copy(mine)"><IconCopy :size="14" class="btn-i" />复制链接</el-button>
              </div>
            </div>
          </div>
          <div v-else-if="!mineLoading" class="state-box">
            <IconQrCode :size="48" />
            <h4>暂无专属码</h4>
            <p>专属码由公司为你生成，生成后会出现在这里</p>
          </div>
        </div>
      </div>
      <div v-if="canManage" class="notice-bar notice-bar--warn rule">
        <IconInfo :size="16" class="notice-bar-i" />
        <span><b>归属规则：</b>扫描本公司渠道码（公司码 / 驻场成员码 / 项目码）注册的求职者归属本公司（私域），仅匹配本公司岗位；已入职员工分享的注册用户归属平台（公域）。</span>
      </div>
    </div>

    <div v-if="canManage" class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="statusFilter === t.key" :class="{ on: statusFilter === t.key }" @click="statusFilter = t.key">
            {{ t.label }}<span v-if="ready" class="n">{{ countOf(t.key) }}</span>
          </button>
        </div>
        <span class="spacer" />
        <el-input v-model="keyword" placeholder="名称 / 成员 / 项目 / 渠道码" clearable style="width: 220px" />
        <el-button @click="load">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <p v-for="(b, code) in blocked" :key="code" class="blocked-why tbl-tip" role="status">「{{ b.name }}」{{ b.text }}。重新查询后再判断</p>
      <el-table v-loading="loading" :data="pageRows" row-key="code" :row-class-name="({ row }) => (row.status === 'DISABLED' ? 'row-dim' : '')">
        <el-table-column label="二维码" width="96">
          <template #default="{ row }"><QrImage :url="row.url" :size="64" :dim="row.status !== 'ACTIVE'" /></template>
        </el-table-column>
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <div class="name-row"><span class="strong-t">{{ row.name }}</span><span class="status-tag" :class="`status-tag--${kindOf(row).tone}`">{{ kindOf(row).label }}</span></div>
            <div class="sub tnum">{{ row.code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="归属成员 / 项目" min-width="140">
          <template #default="{ row }">
            <div class="strong-t">{{ row.memberName || '—' }}</div>
            <div v-if="row.projectName" class="sub">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="访问" width="68" align="right">
          <template #default="{ row }"><span class="tnum strong-t">{{ row.visits }}</span></template>
        </el-table-column>
        <el-table-column label="注册" width="68" align="right">
          <template #default="{ row }"><span class="tnum strong-t">{{ row.registrations }}</span></template>
        </el-table-column>
        <el-table-column label="转化" width="76" align="right">
          <template #default="{ row }"><span class="tnum strong-t">{{ conv(row) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="104">
          <template #default="{ row }">
            <span class="status-tag" :class="row.status === 'ACTIVE' ? 'status-tag--success' : 'status-tag--neutral'">{{ row.status === 'ACTIVE' ? '启用' : '已停用' }}</span>
            <div class="sub tnum">{{ fmtDate(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <el-button size="small" link type="primary" @click="download(row)">下载</el-button>
              <el-button size="small" link type="primary" @click="copy(row)">复制链接</el-button>
              <el-button size="small" link :type="row.status === 'ACTIVE' ? 'danger' : 'primary'" :disabled="!!blocked[row.code]" @click="toggle(row)">
                {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
              </el-button>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconQrCode :size="48" />
            <h4>暂无渠道码</h4>
            <p>{{ keyword.trim() || statusFilter !== DEFAULT_STATUS ? '当前筛选范围内没有渠道码，换个条件或点「重置」' : '点右上角「生成渠道码」，用于海报、门岗或线上投放' }}</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="filtered.length > 0" class="pager">
        <el-pagination
          v-model:current-page="pg.page"
          v-model:page-size="pg.pageSize"
          :total="filtered.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @size-change="pg.page = 1"
        />
      </div>
    </div>

    <el-dialog v-model="dialog.visible" title="生成渠道码" width="520px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
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
      <div class="notice-bar">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>指定成员后，扫码注册的用户记入该成员的渠道业绩；指定项目后可按项目统计来源。</span>
      </div>
      <p v-if="dialog.why" class="blocked-why dlg-why" role="alert">{{ dialog.why }}</p>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" :disabled="!!dialog.why" @click="create">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.btn-i { margin-right: var(--space-1); }
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); margin-bottom: var(--space-gap); }
.top-row { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--space-gap); align-items: start; }
.top-row.solo { grid-template-columns: minmax(0, 720px); }
.tbl-card { margin-top: var(--space-gap); }
.mine { display: flex; gap: var(--space-5); align-items: flex-start; }
.mine-info { flex: 1; min-width: 0; }
.desc-list .wide { grid-column: 1 / -1; }
.url { font-size: var(--font-size-aux); word-break: break-all; }
.mine-acts { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
.mine-acts .el-button + .el-button { margin-left: 0; }
.toolbar .el-button + .el-button { margin-left: 0; }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.name-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.strong-t { color: var(--text-1); }
.sub { margin-top: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.dlg-why { margin-top: var(--space-3); }
</style>
