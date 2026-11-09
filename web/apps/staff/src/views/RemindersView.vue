<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import {
  errorMessage,
  isApiError,
  tenantApi,
  useDict,
  type PrivatePendingRow,
  type SiteApplication,
  type SiteApplicationAction,
} from '@shitu/api-client'
import AppActions from '@/components/AppActions.vue'
import { useNow } from '@/composables/useNow'
import { splitActions } from '@/utils/actions'
import { fmtPhone, fmtRemain, fmtTime, parseLocal } from '@/utils/time'

/**
 * M-12 24 小时响应提醒（按剩余时长排序，< 4 小时标红）+ M-09 私域待匹配一键流转至人才经纪人。
 * 合并三类 24h 窗口：私域待匹配（扫码注册未报名）、新报名待知悉、面试通过待确权。
 */
type Kind = 'private' | 'ack' | 'confirm'
type FilterKey = 'all' | Kind
interface Item {
  key: string
  kind: Kind
  deadline: number | null
  p?: PrivatePendingRow
  a?: SiteApplication
}
const FILTERS: { key: FilterKey; title: string }[] = [
  { key: 'all', title: '全部' },
  { key: 'private', title: '私域待匹配' },
  { key: 'ack', title: '待知悉' },
  { key: 'confirm', title: '待确权' },
]
const URGENT_MS = 4 * 3600_000
const APP_PAGE = 50

const route = useRoute()
const router = useRouter()
const now = useNow(30_000)
const { label } = useDict()

const asFilter = (v: unknown): FilterKey => (FILTERS.some((f) => f.key === v) ? (v as FilterKey) : 'all')
const filter = ref<FilterKey>(asFilter(route.query.f))
watch(filter, (f) => void router.replace({ query: { ...route.query, f: f === 'all' ? undefined : f } }))
watch(
  () => route.query.f,
  (v) => (filter.value = asFilter(v)),
)

const privates = shallowRef<PrivatePendingRow[]>([])
const acks = shallowRef<SiteApplication[]>([])
const confirms = shallowRef<SiteApplication[]>([])
const loading = ref(true)
const loadError = ref('')
const appsForbidden = ref(false)
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  const errs: string[] = []
  await Promise.all([
    tenantApi
      .privatePending()
      .then((r) => (privates.value = r))
      .catch((e: unknown) => errs.push(errorMessage(e, '私域待匹配加载失败'))),
    tenantApi
      .applications({ status: 'PENDING_INTERVIEW', unacknowledged: true, sort: 'DEADLINE', page: 1, pageSize: APP_PAGE })
      .then((r) => (acks.value = r.records))
      .catch((e: unknown) => {
        if (isApiError(e) && e.status === 403) appsForbidden.value = true
        else errs.push(errorMessage(e, '报名待办加载失败'))
      }),
    tenantApi
      .applications({ status: 'PENDING_CONFIRM', sort: 'DEADLINE', page: 1, pageSize: APP_PAGE })
      .then((r) => (confirms.value = r.records))
      .catch((e: unknown) => {
        if (!(isApiError(e) && e.status === 403)) errs.push(errorMessage(e, '待确权加载失败'))
      }),
  ])
  loadError.value = errs[0] ?? ''
  loading.value = false
}
void load()
async function onRefresh() {
  try {
    await load()
  } finally {
    refreshing.value = false
  }
}

const ts = (v?: string) => parseLocal(v)?.getTime() ?? null
const items = computed<Item[]>(() => {
  const list: Item[] = [
    ...privates.value.map((p) => ({ key: `p-${p.userId}`, kind: 'private' as const, deadline: ts(p.deadline), p })),
    ...acks.value.map((a) => ({ key: `a-${a.applicationId}`, kind: 'ack' as const, deadline: ts(a.responseDeadline), a })),
    ...confirms.value.map((a) => ({ key: `c-${a.applicationId}`, kind: 'confirm' as const, deadline: ts(a.responseDeadline), a })),
  ]
  return list.sort((x, y) => (x.deadline ?? Infinity) - (y.deadline ?? Infinity))
})
const shown = computed(() => (filter.value === 'all' ? items.value : items.value.filter((i) => i.kind === filter.value)))
const count = (k: FilterKey) => (k === 'all' ? items.value.length : items.value.filter((i) => i.kind === k).length)
const urgentCount = computed(() => items.value.filter((i) => i.deadline != null && i.deadline - now.value < URGENT_MS).length)

