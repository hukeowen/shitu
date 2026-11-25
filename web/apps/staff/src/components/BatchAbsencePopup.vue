<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, tenantApi, useDict, type AbsenceBatchResult, type StaffRow } from '@shitu/api-client'
import { IconX } from '@shitu/ui-icons'
import { addDays, startOfDay, ymd } from '@/utils/time'

/** D-62③ 批量请假 / 旷工：选好的多个人 × 多天一次标完；标不上的（入职前、已离职）逐条说明 */
const props = defineProps<{ rows: StaffRow[] }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ done: [] }>()
const { label, options } = useDict()

type AbsType = 'LEAVE' | 'ABSENT'
const form = reactive({ type: 'LEAVE' as AbsType, remark: '' })
const dates = shallowRef<Date[]>([startOfDay()])
const saving = ref(false)
const submitError = ref('')
const result = shallowRef<AbsenceBatchResult | null>(null)
const calShow = ref(false)

const today = computed(() => startOfDay())
const minDate = computed(() => addDays(today.value, -31))
const typeOptions = computed(() => {
  const o = options('AbsenceType').filter((x) => x.value === 'LEAVE' || x.value === 'ABSENT')
  return o.length ? o : [{ value: 'LEAVE', label: label('AbsenceType', 'LEAVE') }, { value: 'ABSENT', label: label('AbsenceType', 'ABSENT') }]
})
const typeText = computed(() => label('AbsenceType', form.type))
const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
const sorted = computed(() => [...dates.value].sort((a, b) => a.getTime() - b.getTime()))
const dateText = computed(() => {
  const ds = sorted.value
  if (!ds.length) return '请选择'
  if (ds.length === 1) return ds[0].getTime() === today.value.getTime() ? `今天（${md(ds[0])}）` : md(ds[0])
  return `共 ${ds.length} 天：${ds.slice(0, 3).map(md).join('、')}${ds.length > 3 ? ' 等' : ''}`
})
const whoText = computed(() => {
  const names = props.rows.slice(0, 4).map((r) => r.name)
  return `${names.join('、')}${props.rows.length > 4 ? ` 等 ${props.rows.length} 人` : ''}`
})
/** 提交那一刻的名单：标完后页面会清空勾选，结果页还要用名字说明谁没标上 */
let names = new Map<string, string>()
const nameOf = (id: string) => names.get(id) ?? id

watch(show, (v) => {
  if (!v) return
  form.type = 'LEAVE'
  form.remark = ''
  dates.value = [startOfDay()]
  submitError.value = ''
  result.value = null
})

function onDates(v: Date | Date[]) {
  dates.value = (Array.isArray(v) ? v : [v]).map((d) => startOfDay(d))
  calShow.value = false
}

async function submit() {
  if (saving.value || !props.rows.length || !dates.value.length) return
  const n = props.rows.length
  const d = dates.value.length
  try {
    await showConfirmDialog({
      title: `给 ${n} 人标记${typeText.value}`,
      message: `${whoText.value}\n${d === 1 ? dateText.value : `${d} 天`}，一共 ${n * d} 人天。\n\n这些天不算在岗，会少算在岗天数，影响预支和计费。之前标过的同一天，会改成这次的「${typeText.value}」。`,
      messageAlign: 'left',
      confirmButtonText: `确认标记${typeText.value}`,
    })
  } catch {
    return
  }
  saving.value = true
  submitError.value = ''
  names = new Map(props.rows.map((x) => [x.employmentId, x.employeeNo ? `${x.name}（${x.employeeNo}）` : x.name]))
  try {
    const r = await tenantApi.markAbsenceBatch(
      props.rows.map((x) => x.employmentId),
      sorted.value.map(ymd),
      form.type,
      form.remark.trim() || undefined,
    )
    emit('done')
    if (r.skipped.length) {
      result.value = r
    } else {
      showSuccessToast(`已标记 ${r.marked} 人天`)
      show.value = false
    }
  } catch (e) {
    submitError.value = errorMessage(e, '标记失败，请稍后重试')
    showToast(submitError.value)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="babs">
    <div class="sheet-h" aria-hidden="true" />
    <div class="hd">
      <h3>批量标记请假 / 旷工</h3>
      <button type="button" class="x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>

    <template v-if="result">
      <p class="res-t">已标记 {{ result.marked }} 人天，有 {{ result.skipped.length }} 条没标上</p>
      <div class="recs">
        <div v-for="(s, i) in result.skipped" :key="i" class="rec">
          <b>{{ nameOf(s.employmentId) }}</b>
          <span>{{ s.date }} · {{ s.reason }}</span>
        </div>
      </div>
      <van-button block type="primary" size="large" class="ok" @click="show = false">知道了</van-button>
    </template>

    <template v-else>
      <p class="who">已选 {{ rows.length }} 人：{{ whoText }}</p>
      <van-cell-group inset class="grp">
        <van-field label="日期" required is-link readonly :model-value="dateText" @click="calShow = true" />
        <van-field label="类型" required>
          <template #input>
            <van-radio-group v-model="form.type" direction="horizontal">
              <van-radio v-for="o in typeOptions" :key="o.value" :name="o.value">{{ o.label }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field v-model="form.remark" label="备注" maxlength="100" placeholder="选填，如：停线放假" />
      </van-cell-group>
      <p class="tip">可以一次选多天（近 31 天内）。入职前的日期会自动跳过，并告诉你是谁、哪天没标上。</p>
      <p v-if="submitError" class="bar-why err" role="status">没有标记成功：{{ submitError }}</p>
      <van-button block type="primary" size="large" :loading="saving" :disabled="!dates.length" loading-text="提交中…" @click="submit">
        给 {{ rows.length }} 人标记{{ typeText }}
      </van-button>
    </template>

    <van-calendar
      v-model:show="calShow"
      type="multiple"
      title="选择日期（可多选）"
      teleport="body"
      :min-date="minDate"
      :max-date="today"
      :default-date="dates"
      :max-range="31"
      color="var(--primary)"
      confirm-text="选好了"
      confirm-disabled-text="请选择日期"
      safe-area-inset-bottom
      @confirm="onDates"
    />
  </van-popup>
</template>

<style scoped>
.babs { padding: var(--space-2) var(--space-4) var(--space-4); max-height: 90vh; overflow-y: auto; box-sizing: border-box; background: var(--bg-page); }
.sheet-h { width: 36px; height: 4px; border-radius: 2px; background: var(--border); margin: 0 auto var(--space-2); }
.hd { display: flex; align-items: center; justify-content: space-between; }
.hd h3 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.x { width: 44px; height: 44px; display: grid; place-items: center; margin-right: calc(var(--space-3) * -1); padding: 0; border: 0; background: none; color: var(--text-3); }
.who { margin: 2px 0 var(--space-3); font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.grp { margin: 0 0 var(--space-2); }
.tip { margin-bottom: var(--space-3); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.bar-why { display: block; margin: 0 0 var(--space-2); text-align: left; }
.res-t { margin: var(--space-2) 0 var(--space-3); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--warning-text); }
.recs { max-height: 46vh; overflow-y: auto; background: var(--bg-card); border-radius: var(--radius-card); }
.rec { padding: var(--space-3) var(--space-card); border-bottom: 1px solid var(--divider); }
.rec:last-child { border-bottom: 0; }
.rec b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--text-1); }
.rec span { display: block; margin-top: 2px; font-size: var(--font-size-aux); color: var(--text-3); }
.ok { margin-top: var(--space-4); }
</style>
