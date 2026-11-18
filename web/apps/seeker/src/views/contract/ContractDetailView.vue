<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type KycView, type LaborContractView } from '@shitu/api-client'
import { IconFileText, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { CONTRACT_TONE, daysLeft, termMonths, termText } from '@/utils/contract'
import { formatServerTime } from '@/utils/time'

/** S-28 合同详情（C-503）：编号、期限、岗位、签约主体、签署记录；接口没有合同文件地址，文件需联系驻场老师获取 */
const route = useRoute()
const router = useRouter()
const { label } = useDict()

const c = ref<LaborContractView | null>(null)
const kyc = ref<KycView | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [all, k] = await Promise.all([seekerApi.contracts(), seekerApi.kyc().catch(() => null)])
    kyc.value = k
    c.value = all.find((x) => x.contractId === route.params.id) ?? null
    if (c.value?.status === 'PENDING_SIGN') void router.replace('/contracts/sign')
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const months = computed(() => (c.value ? termMonths(c.value) : null))
const endText = computed(() => {
  const x = c.value
  if (!x) return ''
  if (x.status === 'EFFECTIVE') {
    if (!x.termEnd) return '无固定期限'
    const d = daysLeft(x.termEnd)
    return d ? `剩余 ${d} 天到期` : ''
  }
  if (x.status === 'EXPIRED') return '合同期满'
  return ''
})

const records = computed(() => {
  const x = c.value
  if (!x) return []
  // 签了的每一步是「已完成」；期满、解除、终止、作废是合同走到头，标「已结束」
  const out: { t: string; m: string; cls: string }[] = [{ t: '合同生成，发起电子签署', m: formatServerTime(x.createdAt), cls: 'done' }]
  if (x.signedAt) {
    out.push({ t: '乙方电子签名完成', m: formatServerTime(x.signedAt), cls: 'done' })
    out.push({ t: '合同生效并归档', m: `${formatServerTime(x.signedAt)} · ${x.companyName || '甲方'}`, cls: 'done' })
  }
  if (x.status === 'EXPIRED') out.push({ t: '合同期满', m: formatServerTime(x.termEnd, false), cls: '' })
  if (x.status === 'TERMINATED' || x.status === 'DISSOLVED') out.push({ t: `合同${label('ContractStatus', x.status)}`, m: '', cls: '' })
  if (x.status === 'VOIDED') out.push({ t: '签署邀请已作废', m: '', cls: '' })
  return out
})
const partyB = computed(() => (kyc.value?.kycStatus === 'VERIFIED' ? kyc.value.realNameMasked : '') || '本人')
</script>

<template>
  <div class="cd">
    <AppBar title="合同详情" fallback="/contracts" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>
    <div v-else-if="!c" class="state-block">
      <IconFileText :size="48" :stroke-width="1.5" />
      <div class="state-block-t">合同不存在</div>
      <div class="state-block-d">可能已作废，或不是你名下的合同</div>
      <van-button type="primary" @click="router.replace('/contracts')">返回我的合同</van-button>
    </div>

    <div v-else class="pad stack">
      <section class="acard">
        <div class="item-hd">
          <h1>{{ c.title }}</h1>
          <span class="status-tag" :class="CONTRACT_TONE[c.status]">{{ label('ContractStatus', c.status) }}</span>
        </div>
        <p v-if="endText" class="item-meta">{{ endText }}</p>
        <dl class="facts line">
          <div class="kv"><dt>合同编号</dt><dd class="code">{{ c.contractNo }}</dd></div>
          <div class="kv top"><dt>合同期限</dt><dd>{{ termText(c) }}<span v-if="months" class="sub">共 {{ months }} 个月</span></dd></div>
          <div class="kv"><dt>签署时间</dt><dd>{{ c.signedAt ? formatServerTime(c.signedAt) : '—' }}</dd></div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>岗位信息</h4></div>
        <dl class="facts">
          <div class="kv"><dt>岗位</dt><dd>{{ c.jobTitle || '—' }}</dd></div>
          <div class="kv"><dt>用工项目</dt><dd>{{ c.projectName || '—' }}</dd></div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>签约主体</h4></div>
        <dl class="facts">
          <div class="kv top"><dt>甲方（用人单位）</dt><dd>{{ c.companyName || '—' }}</dd></div>
          <div class="kv top">
            <dt>乙方（劳动者）</dt>
            <dd>{{ partyB }}<span v-if="kyc?.idCardMasked" class="sub">{{ kyc.idCardMasked }}</span></dd>
          </div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>签署记录</h4></div>
        <ul class="tl">
          <li v-for="r in records" :key="r.t" :class="r.cls">
            <div class="tl-t">{{ r.t }}<span class="status-tag" :class="{ 'status-tag--success': r.cls === 'done' }">{{ r.cls === 'done' ? '已完成' : '已结束' }}</span></div>
            <div v-if="r.m" class="tl-m">{{ r.m }}</div>
          </li>
        </ul>
      </section>

      <p class="foot">合同文件由电子签平台存证，如需纸质或电子版请联系驻场老师</p>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.cd { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.item-hd h1 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); overflow-wrap: anywhere; }
.facts.line { margin-top: var(--space-3); border-top: 1px solid var(--divider); }
.facts dd { word-break: normal; overflow-wrap: anywhere; }
.kv.top { align-items: flex-start; }
.code { font-family: var(--font-mono); }
.sub { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); line-height: 20px; color: var(--text-3); }
.tl-t .status-tag { margin-left: var(--space-2); vertical-align: 1px; }
.tl-m { font-size: var(--font-size-aux); line-height: 20px; }
.foot { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-align: center; }
</style>
