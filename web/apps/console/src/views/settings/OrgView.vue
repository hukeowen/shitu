<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  errorMessage,
  tenantApi,
  useDict,
  type MemberRequest,
  type MemberView,
  type ProjectView,
  type TenantRole,
} from '@shitu/api-client'
import {
  IconBriefcase,
  IconCheck,
  IconCircleExclamationPoint,
  IconInfo,
  IconPlus,
  IconShieldCheck,
  IconUserCheck,
  IconUsers,
  IconX,
} from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { boxSubmit, isBlocked, isNetwork } from '@/composables/boxSubmit'
import { buildRoleMatrix, MATRIX_ROLES } from '@/router/roleMatrix'
import { useMeStore } from '@/stores/me'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime, PHONE_RE } from '@/utils/format'

/** T-502 组织与权限（原型 A-19）：老板可增删改；项目经理只读 */
const meStore = useMeStore()
const { options } = useDict()
const canManage = computed(() => meStore.can('ORG_MANAGE'))

const TENANT_ROLES: TenantRole[] = ['SITE', 'BROKER', 'PM', 'OWNER']
const roleOptions = computed(() => options('ActorRole').filter((o) => TENANT_ROLES.includes(o.value as TenantRole)))

// ---------------------------------------------------------------- 列表
const loading = ref(false)
const loadError = ref('')
const loadNet = ref(false)
const members = ref<MemberView[]>([])
/** 拿到过成员列表（没拿到时指标不显示数字） */
const ready = ref(false)
const filter = reactive<{ keyword: string; role: TenantRole | '' }>({ keyword: '', role: '' })
/** 接口一次返回全部成员，表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => members.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))
/** 停用 / 启用被后端拒绝的成员：只置灰这一行的那个按钮，原因写在表格上方，重新查询时清掉 */
const blocked = reactive<Record<string, { name: string; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  ready.value = false
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    members.value = await tenantApi.members({ keyword: filter.keyword.trim() || undefined, role: filter.role || undefined })
    pg.page = 1
    ready.value = true
  } catch (e) {
    members.value = []
    loadError.value = errorMessage(e, '成员列表加载失败')
    loadNet.value = isNetwork(e)
  } finally {
    loading.value = false
  }
}
/** 重置：角色和关键词清空后重新查询 */
function reset() {
  filter.role = ''
  filter.keyword = ''
  load()
}

const stats = computed(() => {
  const active = members.value.filter((m) => m.status === 'NORMAL')
  const count = (r: TenantRole) => active.filter((m) => m.roles.includes(r)).length
  return { total: members.value.length, disabled: members.value.length - active.length, site: count('SITE'), broker: count('BROKER'), pm: count('PM'), owner: count('OWNER') }
})
const num = (n: number) => (ready.value ? String(n) : '—')

const projectNames = (m: MemberView) => m.projects.map((p) => p.name).join(' / ')

// ---------------------------------------------------------------- 项目（负责范围）
const projects = ref<ProjectView[]>([])
const projectsError = ref(false)
async function loadProjects() {
  try {
    projects.value = await tenantApi.projects()
    projectsError.value = false
  } catch {
    projects.value = []
    projectsError.value = true
  }
}

// ---------------------------------------------------------------- 新增 / 编辑
const dialog = reactive({ visible: false, saving: false, editing: null as MemberView | null, why: '' })
const formRef = ref<FormInstance>()
const form = reactive<{ name: string; phone: string; roles: TenantRole[]; projectIds: string[] }>({ name: '', phone: '', roles: [], projectIds: [] })
// 保存被后端拒绝后置灰「保存」；改了内容再放开
watch(form, () => (dialog.why = ''))
const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: '请填写姓名', trigger: 'blur' },
    { max: 20, message: '姓名最多 20 个字', trigger: 'blur' },
  ],
  phone: dialog.editing
    ? []
    : [
        { required: true, message: '请填写手机号', trigger: 'blur' },
        { pattern: PHONE_RE, message: '请输入正确的 11 位手机号', trigger: 'blur' },
      ],
  roles: [{ type: 'array', required: true, min: 1, message: '至少选择一个角色', trigger: 'change' }],
}))

function openCreate() {
  dialog.editing = null
  Object.assign(form, { name: '', phone: '', roles: [], projectIds: [] })
  dialog.why = ''
  dialog.visible = true
  formRef.value?.clearValidate()
}

function openEdit(m: MemberView) {
  dialog.editing = m
  Object.assign(form, { name: m.name, phone: '', roles: [...m.roles], projectIds: m.projects.map((p) => p.projectId) })
  dialog.why = ''
  dialog.visible = true
  formRef.value?.clearValidate()
}

