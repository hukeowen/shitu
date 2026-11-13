<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useDict, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { splitActions } from '@/utils/actions'
import { APPLICATION_TAG, CONTRACT_TAG, STAGE_TAG, STAGE_TEXT, URGENT_MS, appStage, countdownTag } from '@/utils/status'
import { fmtCountdown, fmtPhone, fmtTime, parseLocal } from '@/utils/time'

/**
 * M-02 / M-03 待办卡片：来源 / 阶段（待知悉 / 待面试 / 已到厂 / 待确权，互斥，只显示一个）/ 24h 倒计时、姓名（脱敏）与完整手机号（仅驻场）、岗位、到厂与签约状态；
 * 操作按钮完全由后端 allowedActions 决定（主按钮 + 「更多」）。
 */
const props = defineProps<{ app: SiteApplication; now: number; detailLink?: boolean }>()
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
  return { text: fmtCountdown(remainMs.value), cls: countdownTag(remainMs.value) }
})
const urgent = computed(() => remainMs.value != null && remainMs.value < URGENT_MS && !!countdown.value && acts.value.main.length > 0)

const contract = computed(() => props.app.contract)
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
const sourceText = computed(() =>
  props.app.fromPublic ? `${label('DomainTag', 'PUBLIC')} → 报名后${label('DomainTag', 'TEMP_PRIVATE')}` : `本公司${label('DomainTag', 'PRIVATE')}`,
)
const nowDate = computed(() => new Date(props.now))
const avatarChar = computed(() => (props.app.seekerName === '未实名' ? '?' : props.app.seekerName.slice(0, 1)))
</script>

<template>
  <article class="acard app" :class="{ urgent }">
    <div class="top">
      <div class="row tags">
        <span class="tag" :class="domain === 'PUBLIC' ? 'tag-public' : 'tag-private'"><i class="dot" />{{ label('DomainTag', domain) }}</span>
        <span v-if="stage" class="tag" :class="STAGE_TAG[stage]">{{ STAGE_TEXT[stage] }}</span>
        <span v-else class="tag" :class="APPLICATION_TAG[app.status] ?? 'tag-muted'">{{ label('ApplicationStatus', app.status) }}</span>
        <span v-if="contract && app.status === 'PENDING_CONFIRM'" class="tag" :class="CONTRACT_TAG[contract.status] ?? 'tag-muted'">合同{{ label('ContractStatus', contract.status) }}</span>
      </div>
      <span v-if="countdown" class="tag num" :class="countdown.cls">{{ countdown.text }}</span>
    </div>

    <component :is="detailLink ? RouterLink : 'div'" :to="detailLink ? `/applications/${app.applicationId}` : undefined" class="row person">
      <div class="avatar" :class="app.fromPublic ? 'avatar--t' : 'avatar--o'">{{ avatarChar }}</div>
      <div class="flex1">
        <div class="name">{{ app.seekerName }}</div>
        <div v-if="app.phone" class="t-xs mono">{{ fmtPhone(app.phone) }} · 仅驻场可见完整号码</div>
      </div>
      <span v-if="detailLink" class="t-xs go">详情<van-icon name="arrow" /></span>
    </component>

    <div class="divider" />
    <dl>
      <div class="kv"><dt>应聘岗位</dt><dd>{{ app.jobTitle ?? '—' }}</dd></div>
      <div v-if="app.projectName" class="kv"><dt>项目</dt><dd>{{ app.projectName }}</dd></div>
      <div class="kv"><dt>报名时间</dt><dd class="num">{{ fmtTime(app.createdAt, nowDate) }}</dd></div>
      <div v-if="app.interviewAt" class="kv"><dt>面试时间</dt><dd class="num">{{ fmtTime(app.interviewAt, nowDate) }}</dd></div>
      <div v-if="app.arrivedAt" class="kv"><dt>到厂时间</dt><dd class="num">{{ fmtTime(app.arrivedAt, nowDate) }}</dd></div>
      <div v-if="contract && app.status === 'PENDING_CONFIRM'" class="kv">
        <dt>电子合同</dt>
        <dd>{{ label('ContractStatus', contract.status) }} · <span class="num">{{ fmtTime(contract.createdAt, nowDate) }}</span> 发起</dd>
      </div>
      <div class="kv"><dt>来源</dt><dd>{{ sourceText }}</dd></div>
      <div class="kv"><dt>当前状态</dt><dd>{{ statusText }}</dd></div>
    </dl>

    <div v-if="app.phone || acts.main.length || acts.more.length" class="acts">
      <van-button v-if="app.phone" size="small" class="act" :url="`tel:${app.phone}`">拨打</van-button>
      <van-button v-if="acts.more.length" size="small" class="act" @click="emit('more', app)">更多</van-button>
      <van-button
        v-for="b in acts.main"
        :key="b.key"
        size="small"
        :type="b.type === 'primary' ? 'primary' : 'default'"
        class="act"
        :class="{ 'act--main': acts.main.length === 1 }"
        @click="emit('action', app, b.key)"
      >
        {{ b.text }}
      </van-button>
    </div>
  </article>
</template>

<style scoped>
.app.urgent { border-color: var(--danger-line); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.tags { gap: 6px; flex-wrap: wrap; min-width: 0; }
.person { gap: 10px; text-decoration: none; color: inherit; }
.go { display: inline-flex; align-items: center; gap: 1px; flex: none; }
.name { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.divider { height: 1px; background: var(--line); margin: 10px 0 4px; }
.kv { padding: 6px 0; font-size: 12.5px; }
.acts { display: flex; gap: 8px; margin-top: 12px; }
.act { flex: 1; min-width: 0; padding: 0 6px; border-radius: var(--r-sm); font-weight: 600; }
.act--main { flex: 1.8; }
</style>
