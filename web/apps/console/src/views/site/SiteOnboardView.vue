<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconCopy, IconShieldCheck } from '@shitu/ui-icons'
import AppActionButtons, { ACTION_LABEL, actionsColWidth } from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import RemainTag from '@/components/site/RemainTag.vue'
import DictTag from '@/components/DictTag.vue'
import QrImage from '@/components/QrImage.vue'
import PersonCell from '@/components/PersonCell.vue'
import { useNow } from '@/composables/useNow'
import { useProjects } from '@/composables/useProjects'
import { copyText, fmtDateTime, fmtPhone } from '@/utils/format'

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
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)
/** 后端拒绝过的操作：这条报名的按钮置灰、原因写在表格上方，刷新后重新判断 */
const blocked = reactive<Record<string, { name: string; text: string }>>({})
function onRejected(action: SiteApplicationAction, app: SiteApplication, reason: string) {
  blocked[app.applicationId] = { name: app.seekerName, text: `暂时不能${ACTION_LABEL[action]}：${reason}` }
}

const signing = (a: SiteApplication) => a.contract?.status === 'PENDING_SIGN' || a.allowedActions.includes('RESEND_CONTRACT')
const waitingSign = computed(() => list.value.filter(signing).length)
const opsWidth = computed(() => actionsColWidth(list.value))

async function copySign(url: string) {
  if (await copyText(url)) ElMessage.success('签署链接已复制')
  else ElMessage.error('复制失败，请手动复制')
}

async function load() {
  loading.value = true
  loadError.value = ''
  Object.keys(blocked).forEach((k) => delete blocked[k])
  try {
    const r = await tenantApi.applications({ status: 'PENDING_CONFIRM', projectId: projectId.value || undefined, page: 1, pageSize: 100 })
    list.value = r.records
    total.value = r.total
  } catch (e) {
    loadError.value = errorMessage(e, '待确权列表加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
  try {
    const e = await tenantApi.applications({ status: 'EMPLOYED', projectId: projectId.value || undefined, page: 1, pageSize: 8, sort: 'CREATED_DESC' })
    recent.value = e.records
  } catch {
    recent.value = []
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
      <el-button @click="load">刷新</el-button>
    </div>

    <div v-loading="loading" class="stats">
      <div class="stat st"><div class="stat-l">待确权</div><div class="stat-v">{{ loadError ? '—' : total }}</div><div class="stat-d">面试已通过</div></div>
      <div class="stat stat--warn st"><div class="stat-l">已发起 · 待求职者签署</div><div class="stat-v">{{ loadError ? '—' : waitingSign }}</div><div class="stat-d">可重发签约</div></div>
      <div class="stat st"><div class="stat-l">待发起签约</div><div class="stat-v">{{ loadError ? '—' : list.length - waitingSign }}</div><div class="stat-d">请尽快确权</div></div>
    </div>

    <div class="card tbl-card">
      <div class="card__hd"><h3>待确权</h3><span class="flow">到厂确认 → 面试通过 → <b>入职确权</b> → 电子签约 → 已入职在岗</span></div>
      <div v-for="(b, id) in blocked" :key="id" class="notice-bar notice-bar--danger tbl-tip" role="status">
        <IconCircleExclamationPoint :size="16" class="notice-bar-i" /><span>{{ b.name }}（{{ id }}）{{ b.text }}。刷新后重新判断</span>
      </div>
      <el-table v-loading="loading" :data="list" row-key="applicationId">
        <el-table-column label="求职者" min-width="130">
          <template #default="{ row }"><PersonCell :name="row.seekerName" :accent="!row.fromPublic" :sub="row.phone ? fmtPhone(row.phone) : undefined" /></template>
        </el-table-column>
        <el-table-column label="入职岗位" min-width="180">
          <template #default="{ row }">
            <div class="job-t">{{ row.jobTitle }}</div>
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
        <el-table-column label="操作" :width="opsWidth" align="right" fixed="right" class-name="ops-col">
          <template #default="{ row }"><AppActionButtons :app="row" link :disabled="!!blocked[row.applicationId]" @action="(a, r) => dialogs?.run(a, r)" /></template>
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
        <div class="card__hd"><h3>最近入职</h3><span class="t-sm">已完成签约</span></div>
        <el-table :data="recent" size="small" row-key="applicationId">
          <el-table-column label="员工" min-width="80"><template #default="{ row }"><span class="job-t">{{ row.seekerName }}</span></template></el-table-column>
          <el-table-column label="岗位" min-width="120"><template #default="{ row }"><span class="t-sm">{{ row.jobTitle }}</span></template></el-table-column>
          <el-table-column label="报名时间" width="110"><template #default="{ row }"><span class="t-xs">{{ fmtDateTime(row.createdAt).slice(5) }}</span></template></el-table-column>
          <template #empty><span class="t-sm">暂无</span></template>
        </el-table>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-gap); }
.st { padding: var(--space-4); }
.tbl-card { margin-top: var(--space-gap); }
.tbl-tip { margin: var(--space-3) var(--space-4) 0; }
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
</style>
