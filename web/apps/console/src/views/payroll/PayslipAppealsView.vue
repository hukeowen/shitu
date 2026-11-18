<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, useDict, type PayslipAppealRow, type PayslipAppealStatus } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInfo, IconMessageSquare } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
import { isBlocked } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime, fmtSigned, fmtYuan, toNum } from '@/utils/format'

/** 工资申诉（C-702 / D-28）：员工对某张工资条提出疑问，项目经理 / 老板核对后回复，结果通知本人 */
const { label } = useDict()
const TABS: { key: PayslipAppealStatus | ''; label: string }[] = [
  { key: 'OPEN', label: '待处理' },
  { key: 'RESOLVED', label: '已受理' },
  { key: 'REJECTED', label: '未受理' },
  { key: '', label: '全部' },
]
const EMPTY_TEXT: Record<PayslipAppealStatus | '', string> = {
  OPEN: '没有待处理的工资申诉',
  RESOLVED: '还没有已受理的工资申诉',
  REJECTED: '还没有未受理的工资申诉',
  '': '暂无工资申诉',
}

const tab = ref<PayslipAppealStatus | ''>('OPEN')
const rows = ref<PayslipAppealRow[]>([])
const loading = ref(false)
const loadError = ref('')
/** 接口一次返回全部，表格在前端分页 */
const pg = reactive({ page: 1, pageSize: 20 })
const pageRows = computed(() => rows.value.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize))

