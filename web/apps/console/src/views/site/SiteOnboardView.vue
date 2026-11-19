<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type SiteApplication } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconCopy, IconShieldCheck } from '@shitu/ui-icons'
import AppActionButtons, { appActionsColWidth } from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import DictTag from '@/components/DictTag.vue'
import QrImage from '@/components/QrImage.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useNow } from '@/composables/useNow'
import { useProjects } from '@/composables/useProjects'
import { exportList, type CsvColumn } from '@/utils/exportCsv'
import { copyText, fmtDateTime, fmtPhone } from '@/utils/format'
import { enumLabel } from '@/utils/labels'

/**
 * A-04 入职确权与线上电子签约（T-103）：待确权列表 → 确权签约（入职日期 / 工号 / 合同截止）→ 返回签署链接；
 * 已发起未签署的显示「重发签约」（作废旧流程重发）；报名自带最近一份合同（contract），签署链接 / 二维码可直接查看，无需重发。
 */
const now = useNow()
const { projects } = useProjects()
const projectId = ref('')
const list = ref<SiteApplication[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const recent = ref<SiteApplication[]>([])
/** 待确权列表拿到过数据；最近入职单独一个请求，失败单独说 */
const ready = ref(false)
const recentError = ref('')
const recentLoading = ref(false)
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)

const signing = (a: SiteApplication) => a.contract?.status === 'PENDING_SIGN' || a.allowedActions.includes('RESEND_CONTRACT')
/** 只读角色（老板）对列表里的报名都没有可用操作时，不显示操作列 */
const hasOps = computed(() => list.value.some((a) => a.allowedActions.length > 0))
const waitingSign = computed(() => list.value.filter(signing).length)
const opsWidth = computed(() => appActionsColWidth(list.value))

async function copySign(url: string) {
  if (await copyText(url)) ElMessage.success('签署链接已复制')
  else ElMessage.error('复制失败，请手动复制')
}

