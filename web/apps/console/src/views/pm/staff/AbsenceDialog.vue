<script setup lang="ts">
import { shNow } from '@/utils/time'
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type DutyAbsenceView, type StaffRow } from '@shitu/api-client'
import DictTag from '@/components/DictTag.vue'
import { fmtDateTime } from '@/utils/format'
import { enumLabel } from '@/utils/labels'
import { monthRange, parseLocal, ym, ymd } from '@/utils/time'

/** 请假 / 旷工标记（驻场 / 项目经理）：标记某天 + 查看当月记录、撤销 */
const props = defineProps<{ row: StaffRow | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()

const form = reactive({ date: ymd(shNow()), type: 'LEAVE' as 'LEAVE' | 'ABSENT', remark: '' })
const month = ref(ym(shNow()))
const records = ref<DutyAbsenceView[]>([])
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const changed = ref(false)

const summary = computed(() => ({
  leave: records.value.filter((r) => r.absenceType === 'LEAVE').length,
  absent: records.value.filter((r) => r.absenceType === 'ABSENT').length,
}))

async function load() {
  const r = props.row
  if (!r) return
  loading.value = true
  loadError.value = ''
  try {
    const { from, to } = monthRange(month.value)
    const list = await tenantApi.absences(r.employmentId, from, to)
    records.value = [...list].sort((a, b) => b.absenceDate.localeCompare(a.absenceDate))
  } catch (e) {
    loadError.value = errorMessage(e, '记录加载失败')
    records.value = []
  } finally {
    loading.value = false
  }
}

watch(visible, (v) => {
  if (v && props.row) {
    form.date = ymd(shNow())
    form.type = 'LEAVE'
    form.remark = ''
    month.value = ym(shNow())
    changed.value = false
    load()
  } else if (!v && changed.value) {
    emit('done')
  }
})
watch(month, () => {
  if (visible.value) load()
})

/** 只能标记入职日之后、今天（或离职日）之前的日期 */
function disableDate(d: Date) {
  const start = parseLocal(props.row?.startDate)
  const end = parseLocal(props.row?.endDate) ?? shNow()
  return (start != null && d.getTime() < start.getTime()) || d.getTime() > end.getTime()
}

async function submit() {
  const r = props.row
  if (!r) return
  if (!form.date) return ElMessage.warning('请选择日期')
  saving.value = true
  try {
    await tenantApi.markAbsence(r.employmentId, form.date, form.type, form.remark.trim() || undefined)
    ElMessage.success(`已标记 ${form.date} ${enumLabel('AbsenceType', form.type)}`)
    changed.value = true
    form.remark = ''
    if (form.date.startsWith(month.value)) load()
    else month.value = form.date.slice(0, 7)
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    saving.value = false
  }
}

async function revoke(rec: DutyAbsenceView) {
  const r = props.row
  if (!r) return
  try {
    await ElMessageBox.confirm(`撤销 ${rec.absenceDate} 的${enumLabel('AbsenceType', rec.absenceType)}标记？`, '撤销标记', {
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await tenantApi.markAbsence(r.employmentId, rec.absenceDate)
    ElMessage.success('已撤销')
    changed.value = true
    load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="请假 / 旷工标记" width="600px">
    <template v-if="row">
      <dl class="kv"><dt>员工</dt><dd>{{ row.name }}{{ row.employeeNo ? ` · ${row.employeeNo}` : '' }} · {{ row.projectName }}</dd></dl>
      <el-form label-width="64px" style="margin-top: 14px" @submit.prevent>
        <div class="row" style="gap: 10px; align-items: flex-start">
          <el-form-item label="日期" required style="margin-bottom: 12px">
            <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" :disabled-date="disableDate" :clearable="false" style="width: 150px" />
          </el-form-item>
          <el-form-item label="类型" label-width="44px" style="margin-bottom: 12px">
            <el-radio-group v-model="form.type">
              <el-radio-button value="LEAVE">请假</el-radio-button>
              <el-radio-button value="ABSENT">旷工</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </div>
        <el-form-item label="备注">
          <el-input v-model="form.remark" maxlength="100" placeholder="选填，如：病假 / 事假" />
        </el-form-item>
      </el-form>
      <div style="text-align: right; margin-bottom: 14px">
        <el-button type="primary" :loading="saving" @click="submit">标记</el-button>
      </div>

      <div class="row" style="margin-bottom: 8px">
        <span class="form-sec" style="margin: 0; flex: 1">缺勤记录</span>
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 130px" size="small" />
        <span class="t-xs">请假 {{ summary.leave }} · 旷工 {{ summary.absent }}</span>
      </div>
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" />
      <el-table v-loading="loading" :data="records" size="small" max-height="260" row-key="id">
        <el-table-column label="日期" min-width="110"><template #default="{ row: r }"><span class="mono">{{ r.absenceDate }}</span></template></el-table-column>
        <el-table-column label="类型" min-width="80"><template #default="{ row: r }"><DictTag type="AbsenceType" :value="r.absenceType" /></template></el-table-column>
        <el-table-column label="备注" min-width="120"><template #default="{ row: r }"><span class="t-sm">{{ r.remark || '—' }}</span></template></el-table-column>
        <el-table-column label="标记时间" min-width="146"><template #default="{ row: r }"><span class="mono t-xs">{{ fmtDateTime(r.createdAt) }}</span></template></el-table-column>
        <el-table-column label="操作" width="72" class-name="ops-col">
          <template #default="{ row: r }"><el-button link type="danger" size="small" @click="revoke(r)">撤销</el-button></template>
        </el-table-column>
        <template #empty><span class="t-xs">本月无缺勤记录</span></template>
      </el-table>
    </template>
    <template #footer><el-button @click="visible = false">关闭</el-button></template>
  </el-dialog>
</template>
