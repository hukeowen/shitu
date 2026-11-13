<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { tenantApi, type JobView, type StaffRow } from '@shitu/api-client'
import { IconInfo } from '@shitu/ui-icons'
import { boxSubmit } from '@/composables/boxSubmit'
import { useProjects } from '@/composables/useProjects'

/** 内部调岗（T-307，仅项目经理）：选目标项目 + 可选岗位 */
const props = defineProps<{ row: StaffRow | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()
const { projects } = useProjects()

const form = reactive({ projectId: '', jobId: '' })
const jobs = ref<JobView[]>([])
const jobsLoading = ref(false)
/** 调岗被后端业务拒绝的原因：留在弹窗里、置灰「确认调岗」，改了调入项目或岗位再放开 */
const why = ref('')
watch(() => [form.projectId, form.jobId], () => (why.value = ''))
const activeProjects = computed(() => projects.value.filter((p) => p.status === 'ACTIVE'))

watch(visible, (v) => {
  if (v && props.row) {
    form.projectId = props.row.projectId
    form.jobId = ''
    why.value = ''
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
  // 确认框里提交（规范 Page States「后台确认框一律在框内提交」）
  const s = boxSubmit(
    `将 ${r.name} 调至「${p?.name ?? form.projectId}${j ? ` · ${j.title}` : ''}」？调岗不影响在岗天数与归属。`,
    '调岗',
    () => tenantApi.transfer(r.employmentId, form.projectId, form.jobId || undefined),
    (w) => (why.value = w),
  )
  try {
    await ElMessageBox.confirm(s.message, '内部调岗', { confirmButtonText: '确认调岗', cancelButtonText: '取消', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('调岗完成')
  visible.value = false
  emit('done')
}
</script>

<template>
  <el-dialog v-model="visible" title="内部调岗" width="480px">
    <template v-if="row">
      <dl class="desc-list">
        <div><dt>员工</dt><dd>{{ row.name }}{{ row.employeeNo ? ` · ${row.employeeNo}` : '' }}</dd></div>
        <div><dt>当前</dt><dd>{{ row.projectName }} · {{ row.jobTitle ?? '—' }}</dd></div>
      </dl>
      <el-form label-width="80px" class="dlg-form" @submit.prevent>
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
      <div class="notice-bar">
        <IconInfo :size="16" class="notice-bar-i" />
        <span>已入职员工匹配范围锁定为「仅本公司内部调岗」，调岗不改变来源归属和计费。</span>
      </div>
      <p v-if="why" class="blocked-why dlg-why" role="alert">{{ why }}</p>
    </template>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!!why" @click="submit">确认调岗</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dlg-form { margin-top: var(--space-4); }
.dlg-why { margin-top: var(--space-3); }
</style>
