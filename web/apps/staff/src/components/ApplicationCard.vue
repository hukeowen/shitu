<script setup lang="ts">
import { computed } from 'vue'
import { useDict, type SiteApplication } from '@shitu/api-client'
import { fmtPhone, fmtRemain, fmtTime, parseLocal } from '@/utils/time'

/** M-02 待办卡片：来源 / 状态 / 24h 倒计时、姓名（脱敏）与完整手机号（仅驻场）、岗位与操作 */
const props = defineProps<{ app: SiteApplication; now: number; detailLink?: boolean }>()
const emit = defineEmits<{ action: [app: SiteApplication] }>()
const { label } = useDict()

const URGENT_MS = 4 * 3600_000

const domain = computed(() => (props.app.fromPublic ? 'PUBLIC' : 'PRIVATE'))
const acked = computed(() => !!props.app.acknowledgedAt)
const action = computed(() => {
  if (props.app.allowedActions.includes('ACKNOWLEDGE')) return { key: 'ACKNOWLEDGE', text: '知悉并推送面试信息' }
  if (props.app.allowedActions.includes('REPUSH')) return { key: 'REPUSH', text: '修改面试信息' }
  return null
})

const remainMs = computed(() => {
  const d = parseLocal(props.app.responseDeadline)
  return d ? d.getTime() - props.now : null
})
const countdown = computed(() => {
  if (remainMs.value == null) return null
  const t = fmtRemain(remainMs.value)
  if (!t) return { text: '已超时', cls: 'tag-danger' }
  return { text: `剩 ${t}`, cls: remainMs.value < URGENT_MS ? 'tag-danger' : 'tag-warn' }
})
const urgent = computed(() => remainMs.value != null && remainMs.value < URGENT_MS && action.value?.key === 'ACKNOWLEDGE')

const statusText = computed(() => {
  if (props.app.status === 'PENDING_INTERVIEW') return acked.value ? '面试信息已推送 · 待到厂' : '已报名 · 待你知悉并推送面试信息'
  return label('ApplicationStatus', props.app.status)
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
        <span class="tag tag-temp">{{ label('ApplicationStatus', app.status) }}</span>
        <span v-if="acked && app.status === 'PENDING_INTERVIEW'" class="tag tag-ok">已推送</span>
      </div>
      <span v-if="countdown" class="tag num" :class="countdown.cls">{{ countdown.text }}</span>
    </div>

    <div class="row person">
      <div class="avatar" :class="app.fromPublic ? 'avatar--t' : 'avatar--o'">{{ avatarChar }}</div>
      <div class="flex1">
        <div class="name">{{ app.seekerName }}</div>
        <div v-if="app.phone" class="t-xs mono">{{ fmtPhone(app.phone) }} · 仅驻场可见完整号码</div>
      </div>
    </div>

    <div class="divider" />
    <dl>
      <div class="kv"><dt>应聘岗位</dt><dd>{{ app.jobTitle ?? '—' }}</dd></div>
      <div v-if="app.projectName" class="kv"><dt>项目</dt><dd>{{ app.projectName }}</dd></div>
      <div class="kv"><dt>报名时间</dt><dd class="num">{{ fmtTime(app.createdAt, nowDate) }}</dd></div>
      <div v-if="app.interviewAt" class="kv"><dt>面试时间</dt><dd class="num">{{ fmtTime(app.interviewAt, nowDate) }}</dd></div>
      <div class="kv"><dt>来源</dt><dd>{{ sourceText }}</dd></div>
      <div class="kv"><dt>当前状态</dt><dd>{{ statusText }}</dd></div>
    </dl>

    <div v-if="app.phone || action || detailLink" class="acts">
      <van-button v-if="app.phone" size="small" class="act" :url="`tel:${app.phone}`">拨打</van-button>
      <van-button v-if="detailLink" size="small" class="act" :to="`/applications/${app.applicationId}`">查看详情</van-button>
      <van-button v-if="action" size="small" :type="action.key === 'ACKNOWLEDGE' ? 'primary' : 'default'" class="act act--main" @click="emit('action', app)">
        {{ action.text }}
      </van-button>
    </div>
  </article>
</template>

<style scoped>
.app.urgent { border-color: var(--danger-line); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.tags { gap: 6px; flex-wrap: wrap; min-width: 0; }
.person { gap: 10px; }
.name { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.divider { height: 1px; background: var(--line); margin: 10px 0 4px; }
.kv { padding: 6px 0; font-size: 12.5px; }
.acts { display: flex; gap: 8px; margin-top: 12px; }
.act { flex: 1; min-width: 0; padding: 0 6px; border-radius: var(--r-sm); font-weight: 600; }
.act--main { flex: 1.8; }
</style>
