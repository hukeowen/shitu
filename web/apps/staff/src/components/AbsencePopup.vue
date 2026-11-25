<script setup lang="ts">
import { shNow } from '@/utils/time'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type DutyAbsenceView, type StaffRow } from '@shitu/api-client'
import { IconChevronLeft, IconChevronRight, IconX } from '@shitu/ui-icons'
import { fmtDay, fmtTime, parseLocal, startOfDay, ymd } from '@/utils/time'

/** M-15 请假 / 旷工标记：按人按日标记（扣减有效在岗日），查看当月记录、撤销 */
const props = defineProps<{ row: StaffRow | null }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ changed: [] }>()
const { label, options } = useDict()

type AbsType = 'LEAVE' | 'ABSENT'
const form = reactive({ date: startOfDay(), type: 'LEAVE' as AbsType, remark: '' })
const month = ref(startOfDay())
const records = shallowRef<DutyAbsenceView[]>([])
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
/** 标记 / 撤销被拒的原因留在弹层上；业务拒绝时「标记」置灰，改了日期或类型后可再提交 */
const submitError = ref('')
const rejected = ref(false)
const revokeError = ref('')
let changed = false

const typeOptions = computed(() => {
  const o = options('AbsenceType').filter((x) => x.value === 'LEAVE' || x.value === 'ABSENT')
  return o.length ? o : [{ value: 'LEAVE', label: label('AbsenceType', 'LEAVE') }, { value: 'ABSENT', label: label('AbsenceType', 'ABSENT') }]
})
const p2 = (n: number) => String(n).padStart(2, '0')
const monthText = computed(() => `${month.value.getFullYear()}-${p2(month.value.getMonth() + 1)}`)
const minDate = computed(() => parseLocal(props.row?.startDate) ?? new Date(2020, 0, 1))
const maxDate = computed(() => {
  const end = parseLocal(props.row?.endDate)
  const today = startOfDay()
  return end && end.getTime() < today.getTime() ? end : today
})
const canNext = computed(() => new Date(month.value.getFullYear(), month.value.getMonth() + 1, 1).getTime() <= maxDate.value.getTime())
const canPrev = computed(() => new Date(month.value.getFullYear(), month.value.getMonth(), 0).getTime() >= minDate.value.getTime())
const summary = computed(() => ({
  leave: records.value.filter((r) => r.absenceType === 'LEAVE').length,
  absent: records.value.filter((r) => r.absenceType === 'ABSENT').length,
}))

async function load() {
  const r = props.row
  if (!r) return
  loading.value = true
  loadError.value = ''
  const y = month.value.getFullYear()
  const m = month.value.getMonth()
  try {
    const list = await tenantApi.absences(r.employmentId, ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0)))
    records.value = [...list].sort((a, b) => b.absenceDate.localeCompare(a.absenceDate))
  } catch (e) {
    records.value = []
    loadError.value = errorMessage(e, '记录加载失败')
  } finally {
    loading.value = false
  }
}

watch(() => [form.date, form.type], () => {
  rejected.value = false
  submitError.value = ''
})
watch(show, (v) => {
  if (v && props.row) {
    submitError.value = ''
    rejected.value = false
    revokeError.value = ''
    form.date = maxDate.value
    form.type = 'LEAVE'
    form.remark = ''
    month.value = new Date(form.date.getFullYear(), form.date.getMonth(), 1)
    changed = false
    void load()
  } else if (!v && changed) {
    emit('changed')
  }
})

function shiftMonth(n: number) {
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1)
  void load()
}

// ---------- 日期 ----------
const pickShow = ref(false)
const pickVals = ref<string[]>([])
function openPicker() {
  const d = form.date
  pickVals.value = [String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate())]
  pickShow.value = true
}
function onPick() {
  const [y, m, d] = pickVals.value.map(Number)
  form.date = new Date(y, m - 1, d)
  pickShow.value = false
}

async function submit() {
  const r = props.row
  if (!r || saving.value) return
  saving.value = true
  submitError.value = ''
  const date = ymd(form.date)
  try {
    await tenantApi.markAbsence(r.employmentId, date, form.type, form.remark.trim() || undefined)
    showSuccessToast(`已标记 ${date} ${label('AbsenceType', form.type)}`)
    changed = true
    form.remark = ''
    const target = new Date(form.date.getFullYear(), form.date.getMonth(), 1)
    if (target.getTime() !== month.value.getTime()) month.value = target
    void load()
  } catch (e) {
    showToast(errorMessage(e, '标记失败，请稍后重试'))
    submitError.value = errorMessage(e, '标记失败，请稍后重试')
    rejected.value = isApiError(e) && e.code !== 'NETWORK'
  } finally {
    saving.value = false
  }
}

