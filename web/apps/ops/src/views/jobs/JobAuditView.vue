<script setup lang="ts">
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
      <div class="spacer" />
      <span class="ref">原型 <b>P-04</b></span>
    </div>

    <el-tabs v-model="tab" class="tabs">
      <el-tab-pane name="jobs">
        <template #label>岗位审核<span v-if="pending.counts?.jobs" class="cnt">{{ pending.counts.jobs }}</span></template>
        <JobQueue v-if="tab === 'jobs'" />
      </el-tab-pane>
      <el-tab-pane name="contracts">
        <template #label>合同备案<span v-if="pending.counts?.contracts" class="cnt">{{ pending.counts.contracts }}</span></template>
        <ContractQueue v-if="tab === 'contracts'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.cnt { margin-left: 6px; font-family: var(--f-mono); font-size: 10px; background: var(--danger); color: #fff; padding: 0 5px; height: 15px; line-height: 15px; border-radius: 8px; display: inline-block; }
</style>
