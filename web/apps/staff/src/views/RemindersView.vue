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
import { IconBriefcase, IconChevronRight, IconCircleExclamationPoint, IconClock, IconInbox, IconPhone } from '@shitu/ui-icons'
import AppActions from '@/components/AppActions.vue'
import { useNow } from '@/composables/useNow'
import { ACTION_TEXT, DOMAIN_TONE, splitActions, tagTone } from '@/utils/actions'
import { PRIVATE_PENDING_TAG, STAGE_TAG, STAGE_TEXT, URGENT_MS } from '@/utils/status'
import { fmtDuration, fmtPhone, fmtTime, parseLocal } from '@/utils/time'

/**
 * M-12 24 小时响应提醒（按剩余时长排序，< 4 小时标红）+ M-09 私域待匹配一键流转至人才经纪人。
 * 合并三类 24h 窗口：私域待匹配（扫码注册未报名）、新报名待知悉、面试通过待确权。
 */
/** arrived：尚未知悉但已到厂（少见），只出现在「全部」里，徽标与待办页一致显示「已到厂」 */
type Kind = 'private' | 'ack' | 'arrived' | 'confirm'
type FilterKey = 'all' | 'private' | 'ack' | 'confirm'
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
  { key: 'ack', title: STAGE_TEXT.ack },
  { key: 'confirm', title: STAGE_TEXT.confirm },
]
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
/** 后端拒绝过的操作：这一条的按钮置灰、原因留在卡片上，刷新后重新判断 */
const blocked = ref<Record<string, { text: string; action?: SiteApplicationAction }>>({})

