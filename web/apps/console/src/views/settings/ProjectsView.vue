<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IconInfo, IconPlus, IconUpload } from '@shitu/ui-icons'
import { useMeStore } from '@/stores/me'
import ProjectTab from './projects/ProjectTab.vue'
import ContractTab from './projects/ContractTab.vue'

/** T-301 项目与甲方：项目 ↔ 甲方企业 ↔ 合作合同（规范第 11 类：页面头 → 标签页 → 白卡片表格，新增按钮在页面头右边） */
const meStore = useMeStore()
const route = useRoute()
const router = useRouter()
const canContract = computed(() => meStore.can('CLIENT_CONTRACT_MANAGE'))
const canManage = computed(() => meStore.can('PROJECT_MANAGE'))
const tab = ref<string>(route.query.tab === 'contracts' && canContract.value ? 'contracts' : 'projects')
const projectTab = ref<InstanceType<typeof ProjectTab>>()
const contractTab = ref<InstanceType<typeof ContractTab>>()

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
      <el-button v-if="tab === 'projects' && canManage" type="primary" @click="projectTab?.openCreate()"><IconPlus :size="16" class="btn-i" />新建项目</el-button>
      <el-button v-else-if="tab === 'contracts'" type="primary" @click="contractTab?.openUpload()"><IconUpload :size="16" class="btn-i" />上传合同</el-button>
    </div>

    <div class="notice-bar prep">
      <IconInfo :size="16" class="notice-bar-i" />
      <span><b>发布岗位前的准备：</b>① 新建甲方企业与项目 → ② 在「合作合同」上传与该甲方签订的合同（平台审核）→ ③ 合同审核通过且在有效期内，该甲方下的项目即可发布岗位。</span>
    </div>

    <div class="card tbl-card">
      <el-tabs v-model="tab" class="tabs" @tab-change="onTab">
        <el-tab-pane label="项目" name="projects">
          <ProjectTab ref="projectTab" @go-contracts="tab = 'contracts'" />
        </el-tab-pane>
        <el-tab-pane v-if="canContract" label="合作合同" name="contracts" lazy>
          <ContractTab ref="contractTab" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.prep { margin-bottom: var(--space-gap); }
.btn-i { margin-right: var(--space-1); }
.tabs :deep(.el-tabs__header) { margin: 0; padding: 0 var(--space-4); }
.tabs :deep(.el-tabs__item) { height: 44px; font-weight: var(--font-weight-semibold); }
</style>
