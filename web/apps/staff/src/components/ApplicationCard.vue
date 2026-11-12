<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useDict, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { IconBriefcase, IconChevronRight, IconClock, IconPhone } from '@shitu/ui-icons'
import { ACTION_TEXT, CONTRACT_TONE, DOMAIN_TONE, splitActions } from '@/utils/actions'
import { fmtPhone, fmtRemain, fmtTime, parseLocal } from '@/utils/time'

/**
 * M-02 / M-03 待办卡片，从上到下：姓名、归属标签、剩余时间 → 岗位和面试时间 → 手机号（仅驻场可见完整号码）→ 「拨打」和当前阶段的主按钮。
 * 操作按钮完全由后端 allowedActions 决定（主按钮 + 「更多」）；blocked 是后端拒绝过的那个操作和原因，按钮置灰、原因留在卡片上。
 */
const props = defineProps<{
  app: SiteApplication
  now: number
  detailLink?: boolean
  /** 详情页顶部：不放操作按钮（操作在底部通栏） */
  noActions?: boolean
  blocked?: { action: SiteApplicationAction; reason: string } | null
}>()
const emit = defineEmits<{ action: [app: SiteApplication, action: SiteApplicationAction]; more: [app: SiteApplication] }>()
const { label } = useDict()

const URGENT_MS = 4 * 3600_000

const domain = computed(() => (props.app.fromPublic ? 'PUBLIC' : 'PRIVATE'))
const acked = computed(() => !!props.app.acknowledgedAt)
const acts = computed(() => splitActions(props.app))

const remainMs = computed(() => {
  const d = parseLocal(props.app.responseDeadline)
  return d ? d.getTime() - props.now : null
})
const countdown = computed(() => {
  if (remainMs.value == null) return null
  if (props.app.status !== 'PENDING_INTERVIEW' && props.app.status !== 'PENDING_CONFIRM') return null
  const t = fmtRemain(remainMs.value)
  if (!t) return { text: '已超时', urgent: true }
  return { text: t, urgent: remainMs.value < URGENT_MS }
})

const contract = computed(() => props.app.contract)
const statusText = computed(() => {
  const a = props.app
  if (a.status === 'PENDING_INTERVIEW') {
    if (a.arrivedAt) return '已到厂 · 待录入面试结果'
    return acked.value ? '面试信息已推送 · 待到厂' : '已报名 · 待你知悉并推送面试信息'
  }
  if (a.status === 'PENDING_CONFIRM') {
    if (contract.value?.status === 'PENDING_SIGN') return '已确权 · 等待求职者电子签署'
    return '面试已通过 · 待入职确权'
  }
  return label('ApplicationStatus', a.status)
})
const nowDate = computed(() => new Date(props.now))
const whenText = computed(() => {
  const a = props.app
  const parts: string[] = []
  parts.push(a.interviewAt ? `${fmtTime(a.interviewAt, nowDate.value)} 面试` : `${fmtTime(a.createdAt, nowDate.value)} 报名`)
  if (a.arrivedAt) parts.push(`${fmtTime(a.arrivedAt, nowDate.value)} 已到厂`)
  return parts.join(' · ')
})
const blockedText = computed(() => (props.blocked ? `暂时不能${ACTION_TEXT[props.blocked.action]}：${props.blocked.reason}` : ''))
</script>

<template>
  <article class="acard app">
    <div class="item-hd">
      <div class="who">
        <component :is="detailLink ? RouterLink : 'div'" :to="detailLink ? `/applications/${app.applicationId}` : undefined" class="name-link">
          <h3>{{ app.seekerName }}</h3>
          <IconChevronRight v-if="detailLink" :size="16" class="chev" />
        </component>
        <span class="status-tag" :class="`status-tag--${DOMAIN_TONE[domain]}`">{{ label('DomainTag', domain) }}</span>
      </div>
      <div v-if="countdown" class="left" :class="countdown.urgent ? 'urgent' : 'soon'">
        <small>剩余</small><b>{{ countdown.text }}</b>
      </div>
      <span v-else class="status-tag status-tag--neutral">{{ label('ApplicationStatus', app.status) }}</span>
    </div>

    <ul class="facts">
      <li><IconBriefcase :size="16" /><span>{{ app.jobTitle ?? '—' }}<template v-if="app.projectName"> · {{ app.projectName }}</template></span></li>
      <li><IconClock :size="16" /><span>{{ whenText }}</span></li>
      <li v-if="app.phone"><IconPhone :size="16" /><span>{{ fmtPhone(app.phone) }}<small> · 仅驻场可见完整号码</small></span></li>
    </ul>
    <p class="item-meta">
      {{ statusText }}
      <span v-if="contract && app.status === 'PENDING_CONFIRM'" class="status-tag" :class="`status-tag--${CONTRACT_TONE[contract.status] ?? 'neutral'}`">合同{{ label('ContractStatus', contract.status) }}</span>
    </p>

    <div v-if="!noActions && (app.phone || acts.main.length || acts.more.length)" class="acts">
      <van-button v-if="app.phone" class="act act--call" :url="`tel:${app.phone}`"><template #icon><IconPhone :size="18" /></template>拨打</van-button>
      <van-button v-if="acts.more.length" class="act" @click="emit('more', app)">更多</van-button>
      <van-button
        v-for="b in acts.main"
        :key="b.key"
        :type="b.type === 'primary' ? 'primary' : 'default'"
        :disabled="blocked?.action === b.key"
        class="act act--main"
        @click="emit('action', app, b.key)"
      >
        {{ b.text }}
      </van-button>
    </div>
    <p v-if="!noActions && blocked" class="why" role="status">{{ blockedText }}</p>
  </article>
</template>

<style scoped>
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
.facts small { font-size: var(--font-size-aux); color: var(--text-3); }
.item-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.acts { display: flex; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.act { flex: 1 1 auto; min-width: 0; padding: 0 var(--space-2); font-weight: var(--font-weight-medium); }
.act--call { flex: 0 0 auto; padding: 0 var(--space-3); }
.act--main { flex: 1.8; white-space: nowrap; }
.act--main :deep(.van-button__text) { overflow: hidden; text-overflow: ellipsis; }
.why { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--warning-text); }
</style>
