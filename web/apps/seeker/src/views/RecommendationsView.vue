<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, seekerApi, type MyRecommendation } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { formatRelative } from '@/utils/time'

/**
 * 专属顾问推荐（T-203 用户侧）：私域用户匹配度不足时，归属公司的人才经纪人人工挑选岗位推荐给你。
 * 「去报名」= 接受推荐后进入岗位详情，走正常的告知书 + 实名 + 报名流程；「不考虑」= 告诉顾问换一个。
 */
const router = useRouter()
const auth = useAuthStore()
const journey = useJourney()

const loading = ref(!journey.recsLoaded)
const loadError = ref('')
const refreshing = ref(false)
const busy = ref<number | null>(null)

async function load() {
  loadError.value = ''
  try {
    await journey.loadRecs()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
if (!auth.profile) void auth.loadProfile().catch(() => undefined)
async function onRefresh() {
  await load()
  refreshing.value = false
}

const list = computed(() => journey.recs)
const company = computed(() => auth.profile?.boundCompanyName || '')
const status = computed(() => auth.profile?.status)
const appliedLock = computed(() => status.value === 'PENDING_INTERVIEW' || status.value === 'PENDING_CONFIRM')
const lockNote = computed(() =>
  status.value === 'PENDING_CONFIRM' ? '你已通过面试、正在办理入职，暂时不能报名其他岗位。' : '你已有进行中的报名，面试结果出来前不能报名其他岗位。',
)
/** 只有「有专属顾问跟进、且没有进行中的报名 / 未在岗」的用户，空列表才是「正在挑选」 */
const picking = computed(() => !!company.value && auth.profile?.domainTag === 'PRIVATE' && !appliedLock.value && status.value !== 'EMPLOYED')
const emptyText = computed<{ t: string; d: string }>(() => {
  if (picking.value) return { t: '专属顾问正在为你挑选岗位', d: '有推荐时会通过站内消息通知你，请保持手机畅通' }
  if (status.value === 'EMPLOYED') return { t: '暂无顾问推荐', d: '你已入职在岗。顾问推荐只在求职期间、AI 问薪没有匹配到合适岗位时出现。' }
  if (status.value === 'PENDING_CONFIRM') return { t: '暂无顾问推荐', d: '你已通过面试、正在办理入职，这期间顾问不会推荐新的岗位。' }
  if (appliedLock.value) return { t: '暂无顾问推荐', d: '你已有进行中的报名，面试结果出来前顾问不会推荐新的岗位。' }
  return { t: '暂无顾问推荐', d: '当你由某家劳务公司的专属顾问服务、且 AI 问薪没有匹配到合适岗位时，顾问会人工为你挑选岗位，并在这里展示。' }
})

const DECISION: Record<MyRecommendation['decision'], { t: string; cls: string }> = {
  PENDING: { t: '待你确认', cls: 'tag-warn' },
  ACCEPTED: { t: '已接受', cls: 'tag-ok' },
  DECLINED: { t: '不考虑', cls: 'tag-muted' },
}

function openJob(r: MyRecommendation) {
  void router.push({ path: `/jobs/${r.jobId}`, query: { from: 'rec' } })
}

async function accept(r: MyRecommendation) {
  if (busy.value) return
  if (r.decision === 'ACCEPTED') return openJob(r)
  busy.value = r.id
  try {
    await seekerApi.decideRecommendation(r.id, true)
    journey.setDecision(r.id, 'ACCEPTED')
    openJob(r)
  } catch (e) {
    showToast(errorMessage(e, '操作失败，请稍后重试'))
  } finally {
    busy.value = null
  }
}

async function decline(r: MyRecommendation) {
  if (busy.value) return
  try {
    await showConfirmDialog({ title: '不考虑这个岗位？', message: '顾问会收到你的反馈，并继续为你挑选其他岗位。', confirmButtonText: '不考虑', cancelButtonText: '再想想' })
  } catch {
    return
  }
  busy.value = r.id
  try {
    await seekerApi.decideRecommendation(r.id, false)
    journey.setDecision(r.id, 'DECLINED')
    showToast('已反馈给专属顾问')
  } catch (e) {
    showToast(errorMessage(e, '操作失败，请稍后重试'))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="recs">
    <AppBar title="专属顾问推荐" fallback="/" />
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="pad stack body">
        <section class="acard intro">
          <div class="row" style="gap: 10px">
            <div class="avatar avatar--o">{{ (company || '顾').slice(0, 1) }}</div>
            <div class="flex1">
              <b class="i-t">{{ company ? `${company} · 专属顾问` : '专属顾问' }}</b>
              <div class="t-xs">根据你的求职画像人工挑选，确认后按正常流程实名 + 报名</div>
            </div>
          </div>
        </section>

        <div v-if="appliedLock && list.length" class="note note--warn">{{ lockNote }}</div>

        <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
        <div v-else-if="loadError" class="page-state">
          <van-empty image="error" :description="loadError">
            <van-button round type="primary" size="small" @click="load">重新加载</van-button>
          </van-empty>
        </div>
        <div v-else-if="!list.length" class="page-state">
          <van-empty :description="emptyText.t">
            <p class="t-xs empty-d">{{ emptyText.d }}</p>
            <van-button v-if="!picking && !appliedLock && status !== 'EMPLOYED'" round type="primary" size="small" style="margin-top: 14px" @click="router.push('/match')">去 AI 问薪</van-button>
          </van-empty>
        </div>

        <template v-else>
          <article v-for="r in list" :key="r.id" class="job rec" :class="{ dim: r.decision === 'DECLINED' }">
            <div class="job-top" @click="r.decision !== 'DECLINED' && openJob(r)">
              <div class="job-title">
                <b>{{ r.jobTitle || '推荐岗位' }}</b>
                <span class="tag" :class="DECISION[r.decision].cls">{{ DECISION[r.decision].t }}</span>
              </div>
              <div class="t-sm" style="margin-top: 3px">{{ r.companyName || '—' }}</div>
              <div v-if="r.note" class="memo"><b>顾问说：</b>{{ r.note }}</div>
            </div>
            <div class="job-ft">
              <span class="co">推荐于 {{ formatRelative(r.createdAt) }}</span>
              <template v-if="r.decision === 'PENDING'">
                <van-button size="small" class="act" :disabled="busy === r.id" @click="decline(r)">不考虑</van-button>
                <van-button size="small" type="primary" class="act" :loading="busy === r.id" :disabled="appliedLock" @click="accept(r)">去报名</van-button>
              </template>
              <van-button v-else-if="r.decision === 'ACCEPTED'" size="small" type="primary" plain class="act" @click="openJob(r)">查看岗位</van-button>
            </div>
          </article>
        </template>

        <div v-if="list.length || picking" class="note note--info">
          推荐岗位与 AI 问薪结果一样，需先同意求职告知书并完成实名认证才能报名。都不满意时，顾问可为你开放全平台岗位匹配，届时可匹配全平台岗位。
        </div>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.recs { min-height: 100vh; background: var(--surface-2); }
.body { min-height: 50vh; align-content: start; }
.empty-d { max-width: 280px; margin: 0 auto; line-height: 1.7; }
.page-state { padding-top: 30px; }
.intro { background: linear-gradient(160deg, #7A3410, #2B1408); border: 0; color: #fff; }
.intro .t-xs { color: rgba(255, 255, 255, .6); margin-top: 2px; }
.i-t { font-size: 14px; display: block; }
.rec .job-title .tag { flex: none; }
.rec.dim { opacity: .65; }
.memo { margin-top: 9px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--signal-50); font-size: 12.5px; line-height: 1.6; color: var(--ink-700); }
.memo b { color: var(--signal-700); }
.act { flex: none; border-radius: 8px !important; padding: 0 12px !important; }
</style>
