<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { errorMessage, opsApi, useDict, type AdminView, type OpsRole } from '@shitu/api-client'
import DictTags from '@/components/DictTags.vue'
import OneTimePasswordDialog from '@/components/OneTimePasswordDialog.vue'
import StatusTag from '@/components/StatusTag.vue'
import { usePagedList } from '@/composables/usePagedList'
import { confirmAction } from '@/composables/useRemark'
import { useAuthStore } from '@/stores/auth'
import { fmtDateTime } from '@/utils/format'

const router = useRouter()
const auth = useAuthStore()
const { options } = useDict()

const keyword = ref('')
const list = usePagedList<AdminView>((p) => opsApi.admins({ ...p, keyword: keyword.value.trim() || undefined }))
const roleOptions = computed(() => options('OpsRole'))
const isSelf = (row: AdminView) => row.adminId === auth.me?.adminId

// ---------- 新建 / 编辑 ----------
const formRef = ref<FormInstance>()
const dlg = reactive({ visible: false, mode: 'create' as 'create' | 'edit', adminId: '', saving: false, error: '' })
const form = reactive({ username: '', displayName: '', roles: [] as OpsRole[] })
const rules: FormRules<typeof form> = {
  username: [
    { required: true, message: '请填写用户名', trigger: 'blur' },
    { pattern: /^[a-z0-9_.]{3,32}$/, message: '3–32 位，仅限小写字母、数字、下划线和点', trigger: 'blur' },
  ],
  displayName: [
    { required: true, message: '请填写姓名', trigger: 'blur' },
    { max: 32, message: '最多 32 字', trigger: 'blur' },
  ],
  roles: [{ type: 'array', required: true, min: 1, message: '至少选择一个角色', trigger: 'change' }],
}

function openCreate() {
  dlg.mode = 'create'
  dlg.adminId = ''
  dlg.error = ''
  Object.assign(form, { username: '', displayName: '', roles: [] })
  dlg.visible = true
}
function openEdit(row: AdminView) {
  dlg.mode = 'edit'
  dlg.adminId = row.adminId
  dlg.error = ''
  Object.assign(form, { username: row.username, displayName: row.displayName, roles: [...row.roles] })
  dlg.visible = true
}

const editingSelfRoles = computed(() => {
  if (dlg.mode !== 'edit' || dlg.adminId !== auth.me?.adminId) return false
  const before = [...(auth.me?.roles ?? [])].sort().join(',')
  return before !== [...form.roles].sort().join(',')
})

const otp = reactive({ visible: false, title: '', username: '', password: '' })
function showOtp(title: string, username: string, password: string) {
  Object.assign(otp, { visible: true, title, username, password })
}

async function save() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  dlg.saving = true
  dlg.error = ''
  try {
    if (dlg.mode === 'create') {
      const r = await opsApi.createAdmin({ username: form.username.trim(), displayName: form.displayName.trim(), roles: form.roles })
      dlg.visible = false
      showOtp('账号已创建 · 初始密码', r.admin.username, r.initialPassword)
      list.search()
    } else {
      const selfRolesChanged = editingSelfRoles.value
      await opsApi.updateAdmin(dlg.adminId, { displayName: form.displayName.trim(), roles: form.roles })
      dlg.visible = false
      if (selfRolesChanged) {
        // 角色变更后服务端吊销该账号全部会话
        auth.clear()
        ElMessage.success('角色已修改，请重新登录')
        router.replace('/login')
        return
      }
      ElMessage.success('已保存')
      if (dlg.adminId === auth.me?.adminId) auth.loadMe().catch(() => undefined)
      list.load()
    }
  } catch (e) {
    dlg.error = errorMessage(e)
  } finally {
    dlg.saving = false
  }
}

// ---------- 停用 / 启用 / 重置密码 ----------
const acting = ref<string | null>(null)
async function toggleStatus(row: AdminView) {
  const disable = row.status === 'NORMAL'
  const ok = await confirmAction(
    disable ? '停用账号' : '启用账号',
    disable ? `停用后「${row.displayName}（${row.username}）」将立即被踢下线且无法登录，确定停用？` : `确定启用「${row.displayName}（${row.username}）」？`,
    disable,
  )
  if (!ok) return
  acting.value = row.adminId
  try {
    await opsApi.setAdminStatus(row.adminId, disable ? 'DISABLED' : 'NORMAL')
    ElMessage.success(disable ? '已停用' : '已启用')
    list.load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = null
  }
}

