<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage, opsApi, type HolidayRow } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'

/** 节假日日历（D-23）：账单异议期按工作日计算，周末自动跳过；法定假日与调休上班日在这里维护 */
const auth = useAuthStore()
const canEdit = computed(() => auth.hasAnyRole(['SUPER', 'FINANCE']))

const thisYear = new Date().getFullYear()
const years = [thisYear - 1, thisYear, thisYear + 1]
const year = ref(thisYear)
const rows = ref<HolidayRow[]>([])
const loading = ref(false)
const loadError = ref('')
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function parse(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}
function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
const weekday = (d: string) => WEEK[parse(d).getDay()]

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await opsApi.holidays(year.value)
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '节假日加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const offDays = computed(() => rows.value.filter((r) => !r.isWorkday).length)
const workDays = computed(() => rows.value.filter((r) => r.isWorkday).length)

const form = reactive({ open: false, workday: false, name: '', range: undefined as [Date, Date] | undefined, saving: false, error: '' })
function openAdd() {
  Object.assign(form, { open: true, workday: false, name: '', range: undefined, error: '' })
}
/** 范围内真正需要录入的日期：放假只取工作日，调休上班只取周末 */
const picked = computed(() => {
  if (!form.range) return []
  const out: string[] = []
  const d = new Date(form.range[0])
  const end = form.range[1].getTime()
  for (let i = 0; i < 60 && d.getTime() <= end; i++) {
    const weekend = d.getDay() === 0 || d.getDay() === 6
    if (weekend === form.workday) out.push(iso(d))
    d.setDate(d.getDate() + 1)
  }
  return out
})
async function save() {
  if (!form.name.trim()) return void (form.error = '请填写名称，例如「春节」')
  if (!form.range) return void (form.error = '请选择日期')
  if (picked.value.length === 0) {
    return void (form.error = form.workday ? '所选日期里没有周末，不需要录入调休上班' : '所选日期都是周末，本来就不算工作日，不需要录入')
  }
  form.saving = true
  try {
    await opsApi.saveHolidays(picked.value.map((date) => ({ date, workday: form.workday, name: form.name.trim() })))
    ElMessage.success('已录入 ' + picked.value.length + ' 天')
    form.open = false
    year.value = parse(picked.value[0]).getFullYear()
    await load()
  } catch (e) {
    form.error = errorMessage(e, '保存失败')
  } finally {
    form.saving = false
  }
}
async function remove(r: HolidayRow) {
  try {
    await ElMessageBox.confirm('删除 ' + r.holidayDate + '「' + r.name + '」？删除后这一天按普通' + (r.isWorkday ? '周末' : '工作日') + '计算。', '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    await opsApi.deleteHoliday(r.holidayDate)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '删除失败'))
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>节假日</h2>
        <p>账单异议期按工作日计算 · 周末自动跳过，法定假日和调休上班日需要在这里录入</p>
      </div>
      <span class="spacer" />
      <el-select v-model="year" style="width: 110px" :disabled="loading" @change="load">
        <el-option v-for="y in years" :key="y" :label="y + ' 年'" :value="y" />
      </el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button v-if="canEdit" type="primary" @click="openAdd">录入</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px" />
    <div v-else-if="!loading && rows.length === 0" class="notice notice--warn" style="margin-bottom: 14px">
      还没有录入 {{ year }} 年的节假日。在录入之前，{{ year }} 年的账单异议期只会跳过周末，遇到法定长假会比实际短。国务院一般在上一年 11 月前后公布安排。
    </div>

    <div class="card">
      <div class="card__hd"><h3>{{ year }} 年</h3><span class="t-xs">放假 {{ offDays }} 个工作日 · 调休上班 {{ workDays }} 天</span></div>
      <el-table v-loading="loading" :data="rows" row-key="holidayDate">
        <el-table-column label="日期" width="150"><template #default="{ row }"><span class="mono">{{ row.holidayDate }}</span></template></el-table-column>
        <el-table-column label="星期" width="90"><template #default="{ row }">{{ weekday(row.holidayDate) }}</template></el-table-column>
        <el-table-column label="类型" width="130">
          <template #default="{ row }"><span class="tag" :class="row.isWorkday ? 'tag--warn' : 'tag--ok'">{{ row.isWorkday ? '调休上班' : '放假' }}</span></template>
        </el-table-column>
        <el-table-column label="名称" min-width="200" prop="name" />
        <el-table-column v-if="canEdit" label="操作" width="90" align="right">
          <template #default="{ row }"><el-button size="small" link type="danger" @click="remove(row)">删除</el-button></template>
        </el-table-column>
        <template #empty><el-empty :description="loadError ? '加载失败' : '暂无记录'" :image-size="70" /></template>
      </el-table>
    </div>

    <el-dialog v-model="form.open" title="录入节假日" width="520px" destroy-on-close :close-on-click-modal="false">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.workday" @change="form.error = ''">
            <el-radio-button :value="false">放假</el-radio-button>
            <el-radio-button :value="true">调休上班</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="32" :placeholder="form.workday ? '例如：春节调休' : '例如：春节'" @input="form.error = ''" />
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="form.range" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" :clearable="false" @change="form.error = ''" />
        </el-form-item>
      </el-form>
      <div v-if="picked.length" class="notice notice--info">
        <div>
          将录入 {{ picked.length }} 天：<span class="mono">{{ picked.join('、') }}</span>
          <div class="t-xs" style="margin-top: 4px">{{ form.workday ? '只录入范围内的周六、周日。' : '范围内的周六、周日本来就不算工作日，已自动跳过。' }}</div>
        </div>
      </div>
      <div v-if="form.error" class="notice notice--danger" style="margin-top: 10px">{{ form.error }}</div>
      <template #footer>
        <el-button @click="form.open = false">取消</el-button>
        <el-button type="primary" :loading="form.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
