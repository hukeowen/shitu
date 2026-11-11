<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type SiteApplication } from '@shitu/api-client'
import AppActionButtons from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import CountdownTag from '@/components/CountdownTag.vue'
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

const signing = (a: SiteApplication) => a.contract?.status === 'PENDING_SIGN' || a.allowedActions.includes('RESEND_CONTRACT')
const waitingSign = computed(() => list.value.filter(signing).length)

async function copySign(url: string) {
  if (await copyText(url)) ElMessage.success('签署链接已复制')
  else ElMessage.error('复制失败，请手动复制')
}

async function load() {
  loading.value = true
  loadError.value = ''
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

    <div class="grid g-3">
      <div class="stat"><div class="stat-l">待确权</div><div class="stat-v">{{ total }}</div><div class="stat-d">面试已通过</div></div>
      <div class="stat stat--warn"><div class="stat-l">已发起 · 待求职者签署</div><div class="stat-v">{{ waitingSign }}</div><div class="stat-d">可重发签约</div></div>
      <div class="stat"><div class="stat-l">待发起签约</div><div class="stat-v">{{ list.length - waitingSign }}</div><div class="stat-d">请尽快确权</div></div>
    </div>

    <div class="grid g-32" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>待确权</h3><span class="t-xs">到厂确认 → 面试通过 → <b class="strong">入职确权</b> → 电子签约 → 已入职在岗</span></div>
        <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
          <el-button size="small" @click="load">重试</el-button>
        </el-alert>
        <el-table v-loading="loading" :data="list" row-key="applicationId">
          <el-table-column label="求职者" min-width="120">
            <template #default="{ row }"><PersonCell :name="row.seekerName" :accent="!row.fromPublic" :sub="row.phone ? fmtPhone(row.phone) : undefined" /></template>
          </el-table-column>
          <el-table-column label="入职岗位" min-width="170">
            <template #default="{ row }">
              <div class="t-sm strong">{{ row.jobTitle }}</div>
              <div class="t-xs">{{ row.projectName }}</div>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="74">
            <template #default="{ row }"><span class="tag" :class="row.fromPublic ? 'tag--public' : 'tag--private'">{{ row.fromPublic ? '公域' : '私域' }}</span></template>
          </el-table-column>
          <el-table-column label="签约进度" width="150">
            <template #default="{ row }">
              <template v-if="row.contract">
                <DictTag type="ContractStatus" :value="row.contract.status" />
                <el-popover v-if="row.contract.signUrl" placement="left" :width="300" trigger="click">
                  <template #reference>
                    <el-button size="small" link type="primary" style="margin-left: 4px">签署码</el-button>
                  </template>
                  <div class="sign-pop">
                    <QrImage :url="row.contract.signUrl" :size="120" />
                    <div class="mono t-xs link">{{ row.contract.signUrl }}</div>
                    <el-button size="small" type="primary" @click="copySign(row.contract.signUrl)">复制链接</el-button>
                    <div class="t-xs">发起于 {{ fmtDateTime(row.contract.createdAt) }} · 现场扫码或发给求职者签署</div>
                  </div>
                </el-popover>
                <div class="mono t-xs">{{ fmtDateTime(row.contract.createdAt).slice(5) }} 发起</div>
              </template>
              <span v-else-if="signing(row)" class="tag tag--warn">待乙方签名</span>
              <span v-else class="tag tag--muted">未发起</span>
            </template>
          </el-table-column>
          <el-table-column label="响应剩余" width="100">
            <template #default="{ row }"><CountdownTag :deadline="row.responseDeadline" :now="now" /></template>
          </el-table-column>
          <el-table-column label="操作" min-width="170" align="right" fixed="right">
            <template #default="{ row }"><AppActionButtons :app="row" @action="(a, r) => dialogs?.run(a, r)" /></template>
          </el-table-column>
          <template #empty><el-empty :image-size="70" :description="loadError ? '加载失败' : '暂无待确权人员'" /></template>
        </el-table>
      </div>

      <div class="grid" style="gap: 14px; align-content: start">
        <div class="card">
          <div class="card__hd"><h3>确权后系统自动执行</h3></div>
          <div class="card__bd">
            <ul class="tl">
              <li class="now"><div class="tl-t">写入归属</div><div class="t-sm">公域用户写入本公司、标签变私域；私域用户保持不变</div></li>
              <li class="now"><div class="tl-t">锁定匹配范围</div><div class="t-sm">仅本公司内部调岗</div></li>
              <li class="now"><div class="tl-t">触发增长技术服务费</div><div class="t-sm">按公司在岗人数 − 存量基数计费</div></li>
              <li class="now"><div class="tl-t">触发人才流转费</div><div class="t-sm">来源归属为其他公司时，10 元/人/天</div></li>
              <li class="now"><div class="tl-t">生成电子合同并推送签署</div><div class="t-sm">签署完成 → 已入职在岗，消息推送项目经理 / 老板</div></li>
            </ul>
          </div>
        </div>
        <div class="card">
          <div class="card__hd"><h3>最近入职</h3><span class="t-xs">已完成签约</span></div>
          <el-table :data="recent" size="small" row-key="applicationId">
            <el-table-column label="员工" min-width="80"><template #default="{ row }"><b>{{ row.seekerName }}</b></template></el-table-column>
            <el-table-column label="岗位" min-width="120"><template #default="{ row }"><span class="t-sm">{{ row.jobTitle }}</span></template></el-table-column>
            <el-table-column label="报名时间" width="110"><template #default="{ row }"><span class="mono t-xs">{{ fmtDateTime(row.createdAt).slice(5) }}</span></template></el-table-column>
            <template #empty><span class="t-xs">暂无</span></template>
          </el-table>
        </div>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" />
  </div>
</template>

<style scoped>
.sign-pop { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.link { word-break: break-all; color: var(--ink-700); }
</style>
