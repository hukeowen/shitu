<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, tenantApi, useDict, type DutyAbsenceView, type StaffRow } from '@shitu/api-client'
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

watch(show, (v) => {
  if (v && props.row) {
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
  } finally {
    saving.value = false
  }
}

async function revoke(rec: DutyAbsenceView) {
  const r = props.row
  if (!r) return
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
const nowDate = new Date()
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="abs">
    <div class="sheet-h" aria-hidden="true" />
    <div class="hd">
      <h3>请假 / 旷工标记</h3>
      <button type="button" class="x" aria-label="关闭" @click="show = false"><van-icon name="cross" size="18" /></button>
    </div>
    <template v-if="row">
      <p class="t-sm who">{{ row.name }}<template v-if="row.employeeNo"> · {{ row.employeeNo }}</template> · {{ row.projectName ?? '—' }}</p>

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
      <p class="t-xs tip">请假 / 旷工的日期不计入有效在岗日（影响预支机会与计费）。同一天重复标记以最后一次为准。</p>
      <van-button block type="primary" class="btn-cta" :loading="saving" loading-text="提交中…" @click="submit">标记 {{ label('AbsenceType', form.type) }}</van-button>

      <div class="rec-hd">
        <button type="button" class="mbtn" :disabled="!canPrev" aria-label="上个月" @click="shiftMonth(-1)"><van-icon name="arrow-left" /></button>
        <b class="num">{{ monthText }}</b>
        <button type="button" class="mbtn" :disabled="!canNext" aria-label="下个月" @click="shiftMonth(1)"><van-icon name="arrow" /></button>
        <span class="t-xs flex1" style="text-align: right">{{ label('AbsenceType', 'LEAVE') }} {{ summary.leave }} · {{ label('AbsenceType', 'ABSENT') }} {{ summary.absent }}</span>
      </div>
      <div v-if="loading" class="empty-box"><van-loading size="20" /></div>
      <p v-else-if="loadError" class="t-xs err">{{ loadError }}</p>
      <div v-else-if="!records.length" class="empty-box t-xs">本月无缺勤记录</div>
      <div v-else class="recs">
        <div v-for="r in records" :key="r.id" class="rec">
          <span class="tag" :class="r.absenceType === 'ABSENT' ? 'tag-danger' : 'tag-warn'">{{ label('AbsenceType', r.absenceType) }}</span>
          <div class="flex1">
            <b class="num">{{ fmtDay(r.absenceDate) }}</b>
            <span>{{ r.remark || '无备注' }} · {{ fmtTime(r.createdAt, nowDate) }} 标记</span>
          </div>
          <van-button size="mini" plain type="danger" @click="revoke(r)">撤销</van-button>
        </div>
      </div>
    </template>

    <van-popup v-model:show="pickShow" position="bottom" round teleport="body" safe-area-inset-bottom>
      <van-date-picker v-model="pickVals" title="选择日期" :min-date="minDate" :max-date="maxDate" @confirm="onPick" @cancel="pickShow = false" />
    </van-popup>
  </van-popup>
</template>

<style scoped>
.abs { padding: 8px 14px 14px; max-height: 90vh; overflow-y: auto; box-sizing: border-box; background: var(--surface-2); }
.sheet-h { width: 36px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 auto 10px; }
.hd { display: flex; align-items: center; justify-content: space-between; }
.hd h3 { font-size: 17px; font-weight: 700; color: var(--ink-900); }
.x { width: 32px; height: 32px; display: grid; place-items: center; background: none; border: 0; color: var(--ink-500); padding: 0; margin-right: -6px; }
.who { margin: 2px 0 10px; }
.grp { margin: 0 0 8px; }
.tip { line-height: 1.6; margin-bottom: 10px; padding: 0 2px; }
.rec-hd { display: flex; align-items: center; gap: 8px; margin: 18px 0 8px; }
.rec-hd b { font-size: 14px; color: var(--ink-900); }
.mbtn { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-600); display: grid; place-items: center; padding: 0; }
.mbtn:disabled { opacity: .35; }
.recs { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
.rec { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.rec:last-child { border-bottom: 0; }
.rec b { display: block; font-size: 13px; color: var(--ink-900); }
.rec span:not(.tag) { display: block; font-size: 11px; color: var(--ink-400); margin-top: 2px; }
.err { color: var(--danger); padding: 10px 0; }
</style>
