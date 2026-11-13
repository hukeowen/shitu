<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type SiteApplication, type SiteWorkbench } from '@shitu/api-client'
import AppActionButtons from '@/components/site/AppActionButtons.vue'
import { appOpsWidth } from '@/components/site/appActions'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import CountdownTag from '@/components/CountdownTag.vue'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { loadOpenApplications, stageText } from '@/composables/openApplications'
import { useNow } from '@/composables/useNow'
import { useMeStore } from '@/stores/me'
import { fmtDateTime, fmtPhone } from '@/utils/format'
import { remainMs } from '@/utils/time'

/** A-01 驻场工作台（T-101）：KPI 卡片 + 按响应剩余排序的今日待办 */
const router = useRouter()
const meStore = useMeStore()
const now = useNow()

const wb = ref<SiteWorkbench | null>(null)
const wbError = ref('')
const todo = ref<SiteApplication[]>([])
const todoTotal = ref(0)
const loading = ref(false)
const todoError = ref('')
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)

const opsWidth = computed(() => appOpsWidth(todo.value))
const urgent = computed(() => todo.value.filter((a) => (remainMs(a.responseDeadline, now.value) ?? Infinity) < 6 * 3600_000).length)

async function load() {
  loading.value = true
  wbError.value = ''
  todoError.value = ''
  const [w, t] = await Promise.allSettled([tenantApi.siteWorkbench(), loadOpenApplications()])
  if (w.status === 'fulfilled') wb.value = w.value
  else wbError.value = errorMessage(w.reason, '工作台数据加载失败')
  if (t.status === 'fulfilled') {
    todoTotal.value = t.value.list.length
    todo.value = t.value.list.slice(0, 8)
  } else {
    todoError.value = errorMessage(t.reason, '待办加载失败')
    todo.value = []
  }
  loading.value = false
}
onMounted(load)

function go(path: string, query?: Record<string, string>) {
  router.push({ path, query })
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>驻场工作台</h2>
        <p>{{ meStore.me?.company.shortName || meStore.me?.company.name }} · {{ meStore.me?.name }}</p>
      </div>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
      <el-button type="primary" @click="go('/site/todo')">处理待办</el-button>
    </div>

    <el-alert v-if="wbError" type="error" :title="wbError" show-icon :closable="false" style="margin-bottom: 14px" />
    <div class="grid g-5">
      <div class="stat stat--link" @click="go('/site/todo', { tab: 'ack' })">
        <div class="stat-l">待知悉</div>
        <div class="stat-v">{{ wb?.pendingAck ?? '—' }}</div>
        <div class="stat-d">新报名 · 需推送面试信息</div>
      </div>
      <div class="stat stat--link" @click="go('/site/todo', { tab: 'interview' })">
        <div class="stat-l">待面试</div>
        <div class="stat-v">{{ wb?.pendingInterview ?? '—' }}</div>
        <div class="stat-d">含待知悉</div>
      </div>
      <div class="stat stat--link" @click="go('/site/onboard')">
        <div class="stat-l">待确权</div>
        <div class="stat-v">{{ wb?.pendingConfirm ?? '—' }}</div>
        <div class="stat-d">面试通过 · 待签约</div>
      </div>
      <div class="stat stat--link" :class="{ 'stat--danger': (wb?.windowsDueIn4h ?? 0) > 0 }" @click="go('/site/follow')">
        <div class="stat-l">24h 窗口 4 小时内到期</div>
        <div class="stat-v">{{ wb?.windowsDueIn4h ?? '—' }}</div>
        <div class="stat-d">超时系统释放至公域</div>
      </div>
      <div class="stat stat--link" @click="go('/site/follow')">
        <div class="stat-l">私域待匹配</div>
        <div class="stat-v">{{ wb?.privatePending ?? '—' }}</div>
        <div class="stat-d">注册后未报名 · 需跟进</div>
      </div>
    </div>

    <div class="grid g-1" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd">
          <h3>今日待办</h3>
          <div class="row" style="gap: 6px">
            <span v-if="urgent" class="tag tag--danger">{{ urgent }} 紧急</span>
            <el-button size="small" @click="go('/site/todo')">全部 {{ todoTotal }} 条</el-button>
          </div>
        </div>
        <el-alert v-if="todoError" type="error" :title="todoError" show-icon :closable="false" />
        <el-table v-loading="loading" :data="todo" row-key="applicationId">
          <el-table-column label="求职者" min-width="170">
            <template #default="{ row }"><PersonCell :name="row.seekerName" :accent="!row.fromPublic" mono :sub="row.phone ? fmtPhone(row.phone) : undefined" /></template>
          </el-table-column>
          <el-table-column label="应聘岗位" min-width="190">
            <template #default="{ row }">
              <div class="t-sm clamp-2" :title="row.jobTitle ?? ''">{{ row.jobTitle ?? '—' }}</div>
              <div class="t-xs clamp-2" :title="stageText(row)">{{ stageText(row) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="面试时间" min-width="116">
            <template #default="{ row }">
              <span v-if="row.interviewAt" class="mono t-sm">{{ fmtDateTime(row.interviewAt).slice(5) }}</span>
              <span v-else class="t-xs">—</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="96">
            <template #default="{ row }"><DictTag type="ApplicationStatus" :value="row.status" pill /></template>
          </el-table-column>
          <el-table-column label="响应剩余" min-width="112">
            <template #default="{ row }"><CountdownTag :deadline="row.responseDeadline" :now="now" /></template>
          </el-table-column>
          <el-table-column v-if="opsWidth" label="操作" :width="opsWidth" fixed="right" class-name="ops-col">
            <template #default="{ row }"><AppActionButtons :app="row" @action="(a, r) => dialogs?.run(a, r)" /></template>
          </el-table-column>
          <template #empty><el-empty :image-size="70" :description="todoError ? '加载失败' : '暂无待办，干得漂亮'" /></template>
        </el-table>
      </div>

      <div class="grid g-2 grid--top">
        <div class="card">
          <div class="card__hd"><h3>快捷操作</h3></div>
          <div class="card__bd grid g-2" style="gap: 8px">
            <el-button @click="go('/site/todo', { tab: 'ack' })">知悉推送</el-button>
            <el-button @click="go('/site/todo', { tab: 'interview' })">到厂 / 面试结果</el-button>
            <el-button @click="go('/site/onboard')">入职确权</el-button>
            <el-button @click="go('/site/follow')">响应监控</el-button>
            <el-button @click="go('/broker/pool')">流转池</el-button>
            <el-button @click="go('/pm/staff')">人员管理</el-button>
          </div>
        </div>
        <div class="card">
          <div class="card__hd"><h3>处理时限</h3></div>
          <div class="card__bd">
            <dl class="kv"><dt>新报名知悉</dt><dd>24 小时内</dd></dl>
            <dl class="kv"><dt>面试通过 → 确权</dt><dd>24 小时内</dd></dl>
            <dl class="kv"><dt>超时后果</dt><dd style="color: var(--danger)">系统释放至公域</dd></dl>
            <div class="note note--info" style="margin-top: 10px">公域用户不触发 24 小时响应窗口；倒计时以系统记录的截止时间为准。</div>
          </div>
        </div>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" />
  </div>
</template>