async function resetPassword(row: AdminView) {
  const ok = await confirmAction(
    '重置密码',
    `将为「${row.displayName}（${row.username}）」生成新的一次性密码，原密码立即失效、该账号所有登录被踢下线，首次登录须修改密码。确定重置？`,
    true,
  )
  if (!ok) return
  acting.value = row.adminId
  try {
    const r = await opsApi.resetAdminPassword(row.adminId)
    showOtp('密码已重置 · 一次性新密码', row.username, r.initialPassword)
    list.load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    acting.value = null
  }
}

onMounted(() => list.load())
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>平台账号与权限</h2><p>超级管理员维护平台账号与角色：超级管理员 / 运营 / 财务 / 风控。新建与重置均生成一次性密码，首次登录强制修改</p></div>
      <div class="spacer" />
      <span class="ref">原型 <b>P-15</b></span>
    </div>

    <div class="card">
      <div class="toolbar">
        <el-input v-model="keyword" clearable placeholder="用户名 / 姓名" style="width: 220px" @keyup.enter="list.search()" @clear="list.search()" />
        <el-button @click="list.search()">查询</el-button>
        <div class="spacer" />
        <el-button type="primary" @click="openCreate">新建账号</el-button>
      </div>

      <el-table v-loading="list.loading.value" :data="list.rows.value" class="ops-table" row-key="adminId">
        <el-table-column label="用户名" min-width="140">
          <template #default="{ row }">
            <span class="mono strong">{{ row.username }}</span>
            <span v-if="isSelf(row)" class="tag tag--signal ml">我</span>
          </template>
        </el-table-column>
        <el-table-column label="姓名" prop="displayName" min-width="110" />
        <el-table-column label="角色" min-width="200">
          <template #default="{ row }"><DictTags type="OpsRole" :values="row.roles" highlight="SUPER" /></template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StatusTag type="MemberStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="密码" width="110">
          <template #default="{ row }">
            <span v-if="row.mustChangePassword" class="tag tag--warn">待首次改密</span>
            <span v-else class="dim t-sm">已设置</span>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.lastLoginAt) }}</span></template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" size="small" :disabled="acting === row.adminId" @click="resetPassword(row)">重置密码</el-button>
            <el-tooltip v-if="isSelf(row)" content="不能停用自己的账号" placement="top">
              <span><el-button link size="small" disabled>停用</el-button></span>
            </el-tooltip>
            <el-button v-else link size="small" :type="row.status === 'NORMAL' ? 'danger' : 'success'" :disabled="acting === row.adminId" @click="toggleStatus(row)">
              {{ row.status === 'NORMAL' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="list.error.value" :image-size="64" :description="list.error.value">
            <el-button size="small" @click="list.load()">重试</el-button>
          </el-empty>
          <el-empty v-else :image-size="64" description="暂无账号" />
        </template>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="list.total.value"
          :current-page="list.page.value"
          :page-size="list.pageSize.value"
          @current-change="list.onPageChange"
        />
      </div>
    </div>

    <el-dialog v-model="dlg.visible" :title="dlg.mode === 'create' ? '新建平台账号' : '编辑平台账号'" width="480px" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="72px" @submit.prevent="save">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="dlg.mode === 'edit'" maxlength="32" placeholder="3–32 位小写字母、数字、_ 或 ." />
        </el-form-item>
        <el-form-item label="姓名" prop="displayName">
          <el-input v-model="form.displayName" maxlength="32" placeholder="使用人真实姓名" />
        </el-form-item>
        <el-form-item label="角色" prop="roles">
          <el-checkbox-group v-model="form.roles">
            <el-checkbox v-for="o in roleOptions" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <div v-if="dlg.mode === 'create'" class="notice notice--info">创建后系统生成一次性初始密码，仅显示一次。</div>
        <div v-else-if="editingSelfRoles" class="notice notice--warn">你正在修改自己的角色，保存后需要重新登录。</div>
        <div v-else-if="dlg.mode === 'edit'" class="notice notice--info">修改角色后该账号会被强制下线，重新登录后生效。</div>
        <div v-if="dlg.error" class="notice notice--danger err">{{ dlg.error }}</div>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">{{ dlg.mode === 'create' ? '创建' : '保存' }}</el-button>
      </template>
    </el-dialog>

    <OneTimePasswordDialog v-model="otp.visible" :title="otp.title" :username="otp.username" :password="otp.password" />
  </div>
</template>

<style scoped>
.ml { margin-left: 6px; }
.err { margin-top: 10px; }
</style>