async function load() {
  loadError.value = ''
  blocked.value = {}
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

const ts = (v?: string) => parseLocal(v)?.getTime() ?? null
const items = computed<Item[]>(() => {
  const list: Item[] = [
    ...privates.value.map((p) => ({ key: `p-${p.userId}`, kind: 'private' as const, deadline: ts(p.deadline), p })),
    ...acks.value.map((a) => ({ key: `a-${a.applicationId}`, kind: a.arrivedAt ? ('arrived' as const) : ('ack' as const), deadline: ts(a.responseDeadline), a })),
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
  // 文案与全端统一：剩余 19 小时 21 分 / 已超时 1 小时 5 分
  return { label: ms > 0 ? '剩余' : '已超时', text: fmtDuration(ms), urgent: ms < URGENT_MS }
}
const KIND_TAG: Record<Kind, { text: string; tone: string }> = {
  private: { text: '私域待匹配', tone: tagTone(PRIVATE_PENDING_TAG) },
  ack: { text: STAGE_TEXT.ack, tone: tagTone(STAGE_TAG.ack) },
  arrived: { text: STAGE_TEXT.arrived, tone: tagTone(STAGE_TAG.arrived) },
  confirm: { text: STAGE_TEXT.confirm, tone: tagTone(STAGE_TAG.confirm) },
}
const nowDate = computed(() => new Date(now.value))
/**
 * 私域来源的可读文案。接口目前只返回渠道码与（成员码的）成员姓名，没有渠道类型 / 名称：
 * 有成员姓名 → 成员「姓名」的专属码；只有码 → 「扫码注册」+ 小字渠道码；都没有 → 本公司渠道。
 */
function sourceOf(p: PrivatePendingRow): { text: string; code?: string } {
  if (p.channelMemberName) return { text: `成员「${p.channelMemberName}」的专属码` }
  if (p.channelName) return { text: `扫「${p.channelName}」注册` }
  if (p.channelCode) return { text: '扫码注册', code: p.channelCode }
  return { text: '本公司渠道' }
}

function onRejected(a: SiteApplication, action: SiteApplicationAction, reason: string) {
  blocked.value = { ...blocked.value, [a.applicationId]: { action, text: `暂时不能${ACTION_TEXT[action]}：${reason}` } }
}
function onDone() {
  blocked.value = {}
  void load()
}

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
          if (isApiError(e) && e.code !== 'NETWORK') blocked.value = { ...blocked.value, [p.userId]: { text: `暂时不能流转：${errorMessage(e)}` } }
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

        <article v-for="i in shown" :key="i.key" class="acard item">
          <div class="item-hd">
            <div class="who">
              <router-link v-if="i.a" :to="`/applications/${i.a.applicationId}`" class="name-link"><h3>{{ i.a.seekerName }}</h3><IconChevronRight :size="16" class="chev" /></router-link>
              <h3 v-else-if="i.p">{{ i.p.seekerName }}</h3>
              <span v-if="i.a" class="status-tag" :class="`status-tag--${DOMAIN_TONE[i.a.fromPublic ? 'PUBLIC' : 'PRIVATE']}`">{{ label('DomainTag', i.a.fromPublic ? 'PUBLIC' : 'PRIVATE') }}</span>
              <span v-else class="status-tag status-tag--private">{{ label('DomainTag', 'PRIVATE') }}</span>
            </div>
            <div v-if="remain(i)" class="left" :class="remain(i)!.urgent ? 'urgent' : 'soon'">
              <small>{{ remain(i)!.urgent ? `紧急 · ${remain(i)!.label}` : remain(i)!.label }}</small><b>{{ remain(i)!.text }}</b>
            </div>
          </div>

          <!-- 私域待匹配 -->
          <template v-if="i.p">
            <ul class="facts">
              <li><IconBriefcase :size="16" /><span>尚未报名 · 待跟进匹配</span></li>
              <li><IconClock :size="16" /><span>{{ fmtTime(i.p.registeredAt, nowDate) }} 注册 · {{ sourceOf(i.p).text }}<small v-if="sourceOf(i.p).code" class="src-code">{{ sourceOf(i.p).code }}</small></span></li>
              <li><IconPhone :size="16" /><span>{{ fmtPhone(i.p.phone) }}</span></li>
            </ul>
            <p class="item-meta"><span class="status-tag" :class="`status-tag--${KIND_TAG.private.tone}`">{{ KIND_TAG.private.text }}</span></p>
            <div class="acts">
              <van-button class="act act--call" :url="`tel:${i.p.phone}`"><template #icon><IconPhone :size="18" /></template>立即拨打</van-button>
              <van-button class="act act--main" :type="i.p.inBrokerPool ? 'default' : 'primary'" :disabled="i.p.inBrokerPool || !!blocked[i.p.userId]" @click="transfer(i.p)">
                {{ i.p.inBrokerPool ? '已在流转池' : '一键流转经纪人' }}
              </van-button>
            </div>
            <p v-if="blocked[i.p.userId]" class="why" role="status">{{ blocked[i.p.userId].text }}</p>
          </template>

          <!-- 报名待知悉 / 待确权 -->
          <template v-else-if="i.a">
            <ul class="facts">
              <li><IconBriefcase :size="16" /><span>{{ i.a.jobTitle ?? '—' }}<template v-if="i.a.projectName"> · {{ i.a.projectName }}</template></span></li>
              <li>
                <IconClock :size="16" />
                <span>
                  <template v-if="i.kind === 'ack'">{{ fmtTime(i.a.createdAt, nowDate) }} 报名 · 尚未推送面试信息</template>
                  <template v-else-if="i.kind === 'arrived'">已到厂 · 待录入面试结果</template>
                  <template v-else-if="i.a.contract?.status === 'PENDING_SIGN'">已确权 · 合同{{ label('ContractStatus', 'PENDING_SIGN') }}</template>
                  <template v-else>面试已通过 · 待入职确权</template>
                </span>
              </li>
              <li v-if="i.a.phone"><IconPhone :size="16" /><span>{{ fmtPhone(i.a.phone) }}</span></li>
            </ul>
            <p class="item-meta"><span class="status-tag" :class="`status-tag--${KIND_TAG[i.kind].tone}`">{{ i.kind === 'confirm' && i.a.contract?.status === 'PENDING_SIGN' ? '合同待签署' : KIND_TAG[i.kind].text }}</span></p>
            <div v-if="i.a.phone || mainAction(i.a)" class="acts">
              <van-button v-if="i.a.phone" class="act act--call" :url="`tel:${i.a.phone}`"><template #icon><IconPhone :size="18" /></template>拨打</van-button>
              <van-button
                v-if="mainAction(i.a)"
                type="primary"
                class="act act--main"
                :disabled="blocked[i.a.applicationId]?.action === mainAction(i.a)!.key"
                @click="run(i.a, mainAction(i.a)!.key)"
              >
                {{ mainAction(i.a)!.text }}
              </van-button>
            </div>
            <p v-if="blocked[i.a.applicationId]" class="why" role="status">{{ blocked[i.a.applicationId].text }}</p>
          </template>
        </article>

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
.who { display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex-wrap: wrap; }
.name-link { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; margin: calc(var(--space-3) * -1) 0; color: inherit; text-decoration: none; min-width: 0; }
.name-link .chev { flex: none; color: var(--text-3); }
.left { flex: none; text-align: right; line-height: 1.2; }
.left small { display: block; font-size: var(--font-size-min); color: var(--text-3); }
.left b { display: block; margin-top: 2px; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); }
.left.urgent b { color: var(--danger-text); }
.left.soon b { color: var(--warning-text); }
.facts { margin-top: var(--space-2); display: grid; gap: var(--space-1); }
.facts li { display: flex; align-items: flex-start; gap: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.facts li > svg { flex: none; margin-top: 3px; color: var(--text-3); }
.facts li > span { min-width: 0; overflow-wrap: anywhere; }
.item-meta { margin-top: var(--space-2); }
.src-code { margin-left: var(--space-1); font-family: var(--font-mono); font-size: var(--font-size-aux); color: var(--text-3); }
.acts { display: flex; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.act { flex: 1; min-width: 0; padding: 0 var(--space-2); font-weight: var(--font-weight-medium); }
.act--call { flex: 0 0 auto; padding: 0 var(--space-4); }
.act--main { flex: 1.8; }
.why { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--warning-text); }
.foot { padding: 0 var(--space-3); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); text-align: center; }
</style>
