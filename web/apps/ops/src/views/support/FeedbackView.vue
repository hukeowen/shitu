<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type FeedbackRow, type FeedbackStatus } from '@shitu/api-client'
import { IconInbox, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { isBlocked, isNetwork } from '@/composables/boxSubmit'
import { actionsColWidth } from '@/utils/actionsWidth'
import { fmtDateTime } from '@/utils/format'

/**
 * 问题反馈工单（C-508）：求职者在 C 端提交，运营回复后通过站内信通知本人
 * 第 8 类审核处理：页签 → 表格 → 「处理」弹窗里回复，次要的「关闭」在左、「回复」主色在右
 */
const { label } = useDict()
const TABS: { key: FeedbackStatus | ''; label: string }[] = [
  { key: 'OPEN', label: '待处理' },
  { key: 'REPLIED', label: '已回复' },
  { key: 'CLOSED', label: '已关闭' },
  { key: '', label: '全部' },
]
/** 色调同求职者端「问题反馈」（seeker views/FeedbackView.vue 的 TONE） */
const TONE: Record<FeedbackStatus, string> = { OPEN: 'status-tag--warning', REPLIED: 'status-tag--success', CLOSED: 'status-tag--neutral' }

const tab = ref<FeedbackStatus | ''>('OPEN')
const rows = ref<FeedbackRow[]>([])
const loading = ref(false)
const loadError = ref('')
const offline = ref(false)
/** 后端拒绝过的处理：只置灰这一条的「处理」，原因用提醒色写在表格上方；切页签、翻页、重新加载都清掉 */
const blocked = reactive<Record<number, string>>({})
const clearBlocked = () => Object.keys(blocked).forEach((k) => delete blocked[Number(k)])

async function load() {
  clearBlocked()
  loading.value = true
  loadError.value = ''
  offline.value = false
  try {
    rows.value = await opsApi.feedbackList(tab.value ? { status: tab.value } : undefined)
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '反馈列表加载失败')
    offline.value = isNetwork(e)
  } finally {
    loading.value = false
    page.value = 1
  }
}
onMounted(load)
watch(tab, load)

// 前端分页：接口一次返回全部
const page = ref(1)
const pageSize = ref(20)
const paged = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([page, pageSize], clearBlocked)
const opsWidth = computed(() => actionsColWidth(paged.value.map((r) => ({ labels: r.status === 'OPEN' ? ['处理'] : [] })), 72))

