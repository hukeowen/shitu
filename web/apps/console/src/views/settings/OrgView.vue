<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
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
import DictTag from '@/components/DictTag.vue'
import RowActions from '@/components/RowActions.vue'
import { buildRoleMatrix, MATRIX_ROLES } from '@/router/roleMatrix'
import { useMeStore } from '@/stores/me'
import { fmtDateTime, PHONE_RE } from '@/utils/format'
import { opsColWidth, type RowAction } from '@/utils/rowActions'

/** T-502 组织与权限（原型 A-19）：老板可增删改；项目经理只读 */
const meStore = useMeStore()
const { options } = useDict()
const canManage = computed(() => meStore.can('ORG_MANAGE'))

const TENANT_ROLES: TenantRole[] = ['SITE', 'BROKER', 'PM', 'OWNER']
const roleOptions = computed(() => options('ActorRole').filter((o) => TENANT_ROLES.includes(o.value as TenantRole)))

// ---------------------------------------------------------------- 列表
const loading = ref(false)
const loadError = ref('')
const members = ref<MemberView[]>([])
const filter = reactive<{ keyword: string; role: TenantRole | '' }>({ keyword: '', role: '' })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    members.value = await tenantApi.members({ keyword: filter.keyword.trim() || undefined, role: filter.role || undefined })
  } catch (e) {
    loadError.value = errorMessage(e, '成员列表加载失败')
  } finally {
    loading.value = false
  }
}

const stats = computed(() => {
  const active = members.value.filter((m) => m.status === 'NORMAL')
  const count = (r: TenantRole) => active.filter((m) => m.roles.includes(r)).length
  return { total: members.value.length, disabled: members.value.length - active.length, site: count('SITE'), broker: count('BROKER'), pm: count('PM'), owner: count('OWNER') }
})

const projectNames = (m: MemberView) => m.projects.map((p) => p.name).join(' / ')

// ---------------------------------------------------------------- 项目（负责范围）
const projects = ref<ProjectView[]>([])
async function loadProjects() {
  try {
    projects.value = await tenantApi.projects()
  } catch {
    projects.value = []
  }
}

// ---------------------------------------------------------------- 新增 / 编辑
const dialog = reactive({ visible: false, saving: false, editing: null as MemberView | null })
const formRef = ref<FormInstance>()
const form = reactive<{ name: string; phone: string; roles: TenantRole[]; projectIds: string[] }>({ name: '', phone: '', roles: [], projectIds: [] })
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
  dialog.visible = true
  formRef.value?.clearValidate()
}

function openEdit(m: MemberView) {
  dialog.editing = m
  Object.assign(form, { name: m.name, phone: '', roles: [...m.roles], projectIds: m.projects.map((p) => p.projectId) })
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
  } finally {
    dialog.saving = false
  }
}