/** 选择项目时，已结束的项目只在原本已负责时展示 */
const projectOptions = computed(() =>
  projects.value.filter((p) => p.status === 'ACTIVE' || form.projectIds.includes(p.projectId)),
)
const needsProject = computed(() => form.roles.some((r) => r === 'SITE' || r === 'PM'))

async function save() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  const req: MemberRequest = { name: form.name.trim(), roles: form.roles, projectIds: form.projectIds }
  dialog.saving = true
  try {
    if (dialog.editing) {
      await tenantApi.updateMember(dialog.editing.memberId, req)
      const rolesChanged = [...dialog.editing.roles].sort().join() !== [...form.roles].sort().join()
      ElMessage.success(rolesChanged ? '已保存，该成员需重新登录后生效' : '已保存')
    } else {
      await tenantApi.createMember({ ...req, phone: form.phone })
      ElMessage.success('成员已添加，可使用该手机号登录')
    }
    dialog.visible = false
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
    if (isBlocked(e)) dialog.why = `暂时不能保存：${errorMessage(e)}`
  } finally {
    dialog.saving = false
  }
}

async function toggleStatus(m: MemberView) {
  const disable = m.status === 'NORMAL'
  const act = disable ? '停用' : '启用'
  const s = boxSubmit(
    disable ? `停用后「${m.name}」将被立即强制下线且无法登录，确定停用？` : `确定启用「${m.name}」？启用后可重新登录。`,
    act,
    () => tenantApi.setMemberStatus(m.memberId, disable ? 'DISABLED' : 'NORMAL'),
    (why) => (blocked[m.memberId] = { name: m.name, text: why }),
  )
  try {
    await ElMessageBox.confirm(s.message, disable ? '停用成员' : '启用成员', {
      type: 'warning',
      confirmButtonText: act,
      // 停用：确认按钮和表格里一样用危险色描边；启用照旧主色
      ...(disable ? { confirmButtonClass: 'el-button--danger is-plain btn-reject' } : {}),
      cancelButtonText: '取消',
      beforeClose: s.beforeClose,
    })
  } catch {
    return
  }
  ElMessage.success(disable ? '已停用' : '已启用')
  load()
}

/** 自己那一行：前端已经知道不能停用自己，「停用」一开始就置灰并写明原因（后端照旧会拒绝） */
const isSelf = (m: MemberView) => m.memberId === meStore.me?.memberId
const SELF_WHY = '不能停用自己'
/** 操作列宽按本页实际出现的按钮算（规范 Page States「console 表格操作列宽」）；自己那一行下面还有一行原因，按 12px 字宽留够 */
const opsWidth = computed(() =>
  actionsColWidth(
    pageRows.value.map((m) => ({ labels: ['编辑', m.status === 'NORMAL' ? '停用' : '启用'] })),
    pageRows.value.some((m) => isSelf(m) && m.status === 'NORMAL') ? 24 + SELF_WHY.length * 12 + 8 : 96,
  ),
)

/** 编辑自己时不能去掉老板角色（否则公司可能没有可登录的老板） */
const editingSelf = computed(() => !!dialog.editing && isSelf(dialog.editing))

// ---------------------------------------------------------------- 权限矩阵：与菜单 / 路由守卫同源（router/roleMatrix.ts），区分 可操作 / 只读 / 无
const matrix = computed(() => buildRoleMatrix(meStore.me))
/** 同一分组的第一行合并单元格显示分组名 */
function matrixSpan({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }) {
  if (columnIndex !== 0) return { rowspan: 1, colspan: 1 }
  const rows = matrix.value
  if (rowIndex > 0 && rows[rowIndex - 1].group === rows[rowIndex].group) return { rowspan: 0, colspan: 0 }
  let n = 1
  while (rowIndex + n < rows.length && rows[rowIndex + n].group === rows[rowIndex].group) n++
  return { rowspan: n, colspan: 1 }
}

