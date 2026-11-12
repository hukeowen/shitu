<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type MyRecommendation } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInbox, IconLock, IconTriangleExclamationPoint } from '@shitu/ui-icons'
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
/** 正在提交的答复：哪一条、哪个按钮 */
const busy = ref<{ id: number; act: 'accept' | 'decline' } | null>(null)
/** 后端拒绝过的报名（如已有进行中的报名）：按钮置灰并把原因写在卡片上；下拉刷新后重新判断 */
const refused = ref<Record<number, string>>({})

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
function retry() {
  loading.value = true
  void load()
}
if (!auth.profile) void auth.loadProfile().catch(() => undefined)
async function onRefresh() {
  refused.value = {}
  await load()
  refreshing.value = false
}

const list = computed(() => journey.recs)
const company = computed(() => auth.profile?.boundCompanyName || '')
const appliedLock = computed(() => auth.profile?.status === 'PENDING_INTERVIEW' || auth.profile?.status === 'PENDING_CONFIRM')

const DECISION: Record<MyRecommendation['decision'], { t: string; cls: string }> = {
  PENDING: { t: '待你确认', cls: 'status-tag--warning' },
  ACCEPTED: { t: '已接受', cls: 'status-tag--success' },
  DECLINED: { t: '不考虑', cls: 'status-tag--neutral' },
}
/** 一屏只有一个主色实心按钮：第一条待确认的推荐 */
const firstPendingId = computed(() => list.value.find((r) => r.decision === 'PENDING')?.id)

function canOpen(r: MyRecommendation) {
  return r.decision !== 'DECLINED'
}
function openJob(r: MyRecommendation) {
  void router.push({ path: `/jobs/${r.jobId}`, query: { from: 'rec' } })
}

async function accept(r: MyRecommendation) {
  if (busy.value) return
  if (r.decision === 'ACCEPTED') return openJob(r)
  busy.value = { id: r.id, act: 'accept' }
  try {
    await seekerApi.decideRecommendation(r.id, true)
    journey.setDecision(r.id, 'ACCEPTED')
    openJob(r)
  } catch (e) {
    // 先复位再提示：提示出来时按钮不能还在转
    busy.value = null
    const msg = errorMessage(e, '操作失败，请稍后重试')
    // 业务上被拒（不是网络问题）：再点也一样，置灰并留下原因；档案状态可能已变，顺手刷新
    if (isApiError(e)) {
      refused.value[r.id] = msg
      void auth.loadProfile().catch(() => undefined)
    }
    showToast(msg)
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
  busy.value = { id: r.id, act: 'decline' }
  try {
    await seekerApi.decideRecommendation(r.id, false)
    journey.setDecision(r.id, 'DECLINED')
    busy.value = null
    showToast('已反馈给专属顾问')
  } catch (e) {
    busy.value = null
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
          <div class="avatar avatar--lg">{{ (company || '顾').slice(0, 1) }}</div>
          <div class="flex1">
            <h2>{{ company ? `${company} · 专属顾问` : '专属顾问' }}</h2>
            <p>根据你的求职画像人工挑选，确认后按正常流程实名 + 报名</p>
          </div>
        </section>

        <section v-if="appliedLock" class="tipbar tipbar--warn">
          <IconLock :size="20" />
          <div class="flex1">
            <div class="tipbar-t">你已有进行中的报名。</div>
            <div class="tipbar-d">面试结果出来前不能报名其他岗位。</div>
          </div>
        </section>

        <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
        <div v-else-if="loadError" class="state-block">
          <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
          <div class="state-block-t">加载失败</div>
          <div class="state-block-d">{{ loadError }}</div>
          <van-button type="primary" @click="retry">重新加载</van-button>
        </div>
        <div v-else-if="!list.length" class="state-block">
          <IconInbox :size="48" :stroke-width="1.5" />
          <div class="state-block-t">专属顾问正在为你挑选岗位</div>
          <div class="state-block-d">有推荐时会通过站内消息通知你，请保持手机畅通</div>
        </div>

        <template v-else>
          <article v-for="r in list" :key="r.id" class="acard rec">
            <div
              class="rec-top"
              :class="{ tap: canOpen(r) }"
              :role="canOpen(r) ? 'button' : undefined"
              :tabindex="canOpen(r) ? 0 : undefined"
              @click="canOpen(r) && openJob(r)"
              @keydown.enter="canOpen(r) && openJob(r)"
              @keydown.space.prevent="canOpen(r) && openJob(r)"
            >
              <div class="item-hd">
                <h3>{{ r.jobTitle || '推荐岗位' }}</h3>
                <span class="status-tag" :class="DECISION[r.decision].cls">{{ DECISION[r.decision].t }}</span>
              </div>
              <p class="item-sub">{{ r.companyName || '—' }}</p>
              <div v-if="r.note" class="memo">
                <b>顾问说</b>
                <p>{{ r.note }}</p>
              </div>
            </div>
            <div class="rec-ft">
              <span class="item-meta flex1">推荐于 {{ formatRelative(r.createdAt) }}</span>
              <template v-if="r.decision === 'PENDING'">
                <van-button class="act" :loading="busy?.id === r.id && busy.act === 'decline'" loading-text="提交中…" :disabled="!!busy && !(busy.id === r.id && busy.act === 'decline')" @click="decline(r)">不考虑</van-button>
                <van-button
                  :type="r.id === firstPendingId ? 'primary' : 'default'"
                  class="act"
                  :class="{ second: r.id !== firstPendingId }"
                  :loading="busy?.id === r.id && busy.act === 'accept'"
                  loading-text="提交中…"
                  :disabled="appliedLock || !!refused[r.id] || (!!busy && !(busy.id === r.id && busy.act === 'accept'))"
                  @click="accept(r)"
                >
                  去报名
                </van-button>
              </template>
              <!-- 卡片上半部分已经能打开岗位，这颗不再单独占一个键盘焦点 -->
              <van-button v-else-if="r.decision === 'ACCEPTED'" class="act second" tabindex="-1" @click="openJob(r)">查看岗位</van-button>
            </div>
            <p v-if="refused[r.id] && r.decision === 'PENDING'" class="why"><IconCircleExclamationPoint :size="16" />暂时不能报名：{{ refused[r.id] }}</p>
          </article>
          <p class="list-end">没有更多了</p>
        </template>

        <div class="note">
          推荐岗位与 AI 问薪结果一样，需先同意求职告知书并完成实名认证才能报名。都不满意时，顾问可为你开放全平台岗位匹配，届时可匹配全平台岗位。
        </div>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.recs { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.body { min-height: 70vh; align-content: start; }
.page-state { padding-top: var(--space-8); }
.intro { display: flex; align-items: center; gap: var(--space-3); }
.intro h2 { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); line-height: 24px; color: var(--text-1); }
.intro p { margin-top: 2px; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.tap { cursor: pointer; }
.tap:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--radius-tag); }
.memo { margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--primary-bg); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.memo b { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--primary-text); }
.rec-ft { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.rec-ft .item-meta { margin-top: 0; }
.act { flex: none; }
.why { display: flex; align-items: flex-start; gap: var(--space-1); margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--warning-text); }
.why svg { flex: none; margin-top: 2px; }
.second { border-color: var(--primary-line); color: var(--primary-text); }
</style>
