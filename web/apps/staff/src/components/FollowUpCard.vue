<script setup lang="ts">
import { computed } from 'vue'
import { useDict, type PrivatePendingRow, type SiteApplication, type SiteApplicationAction } from '@shitu/api-client'
import { IconBriefcase, IconChevronRight, IconClock, IconPhone } from '@shitu/ui-icons'
import { FOLLOW_KIND_TAG, followRemain, type FollowBlocked, type FollowItem } from '@/composables/useFollowUps'
import { DOMAIN_TONE, splitActions } from '@/utils/actions'
import { fmtPhone, fmtTime } from '@/utils/time'

/**
 * 一条 24 小时窗口内要跟进的人（跟进提醒页、工作台「今日待办」共用）：姓名 + 归属 + 剩余时间、事实、拨打 + 当前阶段的主按钮。
 * 已超时或不足 4 小时：整张卡片左侧红条 + 浅红底，不只是倒计时数字变红。
 */
const props = defineProps<{ item: FollowItem; now: number; blocked?: FollowBlocked | null }>()
const emit = defineEmits<{ run: [app: SiteApplication, action: SiteApplicationAction]; transfer: [p: PrivatePendingRow] }>()
const { label } = useDict()

const remain = computed(() => followRemain(props.item, props.now))
const nowDate = computed(() => new Date(props.now))
const main = computed(() => {
  if (!props.item.a) return null
  const m = splitActions(props.item.a).main
  return m[m.length - 1] ?? null
})
const pendingSign = computed(() => props.item.kind === 'confirm' && props.item.a?.contract?.status === 'PENDING_SIGN')

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
</script>

<template>
  <article class="acard item" :class="{ 'item--urgent': remain?.urgent }">
    <div class="item-hd">
      <div class="who">
        <router-link v-if="item.a" :to="`/applications/${item.a.applicationId}`" class="name-link"><h3>{{ item.a.seekerName }}</h3><IconChevronRight :size="16" class="chev" /></router-link>
        <h3 v-else-if="item.p">{{ item.p.seekerName }}</h3>
        <span v-if="item.a" class="status-tag" :class="`status-tag--${DOMAIN_TONE[item.a.fromPublic ? 'PUBLIC' : 'PRIVATE']}`">{{ label('DomainTag', item.a.fromPublic ? 'PUBLIC' : 'PRIVATE') }}</span>
        <span v-else class="status-tag status-tag--private">{{ label('DomainTag', 'PRIVATE') }}</span>
      </div>
      <div v-if="remain" class="left" :class="remain.urgent ? 'urgent' : 'soon'">
        <small>{{ remain.urgent ? `紧急 · ${remain.label}` : remain.label }}</small><b>{{ remain.text }}</b>
      </div>
    </div>

    <!-- 私域待匹配 -->
    <template v-if="item.p">
      <ul class="facts">
        <li><IconBriefcase :size="16" /><span>尚未报名 · 待跟进匹配</span></li>
        <li><IconClock :size="16" /><span>{{ fmtTime(item.p.registeredAt, nowDate) }} 注册 · {{ sourceOf(item.p).text }}<small v-if="sourceOf(item.p).code" class="src-code">{{ sourceOf(item.p).code }}</small></span></li>
        <li><IconPhone :size="16" /><span>{{ fmtPhone(item.p.phone) }}</span></li>
      </ul>
      <p class="item-meta"><span class="status-tag" :class="`status-tag--${FOLLOW_KIND_TAG.private.tone}`">{{ FOLLOW_KIND_TAG.private.text }}</span></p>
      <div class="acts">
        <van-button class="act act--call" :url="`tel:${item.p.phone}`"><template #icon><IconPhone :size="18" /></template>立即拨打</van-button>
        <van-button class="act act--main" :type="item.p.inBrokerPool ? 'default' : 'primary'" :disabled="item.p.inBrokerPool || !!blocked" @click="emit('transfer', item.p)">
          {{ item.p.inBrokerPool ? '已在流转池' : '一键流转经纪人' }}
        </van-button>
      </div>
      <p v-if="blocked" class="why" role="status">{{ blocked.text }}</p>
    </template>

    <!-- 报名待知悉 / 待面试 / 已到厂 / 待确权 -->
    <template v-else-if="item.a">
      <ul class="facts">
        <li><IconBriefcase :size="16" /><span>{{ item.a.jobTitle ?? '—' }}<template v-if="item.a.projectName"> · <span class="nw">{{ item.a.projectName }}</span></template></span></li>
        <li>
          <IconClock :size="16" />
          <span>
            <template v-if="item.kind === 'ack'">{{ fmtTime(item.a.createdAt, nowDate) }} 报名 · 尚未推送面试信息</template>
            <template v-else-if="item.kind === 'interview'">已推送面试信息 · 待到厂面试</template>
            <template v-else-if="item.kind === 'arrived'">已到厂 · 待录入面试结果</template>
            <template v-else-if="pendingSign">已确权 · 合同{{ label('ContractStatus', 'PENDING_SIGN') }}</template>
            <template v-else>面试已通过 · 待入职确权</template>
          </span>
        </li>
        <li v-if="item.a.phone"><IconPhone :size="16" /><span>{{ fmtPhone(item.a.phone) }}</span></li>
      </ul>
      <p class="item-meta"><span class="status-tag" :class="`status-tag--${pendingSign ? 'warning' : FOLLOW_KIND_TAG[item.kind].tone}`">{{ pendingSign ? '合同待签署' : FOLLOW_KIND_TAG[item.kind].text }}</span></p>
      <div v-if="item.a.phone || main" class="acts">
        <van-button v-if="item.a.phone" class="act act--call" :url="`tel:${item.a.phone}`"><template #icon><IconPhone :size="18" /></template>拨打</van-button>
        <van-button v-if="main" type="primary" class="act act--main" :disabled="blocked?.action === main.key" @click="emit('run', item.a, main.key)">
          {{ main.text }}
        </van-button>
      </div>
      <p v-if="blocked" class="why" role="status">{{ blocked.text }}</p>
    </template>
  </article>
</template>

<style scoped>
/* 已超时 / 不足 4 小时：整张卡片标红（左侧红条 + 浅红底） */
.item--urgent { border-left: 4px solid var(--danger-solid); background: var(--danger-soft); }
.who { display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex-wrap: wrap; }
.name-link { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; margin: calc(var(--space-3) * -1) 0; color: inherit; text-decoration: none; min-width: 0; }
.name-link .chev { flex: none; color: var(--text-3); }
.left { flex: none; text-align: right; line-height: 1.2; }
.left small { display: block; font-size: var(--font-size-min); color: var(--text-3); }
.left b { display: block; margin-top: 2px; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); }
.left.urgent small { color: var(--danger-text); font-weight: var(--font-weight-semibold); }
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
</style>
