<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, type SysParamRow } from '@shitu/api-client'
import { ADMIN_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { fmtDateTime, fmtOperator } from '@/utils/format'

/** 系统参数：业务规则里可调的数值（时限、次数、金额等）。只能改值，每次修改写原因并进审计日志。 */
const auth = useAuthStore()
const canEdit = computed(() => auth.hasAnyRole(ADMIN_ROLES))

const GROUPS: { prefix: string; title: string; desc: string }[] = [
  { prefix: 'response_window.', title: '24 小时响应窗口', desc: '新用户报名后公司跟进的时限与催办节奏' },
  { prefix: 'broker.', title: '经纪人时限', desc: '转给经纪人后的联系与出结果时限' },
  { prefix: 'matching.', title: '匹配', desc: '重新匹配的提醒阈值（匹配算法参数在「匹配引擎参数」里）' },
  { prefix: 'kyc.', title: '实名与风控', desc: '年龄门槛、刷单判定' },
  { prefix: 'advance.', title: '预支', desc: '预支资格、金额与次数' },
  { prefix: 'bill.', title: '账单', desc: '异议期与结算日' },
  { prefix: 'sms.', title: '短信', desc: '验证码发送频率、通知短信的免打扰时段' },
  { prefix: 'disclaimer.', title: '告知书', desc: '版本号变更后，所有用户下次使用时需要重新同意' },
]
const TYPE_LABEL: Record<string, string> = { INT: '整数', DECIMAL: '金额', DURATION: '时长', TIME: '时间', STRING: '文本', BOOL: '开关' }
const UNIT_LABEL = { M: '分钟', H: '小时', D: '天' } as const
type Unit = keyof typeof UNIT_LABEL

const rows = ref<SysParamRow[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await opsApi.sysParams()
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '系统参数加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const grouped = computed(() => {
  const used = new Set<string>()
  const out = GROUPS.map((g) => {
    const items = rows.value.filter((r) => r.paramKey.startsWith(g.prefix))
    items.forEach((r) => used.add(r.paramKey))
    return { ...g, items }
  }).filter((g) => g.items.length > 0)
  const rest = rows.value.filter((r) => !used.has(r.paramKey))
  if (rest.length) out.push({ prefix: '', title: '其他', desc: '', items: rest })
  return out
})

/** 说明文字去掉开头的决策 / 文档编号 */
function desc(r: SysParamRow) {
  return r.description.replace(/^(?:[A-Z]-\d+|文档\s*[\d.]+)\s*/, '')
}

/** ISO 时长转成「数值 + 单位」 */
function parseDuration(v: string): { n: number; unit: Unit } {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(v)
  if (!m) return { n: 0, unit: 'H' }
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  if (total > 0 && total % 1440 === 0) return { n: total / 1440, unit: 'D' }
  if (total % 60 === 0) return { n: total / 60, unit: 'H' }
  return { n: total, unit: 'M' }
}
function show(r: SysParamRow) {
  if (r.valueType === 'DURATION') {
    const d = parseDuration(r.paramValue)
    return d.n ? d.n + ' ' + UNIT_LABEL[d.unit] : r.paramValue
  }
  if (r.valueType === 'BOOL') return r.paramValue === 'true' ? '开' : '关'
  return r.paramValue
}