/** 导出待确权：按当前项目把所有页取完（表格只显示前 100 条）；手机号只有驻场拿得到，签署链接不导出 */
const exporting = ref(false)
const EXPORT_COLUMNS: CsvColumn<SiteApplication>[] = [
  { header: '求职者', value: (a) => a.seekerName },
  { header: '手机号', value: (a) => a.phone, kind: 'text' },
  { header: '入职岗位', value: (a) => a.jobTitle },
  { header: '项目', value: (a) => a.projectName },
  { header: '来源', value: (a) => (a.fromPublic ? '公域' : '私域') },
  { header: '签约进度', value: (a) => (a.contract ? enumLabel('ContractStatus', a.contract.status) : signing(a) ? '待乙方签名' : '未发起') },
  { header: '签约发起时间', value: (a) => a.contract?.createdAt, kind: 'datetime' },
  { header: '响应截止', value: (a) => a.responseDeadline, kind: 'datetime' },
]
function doExport() {
  const q = { status: 'PENDING_CONFIRM' as const, projectId: projectId.value || undefined }
  return exportList({ name: '待确权人员', columns: EXPORT_COLUMNS, rows: (p, pageSize) => tenantApi.applications({ ...q, page: p, pageSize }), loading: exporting })
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await tenantApi.applications({ status: 'PENDING_CONFIRM', projectId: projectId.value || undefined, page: 1, pageSize: 100 })
    list.value = r.records
    total.value = r.total
    ready.value = true
  } catch (e) {
    loadError.value = errorMessage(e, '待确权列表加载失败')
    ready.value = false
    list.value = []
  } finally {
    loading.value = false
  }
  await loadRecent()
}
async function loadRecent() {
  recentLoading.value = true
  recentError.value = ''
  try {
    const e = await tenantApi.applications({ status: 'EMPLOYED', projectId: projectId.value || undefined, page: 1, pageSize: 8, sort: 'CREATED_DESC' })
    recent.value = e.records
  } catch (e) {
    recent.value = []
    recentError.value = errorMessage(e, '最近入职加载失败')
  } finally {
    recentLoading.value = false
  }
}
watch(projectId, load)
onMounted(load)
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>入职确权与线上电子签约</h2>
        <p>唯一数据统计节点 —— 确权完成即写入归属、锁定匹配范围、开始计费</p>
      </div>
      <span class="spacer" />
      <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
        <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
      </el-select>
      <el-button :loading="exporting" :disabled="!total" @click="doExport">导出待确权</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <div v-loading="loading" class="stats">
      <div class="stat st"><div class="stat-l">待确权</div><div class="stat-v">{{ ready ? total : '—' }}</div><div class="stat-d">面试已通过</div></div>
      <div class="stat st"><div class="stat-l">已发起 · 待求职者签署</div><div class="stat-v">{{ ready ? waitingSign : '—' }}</div><div class="stat-d">可重发签约</div></div>
      <div class="stat st"><div class="stat-l">待发起签约</div><div class="stat-v">{{ ready ? list.length - waitingSign : '—' }}</div><div class="stat-d">请尽快确权</div></div>
    </div>

    <div class="card tbl-card">
      <div class="card__hd"><h3>待确权</h3><span class="flow">到厂确认 → 面试通过 → <b>入职确权</b> → 电子签约 → 已入职在岗</span></div>
      <el-table v-loading="loading" :data="list" row-key="applicationId">
        <el-table-column label="求职者" min-width="130">
          <template #default="{ row }"><PersonCell :name="row.seekerName" :accent="!row.fromPublic" :sub="row.phone ? fmtPhone(row.phone) : undefined" /></template>
        </el-table-column>
        <el-table-column label="入职岗位" min-width="180">
          <template #default="{ row }">
            <div class="job-t">{{ row.jobTitle ?? '—' }}</div>
            <div class="t-xs">{{ row.projectName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="72">
          <template #default="{ row }"><span class="status-tag" :class="row.fromPublic ? 'status-tag--public' : 'status-tag--private'">{{ row.fromPublic ? '公域' : '私域' }}</span></template>
        </el-table-column>
        <el-table-column label="签约进度" width="180">
          <template #default="{ row }">
            <template v-if="row.contract">
              <div class="sign-row">
                <DictTag type="ContractStatus" :value="row.contract.status" />
                <el-popover v-if="row.contract.signUrl" placement="left" :width="300" trigger="click">
                  <template #reference>
                    <el-button size="small" link type="primary">签署码</el-button>
                  </template>
                  <div class="sign-pop">
                    <QrImage :url="row.contract.signUrl" :size="120" />
                    <div class="code link">{{ row.contract.signUrl }}</div>
                    <el-button size="small" @click="copySign(row.contract.signUrl)"><IconCopy :size="14" class="btn-i" />复制链接</el-button>
                    <div class="t-xs">发起于 {{ fmtDateTime(row.contract.createdAt) }} · 现场扫码或发给求职者签署</div>
                  </div>
                </el-popover>
              </div>
              <div class="t-xs">{{ fmtDateTime(row.contract.createdAt).slice(5) }} 发起</div>
            </template>
            <span v-else-if="signing(row)" class="status-tag status-tag--warning">待乙方签名</span>
            <span v-else class="status-tag">未发起</span>
          </template>
        </el-table-column>
        <el-table-column label="响应剩余" width="116">
          <template #default="{ row }"><RemainTag :deadline="row.responseDeadline" :now="now" /></template>
        </el-table-column>
        <el-table-column v-if="hasOps" label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }"><AppActionButtons :app="row" link @action="(a, r) => dialogs?.run(a, r)" /></template>
        </el-table-column>
        <template #empty>
          <div v-if="loadError" class="tbl-state">
            <IconCircleExclamationPoint :size="48" class="tbl-state-i" />
            <h4>{{ loadError }}</h4>
            <p>请检查网络后重新加载</p>
            <el-button @click="load">重新加载</el-button>
          </div>
          <div v-else-if="!loading" class="tbl-state">
            <IconShieldCheck :size="48" class="tbl-state-i" />
            <h4>暂无待确权人员</h4>
            <p>面试通过的人会出现在这里，确权后发起电子签约</p>
          </div>
        </template>
      </el-table>
    </div>

    <div class="explain">
      <div class="card">
        <div class="card__hd"><h3>确权后系统自动执行</h3></div>
        <div class="card__bd">
          <ol class="auto">
            <li><b>写入归属</b><span>公域用户写入本公司、标签变私域；私域用户保持不变</span></li>
            <li><b>锁定匹配范围</b><span>仅本公司内部调岗</span></li>
            <li><b>触发增长技术服务费</b><span>按公司在岗人数 − 存量基数计费</span></li>
            <li><b>触发人才流转费</b><span>来源归属为其他公司时，10 元/人/天</span></li>
            <li><b>生成电子合同并推送签署</b><span>签署完成 → 已入职在岗，消息推送项目经理 / 老板</span></li>
          </ol>
        </div>
      </div>
      <div class="card">
        <div class="card__hd"><h3>最近入职</h3><span class="t-sm">已完成签约 · 按报名时间倒序</span></div>
        <el-table v-loading="recentLoading" :data="recent" row-key="applicationId" class="recent">
          <el-table-column label="员工" min-width="80"><template #default="{ row }"><span class="job-t">{{ row.seekerName }}</span></template></el-table-column>
          <el-table-column label="岗位" min-width="120"><template #default="{ row }"><span class="t-sm">{{ row.jobTitle }}</span></template></el-table-column>
          <el-table-column label="报名时间" width="110"><template #default="{ row }"><span class="t-xs">{{ fmtDateTime(row.createdAt).slice(5) }}</span></template></el-table-column>
          <template #empty>
            <span v-if="recentError" class="t-sm">{{ recentError }} <el-button link type="primary" @click="loadRecent">重新加载</el-button></span>
            <span v-else-if="!recentLoading" class="t-sm">暂无</span>
          </template>
        </el-table>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" />
  </div>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); }
.st { padding: var(--space-4); }
.tbl-card { margin-top: var(--space-gap); }
.flow { font-size: var(--font-size-aux); color: var(--text-3); }
.flow b { color: var(--text-1); font-weight: var(--font-weight-semibold); }
.job-t { font-size: var(--font-size-aux); color: var(--text-1); font-weight: var(--font-weight-medium); }
.sign-row { display: flex; align-items: center; gap: var(--space-2); }
.sign-pop { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); text-align: center; }
.code { font-family: var(--font-mono); }
.link { word-break: break-all; font-size: var(--font-size-min); color: var(--text-2); }
.btn-i { margin-right: var(--space-1); }
.tbl-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) 0; line-height: 1.6; }
.tbl-state-i { color: var(--text-3); }
.tbl-state h4 { margin: var(--space-2) 0 0; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tbl-state p { margin: 0 0 var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.explain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.auto { margin: 0; padding-left: 20px; }
.auto li { padding: var(--space-1) 0; font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-2); }
.auto li::marker { color: var(--text-3); }
.auto b { display: block; color: var(--text-1); font-weight: var(--font-weight-semibold); }
.recent :deep(.el-table__body .el-table__cell) { padding: var(--space-3) 0; }
</style>
