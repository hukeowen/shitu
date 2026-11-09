<script setup lang="ts">
import { shNow } from '@/utils/time'
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type StaffRow } from '@shitu/api-client'
import { addDays, parseLocal, ymd } from '@/utils/time'

/** 发起离职（T-308，驻场 / 项目经理）→ 项目经理在「离职审核」确认 */
const props = defineProps<{ row: StaffRow | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()

const REASONS = ['个人 / 家庭原因', '岗位不适应', '薪资不满意', '吃住条件', '违纪辞退', '合同到期不续签']
const form = reactive({ resignDate: ymd(shNow()), reason: '', remark: '' })
const saving = ref(false)

/** 默认今天；入职当天或之后入职的，默认入职次日 */
function defaultDate(): string {
  const start = parseLocal(props.row?.startDate)
  const today = shNow()
  today.setHours(0, 0, 0, 0)
  return ymd(start && start.getTime() >= today.getTime() ? addDays(start, 1) : today)
}

watch(visible, (v) => {
  if (v) {
    form.resignDate = defaultDate()
    form.reason = ''
    form.remark = ''
  }
})

/** 离职日：晚于入职日，且在近 31 天到未来 30 天之间（后端同口径） */
function disableDate(d: Date) {
  const start = parseLocal(props.row?.startDate)
  const min = addDays(shNow(), -31)
  min.setHours(0, 0, 0, 0)
  const max = addDays(shNow(), 30)
  return (start != null && d.getTime() <= start.getTime()) || d.getTime() < min.getTime() || d.getTime() > max.getTime()
}

async function submit() {
  const r = props.row
  if (!r) return
  if (!form.resignDate) return ElMessage.warning('请选择最后工作日')
  if (!form.reason) return ElMessage.warning('请选择离职原因')
  saving.value = true
  try {
    const reason = form.remark.trim() ? `${form.reason}：${form.remark.trim()}` : form.reason
    await tenantApi.requestResign(r.employmentId, form.resignDate, reason)
    ElMessage.success('离职申请已提交，待项目经理审核')
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
  <el-dialog v-model="visible" title="发起离职" width="480px">
    <template v-if="row">
      <dl class="kv"><dt>员工</dt><dd>{{ row.name }}{{ row.employeeNo ? ` · ${row.employeeNo}` : '' }}</dd></dl>
      <dl class="kv"><dt>岗位</dt><dd>{{ row.jobTitle ?? '—' }} · {{ row.projectName }}</dd></dl>
      <dl class="kv"><dt>入职 / 在岗</dt><dd class="mono">{{ row.startDate }} · {{ row.dutyDays }} 天</dd></dl>
      <el-form label-width="88px" style="margin-top: 16px" @submit.prevent>
        <el-form-item label="最后工作日" required>
          <el-date-picker v-model="form.resignDate" type="date" value-format="YYYY-MM-DD" :disabled-date="disableDate" :clearable="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="离职原因" required>
          <el-select v-model="form.reason" placeholder="请选择" style="width: 100%">
            <el-option v-for="r in REASONS" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="补充说明">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="150" />
        </el-form-item>
      </el-form>
      <div class="note note--warn">审核通过后：归属清空变公域、计费停止、劳动合同终止；有未还清的薪酬预支须先结清。</div>
    </template>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">提交审核</el-button>
    </template>
  </el-dialog>
</template>