const dlg = reactive({
  open: false,
  row: null as SysParamRow | null,
  value: '',
  n: 1,
  unit: 'H' as Unit,
  bool: false,
  remark: '',
  saving: false,
  error: '',
})
function openEdit(r: SysParamRow) {
  const d = r.valueType === 'DURATION' ? parseDuration(r.paramValue) : { n: 1, unit: 'H' as Unit }
  Object.assign(dlg, { open: true, row: r, value: r.paramValue, n: d.n || 1, unit: d.unit, bool: r.paramValue === 'true', remark: '', error: '' })
}
function currentValue(): string {
  if (!dlg.row) return ''
  if (dlg.row.valueType === 'DURATION') return dlg.unit === 'D' ? 'P' + dlg.n + 'D' : 'PT' + dlg.n + dlg.unit
  if (dlg.row.valueType === 'BOOL') return String(dlg.bool)
  return String(dlg.value ?? '').trim()
}
async function save() {
  if (!dlg.row) return
  const value = currentValue()
  if (!value) return void (dlg.error = '请填写参数值')
  if (value === dlg.row.paramValue) return void (dlg.error = '参数值没有变化')
  if (!dlg.remark.trim()) return void (dlg.error = '请填写修改原因')
  dlg.saving = true
  try {
    await opsApi.updateSysParam(dlg.row.paramKey, { value, remark: dlg.remark.trim() })
    ElMessage.success('已修改，1 分钟内全部生效')
    dlg.open = false
    await load()
  } catch (e) {
    dlg.error = errorMessage(e, '保存失败')
  } finally {
    dlg.saving = false
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>系统参数</h2>
        <p>业务规则里可调的时限、次数与金额 · 修改后 1 分钟内生效，每次修改都会记入审计日志</p>
      </div>
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px" />
    <div v-if="!canEdit" class="notice notice--info" style="margin-bottom: 14px">当前账号只能查看，修改需要超级管理员。</div>

    <div v-loading="loading" class="groups">
      <div v-for="g in grouped" :key="g.title" class="card">
        <div class="card__hd"><h3>{{ g.title }}</h3><span class="t-xs">{{ g.desc }}</span></div>
        <el-table :data="g.items" row-key="paramKey">
          <el-table-column label="参数" min-width="300">
            <template #default="{ row }">
              <b>{{ desc(row) }}</b>
              <div class="t-xs mono">{{ row.paramKey }}</div>
            </template>
          </el-table-column>
          <el-table-column label="当前值" width="150">
            <template #default="{ row }"><b class="num val">{{ show(row) }}</b></template>
          </el-table-column>
          <el-table-column label="最近修改" min-width="240">
            <template #default="{ row }">
              <template v-if="row.updatedBy">
                <div class="t-sm">{{ row.updateRemark || '—' }}</div>
                <div class="t-xs">{{ row.updatedByName || fmtOperator(row.updatedBy) }} · <span class="mono">{{ fmtDateTime(row.updatedAt) }}</span></div>
              </template>
              <span v-else class="t-xs">初始值，未修改过</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canEdit" label="操作" class-name="ops-col" width="90" align="right">
            <template #default="{ row }"><el-button size="small" @click="openEdit(row)">修改</el-button></template>
          </el-table-column>
        </el-table>
      </div>
      <el-empty v-if="!loading && grouped.length === 0" :description="loadError ? '加载失败' : '暂无参数'" :image-size="80" />
    </div>

    <el-dialog v-model="dlg.open" title="修改系统参数" width="520px" destroy-on-close :close-on-click-modal="false">
      <template v-if="dlg.row">
        <div class="t-sm" style="margin-bottom: 4px"><b>{{ desc(dlg.row) }}</b></div>
        <div class="t-xs" style="margin-bottom: 14px">{{ TYPE_LABEL[dlg.row.valueType] ?? '' }} · 当前值 {{ show(dlg.row) }}</div>
        <el-form label-width="80px" @submit.prevent>
          <el-form-item label="新的值" required>
            <div v-if="dlg.row.valueType === 'DURATION'" class="dur">
              <el-input-number v-model="dlg.n" :min="1" :max="1000" :precision="0" controls-position="right" />
              <el-select v-model="dlg.unit" style="width: 110px">
                <el-option label="分钟" value="M" />
                <el-option label="小时" value="H" />
                <el-option label="天" value="D" />
              </el-select>
            </div>
            <el-switch v-else-if="dlg.row.valueType === 'BOOL'" v-model="dlg.bool" />
            <el-time-select v-else-if="dlg.row.valueType === 'TIME'" v-model="dlg.value" start="00:00" step="00:30" end="23:30" :clearable="false" style="width: 160px" />
            <el-input v-else v-model="dlg.value" style="width: 220px" @input="dlg.error = ''" />
          </el-form-item>
          <el-form-item label="修改原因" required>
            <el-input v-model="dlg.remark" type="textarea" :rows="3" maxlength="255" show-word-limit placeholder="写明为什么改，会记入审计日志" @input="dlg.error = ''" />
          </el-form-item>
        </el-form>
        <div class="notice notice--warn">参数直接影响线上业务规则；只对修改之后发生的业务生效，已经在计时或已生成的记录不会回溯调整。</div>
        <div v-if="dlg.error" class="notice notice--danger" style="margin-top: 10px">{{ dlg.error }}</div>
      </template>
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.groups { display: flex; flex-direction: column; gap: 14px; min-height: 120px; }
.val { font-size: 15px; }
.dur { display: flex; gap: 8px; align-items: center; }
</style>
