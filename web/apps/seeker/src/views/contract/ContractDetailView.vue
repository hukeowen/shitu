<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type KycView, type LaborContractView } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { CONTRACT_TAG_CLASS, daysLeft, termMonths, termText } from '@/utils/contract'
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
    if (!c.value) loadError.value = '合同不存在'
    else if (c.value.status === 'PENDING_SIGN') void router.replace('/contracts/sign')
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
  const out: { t: string; m: string; cls: string }[] = [{ t: '合同生成，发起电子签署', m: formatServerTime(x.createdAt), cls: 'done' }]
  if (x.signedAt) {
    out.push({ t: '乙方电子签名完成', m: formatServerTime(x.signedAt), cls: 'done' })
    out.push({ t: '合同生效并归档', m: `${formatServerTime(x.signedAt)} · ${x.companyName || '甲方'}`, cls: 'done' })
  }
  if (x.status === 'EXPIRED') out.push({ t: '合同期满', m: formatServerTime(x.termEnd, false), cls: 'done' })
  if (x.status === 'TERMINATED' || x.status === 'DISSOLVED') out.push({ t: `合同${label('ContractStatus', x.status)}`, m: '', cls: 'done' })
  if (x.status === 'VOIDED') out.push({ t: '签署邀请已作废', m: '', cls: '' })
  return out
})
const partyB = computed(() => (kyc.value?.kycStatus === 'VERIFIED' ? kyc.value.realNameMasked : '') || '本人')
</script>

<template>
  <div class="cd">
    <AppBar title="合同详情" fallback="/contracts" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !c" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round size="small" @click="router.replace('/contracts')">返回我的合同</van-button>
      </van-empty>
    </div>

    <div v-else class="pad stack">
      <section class="acard">
        <div class="row-b" style="margin-bottom: 10px">
          <span class="tag tag--lg" :class="CONTRACT_TAG_CLASS[c.status]"><i class="dot"></i>{{ label('ContractStatus', c.status) }}</span>
          <span class="t-xs">{{ endText }}</span>
        </div>
        <dl>
          <div class="kv"><dt>合同编号</dt><dd class="mono">{{ c.contractNo }}</dd></div>
          <div class="kv"><dt>合同名称</dt><dd>{{ c.title }}</dd></div>
          <div class="kv"><dt>合同期限</dt><dd class="num">{{ termText(c) }}<template v-if="months">（{{ months }} 个月）</template></dd></div>
          <div class="kv"><dt>签署时间</dt><dd class="num">{{ c.signedAt ? formatServerTime(c.signedAt) : '—' }}</dd></div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>岗位信息</h4></div>
        <dl>
          <div class="kv"><dt>岗位</dt><dd>{{ c.jobTitle || '—' }}</dd></div>
          <div class="kv"><dt>用工项目</dt><dd>{{ c.projectName || '—' }}</dd></div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>签约主体</h4></div>
        <dl>
          <div class="kv"><dt>甲方（用人单位）</dt><dd>{{ c.companyName || '—' }}</dd></div>
          <div class="kv">
            <dt>乙方（劳动者）</dt>
            <dd>{{ partyB }}<template v-if="kyc?.idCardMasked"><br /><span class="t-xs mono">{{ kyc.idCardMasked }}</span></template></dd>
          </div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>签署记录</h4></div>
        <ul class="tl">
          <li v-for="r in records" :key="r.t" :class="r.cls">
            <div class="tl-t">{{ r.t }}</div>
            <div v-if="r.m" class="tl-m num">{{ r.m }}</div>
          </li>
        </ul>
      </section>

      <p class="t-xs" style="text-align: center; line-height: 1.7">合同文件由电子签平台存证，如需纸质或电子版请联系驻场老师</p>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.cd { min-height: 100vh; background: var(--surface-2); }
</style>
