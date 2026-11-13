<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type AttributionDispute } from '@shitu/api-client'
import { fmtDateTime } from '@/utils/format'

/**
 * 归属争议（P-08）：传 userId 时显示这个人的全部争议并可登记新的；不传时显示全平台待处理的争议。
 * 来源归属注册时锁定、不可更改，处理结论只留痕。
 */
const props = defineProps<{ userId?: string }>()
const emit = defineEmits<{ open: [userId: string] }>()

const rows = ref<AttributionDispute[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await opsApi.attributionDisputes(props.userId)
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '争议记录加载失败')
  } finally {
    loading.value = false
  }
}
watch(() => props.userId, load, { immediate: true })

const add = reactive({ open: false, companyId: '', content: '', saving: false, error: '' })
function openAdd() {
  Object.assign(add, { open: true, companyId: '', content: '', error: '' })
}
async function submitAdd() {
  if (!props.userId) return
  if (add.content.trim().length < 5) return void (add.error = '请写明争议内容（至少 5 个字）')
  add.saving = true
  try {
    await opsApi.addAttributionDispute({ userId: props.userId, companyId: add.companyId.trim() || undefined, content: add.content.trim() })
    ElMessage.success('已登记')
    add.open = false
    await load()
  } catch (e) {
    add.error = errorMessage(e, '登记失败')
  } finally {
    add.saving = false
  }
}

const res = reactive({ open: false, row: null as AttributionDispute | null, conclusion: '', saving: false, error: '' })
function openResolve(row: AttributionDispute) {
  Object.assign(res, { open: true, row, conclusion: '', error: '' })
}
async function submitResolve() {
  if (!res.row) return
  if (res.conclusion.trim().length < 5) return void (res.error = '请写明处理结论（至少 5 个字）')
  res.saving = true
  try {
    await opsApi.resolveAttributionDispute(res.row.id, res.conclusion.trim())
    ElMessage.success('已结案')
    res.open = false
    await load()
  } catch (e) {
    res.error = errorMessage(e, '操作失败')
  } finally {
    res.saving = false
  }
}
</script>

<template>
  <div class="card" style="margin-top: 14px">
    <div class="card__hd">
      <h3>{{ userId ? '该用户的归属争议' : '待处理的归属争议' }}</h3>
      <span class="hd-r">
        <span class="t-xs">来源归属注册时锁定、不可更改；这里登记争议并记录核查结论</span>
        <el-button v-if="userId" size="small" type="primary" @click="openAdd">登记争议</el-button>
      </span>
    </div>
    <el-table v-loading="loading" :data="rows" row-key="id">
      <el-table-column label="登记时间" width="150"><template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template></el-table-column>
      <el-table-column v-if="!userId" label="用户" width="170">
        <template #default="{ row }"><span class="link-cell mono" @click="emit('open', row.userId)">{{ row.userId }}</span></template>
      </el-table-column>
      <el-table-column label="提出异议的公司" min-width="180">
        <template #default="{ row }">{{ row.companyName ?? '—' }}<div v-if="row.companyId" class="t-xs mono">{{ row.companyId }}</div></template>
      </el-table-column>
      <el-table-column label="争议内容 / 结论" min-width="320">
        <template #default="{ row }">
          <div class="content">{{ row.content }}</div>
          <div class="t-xs">{{ row.createdByName ?? '—' }} 登记</div>
          <div v-if="row.conclusion" class="reply"><b>结论</b>{{ row.conclusion }}<span class="t-xs"> · {{ row.resolvedByName }} {{ fmtDateTime(row.resolvedAt) }}</span></div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }"><span class="tag" :class="row.status === 'OPEN' ? 'tag--warn' : 'tag--ok'">{{ row.status === 'OPEN' ? '待处理' : '已结案' }}</span></template>
      </el-table-column>
      <el-table-column label="操作" class-name="ops-col" width="100" align="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'OPEN'" size="small" @click="openResolve(row)">写结论</el-button>
          <span v-else class="t-xs">—</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty v-if="loadError" :image-size="56" :description="loadError"><el-button size="small" @click="load">重试</el-button></el-empty>
        <el-empty v-else :image-size="56" :description="userId ? '该用户没有归属争议' : '没有待处理的归属争议'" />
      </template>
    </el-table>

    <el-dialog v-model="add.open" title="登记归属争议" width="520px" destroy-on-close :close-on-click-modal="false">
      <el-form label-width="110px" @submit.prevent>
        <el-form-item label="用户"><span class="mono">{{ userId }}</span></el-form-item>
        <el-form-item label="提出异议的公司">
          <el-input v-model="add.companyId" placeholder="公司 ID，如 C10001（可不填）" @input="add.error = ''" />
        </el-form-item>
        <el-form-item label="争议内容" required>
          <el-input v-model="add.content" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="谁提出、主张什么、依据是什么" @input="add.error = ''" />
        </el-form-item>
      </el-form>
      <div v-if="add.error" class="notice notice--danger">{{ add.error }}</div>
      <template #footer>
        <el-button @click="add.open = false">取消</el-button>
        <el-button type="primary" :loading="add.saving" @click="submitAdd">登记</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="res.open" title="写处理结论" width="520px" destroy-on-close :close-on-click-modal="false">
      <template v-if="res.row">
        <div class="content box">{{ res.row.content }}</div>
        <el-input v-model="res.conclusion" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="核查了什么（注册渠道、状态日志、报名与任职记录）、结论是什么" style="margin-top: 12px" @input="res.error = ''" />
        <div class="notice notice--info" style="margin-top: 10px">结案只留痕，不会改动来源归属和当前归属。需要释放当前归属的，由该公司在后台操作。</div>
        <div v-if="res.error" class="notice notice--danger" style="margin-top: 10px">{{ res.error }}</div>
      </template>
      <template #footer>
        <el-button @click="res.open = false">取消</el-button>
        <el-button type="primary" :loading="res.saving" @click="submitResolve">结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.hd-r { display: flex; align-items: center; gap: 12px; }
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
.box { padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); max-height: 200px; overflow: auto; }
.reply { margin-top: 6px; padding: 6px 10px; border-left: 3px solid var(--ok); background: var(--surface-2); border-radius: var(--r-xs); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.reply b { color: var(--ok); margin-right: 6px; font-size: 12px; }
</style>