function remain(i: Item) {
  if (i.deadline == null) return null
  const ms = i.deadline - now.value
  const t = fmtRemain(ms)
  if (!t) return { text: '已超时', cls: 'tag-danger', urgent: true }
  return { text: `剩 ${t}`, cls: ms < URGENT_MS ? 'tag-danger' : 'tag-warn', urgent: ms < URGENT_MS }
}
const KIND_TAG: Record<Kind, { text: string; cls: string }> = {
  private: { text: '私域待匹配', cls: 'tag-private' },
  ack: { text: '待知悉', cls: 'tag-temp' },
  confirm: { text: '待确权', cls: 'tag-info' },
}
const nowDate = computed(() => new Date(now.value))
const initial = (n: string) => (n === '未实名' ? '?' : n.slice(0, 1))

// ---------- M-09 一键流转 ----------
async function transfer(p: PrivatePendingRow) {
  if (p.inBrokerPool) return
  try {
    await showConfirmDialog({
      title: '流转至人才经纪人',
      message: `将 ${p.seekerName}（${fmtPhone(p.phone)}）转交本公司人才经纪人二次匹配？\n将同步当前状态与归属、AI 问薪画像、历史匹配记录与来源归属。`,
      confirmButtonText: '确认流转',
      messageAlign: 'left',
      beforeClose: async (action) => {
        if (action !== 'confirm') return true
        try {
          await tenantApi.transferToBroker(p.userId)
          return true
        } catch (e) {
          showToast(errorMessage(e, '流转失败，请稍后重试'))
          return false
        }
      },
    })
  } catch {
    return
  }
  privates.value = privates.value.map((r) => (r.userId === p.userId ? { ...r, inBrokerPool: true } : r))
  showSuccessToast('已流转至人才经纪人')
}

// ---------- 报名操作 ----------
const actions = ref<InstanceType<typeof AppActions> | null>(null)
function mainAction(a: SiteApplication) {
  const main = splitActions(a).main
  return main[main.length - 1] ?? null
}
function run(a: SiteApplication, key: SiteApplicationAction) {
  void actions.value?.run(key, a)
}
</script>

