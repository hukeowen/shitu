<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMeStore } from '@/stores/me'
import ProjectTab from './projects/ProjectTab.vue'
import ContractTab from './projects/ContractTab.vue'

/** T-301 项目与甲方：项目 ↔ 甲方企业 ↔ 合作合同 */
const meStore = useMeStore()
const route = useRoute()
const router = useRouter()
const canContract = computed(() => meStore.can('CLIENT_CONTRACT_MANAGE'))
const tab = ref<string>(route.query.tab === 'contracts' && canContract.value ? 'contracts' : 'projects')

function onTab(name: string | number) {
  router.replace({ query: { ...route.query, tab: String(name) } })
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>项目与甲方</h2>
        <p>项目归属于甲方企业；岗位只能发布在「有审核通过且在有效期内合作合同」的甲方项目下</p>
      </div>
      <span class="spacer" />
    </div>

    <div class="note note--info" style="margin-bottom: 14px">
      <b>发布岗位前的准备：</b>① 新建甲方企业与项目 → ② 在「合作合同」上传与该甲方签订的合同（平台审核）→ ③ 合同审核通过且在有效期内，该甲方下的项目即可发布岗位。
    </div>

    <div class="card">
      <el-tabs v-model="tab" class="tabs" @tab-change="onTab">
        <el-tab-pane label="项目" name="projects">
          <ProjectTab @go-contracts="tab = 'contracts'" />
        </el-tab-pane>
        <el-tab-pane v-if="canContract" label="合作合同" name="contracts" lazy>
          <ContractTab />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.tabs :deep(.el-tabs__header) { margin: 0; padding: 0 16px; }
.tabs :deep(.el-tabs__item) { height: 44px; font-weight: 600; }
</style>