onMounted(() => {
  load()
  loadProjects()
})
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>组织与权限</h2>
        <p>租户内角色体系与数据可见范围 · 角色变更或停用会使该成员立即下线</p>
      </div>
      <span class="spacer" />
      <el-button v-if="canManage" type="primary" @click="openCreate"><IconPlus :size="16" class="btn-i" />新增成员</el-button>
    </div>

    <div class="kpis">
      <div class="stat stat--icon">
        <IconUsers :size="20" class="stat-i" />
        <div class="stat-l">成员总数</div><div class="stat-v">{{ num(stats.total) }}</div><div class="stat-d">已停用 {{ num(stats.disabled) }}</div>
      </div>
      <div class="stat stat--icon">
        <IconUserCheck :size="20" class="stat-i" />
        <div class="stat-l">驻场</div><div class="stat-v">{{ num(stats.site) }}</div><div class="stat-d">启用中</div>
      </div>
      <div class="stat stat--icon">
        <IconBriefcase :size="20" class="stat-i" />
        <div class="stat-l">人才经纪人</div><div class="stat-v">{{ num(stats.broker) }}</div><div class="stat-d">启用中</div>
      </div>
      <div class="stat stat--icon">
        <IconShieldCheck :size="20" class="stat-i" />
        <div class="stat-l">项目经理 / 老板</div><div class="stat-v">{{ ready ? `${stats.pm} / ${stats.owner}` : '—' }}</div><div class="stat-d">启用中</div>
      </div>
    </div>

    <div class="card tbl-card members">
      <div class="toolbar">
        <h3 class="tbl-t">成员列表</h3>
        <span class="spacer" />
        <el-select v-model="filter.role" placeholder="全部角色" clearable style="width: 140px" @change="load">
          <el-option v-for="o in roleOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="filter.keyword" placeholder="姓名 / 完整手机号" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
        <el-button @click="load">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.name }}」{{ b.text }}</p>
      <el-table v-loading="loading" :data="pageRows" row-key="memberId" :row-class-name="({ row }) => [row.status === 'DISABLED' ? 'row-dim' : '', isSelf(row) ? 'row-self' : ''].join(' ')">
        <el-table-column label="成员" min-width="160">
          <template #default="{ row }">
            <PersonCell :name="row.name" :sub="row.phoneMasked">
              <span v-if="row.memberId === meStore.me?.memberId" class="status-tag status-tag--info me">我</span>
            </PersonCell>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <div class="roles"><DictTag v-for="r in row.roles" :key="r" type="ActorRole" :value="r" /></div>
          </template>
        </el-table-column>
        <el-table-column label="负责项目" min-width="200">
          <template #default="{ row }">
            <span v-if="row.roles.includes('OWNER') && !row.projects.length" class="strong-t">全公司</span>
            <span v-else-if="!row.projects.length" class="sub">未分配</span>
            <span v-else class="strong-t">{{ projectNames(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="84">
          <template #default="{ row }"><DictTag type="MemberStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="最近登录" width="150">
          <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.lastLoginAt) }}</span></template>
        </el-table-column>
        <el-table-column v-if="canManage" label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <div class="acts">
              <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button
                size="small"
                link
                :type="row.status === 'NORMAL' ? 'danger' : 'primary'"
                :disabled="!!blocked[row.memberId] || (isSelf(row) && row.status === 'NORMAL')"
                @click="toggleStatus(row)"
              >
                {{ row.status === 'NORMAL' ? '停用' : '启用' }}
              </el-button>
            </div>
            <div v-if="isSelf(row) && row.status === 'NORMAL'" class="self-why">{{ SELF_WHY }}</div>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>{{ loadNet ? '请检查网络后重新加载' : '加载失败，可以稍后重新加载' }}</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconUsers :size="48" />
            <h4>暂无成员</h4>
            <p>{{ filter.role || filter.keyword.trim() ? '当前筛选范围内没有成员，换个条件或点「重置」' : canManage ? '点右上角「新增成员」，成员用手机号登录' : '老板添加成员后会出现在这里' }}</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="members.length > 0" class="pager">
        <el-pagination
          v-model:current-page="pg.page"
          v-model:page-size="pg.pageSize"
          :total="members.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @size-change="pg.page = 1"
        />
      </div>
      <div v-if="!canManage" class="card__ft ro">
        <IconInfo :size="14" />你当前为只读视图，成员增删改仅限公司老板操作。
      </div>
    </div>

    <div class="card matrix">
      <div class="card__hd">
        <h3>角色权限矩阵</h3>
        <span class="legend sub">
          <span><span class="yes"><IconCheck :size="16" aria-hidden="true" /></span>可操作</span>
          <span><span class="status-tag status-tag--info">只读</span>可查看不可改</span>
          <span><span class="no"><IconX :size="16" aria-hidden="true" /></span>无权限</span>
        </span>
      </div>
      <el-table :data="matrix" size="small" :span-method="matrixSpan" row-key="cap">
        <el-table-column label="分类" min-width="100">
          <template #default="{ row }"><span class="sub">{{ row.group }}</span></template>
        </el-table-column>
        <el-table-column label="能力" min-width="220">
          <template #default="{ row }"><span class="strong-t">{{ row.cap }}</span></template>
        </el-table-column>
        <el-table-column v-for="(r, i) in MATRIX_ROLES" :key="r" align="center" min-width="120">
          <template #header><DictTag type="ActorRole" :value="r" /></template>
          <template #default="{ row }">
            <template v-if="row.cells[i].level === 'op'">
              <span class="yes"><IconCheck :size="16" aria-label="可操作" /></span><span v-if="row.cells[i].text" class="sub cell-note">{{ row.cells[i].text }}</span>
            </template>
            <span v-else-if="row.cells[i].level === 'ro'" class="status-tag status-tag--info">只读</span>
            <span v-else class="no"><IconX :size="16" aria-label="无权限" /></span>
          </template>
        </el-table-column>
      </el-table>
      <div class="card__ft sub">矩阵与左侧菜单、页面访问规则同源。预支审批为双级：驻场初审 + 项目经理终审，老板可查看并登记拨款；完整手机号仅驻场可见，其余角色看到的是脱敏信息。</div>
    </div>

    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑成员' : '新增成员'" width="560px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" maxlength="20" placeholder="成员真实姓名" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-if="!dialog.editing" v-model="form.phone" maxlength="11" placeholder="成员用此手机号登录" />
          <template v-else>
            <span class="tnum strong-t">{{ dialog.editing.phoneMasked }}</span>
            <span class="sub phone-tip">手机号创建后不可修改</span>
          </template>
        </el-form-item>
        <el-form-item label="角色" prop="roles">
          <el-checkbox-group v-model="form.roles">
            <el-checkbox v-for="o in roleOptions" :key="o.value" :value="o.value" :disabled="editingSelf && o.value === 'OWNER' && form.roles.includes('OWNER')">{{ o.label }}</el-checkbox>
          </el-checkbox-group>
          <div v-if="editingSelf" class="sub self-tip">不能去掉自己的老板角色，也不能停用自己；如需交接，请先把另一位成员设为老板，再由对方操作。</div>
        </el-form-item>
        <el-form-item label="负责项目">
          <el-select
            v-model="form.projectIds"
            multiple
            filterable
            placeholder="选择负责的项目"
            style="width: 100%"
            :no-data-text="projectsError ? '项目加载失败，请刷新页面后再试' : '暂无项目，请先在「项目与甲方」中创建'"
          >
            <el-option v-for="p in projectOptions" :key="p.projectId" :label="p.name" :value="p.projectId">
              <span>{{ p.name }}</span>
              <span class="sub opt-r">{{ p.clientName }}</span>
            </el-option>
          </el-select>
          <div v-if="needsProject && !form.projectIds.length" class="sub">驻场 / 项目经理只能操作自己负责的项目，建议至少分配一个。</div>
        </el-form-item>
      </el-form>
      <div v-if="dialog.editing" class="notice-bar notice-bar--warn">
        <IconCircleExclamationPoint :size="16" class="notice-bar-i" />
        <span>修改角色后，该成员的登录会话将失效，需要重新登录。</span>
      </div>
      <p v-if="dialog.why" class="blocked-why dlg-why" role="alert">{{ dialog.why }}</p>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" :disabled="!!dialog.why" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.btn-i { margin-right: var(--space-1); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-gap); }
.tbl-card { margin-top: var(--space-gap); }
.matrix { margin-top: var(--space-gap); }
.tbl-t { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.toolbar .el-button + .el-button { margin-left: 0; }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.me { margin-left: var(--space-1); }
.roles { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }
.strong-t { color: var(--text-1); }
.cell-note { margin-left: var(--space-1); }
.legend { display: inline-flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); }
.legend > span { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
.self-tip { width: 100%; line-height: 1.5; }
.sub { font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.acts { display: inline-flex; gap: var(--space-2); align-items: center; justify-content: flex-end; white-space: nowrap; }
.acts .el-button + .el-button { margin-left: 0; }
.ro { display: flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.yes, .no { display: inline-flex; vertical-align: middle; }
.yes { color: var(--success-text); }
/* 没有该权限只是一种状态，不是错误：用三级文字色 */
.no { color: var(--text-3); }
.phone-tip { margin-left: var(--space-2); }
.self-why { margin-top: var(--space-1); font-size: var(--font-size-min); line-height: 1.4; color: var(--text-3); }
.opt-r { float: right; }
</style>