<template>
  <div class="rem">
    <van-nav-bar title="跟进提醒" safe-area-inset-top fixed placeholder z-index="30" />
    <div class="sticky">
      <div class="atabs" role="tablist">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          role="tab"
          :aria-selected="filter === f.key"
          :class="{ on: filter === f.key }"
          @click="filter = f.key"
        >
          {{ f.title }}<span v-if="!loading" class="mono n">{{ count(f.key) }}</span>
        </button>
      </div>
    </div>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div class="pad stack">
        <section v-if="!loading" class="acard sum" :class="{ hot: urgentCount > 0 }">
          <div class="row" style="justify-content: space-between">
            <div>
              <div class="t-xs">24 小时窗口内待跟进</div>
              <b class="num big">{{ items.length }}<small> 人</small></b>
            </div>
            <div style="text-align: right">
              <div class="t-xs">4 小时内将超时</div>
              <b class="num big" :class="{ red: urgentCount > 0 }">{{ urgentCount }}<small> 人</small></b>
            </div>
          </div>
          <p class="t-xs" style="margin-top: 8px; line-height: 1.6">超时后系统被动释放至公域，该用户可被全平台其他公司匹配，本次获客成本作废。</p>
        </section>

        <p v-if="loadError" class="note err">{{ loadError }}，下拉可重试</p>
        <div v-if="loading" class="state"><van-loading size="24" vertical>加载中…</van-loading></div>

        <template v-else>
          <article v-for="i in shown" :key="i.key" class="acard item" :class="{ urgent: remain(i)?.urgent }">
            <div class="top">
              <div class="row" style="gap: 6px">
                <span v-if="remain(i)?.urgent" class="tag tag-danger">紧急</span>
                <span class="tag" :class="KIND_TAG[i.kind].cls">{{ KIND_TAG[i.kind].text }}</span>
              </div>
              <span v-if="remain(i)" class="tag num" :class="remain(i)!.cls">{{ remain(i)!.text }}</span>
            </div>

            <!-- 私域待匹配 -->
            <template v-if="i.p">
              <div class="row person">
                <div class="avatar avatar--o">{{ initial(i.p.seekerName) }}</div>
                <div class="flex1">
                  <div class="name">{{ i.p.seekerName }}</div>
                  <a :href="`tel:${i.p.phone}`" class="t-xs mono tel">{{ fmtPhone(i.p.phone) }}</a>
                </div>
              </div>
              <dl class="dl">
                <div class="kv"><dt>注册时间</dt><dd class="num">{{ fmtTime(i.p.registeredAt, nowDate) }}</dd></div>
                <div class="kv"><dt>来源</dt><dd>{{ i.p.channelMemberName ? `${i.p.channelMemberName} 的专属码` : i.p.channelCode ? `渠道码 ${i.p.channelCode}` : '本公司渠道' }}</dd></div>
                <div class="kv"><dt>当前状态</dt><dd>尚未报名 · 待跟进匹配</dd></div>
              </dl>
              <div class="acts">
                <van-button size="small" class="act" :url="`tel:${i.p.phone}`">立即拨打</van-button>
                <van-button size="small" class="act act--main" :type="i.p.inBrokerPool ? 'default' : 'primary'" :disabled="i.p.inBrokerPool" @click="transfer(i.p)">
                  {{ i.p.inBrokerPool ? '已在流转池' : '一键流转经纪人' }}
                </van-button>
              </div>
            </template>

            <!-- 报名待知悉 / 待确权 -->
            <template v-else-if="i.a">
              <router-link :to="`/applications/${i.a.applicationId}`" class="row person">
                <div class="avatar" :class="i.a.fromPublic ? 'avatar--t' : 'avatar--o'">{{ initial(i.a.seekerName) }}</div>
                <div class="flex1">
                  <div class="name">{{ i.a.seekerName }}</div>
                  <div class="t-xs">{{ i.a.jobTitle ?? '—' }}<template v-if="i.a.projectName"> · {{ i.a.projectName }}</template></div>
                </div>
                <van-icon name="arrow" class="chev" />
              </router-link>
              <p class="t-xs desc">
                <template v-if="i.kind === 'ack'">{{ fmtTime(i.a.createdAt, nowDate) }} 报名 · 尚未推送面试信息</template>
                <template v-else-if="i.a.contract?.status === 'PENDING_SIGN'">已确权 · 合同{{ label('ContractStatus', 'PENDING_SIGN') }}</template>
                <template v-else>面试已通过 · 待入职确权</template>
              </p>
              <div class="acts">
                <van-button v-if="i.a.phone" size="small" class="act" :url="`tel:${i.a.phone}`">拨打</van-button>
                <van-button v-if="mainAction(i.a)" size="small" type="primary" class="act act--main" @click="run(i.a, mainAction(i.a)!.key)">
                  {{ mainAction(i.a)!.text }}
                </van-button>
              </div>
            </template>
          </article>

          <van-empty v-if="!shown.length && !loadError" image="search" :description="filter === 'all' ? '暂无 24 小时窗口内待跟进的用户' : '暂无该类待跟进'" />
          <p v-if="appsForbidden" class="t-xs" style="text-align: center">报名待办仅对驻场 / 项目经理开放</p>
          <p class="t-xs foot">提醒频率：白天每 6 小时 1 次 · 夜间每 12 小时 1 次；推送驻场 · 项目经理 · 老板三方同步</p>
        </template>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>

    <AppActions ref="actions" @done="load" />
  </div>
</template>

<style scoped>
.rem { min-height: 100vh; }
.sticky { position: sticky; top: calc(46px + env(safe-area-inset-top)); z-index: 20; }
.atabs { display: flex; gap: 6px; overflow-x: auto; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.atabs::-webkit-scrollbar { height: 0; }
.atabs button { flex: none; padding: 5px 12px; border-radius: 20px; border: 0; font-size: 12.5px; color: var(--ink-500); background: var(--surface-3); font-weight: 500; }
.atabs button.on { background: var(--ink-900); color: #fff; font-weight: 600; }
.atabs .n { margin-left: 4px; font-size: 11px; opacity: .8; }
.pr { min-height: calc(100vh - 140px); }
.sum.hot { border-color: var(--danger-line); background: var(--danger-bg); }
.big { display: block; font-size: 22px; font-weight: 700; color: var(--ink-900); margin-top: 2px; }
.big small { font-size: 11px; font-weight: 500; color: var(--ink-400); }
.big.red { color: var(--danger); }
.err { border-left-color: var(--danger); background: var(--danger-bg); color: var(--danger); }
.item.urgent { border-color: var(--danger-line); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.person { gap: 10px; text-decoration: none; color: inherit; }
.person .chev { color: var(--ink-300); }
.name { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.tel { color: var(--signal-700); text-decoration: none; }
.dl { margin-top: 6px; }
.dl .kv { padding: 6px 0; font-size: 12.5px; }
.desc { margin-top: 8px; }
.acts { display: flex; gap: 8px; margin-top: 12px; }
.act { flex: 1; min-width: 0; padding: 0 6px; border-radius: var(--r-sm); font-weight: 600; }
.act--main { flex: 1.8; }
.state { padding: 40px 0; }
.foot { text-align: center; line-height: 1.6; padding: 4px 10px 0; }
</style>
