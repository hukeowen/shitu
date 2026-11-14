<script setup lang="ts">
/** 岗位审核 · 合同备案（第 8 类审核处理：标签页 → 表格 → 岗位抽屉 / 表格里审核合同） */
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePendingStore } from '@/stores/pending'
import ContractQueue from './ContractQueue.vue'
import JobQueue from './JobQueue.vue'

type Tab = 'jobs' | 'contracts'
const route = useRoute()
const router = useRouter()
const pending = usePendingStore()

const tab = ref<Tab>(route.query.tab === 'contracts' ? 'contracts' : 'jobs')
watch(tab, (t) => router.replace({ query: { ...route.query, tab: t } }))
watch(
  () => route.query.tab,
  (t) => {
    tab.value = t === 'contracts' ? 'contracts' : 'jobs'
  },
)
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>岗位审核 · 合同备案</h2><p>劳务公司发布岗位前必须有与甲方审核通过且在有效期内的合作合同；岗位审核通过后进入匹配池</p></div>
    </div>

    <el-tabs v-model="tab" class="tabs">
      <el-tab-pane name="jobs">
        <template #label>岗位审核<span v-if="pending.counts?.jobs" class="status-tag status-tag--warning cnt">{{ pending.counts.jobs }}</span></template>
        <JobQueue v-if="tab === 'jobs'" />
      </el-tab-pane>
      <el-tab-pane name="contracts">
        <template #label>合同备案<span v-if="pending.counts?.contracts" class="status-tag status-tag--warning cnt">{{ pending.counts.contracts }}</span></template>
        <ContractQueue v-if="tab === 'contracts'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.tabs :deep(.el-tabs__header) { margin-bottom: var(--space-4); }
/* 页签上的待办数：共享状态标签（提醒色），没拿到数据时不显示 */
.cnt { margin-left: var(--space-2); font-variant-numeric: tabular-nums; }
</style>