async function toggleStatus(m: MemberView) {
  const disable = m.status === 'NORMAL'
  try {
    await ElMessageBox.confirm(
      disable ? `停用后「${m.name}」将被立即强制下线且无法登录，确定停用？` : `确定启用「${m.name}」？启用后可重新登录。`,
      disable ? '停用成员' : '启用成员',
      { type: 'warning', confirmButtonText: disable ? '停用' : '启用', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await tenantApi.setMemberStatus(m.memberId, disable ? 'DISABLED' : 'NORMAL')
    ElMessage.success(disable ? '已停用' : '已启用')
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}

// ---------------------------------------------------------------- 行操作
const isSelf = (m: MemberView) => m.memberId === meStore.me?.memberId
/** 自己这一行不能停用（否则公司可能没有可登录的老板）；编辑自己时也不能去掉老板角色 */
function rowActions(m: MemberView): RowAction[] {
  if (!canManage.value) return []
  const a: RowAction[] = [{ key: 'edit', label: '编辑' }]
  if (!isSelf(m)) a.push(m.status === 'NORMAL' ? { key: 'toggle', label: '停用', type: 'danger', plain: true } : { key: 'toggle', label: '启用', type: 'primary', plain: true })
  return a
}
const opsWidth = computed(() => opsColWidth(members.value.map(rowActions)))
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
      <el-button v-if="canManage" type="primary" @click="openCreate">+ 新增成员</el-button>
    </div>

    <div class="grid g-4" style="margin-bottom: 14px">
      <div class="stat"><div class="stat-l">成员总数</div><div class="stat-v">{{ stats.total }}</div><div class="stat-d">已停用 {{ stats.disabled }}</div></div>
      <div class="stat"><div class="stat-l">驻场</div><div class="stat-v">{{ stats.site }}</div><div class="stat-d">启用中</div></div>
      <div class="stat"><div class="stat-l">人才经纪人</div><div class="stat-v">{{ stats.broker }}</div><div class="stat-d">启用中</div></div>
      <div class="stat"><div class="stat-l">项目经理 / 老板</div><div class="stat-v">{{ stats.pm }} / {{ stats.owner }}</div><div class="stat-d">启用中</div></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <b class="strong" style="font-size: 15px">成员列表</b>
        <div class="tb-fields">
          <el-select v-model="filter.role" placeholder="全部角色" clearable style="width: 140px" @change="load">
            <el-option v-for="o in roleOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <div class="tb-group">
            <el-input v-model="filter.keyword" placeholder="姓名 / 手机号" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
            <el-button @click="load">查询</el-button>
          </div>
        </div>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="members" row-key="memberId" :row-class-name="({ row }) => (row.status === 'DISABLED' ? 'row-dim' : '')">
        <el-table-column label="成员" min-width="190">
          <template #default="{ row }">
            <div class="row">
              <div class="av">{{ row.name.slice(0, 1) }}</div>
              <div class="nowrap">
                <b>{{ row.name }}</b>
                <span v-if="isSelf(row)" class="tag tag--info" style="margin-left: 6px">我</span>
                <div class="t-xs mono">{{ row.phoneMasked }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <div class="row-wrap"><DictTag v-for="r in row.roles" :key="r" type="ActorRole" :value="r" /></div>
          </template>
        </el-table-column>
        <el-table-column label="负责项目" min-width="200">
          <template #default="{ row }">
            <span v-if="row.roles.includes('OWNER') && !row.projects.length" class="t-sm">全公司</span>
            <span v-else-if="!row.projects.length" class="t-xs">未分配</span>
            <span v-else class="t-sm clamp-2" :title="projectNames(row)">{{ projectNames(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="90">
          <template #default="{ row }"><DictTag type="MemberStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="最近登录" min-width="156">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.lastLoginAt) }}</span></template>
        </el-table-column>
        <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
          <template #default="{ row }"><RowActions :actions="rowActions(row)" @act="(k) => (k === 'edit' ? openEdit(row) : toggleStatus(row))" /></template>
        </el-table-column>
        <template #empty><el-empty :description="loadError ? '加载失败' : '暂无成员'" :image-size="80" /></template>
      </el-table>
      <div v-if="!canManage" class="card__ft t-xs">你当前为只读视图，成员增删改仅限公司老板操作。</div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="card__hd">
        <h3>角色权限矩阵</h3>
        <span class="legend t-xs"><span><i class="yes">✓</i>可操作</span><span><i class="ro">只读</i>可查看不可改</span><span><i class="no">—</i>无权限</span></span>
      </div>
      <el-table :data="matrix" size="small" :span-method="matrixSpan" row-key="cap">
        <el-table-column label="分类" min-width="100">
          <template #default="{ row }"><span class="t-sm dim">{{ row.group }}</span></template>
        </el-table-column>
        <el-table-column label="能力" min-width="240">
          <template #default="{ row }"><span class="t-sm">{{ row.cap }}</span></template>
        </el-table-column>
        <el-table-column v-for="(r, i) in MATRIX_ROLES" :key="r" align="center" min-width="140">
          <template #header><DictTag type="ActorRole" :value="r" /></template>
          <template #default="{ row }">
            <template v-if="row.cells[i].level === 'op'">
              <span class="yes">✓</span><span v-if="row.cells[i].text" class="t-xs cell-note">{{ row.cells[i].text }}</span>
            </template>
            <span v-else-if="row.cells[i].level === 'ro'" class="ro">只读</span>
            <span v-else class="no">—</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="card__ft t-xs">矩阵与左侧菜单、页面访问规则同源。预支审批为双级：驻场初审 + 项目经理终审，老板可查看并登记拨款；完整手机号仅驻场可见，其余角色看到的是脱敏信息。</div>
    </div>

    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑成员' : '新增成员'" width="560px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="86px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" maxlength="20" placeholder="成员真实姓名" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-if="!dialog.editing" v-model="form.phone" maxlength="11" placeholder="成员用此手机号登录" />
          <template v-else>
            <span class="mono">{{ dialog.editing.phoneMasked }}</span>
            <span class="t-xs" style="margin-left: 8px">手机号创建后不可修改</span>
          </template>
        </el-form-item>
        <el-form-item label="角色" prop="roles">
          <el-checkbox-group v-model="form.roles" class="role-grid">
            <el-checkbox v-for="o in roleOptions" :key="o.value" :value="o.value" :disabled="editingSelf && o.value === 'OWNER' && form.roles.includes('OWNER')">{{ o.label }}</el-checkbox>
          </el-checkbox-group>
          <div v-if="editingSelf" class="t-xs" style="line-height: 1.5">不能去掉自己的老板角色，也不能停用自己；如需交接，请先把另一位成员设为老板，再由对方操作。</div>
        </el-form-item>
        <el-form-item label="负责项目">
          <el-select v-model="form.projectIds" multiple filterable placeholder="选择负责的项目" style="width: 100%" no-data-text="暂无项目，请先在「项目与甲方」中创建">
            <el-option v-for="p in projectOptions" :key="p.projectId" :label="p.name" :value="p.projectId">
              <span>{{ p.name }}</span>
              <span class="t-xs" style="float: right">{{ p.clientName }}</span>
            </el-option>
          </el-select>
          <div v-if="needsProject && !form.projectIds.length" class="t-xs" style="margin-top: 4px">驻场 / 项目经理只能操作自己负责的项目，建议至少分配一个。</div>
        </el-form-item>
      </el-form>
      <div v-if="dialog.editing" class="note note--warn">修改角色后，该成员的登录会话将失效，需要重新登录。</div>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-3); color: var(--ink-700); font-weight: 700; font-size: 12px; flex: none; }
.yes { color: var(--ok); font-weight: 700; font-style: normal; }
.ro { display: inline-block; padding: 0 7px; border-radius: 6px; background: var(--info-bg); color: var(--info); font-size: 12px; font-weight: 500; line-height: 20px; font-style: normal; }
.no { color: var(--ink-300); font-style: normal; }
.cell-note { margin-left: 6px; color: var(--ink-500); }
.legend { display: inline-flex; flex-wrap: wrap; gap: 4px 16px; }
.legend > span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
/* 角色两列排布，四个角色正好两行，不会单独掉一个到下一行 */
.role-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; width: 100%; }
.role-grid :deep(.el-checkbox) { margin-right: 0; }
</style>
