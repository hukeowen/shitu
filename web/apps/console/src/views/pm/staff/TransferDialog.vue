<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type JobView, type StaffRow } from '@shitu/api-client'
import { useProjects } from '@/composables/useProjects'

/** 内部调岗（T-307，仅项目经理）：选目标项目 + 可选岗位 */
const props = defineProps<{ row: StaffRow | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()
const { projects } = useProjects()

const form = reactive({ projectId: '', jobId: '' })
const jobs = ref<JobView[]>([])
const jobsLoading = ref(false)
const saving = ref(false)
const activeProjects = computed(() => projects.value.filter((p) => p.status === 'ACTIVE'))

watch(visible, (v) => {
  if (v && props.row) {
    form.projectId = props.row.projectId
    form.jobId = ''
    loadJobs(props.row.projectId)
  }
})

async function loadJobs(pid: string) {
  jobs.value = []
  if (!pid) return
  jobsLoading.value = true
  try {
    const r = await tenantApi.jobs({ projectId: pid, page: 1, pageSize: 100 })
    jobs.value = r.records.filter((j) => j.status === 'RECRUITING' || j.status === 'PAUSED')
  } catch {
    jobs.value = []
  } finally {
    jobsLoading.value = false
  }
}
function onProject(pid: string) {
  form.jobId = ''
  loadJobs(pid)
}

async function submit() {
  const r = props.row
  if (!r) return
  if (!form.projectId) return ElMessage.warning('请选择调入项目')
  if (form.projectId === r.projectId && (!form.jobId || form.jobId === r.jobId)) return ElMessage.warning('请选择不同的项目或岗位')
  const p = projects.value.find((x) => x.projectId === form.projectId)
  const j = jobs.value.find((x) => x.jobId === form.jobId)
  try {
    await ElMessageBox.confirm(`将 ${r.name} 调至「${p?.name ?? form.projectId}${j ? ` · ${j.title}` : ''}」？调岗不影响在岗天数与归属。`, '内部调岗', {
      confirmButtonText: '确认调岗',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  saving.value = true
  try {
    await tenantApi.transfer(r.employmentId, form.projectId, form.jobId || undefined)
    ElMessage.success('调岗完成')
    visible.value = false
    emit('done')
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="内部调岗" width="480px">
    <template v-if="row">
      <dl class="kv"><dt>员工</dt><dd>{{ row.name }}{{ row.employeeNo ? ` · ${row.employeeNo}` : '' }}</dd></dl>
      <dl class="kv"><dt>当前</dt><dd>{{ row.projectName }} · {{ row.jobTitle ?? '—' }}</dd></dl>
      <el-form label-width="80px" style="margin-top: 16px" @submit.prevent>
        <el-form-item label="调入项目" required>
          <el-select v-model="form.projectId" filterable style="width: 100%" @change="onProject">
            <el-option v-for="p in activeProjects" :key="p.projectId" :label="p.name" :value="p.projectId" />
          </el-select>
        </el-form-item>
        <el-form-item label="调入岗位">
          <el-select v-model="form.jobId" clearable filterable placeholder="选填" :loading="jobsLoading" style="width: 100%">
            <el-option v-for="j in jobs" :key="j.jobId" :label="j.title" :value="j.jobId" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="note note--info">已入职员工匹配范围锁定为「仅本公司内部调岗」，调岗不改变来源归属和计费。</div>
    </template>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">确认调岗</el-button>
    </template>
  </el-dialog>
</template>
