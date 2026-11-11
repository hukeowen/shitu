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
import { useMeStore } from '@/stores/me'
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

// ---------------------------------------------------------------- 权限矩阵（原型 A-19，与后端 TenantPermissions 一致）
type Cell = boolean | string
const MATRIX: { cap: string; strong?: boolean; v: [Cell, Cell, Cell, Cell] }[] = [
  { cap: '查看完整手机号', v: [true, false, false, false] },
  { cap: '查看用工档案', v: [true, true, true, false] },
  { cap: '查看 AI 画像', v: [true, true, false, false] },
  { cap: '到厂确认 / 入职确权', v: [true, false, true, false] },
  { cap: '标记爽约', v: [true, false, false, false] },
  { cap: '取消报名', v: [true, false, true, false] },
  { cap: '流转至经纪人', v: [true, false, true, false] },
  { cap: '释放至公域', strong: true, v: [true, true, false, false] },
  { cap: '岗位管理 / 知识库', v: [false, false, true, false] },
  { cap: '离职审核', v: [false, false, true, false] },
  { cap: '预支审批', v: ['初审', false, '终审', false] },
  { cap: '项目 / 甲方合同管理', v: [false, false, true, true] },
  { cap: '渠道二维码管理', v: [false, false, true, true] },
  { cap: '组织与权限（成员管理）', v: [false, false, false, true] },
  { cap: '数据总览 / 费用账单', v: [false, false, false, true] },
]

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
        <b class="strong" style="font-size: 14px">成员列表</b>
        <span class="spacer" />
        <el-select v-model="filter.role" placeholder="全部角色" clearable style="width: 140px" @change="load">
          <el-option v-for="o in roleOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="filter.keyword" placeholder="姓名 / 手机号" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
        <el-button @click="load">查询</el-button>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
        <el-button size="small" @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="members" row-key="memberId" :row-class-name="({ row }) => (row.status === 'DISABLED' ? 'row-dim' : '')">
        <el-table-column label="成员" min-width="160">
          <template #default="{ row }">
            <div class="row">
              <div class="av">{{ row.name.slice(0, 1) }}</div>
              <div>
                <b>{{ row.name }}</b>
                <span v-if="row.memberId === meStore.me?.memberId" class="tag tag--info" style="margin-left: 6px">我</span>
                <div class="t-xs mono">{{ row.phoneMasked }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="170">
          <template #default="{ row }">
            <div class="row-wrap"><DictTag v-for="r in row.roles" :key="r" type="ActorRole" :value="r" /></div>
          </template>
        </el-table-column>
        <el-table-column label="负责项目" min-width="200">
          <template #default="{ row }">
            <span v-if="row.roles.includes('OWNER') && !row.projects.length" class="t-sm">全公司</span>
            <span v-else-if="!row.projects.length" class="t-xs">未分配</span>
            <span v-else class="t-sm">{{ projectNames(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><DictTag type="MemberStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="最近登录" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.lastLoginAt) }}</span></template>
        </el-table-column>
        <el-table-column v-if="canManage" label="操作" width="150" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" :type="row.status === 'NORMAL' ? 'danger' : 'primary'" plain @click="toggleStatus(row)">
              {{ row.status === 'NORMAL' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty :description="loadError ? '加载失败' : '暂无成员'" :image-size="80" /></template>
      </el-table>
      <div v-if="!canManage" class="card__ft t-xs">你当前为只读视图，成员增删改仅限公司老板操作。</div>
    </div>

    <div class="card" style="margin-top: 14px">
      <div class="card__hd">
        <h3>角色权限矩阵</h3>
        <span class="t-xs">预支审批：驻场初审 + 项目经理终审</span>
      </div>
      <el-table :data="MATRIX" size="small">
        <el-table-column label="能力" min-width="200">
          <template #default="{ row }"><span :class="row.strong ? 'strong' : 't-sm'">{{ row.cap }}</span></template>
        </el-table-column>
        <el-table-column v-for="(r, i) in TENANT_ROLES" :key="r" align="center" width="120">
          <template #header><DictTag type="ActorRole" :value="r" /></template>
          <template #default="{ row }">
            <span v-if="typeof row.v[i] === 'string'" class="t-xs strong">{{ row.v[i] }}</span>
            <span v-else-if="row.v[i]" class="yes">✓</span>
            <span v-else class="no">✕</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="card__ft t-xs">老板仅可查看聚合统计，不接触求职者个人隐私；项目经理可见用工档案（自动隐藏手机号 / 证件号）。</div>
    </div>

    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑成员' : '新增成员'" width="520px" :close-on-click-modal="false">
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
          <el-checkbox-group v-model="form.roles">
            <el-checkbox v-for="o in roleOptions" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
          </el-checkbox-group>
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
.yes { color: var(--ok); font-weight: 700; }
.no { color: var(--danger); }
</style>
