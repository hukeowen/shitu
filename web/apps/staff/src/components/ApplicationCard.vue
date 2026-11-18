<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useDict, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { IconBriefcase, IconChevronRight, IconClock, IconPhone } from '@shitu/ui-icons'
import { ACTION_TEXT, CONTRACT_TONE, DOMAIN_TONE, splitActions, tagTone } from '@/utils/actions'
import { APPLICATION_TAG, STAGE_TAG, STAGE_TEXT, URGENT_MS, appStage } from '@/utils/status'
import { fmtDuration, fmtPhone, fmtTime, parseLocal } from '@/utils/time'

/**
 * M-02 / M-03 待办卡片，从上到下：姓名、归属标签、剩余时间（没有倒计时就显示阶段：待知悉 / 待面试 / 已到厂 / 待确权，互斥，只显示一个）→ 岗位和面试时间 → 手机号（仅驻场可见完整号码）→ 「拨打」和当前阶段的主按钮。
 * 操作按钮完全由后端 allowedActions 决定（主按钮 + 「更多」）；blocked 是后端拒绝过的那个操作和原因：报名状态已经变了，
 * 除「拨打」外的操作都置灰、原因留在卡片上，刷新后重新判断。按钮放不下一行时主按钮单独占一行，文案不截断。
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

const domain = computed(() => (props.app.fromPublic ? 'PUBLIC' : 'PRIVATE'))
const stage = computed(() => appStage(props.app))
const acts = computed(() => splitActions(props.app))

const remainMs = computed(() => {
  const d = parseLocal(props.app.responseDeadline)
  return d ? d.getTime() - props.now : null
})
const countdown = computed(() => {
  if (remainMs.value == null) return null
  if (props.app.status !== 'PENDING_INTERVIEW' && props.app.status !== 'PENDING_CONFIRM') return null
  // 文案与全端统一：剩余 19 小时 21 分 / 已超时 1 小时 5 分
  return { label: remainMs.value > 0 ? '剩余' : '已超时', text: fmtDuration(remainMs.value), urgent: remainMs.value < URGENT_MS }
})

const contract = computed(() => props.app.contract)
const signing = computed(() => props.app.status === 'PENDING_CONFIRM' && contract.value?.status === 'PENDING_SIGN')
const statusText = computed(() => {
  const a = props.app
  if (stage.value === 'arrived') return '已到厂 · 待录入面试结果'
  if (stage.value === 'interview') return '面试信息已推送 · 待到厂'
  if (stage.value === 'ack') return '已报名 · 待你知悉并推送面试信息'
  if (stage.value === 'confirm') {
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
        <small>{{ countdown.label }}</small><b>{{ countdown.text }}</b>
      </div>
      <!-- 已确权、合同等求职者签署：只显示下面的合同标签，不再挂「待确权」 -->
      <template v-else-if="signing" />
      <span v-else-if="stage" class="status-tag" :class="`status-tag--${tagTone(STAGE_TAG[stage])}`">{{ STAGE_TEXT[stage] }}</span>
      <span v-else class="status-tag" :class="`status-tag--${tagTone(APPLICATION_TAG[app.status])}`">{{ label('ApplicationStatus', app.status) }}</span>
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
      <van-button v-if="acts.more.length" class="act" :disabled="!!blocked" @click="emit('more', app)">更多</van-button>
      <van-button
        v-for="b in acts.main"
        :key="b.key"
        :type="b.type === 'primary' ? 'primary' : 'default'"
        :disabled="!!blocked"
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
.acts { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--divider); }
.act { flex: 1 1 auto; min-width: 0; padding: 0 var(--space-2); font-weight: var(--font-weight-medium); }
.act--call { flex: 0 0 auto; padding: 0 var(--space-3); }
.act--main { flex: 1 0 auto; white-space: nowrap; }
.why { margin-top: var(--space-2); font-size: var(--font-size-body); line-height: 22px; color: var(--warning-text); }
</style>