/** 后端拒绝过的受理 / 不受理：只置灰这一条的这个操作，原因用提醒色写在表格上方和处理弹窗里，刷新后重新判断 */
type Act = 'accept' | 'reject'
const blocked = reactive<Record<number, { name: string; act: Act; text: string }>>({})

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[Number(k)])
  try {
    rows.value = await tenantApi.payslipAppeals(tab.value ? { status: tab.value } : undefined)
    pg.page = 1
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '工资申诉加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(tab, load)

const dlg = reactive({ open: false, row: null as PayslipAppealRow | null, reply: '', saving: '' as Act | '' })
/** 扣款合计 = 社保 + 个税 + 其他扣款 + 预支抵扣（同求职者端工资条的「扣款合计」） */
const deductTotal = computed(() => {
  const r = dlg.row
  return r ? toNum(r.socialInsurance) + toNum(r.incomeTax) + toNum(r.otherDeduct) + toNum(r.advanceDeduct) : 0
})
const dlgBlocked = computed(() => (dlg.row ? blocked[dlg.row.id] : undefined))
function openHandle(row: PayslipAppealRow) {
  dlg.row = row
  dlg.reply = ''
  dlg.open = true
}
async function submit(accept: boolean) {
  const row = dlg.row
  if (!row || dlg.saving) return
  const text = dlg.reply.trim()
  if (text.length < 2) return void ElMessage.warning('请填写处理说明')
  const act: Act = accept ? 'accept' : 'reject'
  dlg.saving = act
  try {
    await tenantApi.handlePayslipAppeal(row.id, { accept, reply: text })
    ElMessage.success('已处理，员工会收到通知')
    dlg.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
    // 业务拒绝才置灰并留原因；断网只提示，可以直接再点
    if (isBlocked(e)) blocked[row.id] = { name: row.seekerName, act, text: `暂时不能${accept ? '受理' : '标记不受理'}：${errorMessage(e)}` }
  } finally {
    dlg.saving = ''
  }
}

/** 操作列宽按本页实际出现的按钮算（规范 Page States「console 表格操作列宽」） */
const opsWidth = computed(() => actionsColWidth(rows.value.map((r) => ({ labels: r.status === 'OPEN' ? ['处理'] : [] }))))
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>工资申诉</h2>
        <p>员工对工资条提出的疑问 · 核对后回复，结果会通知员工本人</p>
      </div>
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs" role="tablist">
          <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
        </div>
      </div>
      <p v-for="(b, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">「{{ b.name }}」{{ b.text }}{{ b.text.includes('刷新') ? '' : '。刷新后重新判断' }}</p>
      <el-table v-loading="loading" :data="pageRows" row-key="id">
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="员工" min-width="190">
          <template #default="{ row }">
            <div><span class="strong-t">{{ row.seekerName }}</span><span v-if="row.employeeNo" class="sub tnum"> · {{ row.employeeNo }}</span></div>
            <div class="sub">{{ row.projectName || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="工资月份" width="100">
          <template #default="{ row }"><span class="tnum">{{ row.payMonth }}</span></template>
        </el-table-column>
        <el-table-column label="实发" width="120" align="right">
          <template #default="{ row }"><span class="money">{{ fmtYuan(row.netPay) }}</span></template>
        </el-table-column>
        <el-table-column label="申诉内容" min-width="240">
          <template #default="{ row }">
            <span v-if="row.itemCode" class="status-tag status-tag--info item">{{ label('PayslipAppealItem', row.itemCode) }}</span>
            <span class="content">{{ row.content }}</span>
            <div v-if="row.reply" class="reply">
              <b>处理说明</b>{{ row.reply }}
              <div class="sub">{{ row.handledByName }} · {{ fmtDateTime(row.handledAt) }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><DictTag type="PayslipAppealStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" align="right" class-name="ops-col">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN'" size="small" link type="primary" @click="openHandle(row)">处理</el-button>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="state-box">
            <IconCircleExclamationPoint :size="48" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="state-box">
            <IconMessageSquare :size="48" />
            <h4>{{ EMPTY_TEXT[tab] }}</h4>
            <p>员工在求职者端的工资条上点「对这张工资条提出申诉」提交后，申诉会出现在这里</p>
          </div>
          <span v-else />
        </template>
      </el-table>
      <div v-if="rows.length > 0" class="pager">
        <el-pagination
          v-model:current-page="pg.page"
          v-model:page-size="pg.pageSize"
          :total="rows.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @size-change="pg.page = 1"
        />
      </div>
    </div>

    <el-dialog v-model="dlg.open" title="处理工资申诉" width="600px" destroy-on-close>
      <template v-if="dlg.row">
        <div class="who">
          <span class="strong-t">{{ dlg.row.seekerName }}</span> · {{ dlg.row.payMonth }} 工资条 <span class="code">{{ dlg.row.payslipId }}</span>
        </div>
        <!-- 工资条按「应发 / 扣款 / 实发」分组，实发最醒目（规范第 9 类） -->
        <div class="slip">
          <div class="slip-g">
            <div class="slip-h">应发</div>
            <div class="slip-r"><span>应发合计</span><b class="money">{{ fmtYuan(dlg.row.grossPay) }}</b></div>
          </div>
          <div class="slip-g">
            <div class="slip-h">扣款</div>
            <div class="slip-r"><span>社保</span><b class="money">{{ fmtSigned(dlg.row.socialInsurance, 'out') }}</b></div>
            <div class="slip-r"><span>个税</span><b class="money">{{ fmtSigned(dlg.row.incomeTax, 'out') }}</b></div>
            <div class="slip-r"><span>其他扣款</span><b class="money">{{ fmtSigned(dlg.row.otherDeduct, 'out') }}</b></div>
            <div class="slip-r"><span>预支抵扣</span><b class="money">{{ fmtSigned(dlg.row.advanceDeduct, 'out') }}</b></div>
            <div class="slip-r total"><span>扣款合计</span><b class="money">{{ fmtSigned(deductTotal, 'out') }}</b></div>
          </div>
          <div class="slip-g">
            <div class="slip-h">实发工资</div>
            <div class="slip-r net"><b class="money">{{ fmtYuan(dlg.row.netPay) }}</b></div>
          </div>
        </div>
        <div class="ask">
          <div class="ask-t">员工的疑问<span v-if="dlg.row.itemCode" class="status-tag status-tag--info item">{{ label('PayslipAppealItem', dlg.row.itemCode) }}</span></div>
          <div class="content">{{ dlg.row.content }}</div>
        </div>
        <el-input v-model="dlg.reply" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="写明核对结果；如需补发或更正，请说明处理方式与时间" aria-label="处理说明" class="reply-in" />
        <div class="notice-bar dlg-note">
          <IconInfo :size="16" class="notice-bar-i" />
          <span>工资条导入后不能在系统内修改金额。确需更正的，请线下补发 / 扣回并在这里写明。</span>
        </div>
        <p v-if="dlgBlocked" class="blocked-why dlg-why" role="alert">{{ dlgBlocked.text }}</p>
      </template>
      <template #footer>
        <!-- 审核按钮：驳回类在左、危险色描边；通过类在右、主色实心（规范第 8 类） -->
        <el-button
          type="danger"
          plain
          class="btn-reject"
          :loading="dlg.saving === 'reject'"
          :disabled="(!!dlg.saving && dlg.saving !== 'reject') || dlgBlocked?.act === 'reject'"
          @click="submit(false)"
        >不受理</el-button>
        <el-button
          type="primary"
          :loading="dlg.saving === 'accept'"
          :disabled="(!!dlg.saving && dlg.saving !== 'accept') || dlgBlocked?.act === 'accept'"
          @click="submit(true)"
        >受理并回复</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.strong-t { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.sub { font-size: var(--font-size-min); color: var(--text-3); }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.code { font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-2); white-space: nowrap; }
.item { margin-right: var(--space-2); }
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; color: var(--text-1); }
.reply { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.reply b { margin-right: var(--space-2); font-size: var(--font-size-min); font-weight: var(--font-weight-semibold); color: var(--success-text); }
.who { margin-bottom: var(--space-3); color: var(--text-2); }
.slip { display: grid; grid-template-columns: 1fr 1.6fr 1fr; gap: var(--space-2); }
.slip-g { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); }
.slip-r { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); font-size: var(--font-size-aux); }
.slip-r span { color: var(--text-2); }
.slip-h { font-size: var(--font-size-min); font-weight: var(--font-weight-medium); color: var(--text-3); }
.slip-r.total { margin-top: var(--space-1); padding-top: var(--space-1); border-top: 1px solid var(--divider); }
.slip-r.total span { color: var(--text-1); font-weight: var(--font-weight-medium); }
.slip-r.net { justify-content: flex-end; }
.slip-r.net b { font-size: var(--font-size-section); }
.ask { margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); max-height: 200px; overflow: auto; }
.ask-t { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.ask-t .item { margin-right: 0; }
.reply-in { margin-top: var(--space-3); }
.dlg-note { margin-top: var(--space-3); }
.dlg-why { margin-top: var(--space-3); }
</style>
