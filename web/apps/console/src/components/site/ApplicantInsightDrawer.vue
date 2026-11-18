<script setup lang="ts">
import { ref, watch } from 'vue'
import { errorMessage, tenantApi, useDict, type ApplicationInsight, type SiteApplication } from '@shitu/api-client'
import { IconCircleExclamationPoint } from '@shitu/ui-icons'
import DictTag from '@/components/DictTag.vue'
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
  <el-drawer v-model="open" :title="app ? app.seekerName + ' 的画像' : '求职者画像'" size="560px" class="insight-drawer" destroy-on-close>
    <div v-loading="loading" class="wrap">
      <div v-if="error" class="fail">
        <IconCircleExclamationPoint :size="48" class="fail-i" />
        <h4 class="fail-t">{{ error }}</h4>
        <p class="hint">请检查网络后重新加载</p>
        <el-button type="primary" @click="load">重新加载</el-button>
      </div>
      <template v-else-if="data && app">
        <dl class="job"><dt>报名岗位</dt><dd><b>{{ app.jobTitle }}</b><span class="hint"> · {{ app.projectName }}</span></dd></dl>

        <h4>画像标签</h4>
        <div v-if="data.profileTags.length" class="chips"><span v-for="t in data.profileTags" :key="t" class="status-tag">{{ t }}</span></div>
        <p v-else class="hint">没有答题记录（由驻场 / 经纪人推荐报名）</p>

        <h4>匹配记录</h4>
        <p v-if="data.matchRecords.length === 0" class="hint">没有匹配到本公司岗位的记录</p>
        <div v-for="(m, i) in data.matchRecords" :key="i" class="rec">
          <div class="rec-hd"><span class="hint">{{ fmtDateTime(m.matchedAt) }}</span><span v-if="m.source" class="status-tag status-tag--success">本次报名来自这次匹配</span></div>
          <div v-for="j in m.jobs" :key="j.jobId" class="rec-job">
            <div class="rec-t"><span :class="{ strong: j.appliedJob }">{{ j.title }}</span><b class="score">{{ Number(j.matchScore).toFixed(0) }}%</b></div>
            <div v-if="j.reasonText" class="hint">{{ j.reasonText }}</div>
          </div>
        </div>

        <h4>在本公司的历史报名</h4>
        <p v-if="data.history.length === 0" class="hint">这是第一次报名本公司岗位</p>
        <div v-for="h in data.history" :key="h.applicationId" class="his">
          <div class="his-hd"><b>{{ h.jobTitle }}</b> <DictTag type="ApplicationStatus" :value="h.status" /></div>
          <div class="hint">{{ fmtDateTime(h.createdAt) }} 报名<template v-if="h.endReason"> · {{ label('LifecycleEvent', h.endReason) }}</template></div>
        </div>
        <p class="hint foot">只显示本公司的岗位与报名记录。</p>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.wrap { min-height: 160px; font-size: var(--font-size-body); color: var(--text-1); }
.job { display: flex; gap: var(--space-3); margin: 0; }
.job dt { color: var(--text-2); }
.job dd { margin: 0; }
h4 { margin: var(--space-6) 0 var(--space-3); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.hint { margin: 0; font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-3); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.rec { padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); margin-bottom: var(--space-2); }
.rec-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); }
.rec-job { padding: var(--space-2) 0; border-top: 1px solid var(--divider); }
.rec-t { display: flex; justify-content: space-between; gap: var(--space-3); }
.rec-t .strong { font-weight: var(--font-weight-semibold); }
.score { font-weight: var(--font-weight-semibold); }
.his { padding: var(--space-2) 0; border-bottom: 1px solid var(--divider); line-height: 1.8; }
.his-hd { display: flex; align-items: center; gap: var(--space-2); }
.foot { margin-top: var(--space-4); }
.fail { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) 0; text-align: center; }
.fail-i { color: var(--text-3); }
.fail-t { margin: var(--space-2) 0 0; }
</style>
