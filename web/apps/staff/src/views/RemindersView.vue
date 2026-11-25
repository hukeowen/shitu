<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { SiteApplication, SiteApplicationAction } from '@shitu/api-client'
import { IconCircleExclamationPoint, IconInbox } from '@shitu/ui-icons'
import AppActions from '@/components/AppActions.vue'
import FollowUpCard from '@/components/FollowUpCard.vue'
import { useFollowUps } from '@/composables/useFollowUps'
import { useNow } from '@/composables/useNow'
import { STAGE_TEXT, URGENT_MS } from '@/utils/status'

/**
 * M-12 24 小时响应提醒（按剩余时长排序，已超时 / 不足 4 小时整张卡片标红）+ M-09 私域待匹配一键流转至人才经纪人。
 * 合并三类 24h 窗口：私域待匹配（扫码注册未报名）、新报名待知悉（含待面试 / 已到厂）、面试通过待确权。
 * 加载与合并排序在 composables/useFollowUps（工作台「今日待办」共用）。
 */
/** interview（已知悉、待面试）、arrived（已到厂、待录入结果）只出现在「全部」里，徽标与待办页一致；
 * 它们同样有响应时限，工作台的「N 人即将超时」把它们算在内，这里也要列出来，数字才对得上 */
type FilterKey = 'all' | 'private' | 'ack' | 'confirm'
const FILTERS: { key: FilterKey; title: string }[] = [
  { key: 'all', title: '全部' },
  { key: 'private', title: '私域待匹配' },
  { key: 'ack', title: STAGE_TEXT.ack },
  { key: 'confirm', title: STAGE_TEXT.confirm },
]

const route = useRoute()
const router = useRouter()
const now = useNow(30_000)

const asFilter = (v: unknown): FilterKey => (FILTERS.some((f) => f.key === v) ? (v as FilterKey) : 'all')
const filter = ref<FilterKey>(asFilter(route.query.f))
watch(filter, (f) => void router.replace({ query: { ...route.query, f: f === 'all' ? undefined : f } }))
watch(
  () => route.query.f,
  (v) => (filter.value = asFilter(v)),
)

const { items, loadError, appsForbidden, blocked, load: loadFollowUps, onRejected, transfer } = useFollowUps()
const loading = ref(true)
const refreshing = ref(false)

async function load() {
  await loadFollowUps()
  loading.value = false
}
void load()
function reload() {
  loading.value = true
  void load()
}
async function onRefresh() {
  try {
    await load()
  } finally {
    refreshing.value = false
  }
}

const shown = computed(() => (filter.value === 'all' ? items.value : items.value.filter((i) => i.kind === filter.value)))
const count = (k: FilterKey) => (k === 'all' ? items.value.length : items.value.filter((i) => i.kind === k).length)
const urgentCount = computed(() => items.value.filter((i) => i.deadline != null && i.deadline - now.value < URGENT_MS).length)

function onDone() {
  blocked.value = {}
  void load()
}

// ---------- 报名操作 ----------
const actions = ref<InstanceType<typeof AppActions> | null>(null)
function run(a: SiteApplication, key: SiteApplicationAction) {
  void actions.value?.run(key, a)
}
</script>

<template>
  <div class="rem">
    <van-nav-bar title="跟进提醒" safe-area-inset-top fixed placeholder z-index="30" />
    <van-tabs v-model:active="filter" sticky offset-top="44" shrink class="seg-tabs">
      <van-tab v-for="f in FILTERS" :key="f.key" :name="f.key">
        <template #title>{{ f.title }}<span v-if="!loading" class="n">{{ count(f.key) }}</span></template>
      </van-tab>
    </van-tabs>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else-if="loadError && !items.length" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ loadError }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reload">重新加载</van-button>
      </div>
      <div v-else class="pad stack">
        <section class="acard sum">
          <div class="metrics two">
            <div class="metric"><b>{{ items.length }}</b><span>24 小时窗口内待跟进</span></div>
            <div class="metric"><b :class="{ red: urgentCount > 0 }">{{ urgentCount }}</b><span>4 小时内将超时</span></div>
          </div>
          <p class="sum-d">超时后系统被动释放至公域，该用户可被全平台其他公司匹配，本次获客成本作废。</p>
        </section>

        <p v-if="loadError" class="tipbar tipbar--danger" role="alert">
          <IconCircleExclamationPoint :size="18" /><span class="flex1">{{ loadError }}，下拉可重试</span>
        </p>

        <FollowUpCard
          v-for="i in shown"
          :key="i.key"
          :item="i"
          :now="now"
          :blocked="blocked[i.a?.applicationId ?? i.p?.userId ?? '']"
          @run="run"
          @transfer="transfer"
        />

        <div v-if="!shown.length && !loadError" class="state-block">
          <IconInbox :size="48" />
          <p class="state-block-t">{{ filter === 'all' ? '暂无 24 小时窗口内待跟进的用户' : '暂无该类待跟进' }}</p>
          <p class="state-block-d">新报名、面试通过和扫码注册的用户会出现在这里</p>
        </div>
        <p v-if="appsForbidden" class="foot">报名待办仅对驻场 / 项目经理开放</p>
        <p class="foot">提醒频率：白天每 6 小时 1 次 · 夜间每 12 小时 1 次；推送驻场 · 项目经理 · 老板三方同步</p>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>

    <AppActions ref="actions" @done="onDone" @rejected="onRejected" />
  </div>
</template>

<style scoped>
.rem { min-height: calc(100vh - var(--tabbar-h, 0px)); }
.n { margin-left: var(--space-1); }
.pr { min-height: calc(100vh - 140px - var(--tabbar-h, 0px)); }
.metrics.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.metrics .red { color: var(--danger-text); }
.sum-d { margin-top: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.foot { padding: 0 var(--space-3); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-align: center; }
</style>
