<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { errorMessage, tenantApi, type SiteApplication, type SiteWorkbench } from '@shitu/api-client'
import AppActionButtons from '@/components/site/AppActionButtons.vue'
import AppActionDialogs from '@/components/site/AppActionDialogs.vue'
import CountdownTag from '@/components/CountdownTag.vue'
import DictTag from '@/components/DictTag.vue'
import PersonCell from '@/components/PersonCell.vue'
import { loadOpenApplications, stageText } from '@/composables/openApplications'
import { useNow } from '@/composables/useNow'
import { useProjects } from '@/composables/useProjects'
import { fmtDateTime, fmtPhone } from '@/utils/format'
import { remainMs } from '@/utils/time'

/**
 * A-03 24 小时响应监控（T-102）：按 SiteApplication.responseDeadline 分档 <1h / 1–6h / 6–24h。
 * 只有私域用户有响应窗口；尚未报名的「私域待匹配」用户当前接口不返回明细，只显示工作台汇总数。
 */
type Bucket = '' | 'h1' | 'h6' | 'h24'
const H = 3600_000
const now = useNow(15_000)
const { projects } = useProjects()

const projectId = ref('')
const bucket = ref<Bucket>('')
const all = ref<SiteApplication[]>([])
const truncated = ref(false)
const wb = ref<SiteWorkbench | null>(null)
const loading = ref(false)
const loadError = ref('')
const dialogs = ref<InstanceType<typeof AppActionDialogs> | null>(null)

/** 有窗口的报名（公域用户没有 responseDeadline） */
const windowed = computed(() => all.value.filter((a) => a.responseDeadline))
function bucketOf(a: SiteApplication): Bucket {
  const ms = remainMs(a.responseDeadline, now.value) ?? Infinity
  if (ms < H) return 'h1'
  if (ms < 6 * H) return 'h6'
  return 'h24'
}
const counts = computed(() => {
  const c = { h1: 0, h6: 0, h24: 0 }
  windowed.value.forEach((a) => {
    const b = bucketOf(a)
    if (b) c[b]++
  })
  return c
})
const rows = computed(() => (bucket.value ? windowed.value.filter((a) => bucketOf(a) === bucket.value) : windowed.value))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [r, w] = await Promise.all([loadOpenApplications(projectId.value), tenantApi.siteWorkbench().catch(() => null)])
    all.value = r.list
    truncated.value = r.truncated
    wb.value = w
  } catch (e) {
    loadError.value = errorMessage(e, '响应窗口加载失败')
    all.value = []
  } finally {
    loading.value = false
  }
}
watch(projectId, load)
onMounted(load)

