<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, tenantApi, useDict, type AdvanceRow } from '@shitu/api-client'
import ReasonDialog from '@/components/ReasonDialog.vue'
import { ADVANCE_TAG, canSiteReview, siteReview } from '@/utils/advance'
import { fmtTime, fmtYuan } from '@/utils/time'

/** M-11 薪酬预支初审：本人发起 → 驻场初审 → 项目经理终审 → 拨款（驳回退回机会） */
type TabKey = 'todo' | 'all'
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const tab = ref<TabKey>(route.query.tab === 'all' ? 'all' : 'todo')
watch(tab, (t) => void router.replace({ query: { ...route.query, tab: t === 'all' ? 'all' : undefined } }))

const rows = shallowRef<AdvanceRow[]>([])
const loading = ref(true)
const loadError = ref('')
const forbidden = ref(false)
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    rows.value = await tenantApi.advances()
  } catch (e) {
    if (isApiError(e) && e.status === 403) forbidden.value = true
    else loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
async function onRefresh() {
  try {
    await load()
  } finally {
    refreshing.value = false
  }
}

const todo = computed(() => rows.value.filter(canSiteReview))
const shown = computed(() => (tab.value === 'todo' ? todo.value : rows.value))
const nowDate = new Date()

const dialog = ref<InstanceType<typeof ReasonDialog> | null>(null)
async function review(a: AdvanceRow, approve: boolean) {
  if (await siteReview(dialog.value, a, approve, fmtYuan(a.amount))) void load()
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="adv">
    <van-nav-bar title="预支初审" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <div class="sticky">
      <div class="atabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'todo'" :class="{ on: tab === 'todo' }" @click="tab = 'todo'">
          待初审<span v-if="!loading" class="mono n">{{ todo.length }}</span>
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'all'" :class="{ on: tab === 'all' }" @click="tab = 'all'">
          全部记录<span v-if="!loading" class="mono n">{{ rows.length }}</span>
        </button>
      </div>
    </div>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div class="pad stack">
        <div v-if="loading" class="state"><van-loading size="24" vertical>加载中…</van-loading></div>
        <van-empty v-else-if="forbidden" description="你的角色暂无预支审批权限" />
        <van-empty v-else-if="loadError" image="error" :description="loadError">
          <van-button round type="primary" size="small" @click="load">重新加载</van-button>
        </van-empty>
        <template v-else>
          <p v-if="tab === 'todo' && todo.length" class="note">流程：本人发起 → <b>驻场初审</b> → 项目经理终审 → 拨款。驳回后本次机会退回给求职者。</p>
          <article v-for="a in shown" :key="a.advanceId" class="acard row-card">
            <router-link :to="`/advance/${a.advanceId}`" class="head">
              <div class="avatar avatar--o">{{ (a.seekerName ?? '?').slice(0, 1) }}</div>
              <div class="flex1">
                <b>{{ a.seekerName ?? '—' }}</b>
                <span>{{ a.projectName ?? '—' }}</span>
              </div>
              <div class="amt">
                <b class="num">{{ fmtYuan(a.amount) }}</b>
                <span class="tag" :class="ADVANCE_TAG[a.status]">{{ label('AdvanceStatus', a.status) }}</span>
              </div>
            </router-link>
            <dl>
              <div class="kv"><dt>申请时间</dt><dd class="num">{{ fmtTime(a.createdAt, nowDate) }}</dd></div>
              <div class="kv"><dt>所属月份</dt><dd class="num">{{ a.bizMonth }}</dd></div>
              <div class="kv"><dt>申请单号</dt><dd class="num">{{ a.advanceId }}</dd></div>
            </dl>
            <div v-if="canSiteReview(a)" class="acts">
              <van-button v-if="a.allowedActions.includes('SITE_REJECT')" size="small" class="act" @click="review(a, false)">驳回</van-button>
              <van-button v-if="a.allowedActions.includes('SITE_APPROVE')" size="small" type="primary" class="act act--main" @click="review(a, true)">初审通过</van-button>
            </div>
          </article>
          <van-empty v-if="!shown.length" image="search" :description="tab === 'todo' ? '暂无待你初审的预支申请' : '暂无预支记录'" />
        </template>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>
    <ReasonDialog ref="dialog" />
  </div>
</template>

<style scoped>
.adv { min-height: 100vh; }
.sticky { position: sticky; top: calc(46px + env(safe-area-inset-top)); z-index: 20; }
.atabs { display: flex; gap: 6px; overflow-x: auto; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.atabs button { flex: none; padding: 5px 12px; border-radius: 20px; border: 0; font-size: 12.5px; color: var(--ink-500); background: var(--surface-3); font-weight: 500; }
.atabs button.on { background: var(--ink-900); color: #fff; font-weight: 600; }
.atabs .n { margin-left: 4px; font-size: 11px; opacity: .8; }
.pr { min-height: calc(100vh - 100px); }
.head { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.head b { display: block; font-size: 14.5px; font-weight: 700; color: var(--ink-900); }
.head span { display: block; font-size: 11.5px; color: var(--ink-400); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt { text-align: right; flex: none; display: grid; justify-items: end; gap: 3px; }
.amt b { font-size: 17px; color: var(--signal-700); }
.head .amt .tag { display: inline-flex; margin-top: 0; }
.row-card .kv { padding: 6px 0; font-size: 12.5px; }
.acts { display: flex; gap: 8px; margin-top: 10px; }
.act { flex: 1; min-width: 0; border-radius: var(--r-sm); font-weight: 600; }
.act--main { flex: 1.8; }
.state { padding: 40px 0; }
</style>
