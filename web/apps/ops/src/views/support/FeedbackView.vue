<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, opsApi, useDict, type FeedbackRow, type FeedbackStatus } from '@shitu/api-client'
import { fmtDateTime } from '@/utils/format'

/** 问题反馈工单（C-508）：求职者在 C 端提交，运营回复后通过站内信通知本人 */
const { label } = useDict()
const TABS: { key: FeedbackStatus | ''; label: string }[] = [
  { key: 'OPEN', label: '待处理' },
  { key: 'REPLIED', label: '已回复' },
  { key: 'CLOSED', label: '已关闭' },
  { key: '', label: '全部' },
]
const TAG: Record<FeedbackStatus, string> = { OPEN: 'tag--warn', REPLIED: 'tag--ok', CLOSED: '' }

const tab = ref<FeedbackStatus | ''>('OPEN')
const rows = ref<FeedbackRow[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await opsApi.feedbackList(tab.value ? { status: tab.value } : undefined)
  } catch (e) {
    rows.value = []
    loadError.value = errorMessage(e, '反馈列表加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(tab, load)

const dlg = reactive({ open: false, row: null as FeedbackRow | null, reply: '', saving: false })
function openReply(row: FeedbackRow) {
  dlg.row = row
  dlg.reply = ''
  dlg.open = true
}
async function submit(close: boolean) {
  if (!dlg.row) return
  const text = dlg.reply.trim()
  if (!close && !text) return void ElMessage.warning('请填写回复内容')
  dlg.saving = true
  try {
    await opsApi.replyFeedback(dlg.row.id, { reply: text || undefined, close })
    ElMessage.success(text ? '已回复，求职者会收到站内信' : '已关闭')
    dlg.open = false
    await load()
  } catch (e) {
    ElMessage.error(errorMessage(e, '操作失败'))
  } finally {
    dlg.saving = false
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
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px" />

    <div class="card">
      <div class="toolbar">
        <div class="filter-tabs">
          <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
        </div>
      </div>
      <el-table v-loading="loading" :data="rows" row-key="id">
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }"><span class="mono t-sm">{{ fmtDateTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="求职者" width="170">
          <template #default="{ row }">
            <b>{{ row.seekerName }}</b>
            <div class="t-xs mono">{{ row.contact || row.phoneMasked }}<span v-if="row.contact"> · 回访电话</span></div>
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
          <template #default="{ row }"><span class="tag" :class="TAG[row.status as FeedbackStatus]">{{ label('FeedbackStatus', row.status) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN'" size="small" type="primary" @click="openReply(row)">处理</el-button>
            <span v-else class="t-xs">—</span>
          </template>
        </el-table-column>
        <template #empty><el-empty :description="loadError ? '加载失败' : '暂无反馈'" :image-size="80" /></template>
      </el-table>
    </div>

    <el-dialog v-model="dlg.open" title="处理反馈" width="560px" destroy-on-close>
      <template v-if="dlg.row">
        <div class="t-sm" style="margin-bottom: 6px"><b>{{ dlg.row.seekerName }}</b> · {{ label('FeedbackCategory', dlg.row.category) }} · <span class="mono">{{ dlg.row.contact || dlg.row.phoneMasked }}</span></div>
        <div class="content box">{{ dlg.row.content }}</div>
        <el-input v-model="dlg.reply" type="textarea" :rows="5" maxlength="1000" show-word-limit placeholder="回复内容会通过站内信发给求职者" style="margin-top: 12px" />
      </template>
      <template #footer>
        <el-button :disabled="dlg.saving" @click="submit(true)">{{ dlg.reply.trim() ? '回复并关闭' : '不回复，直接关闭' }}</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="submit(false)">回复</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.content { white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
.box { padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); max-height: 220px; overflow: auto; }
.reply { margin-top: 6px; padding: 6px 10px; border-left: 3px solid var(--ok); background: var(--surface-2); border-radius: var(--r-xs); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.reply b { color: var(--ok); margin-right: 6px; font-size: 12px; }
</style>
