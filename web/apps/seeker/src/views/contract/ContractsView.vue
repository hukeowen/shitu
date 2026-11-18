<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type LaborContractView } from '@shitu/api-client'
import { IconInbox, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { CONTRACT_TONE, sortContracts, termText } from '@/utils/contract'
import { formatServerTime } from '@/utils/time'

/**
 * S-27 我的合同（C-503）：按签署时间倒序；跨公司流转 / 离职后历史合同全部保留。
 * 状态：生效中 / 已到期 / 已解除 / 已终止（待签署置顶，已作废的签署邀请不展示）。
 */
const router = useRouter()
const { label } = useDict()

const list = ref<LaborContractView[]>([])
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    list.value = sortContracts(await seekerApi.contracts())
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  await load()
  refreshing.value = false
}

const effective = computed(() => list.value.filter((c) => c.status === 'EFFECTIVE').length)
function open(c: LaborContractView) {
  if (c.status === 'PENDING_SIGN') void router.push('/contracts/sign')
  else void router.push(`/contracts/${c.contractId}`)
}
</script>

<template>
  <div class="cts">
    <AppBar title="我的合同" fallback="/me" />
    <van-pull-refresh v-model="refreshing" class="body" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError" class="state-block">
        <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
        <div class="state-block-t">加载失败</div>
        <div class="state-block-d">{{ loadError }}</div>
        <van-button type="primary" @click="retry">重新加载</van-button>
      </div>
      <div v-else-if="!list.length" class="state-block">
        <IconInbox :size="48" :stroke-width="1.5" />
        <div class="state-block-t">还没有劳动合同</div>
        <div class="state-block-d">面试通过、驻场办理入职后，合同将在这里签署和留存</div>
      </div>

      <div v-else class="pad stack">
        <p class="sum">共 {{ list.length }} 份<template v-if="effective"> · {{ effective }} 份生效中</template> · 按签署时间倒序，历史合同全部保留</p>
        <article
          v-for="c in list"
          :key="c.contractId"
          class="acard tap"
          role="button"
          tabindex="0"
          @click="open(c)"
          @keydown.enter="open(c)"
          @keydown.space.prevent="open(c)"
        >
          <div class="item-hd">
            <h3>{{ c.title }}</h3>
            <span class="status-tag" :class="CONTRACT_TONE[c.status]">{{ label('ContractStatus', c.status) }}</span>
          </div>
          <p class="item-sub">签约公司：{{ c.companyName || '—' }}</p>
          <p class="item-meta code">{{ c.contractNo }}</p>
          <dl class="facts">
            <div class="kv"><dt>签署时间</dt><dd>{{ c.signedAt ? formatServerTime(c.signedAt, false) : '待签署' }}</dd></div>
            <div class="kv"><dt>合同期限</dt><dd>{{ termText(c) }}</dd></div>
            <div class="kv"><dt>岗位</dt><dd>{{ c.jobTitle || '—' }}</dd></div>
          </dl>
          <div class="acts">
            <van-button v-if="c.status === 'PENDING_SIGN'" type="primary" tabindex="-1" @click.stop="open(c)">去签署</van-button>
            <van-button v-else tabindex="-1" @click.stop="open(c)">查看详情</van-button>
          </div>
        </article>

        <section class="tipbar">
          <IconInfo :size="20" />
          <div class="flex1"><div class="tipbar-d first"><b class="strong">合同会一直保留。</b>签约入职后合同显示「{{ label('ContractStatus', 'EFFECTIVE') }}」，离职后变为「{{ label('ContractStatus', 'TERMINATED') }}」；即使以后换了公司，以前签过的合同也都能在这里查到。</div></div>
        </section>
        <p class="list-end">没有更多了</p>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.cts { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 60vh; }
.sum { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-wrap: balance; }
.tap { cursor: pointer; }
.tap:active { background: var(--bg-hover); }
.tap:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.code { font-family: var(--font-mono); overflow-wrap: anywhere; }
.facts { margin-top: var(--space-3); border-top: 1px solid var(--divider); }
.facts dd { word-break: normal; overflow-wrap: anywhere; }
/* 卡片底部的操作靠右 */
.acts { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.acts .van-button { min-width: 104px; }
/* 折行时不留孤字 */
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }
</style>