const dlg = reactive({ open: false, row: null as FeedbackRow | null, reply: '', saving: '' as '' | 'reply' | 'close', error: '', why: '', off: '' as '' | 'reply' | 'close' })
function openReply(row: FeedbackRow) {
  Object.assign(dlg, { open: true, row, reply: '', saving: '', error: '', why: '', off: '' })
}
function editReply() {
  dlg.error = ''
  dlg.why = ''
  dlg.off = ''
}
const closeText = computed(() => (dlg.reply.trim() ? '回复并关闭' : '不回复，直接关闭'))
async function submit(close: boolean) {
  const row = dlg.row
  if (!row || dlg.saving) return
  const text = dlg.reply.trim()
  if (!close && !text) return void (dlg.error = '请填写回复内容')
  const act = close ? 'close' : 'reply'
  const actText = close ? closeText.value : '回复'
  dlg.saving = act
  try {
    await opsApi.replyFeedback(row.id, { reply: text || undefined, close })
    ElMessage.success(text ? '已回复，求职者会收到站内信' : '已关闭')
    dlg.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
    // 后端业务拒绝：原因留在弹窗里，只置灰被拒的那个按钮（改了回复内容再放开），表格里这一条也置灰；断网只提示
    if (isBlocked(e)) {
      dlg.why = `暂时不能${actText}：${errorMessage(e, '操作失败')}`
      dlg.off = act
      blocked[row.id] = `${row.seekerName} 的反馈 #${row.id}：${dlg.why}`
    }
  } finally {
    dlg.saving = ''
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>问题反馈</h2>
        <p>求职者在 C 端提交的问题、投诉与建议 · 回复后通过站内信通知本人</p>
      </div>
    </div>

    <div class="card tbl-card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" type="button" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
        </div>
        <div class="spacer" />
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
      <p v-for="(why, id) in blocked" :key="id" class="blocked-why tbl-tip" role="status">{{ why }}</p>
      <el-table v-loading="loading" :data="paged" class="ops-table tbl-48" row-key="id">
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="tnum">{{ fmtDateTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="求职者" width="170">
          <template #default="{ row }">
            <span class="strong">{{ row.seekerName }}</span>
            <div class="t-xs">{{ row.contact || row.phoneMasked }}<span v-if="row.contact"> · 回访电话</span></div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ label('FeedbackCategory', row.category) }}</template>
        </el-table-column>
        <el-table-column label="内容" min-width="320">
          <template #default="{ row }">
            <div class="content">{{ row.content }}</div>
            <div v-if="row.boundCompanyName" class="t-xs">当前服务公司：{{ row.boundCompanyName }}</div>
            <div v-if="row.reply" class="reply"><b>回复</b>{{ row.reply }}<span class="t-xs"> · {{ row.handledByName }} {{ fmtDateTime(row.handledAt) }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><span class="status-tag" :class="TONE[row.status as FeedbackStatus]">{{ label('FeedbackStatus', row.status) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" :width="opsWidth" class-name="ops-col">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN'" link type="primary" size="small" :disabled="!!blocked[row.id]" @click="openReply(row)">处理</el-button>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loading" class="tbl-wait" />
          <div v-else-if="loadError" class="state-box">
            <IconTriangleExclamationPoint :size="48" />
            <h4>反馈列表加载失败</h4>
            <p>{{ offline ? '请检查网络后重新加载' : loadError }}</p>
            <el-button type="primary" @click="load">重新加载</el-button>
          </div>
          <div v-else class="state-box">
            <IconInbox :size="48" />
            <h4>{{ tab === 'OPEN' ? '暂无待处理的反馈' : '暂无反馈' }}</h4>
            <p>{{ tab === 'OPEN' ? '求职者在「问题反馈」里提交后会出现在这里' : '切换上方页签查看其他状态的反馈' }}</p>
          </div>
        </template>
      </el-table>
      <div v-if="rows.length" class="pager">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="rows.length" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" background />
      </div>
    </div>

    <el-dialog v-model="dlg.open" title="处理反馈" width="560px" class="dlg-16" destroy-on-close>
      <template v-if="dlg.row">
        <p class="who"><b>{{ dlg.row.seekerName }}</b> · {{ label('FeedbackCategory', dlg.row.category) }} · <span class="tnum">{{ dlg.row.contact || dlg.row.phoneMasked }}</span></p>
        <div class="content box">{{ dlg.row.content }}</div>
        <el-input v-model="dlg.reply" type="textarea" :rows="5" maxlength="1000" show-word-limit placeholder="回复内容会通过站内信发给求职者" class="gap" @input="editReply" />
        <p v-if="dlg.error" class="form-err gap" role="alert">{{ dlg.error }}</p>
        <p v-if="dlg.why" class="blocked-why gap" role="alert">{{ dlg.why }}</p>
      </template>
      <template #footer>
        <el-button :loading="dlg.saving === 'close'" :disabled="dlg.saving === 'reply' || dlg.off === 'close'" @click="submit(true)">{{ closeText }}</el-button>
        <el-button type="primary" :loading="dlg.saving === 'reply'" :disabled="dlg.saving === 'close' || dlg.off === 'reply'" @click="submit(false)">回复</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
.tbl-wait { height: 160px; }
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; color: var(--text-1); }
.box { padding: var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); max-height: 220px; overflow: auto; }
.who { margin: 0 0 var(--space-2); font-size: var(--font-size-aux); color: var(--text-2); }
.who b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.gap { margin-top: var(--space-3); }
.reply { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--bg-fill); border-radius: var(--radius-control); line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.reply b { color: var(--success-text); margin-right: var(--space-2); font-size: var(--font-size-min); font-weight: var(--font-weight-semibold); }
</style>
