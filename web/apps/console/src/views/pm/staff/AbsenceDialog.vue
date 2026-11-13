<script setup lang="ts">
import { shNow } from '@/utils/time'
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, tenantApi, type DutyAbsenceView, type StaffRow } from '@shitu/api-client'
import { IconCircleExclamationPoint } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { boxSubmit, isBlocked } from '@/composables/boxSubmit'
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
/** 本月记录拿到过（没拿到时不显示请假 / 旷工天数） */
const ready = ref(false)
const saving = ref(false)
const changed = ref(false)
/** 标记被后端业务拒绝：原因留在弹窗里、置灰「标记」，改了日期、类型或备注再放开 */
const why = ref('')
watch(() => [form.date, form.type, form.remark], () => (why.value = ''))
/** 撤销被后端业务拒绝的记录：只置灰这一条的「撤销」，原因写在记录表上方，重新加载后再判断 */
const blocked = reactive<Record<number, { date: string; text: string }>>({})

const summary = computed(() => ({
  leave: records.value.filter((r) => r.absenceType === 'LEAVE').length,
  absent: records.value.filter((r) => r.absenceType === 'ABSENT').length,
}))

async function load() {
  const r = props.row
  if (!r) return
  loading.value = true
  loadError.value = ''
  ready.value = false
  Object.keys(blocked).forEach((k) => delete blocked[Number(k)])
  try {
    const { from, to } = monthRange(month.value)
    const list = await tenantApi.absences(r.employmentId, from, to)
    records.value = [...list].sort((a, b) => b.absenceDate.localeCompare(a.absenceDate))
    ready.value = true
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
    why.value = ''
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
  if (saving.value) return
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
    if (isBlocked(e)) why.value = `暂时不能标记：${errorMessage(e)}`
  } finally {
    saving.value = false
  }
}

async function revoke(rec: DutyAbsenceView) {
  const r = props.row
  if (!r) return
  // 确认框里提交（规范 Page States「后台确认框一律在框内提交」）
  const s = boxSubmit(
    `撤销 ${rec.absenceDate} 的${enumLabel('AbsenceType', rec.absenceType)}标记？`,
    '撤销',
    () => tenantApi.markAbsence(r.employmentId, rec.absenceDate),
    (w) => (blocked[rec.id] = { date: rec.absenceDate, text: w }),
  )
  try {
    await ElMessageBox.confirm(s.message, '撤销标记', { confirmButtonText: '撤销', cancelButtonText: '取消', type: 'warning', beforeClose: s.beforeClose })
  } catch {
    // 取消 / 关闭；提交失败已在框里处理
    return
  }
  ElMessage.success('已撤销')
  changed.value = true
  load()
}
</script>

<template>
  <el-dialog v-model="visible" title="请假 / 旷工标记" width="600px">
    <template v-if="row">
      <dl class="desc-list">
        <div><dt>员工</dt><dd>{{ row.name }}{{ row.employeeNo ? ` · ${row.employeeNo}` : '' }}</dd></div>
        <div><dt>项目</dt><dd>{{ row.projectName }}</dd></div>
      </dl>
      <el-form label-width="64px" class="dlg-form" @submit.prevent>
        <div class="f-row">
          <el-form-item label="日期" required>
            <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" :disabled-date="disableDate" :clearable="false" style="width: 150px" />
          </el-form-item>
          <el-form-item label="类型" label-width="44px">
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
      <div class="mark-row">
        <p v-if="why" class="blocked-why" role="alert">{{ why }}</p>
        <el-button type="primary" :loading="saving" :disabled="!!why" @click="submit">标记</el-button>
      </div>

      <div class="rec-hd">
        <h4 class="rec-t">缺勤记录</h4>
        <span class="spacer" />
        <span v-if="ready" class="rec-sum">请假 {{ summary.leave }} 天 · 旷工 {{ summary.absent }} 天</span>
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 130px" size="small" />
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why rec-why" role="status">{{ b.date }} {{ b.text }}。重新加载后再判断</p>
      <el-table v-loading="loading" :data="records" size="small" max-height="260" row-key="id">
        <el-table-column label="日期" width="110"><template #default="{ row: r }"><span class="tnum">{{ r.absenceDate }}</span></template></el-table-column>
        <el-table-column label="类型" width="80"><template #default="{ row: r }"><DictTag type="AbsenceType" :value="r.absenceType" /></template></el-table-column>
        <el-table-column label="备注" min-width="120"><template #default="{ row: r }">{{ r.remark || '—' }}</template></el-table-column>
        <el-table-column label="标记时间" width="140"><template #default="{ row: r }"><span class="tnum sub">{{ fmtDateTime(r.createdAt) }}</span></template></el-table-column>
        <el-table-column label="操作" width="70" align="right" class-name="ops-col">
          <template #default="{ row: r }"><el-button link type="danger" size="small" :disabled="!!blocked[r.id]" @click="revoke(r)">撤销</el-button></template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box state-box--sm">
            <IconCircleExclamationPoint :size="32" />
            <h4>{{ loadError }}</h4>
            <el-button size="small" @click="load">重新加载</el-button>
          </div>
          <span v-else-if="!loading" class="sub">{{ month }} 没有缺勤记录</span>
          <span v-else />
        </template>
      </el-table>
    </template>
    <template #footer><el-button @click="visible = false">关闭</el-button></template>
  </el-dialog>
</template>

<style scoped>
.dlg-form { margin-top: var(--space-4); }
.f-row { display: flex; gap: var(--space-3); align-items: flex-start; }
.mark-row { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); margin-bottom: var(--space-4); }
.rec-hd { display: flex; align-items: center; gap: var(--space-3); padding-top: var(--space-4); margin-bottom: var(--space-2); border-top: 1px solid var(--divider); }
.rec-t { margin: 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.rec-sum { font-size: var(--font-size-aux); color: var(--text-2); }
.rec-why { margin-bottom: var(--space-2); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sub { font-size: var(--font-size-min); color: var(--text-3); }
.state-box--sm { padding: var(--space-4); }
</style>
