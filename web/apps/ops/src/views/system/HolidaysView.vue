<script setup lang="ts">
import { IconInbox, IconCircleExclamationPoint } from '@shitu/ui-icons'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type HolidayRow } from '@shitu/api-client'
import { confirmInBox, isBlocked } from '@/composables/boxSubmit'
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
  rows.value = []
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

const page = ref(1)
const pageRows = computed(() => rows.value.slice((page.value - 1) * 20, page.value * 20))
watch(rows, () => { page.value = 1 })

const offDays = computed(() => rows.value.filter((r) => !r.isWorkday).length)
const workDays = computed(() => rows.value.filter((r) => r.isWorkday).length)

const form = reactive({ open: false, workday: false, name: '', range: undefined as [Date, Date] | undefined, saving: false, error: '', blocked: false })
function openAdd() {
  Object.assign(form, { open: true, workday: false, name: '', range: undefined, error: '', blocked: false })
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
  if (form.saving || form.blocked) return
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
    form.blocked = isBlocked(e)
    form.error = errorMessage(e, '保存失败')
  } finally {
    form.saving = false
  }
}
async function remove(r: HolidayRow) {
  const ok = await confirmInBox({ title: '删除', action: '删除',
    text: '删除 ' + r.holidayDate + '「' + r.name + '」？删除后这一天按普通' + (r.isWorkday ? '周末' : '工作日') + '计算。',
    api: () => opsApi.deleteHoliday(r.holidayDate),
  })
  if (!ok) return
  ElMessage.success('已删除')
  await load()
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

    <div v-if="!loading && !loadError && rows.length === 0" class="notice notice--warn" style="margin-bottom: 14px">
      还没有录入 {{ year }} 年的节假日。在录入之前，{{ year }} 年的账单异议期只会跳过周末，遇到法定长假会比实际短。国务院一般在上一年 11 月前后公布安排。
    </div>

    <div class="card">
      <div class="card__hd"><h3>{{ loading || loadError ? '节假日日历' : year + ' 年' }}</h3><span v-if="!loading && !loadError" class="t-xs">放假 {{ offDays }} 个工作日 · 调休上班 {{ workDays }} 天</span></div>
      <el-table class="tbl-48" v-loading="loading" :data="loading ? [] : pageRows" row-key="holidayDate">
        <el-table-column label="日期" width="150"><template #default="{ row }"><span class="tnum">{{ row.holidayDate }}</span></template></el-table-column>
        <el-table-column label="星期" width="90"><template #default="{ row }">{{ weekday(row.holidayDate) }}</template></el-table-column>
        <el-table-column label="类型" width="130">
          <template #default="{ row }"><span class="status-tag" :class="row.isWorkday ? 'status-tag--warning' : 'status-tag--success'">{{ row.isWorkday ? '调休上班' : '放假' }}</span></template>
        </el-table-column>
        <el-table-column label="名称" min-width="200" prop="name" />
        <el-table-column v-if="canEdit" class-name="ops-col" label="操作" width="90" align="right">
          <template #default="{ row }"><el-button size="small" link type="danger" @click="remove(row)">删除</el-button></template>
        </el-table-column>
        <template #empty>
          <el-empty v-if="!loading && loadError" :description="loadError" :image-size="48"><template #image><IconCircleExclamationPoint :size="48" /></template><el-button @click="load">重新加载</el-button></el-empty>
          <el-empty v-else-if="!loading" :image-size="48"><template #image><IconInbox :size="48" /></template><template #description><h3>暂无记录</h3><p>当前年份尚未录入节假日，可录入或刷新。</p></template><el-button v-if="canEdit" type="primary" @click="openAdd">录入</el-button><el-button v-else type="primary" @click="load">刷新</el-button></el-empty>
        </template>
      </el-table>
      <div v-if="!loading && rows.length" class="pager"><el-pagination v-model:current-page="page" :page-size="20" :total="rows.length" layout="total, prev, pager, next" /></div>
    </div>

    <el-dialog class="dlg-16" v-model="form.open" title="录入节假日" width="520px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!form.saving" :show-close="!form.saving">
      <el-form :disabled="form.saving" label-width="80px" @submit.prevent>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.workday" @change="!form.blocked && (form.error = '')">
            <el-radio-button :value="false">放假</el-radio-button>
            <el-radio-button :value="true">调休上班</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="32" :placeholder="form.workday ? '例如：春节调休' : '例如：春节'" @input="!form.blocked && (form.error = '')" />
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="form.range" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" :clearable="false" @change="!form.blocked && (form.error = '')" />
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
        <el-button :disabled="form.saving" @click="form.open = false">取消</el-button>
        <el-button type="primary" :loading="form.saving" :disabled="form.blocked" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
