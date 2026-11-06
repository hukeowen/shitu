<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type LaborContractView } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { CONTRACT_TAG_CLASS, sortContracts, termText } from '@/utils/contract'
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
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="body">
        <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
        <div v-else-if="loadError" class="page-state">
          <van-empty image="error" :description="loadError">
            <van-button round type="primary" size="small" @click="load">重新加载</van-button>
          </van-empty>
        </div>
        <div v-else-if="!list.length" class="page-state">
          <van-empty description="还没有劳动合同">
            <p class="t-xs">面试通过、驻场完成入职确权后，合同将在这里签署和留存</p>
          </van-empty>
        </div>

        <template v-else>
          <div class="pad-x" style="padding-top: 12px">
            <div class="t-xs">共 {{ list.length }} 份<template v-if="effective"> · {{ effective }} 份生效中</template> · 按签署时间倒序，历史合同全部保留</div>
          </div>
          <div class="pad stack">
            <article
              v-for="c in list"
              :key="c.contractId"
              class="acard ct"
              :class="{ cur: c.status === 'EFFECTIVE', wait: c.status === 'PENDING_SIGN', dim: c.status !== 'EFFECTIVE' && c.status !== 'PENDING_SIGN' }"
              @click="open(c)"
            >
              <div class="row-b" style="margin-bottom: 10px">
                <span class="tag" :class="CONTRACT_TAG_CLASS[c.status]"><i class="dot"></i>{{ label('ContractStatus', c.status) }}</span>
                <span class="mono t-xs no">{{ c.contractNo }}</span>
              </div>
              <div class="ct-t">{{ c.title }}</div>
              <div class="t-sm" style="margin-top: 2px">签约公司：{{ c.companyName || '—' }}</div>
              <div class="divider" style="margin: 10px 0"></div>
              <dl>
                <div class="kv"><dt>签署时间</dt><dd class="num">{{ c.signedAt ? formatServerTime(c.signedAt, false) : '待签署' }}</dd></div>
                <div class="kv"><dt>合同期限</dt><dd class="num">{{ termText(c) }}</dd></div>
                <div class="kv"><dt>派遣岗位</dt><dd>{{ c.jobTitle || '—' }}</dd></div>
              </dl>
              <div class="row" style="gap: 9px; margin-top: 12px">
                <van-button v-if="c.status === 'PENDING_SIGN'" type="primary" size="small" class="flex1 b" @click.stop="open(c)">去签署</van-button>
                <template v-else>
                  <van-button size="small" class="flex1 b" @click.stop="open(c)">查看详情</van-button>
                  <van-button size="small" class="flex1 b" disabled @click.stop>下载 PDF · 即将上线</van-button>
                </template>
              </div>
            </article>

            <div class="note note--info">
              <b>状态联动：</b>入职签约 → 新合同「{{ label('ContractStatus', 'EFFECTIVE') }}」；离职 → 「{{ label('ContractStatus', 'TERMINATED') }}」；跨公司流转后<b>历史合同全部保留</b>，不因归属变更而删除。
            </div>
            <div class="page-bottom-gap"></div>
          </div>
        </template>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.cts { min-height: 100vh; background: var(--surface-2); }
.body { min-height: 70vh; }
.ct.cur { border-color: var(--ok-line); }
.ct.wait { border-color: var(--warn-line); }
.ct.dim { opacity: .82; }
.ct-t { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.no { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.b { border-radius: 9px !important; height: 36px !important; }
</style>
