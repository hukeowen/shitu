<script setup lang="ts">
import { ref, watch } from 'vue'
import { errorMessage, tenantApi, useDict, type ApplicationInsight, type SiteApplication } from '@shitu/api-client'
import { fmtDateTime } from '@/utils/format'

/** 求职者画像（M-04）：画像标签、匹配记录、在本公司的历史报名。只含本公司的岗位与报名。 */
const props = defineProps<{ app: SiteApplication | null }>()
const open = defineModel<boolean>({ default: false })
const { label } = useDict()

const data = ref<ApplicationInsight | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  if (!props.app) return
  loading.value = true
  error.value = ''
  data.value = null
  try {
    data.value = await tenantApi.applicationInsight(props.app.applicationId)
  } catch (e) {
    error.value = errorMessage(e, '画像加载失败')
  } finally {
    loading.value = false
  }
}
watch(open, (v) => {
  if (v) void load()
})
</script>

<template>
  <el-drawer v-model="open" :title="app ? app.seekerName + ' 的画像' : '求职者画像'" size="480px" destroy-on-close>
    <div v-loading="loading" class="wrap">
      <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
      <template v-else-if="data && app">
        <div class="t-xs">报名岗位</div>
        <div class="job"><b>{{ app.jobTitle }}</b><span class="t-xs"> · {{ app.projectName }}</span></div>

        <h4>画像标签</h4>
        <div v-if="data.profileTags.length" class="chips"><span v-for="t in data.profileTags" :key="t" class="tag">{{ t }}</span></div>
        <div v-else class="t-xs">没有答题记录（由驻场 / 经纪人推荐报名）</div>

        <h4>匹配记录</h4>
        <div v-if="data.matchRecords.length === 0" class="t-xs">没有匹配到本公司岗位的记录</div>
        <div v-for="(m, i) in data.matchRecords" :key="i" class="rec">
          <div class="rec-hd"><span class="mono t-xs">{{ fmtDateTime(m.matchedAt) }}</span><span v-if="m.source" class="tag tag--ok">本次报名来自这次匹配</span></div>
          <div v-for="j in m.jobs" :key="j.jobId" class="rec-job">
            <div class="rec-t"><span :class="{ strong: j.appliedJob }">{{ j.title }}</span><b class="num">{{ Number(j.matchScore).toFixed(0) }}%</b></div>
            <div v-if="j.reasonText" class="t-xs">{{ j.reasonText }}</div>
          </div>
        </div>

        <h4>在本公司的历史报名</h4>
        <div v-if="data.history.length === 0" class="t-xs">这是第一次报名本公司岗位</div>
        <div v-for="h in data.history" :key="h.applicationId" class="his">
          <div><b>{{ h.jobTitle }}</b> <span class="tag">{{ label('ApplicationStatus', h.status) }}</span></div>
          <div class="t-xs"><span class="mono">{{ fmtDateTime(h.createdAt) }}</span> 报名<template v-if="h.endReason"> · {{ label('LifecycleEvent', h.endReason) }}</template></div>
        </div>
        <div class="note">只显示本公司的岗位与报名记录。</div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.wrap { min-height: 160px; }
.job { margin-top: 2px; }
h4 { margin: 20px 0 8px; font-size: 13px; font-weight: 700; color: var(--ink-900); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rec { padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-sm); margin-bottom: 8px; }
.rec-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.rec-job { padding: 5px 0; border-top: 1px dashed var(--line); }
.rec-t { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.rec-t .strong { font-weight: 700; }
.his { padding: 8px 0; border-bottom: 1px solid var(--line); line-height: 1.8; }
.note { margin-top: 16px; }
</style>