async function revoke(rec: DutyAbsenceView) {
  const r = props.row
  if (!r) return
  revokeError.value = ''
  try {
    await showConfirmDialog({
      title: '撤销标记',
      message: `撤销 ${rec.absenceDate} 的${label('AbsenceType', rec.absenceType)}标记？撤销后该日恢复为有效在岗日。`,
      confirmButtonText: '撤销',
      beforeClose: async (action) => {
        if (action !== 'confirm') return true
        try {
          await tenantApi.markAbsence(r.employmentId, rec.absenceDate)
          return true
        } catch (e) {
          showToast(errorMessage(e, '撤销失败，请稍后重试'))
          revokeError.value = `${rec.absenceDate} 没有撤销成功：${errorMessage(e, '请稍后重试')}`
          return false
        }
      },
    })
  } catch {
    return
  }
  showSuccessToast('已撤销')
  changed = true
  void load()
}
const nowDate = shNow()
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="abs">
    <div class="sheet-h" aria-hidden="true" />
    <div class="hd">
      <h3>请假 / 旷工标记</h3>
      <button type="button" class="x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>
    <template v-if="row">
      <p class="who">{{ row.name }}<template v-if="row.employeeNo"> · {{ row.employeeNo }}</template> · {{ row.projectName ?? '—' }}</p>

      <van-cell-group inset class="grp">
        <van-field label="日期" required is-link readonly :model-value="fmtDay(form.date)" @click="openPicker" />
        <van-field label="类型" required>
          <template #input>
            <van-radio-group v-model="form.type" direction="horizontal">
              <van-radio v-for="o in typeOptions" :key="o.value" :name="o.value">{{ o.label }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field v-model="form.remark" label="备注" maxlength="100" placeholder="选填，如：病假 / 事假" />
      </van-cell-group>
      <p class="tip">请假 / 旷工的日期不计入有效在岗日（影响预支机会与计费）。同一天重复标记以最后一次为准。</p>
      <p v-if="submitError" class="bar-why err" role="status">没有标记成功：{{ submitError }}</p>
      <van-button block type="primary" size="large" :loading="saving" :disabled="rejected" loading-text="提交中…" @click="submit">标记 {{ label('AbsenceType', form.type) }}</van-button>

      <div class="rec-hd">
        <button type="button" class="mbtn" :disabled="!canPrev" aria-label="上个月" @click="shiftMonth(-1)"><IconChevronLeft :size="20" /></button>
        <b>{{ monthText }}</b>
        <button type="button" class="mbtn" :disabled="!canNext" aria-label="下个月" @click="shiftMonth(1)"><IconChevronRight :size="20" /></button>
        <span class="sum flex1">{{ label('AbsenceType', 'LEAVE') }} {{ summary.leave }} · {{ label('AbsenceType', 'ABSENT') }} {{ summary.absent }}</span>
      </div>
      <p v-if="revokeError" class="bar-why err" role="status">{{ revokeError }}</p>
      <div v-if="loading" class="page-state in-sheet"><van-loading size="24" /></div>
      <div v-else-if="loadError" class="state-block state-block--sm">
        <p class="state-block-t">{{ loadError }}</p>
        <van-button @click="load">重新加载</van-button>
      </div>
      <div v-else-if="!records.length" class="state-block state-block--sm"><p class="state-block-t">本月无缺勤记录</p></div>
      <div v-else class="recs">
        <div v-for="r in records" :key="r.id" class="rec">
          <span class="status-tag" :class="r.absenceType === 'ABSENT' ? 'status-tag--danger' : 'status-tag--warning'">{{ label('AbsenceType', r.absenceType) }}</span>
          <div class="flex1">
            <b>{{ fmtDay(r.absenceDate) }}</b>
            <span>{{ r.remark || '无备注' }} · {{ fmtTime(r.createdAt, nowDate) }} 标记</span>
          </div>
          <van-button plain type="danger" @click="revoke(r)">撤销</van-button>
        </div>
      </div>
    </template>

    <van-popup v-model:show="pickShow" position="bottom" round teleport="body" safe-area-inset-bottom>
      <van-date-picker v-model="pickVals" title="选择日期" :min-date="minDate" :max-date="maxDate" @confirm="onPick" @cancel="pickShow = false" />
    </van-popup>
  </van-popup>
</template>

<style scoped>
.abs { padding: var(--space-2) var(--space-4) var(--space-4); max-height: 90vh; overflow-y: auto; box-sizing: border-box; background: var(--bg-page); }
.sheet-h { width: 36px; height: 4px; border-radius: 2px; background: var(--border); margin: 0 auto var(--space-2); }
.hd { display: flex; align-items: center; justify-content: space-between; }
.hd h3 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.x { width: 44px; height: 44px; display: grid; place-items: center; margin-right: calc(var(--space-3) * -1); padding: 0; border: 0; background: none; color: var(--text-3); }
.who { margin: 2px 0 var(--space-3); font-size: var(--font-size-body); color: var(--text-2); }
.grp { margin: 0 0 var(--space-2); }
.tip { margin-bottom: var(--space-3); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.bar-why { display: block; margin: 0 0 var(--space-2); text-align: left; }
.rec-hd { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-4) 0 var(--space-2); }
.rec-hd b { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.rec-hd .sum { font-size: var(--font-size-aux); color: var(--text-3); text-align: right; }
.mbtn { width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); color: var(--text-2); }
.mbtn:disabled { color: var(--text-placeholder); }
.in-sheet { padding: var(--space-5) 0; }
.recs { background: var(--bg-card); border-radius: var(--radius-card); overflow: hidden; }
.rec { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-card); border-bottom: 1px solid var(--divider); }
.rec:last-child { border-bottom: 0; }
.rec b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.rec span:not(.status-tag) { display: block; margin-top: 2px; font-size: var(--font-size-aux); color: var(--text-3); }
.rec .van-button { flex: none; min-height: 44px; }
</style>