/** 进度条：窗口已用时长占比（24h 窗口） */
function used(a: SiteApplication): number {
  const ms = remainMs(a.responseDeadline, now.value) ?? 24 * H
  return Math.min(100, Math.max(2, Math.round((1 - ms / (24 * H)) * 100)))
}
function barClass(a: SiteApplication) {
  const b = bucketOf(a)
  return b === 'h1' ? 'danger' : b === 'h6' ? 'warn' : 'sig'
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>24 小时响应监控</h2>
        <p>私域用户专属转化窗口 · 超时系统被动释放至公域</p>
      </div>
      <span class="spacer" />
      <span class="ref">功能 <b>T-102</b></span>
      <el-select v-model="projectId" placeholder="全部项目" clearable filterable style="width: 200px">
        <el-option v-for="p in projects" :key="p.projectId" :label="p.name" :value="p.projectId" />
      </el-select>
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="grid g-4">
      <div class="stat stat--danger stat--link" @click="bucket = 'h1'">
        <div class="stat-l">&lt; 1 小时（含已超时）</div>
        <div class="stat-v">{{ counts.h1 }}</div>
        <div class="stat-d">立即处理</div>
      </div>
      <div class="stat stat--warn stat--link" @click="bucket = 'h6'">
        <div class="stat-l">1–6 小时</div>
        <div class="stat-v">{{ counts.h6 }}</div>
        <div class="stat-d">优先跟进</div>
      </div>
      <div class="stat stat--link" @click="bucket = 'h24'">
        <div class="stat-l">6–24 小时</div>
        <div class="stat-v">{{ counts.h24 }}</div>
        <div class="stat-d">正常窗口</div>
      </div>
      <div class="stat">
        <div class="stat-l">私域待匹配（未报名）</div>
        <div class="stat-v">{{ wb?.privatePending ?? '—' }}</div>
        <div class="stat-d">4 小时内到期窗口 {{ wb?.windowsDueIn4h ?? '—' }} 个（全公司）</div>
      </div>
    </div>

    <div class="grid g-32" style="margin-top: 14px">
      <div class="card">
        <div class="toolbar">
          <div class="filter-tabs">
            <button :class="{ on: bucket === '' }" @click="bucket = ''">全部<span class="n">{{ windowed.length }}</span></button>
            <button :class="{ on: bucket === 'h1' }" @click="bucket = 'h1'">&lt;1h<span class="n">{{ counts.h1 }}</span></button>
            <button :class="{ on: bucket === 'h6' }" @click="bucket = 'h6'">1–6h<span class="n">{{ counts.h6 }}</span></button>
            <button :class="{ on: bucket === 'h24' }" @click="bucket = 'h24'">6–24h<span class="n">{{ counts.h24 }}</span></button>
          </div>
          <span class="spacer" />
          <span class="tag tag--warn">按剩余时长升序</span>
        </div>
        <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false">
          <el-button size="small" @click="load">重试</el-button>
        </el-alert>
        <el-alert v-if="truncated" type="warning" title="报名较多，每个状态仅显示响应窗口最紧的 100 条" show-icon :closable="false" />
        <el-table v-loading="loading" :data="rows" row-key="applicationId">
          <el-table-column label="求职者" min-width="120">
            <template #default="{ row }"><PersonCell :name="row.seekerName" accent :sub="row.phone ? fmtPhone(row.phone) : undefined" /></template>
          </el-table-column>
          <el-table-column label="阶段" min-width="170">
            <template #default="{ row }">
              <DictTag type="ApplicationStatus" :value="row.status" pill />
              <div class="t-xs">{{ stageText(row) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="岗位" min-width="140">
            <template #default="{ row }"><span class="t-sm">{{ row.jobTitle }}</span><div class="t-xs">{{ row.projectName }}</div></template>
          </el-table-column>
          <el-table-column label="剩余" width="104">
            <template #default="{ row }"><CountdownTag :deadline="row.responseDeadline" :now="now" /></template>
          </el-table-column>
          <el-table-column label="窗口进度" width="130">
            <template #default="{ row }">
              <div class="bar"><i :class="barClass(row)" :style="{ width: `${used(row)}%` }" /></div>
              <div class="t-xs mono" style="margin-top: 3px">截止 {{ fmtDateTime(row.responseDeadline).slice(5) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="200" align="right" fixed="right">
            <template #default="{ row }"><AppActionButtons :app="row" @action="(a, r) => dialogs?.run(a, r)" /></template>
          </el-table-column>
          <template #empty><el-empty :image-size="70" :description="loadError ? '加载失败' : '没有进行中的响应窗口'" /></template>
        </el-table>
        <div class="card__ft t-xs">
          尚未报名的「私域待匹配」用户（当前 {{ wb?.privatePending ?? '—' }} 人）也有 24h 窗口，但现有接口不返回其明细，请在驻场手机端查看并拨打 / 流转经纪人。
        </div>
      </div>

      <div class="grid" style="gap: 14px; align-content: start">
        <div class="card">
          <div class="card__hd"><h3>机制说明</h3></div>
          <div class="card__bd">
            <p class="t-sm" style="margin-bottom: 12px; line-height: 1.8">劳务公司获客成本 <b class="strong">300–800 元/人</b>。蓝领求职者 1–2 天必须定去向，超 24 小时无人联系大概率流失。</p>
            <dl class="kv"><dt>适用范围</dt><dd>仅私域用户</dd></dl>
            <dl class="kv"><dt>时间窗口</dt><dd>每阶段完成后 24 小时内</dd></dl>
            <dl class="kv"><dt>匹配范围锁定</dt><dd>仅本公司岗位</dd></dl>
            <dl class="kv"><dt>推送对象</dt><dd>驻场 / 项目经理 / 老板</dd></dl>
            <dl class="kv"><dt>超时后果</dt><dd style="color: var(--danger)">系统被动释放为公域</dd></dl>
            <div class="note note--info" style="margin-top: 12px">公域用户不触发 24 小时响应 —— 不属于任何公司，无需保护特定公司权益。</div>
          </div>
        </div>
        <div class="card">
          <div class="card__hd"><h3>释放后的权益保留</h3></div>
          <div class="card__bd">
            <p class="t-sm" style="line-height: 1.8">释放只清空当前归属（bound），<b class="strong">来源归属（source）永久不变</b>。该用户后续入职任意公司，本公司仍得人才流转费 8 元/人/天。</p>
          </div>
        </div>
      </div>
    </div>

    <AppActionDialogs ref="dialogs" @done="load" />
  </div>
</template>
