<script setup lang="ts">
import { computed } from 'vue'
import type { InterviewNoticeView } from '@shitu/api-client'
import { amapLink } from '@/utils/map'
import { telHref } from '@/utils/format'
import { formatServerTime, untilText } from '@/utils/time'

/** C-408 / S-24 驻场推送的面试信息（首页提醒卡、我的报备卡片内复用） */
const props = defineProps<{ notice: InterviewNoticeView; plain?: boolean }>()
const nav = computed(() => amapLink({ address: props.notice.address, name: props.notice.address }))
const tel = computed(() => telHref(props.notice.contactPhone))
const until = computed(() => untilText(props.notice.interviewAt))
</script>

<template>
  <dl class="notice" :class="{ plain }">
    <div class="kv">
      <dt>面试时间</dt>
      <dd>
        <span class="num">{{ formatServerTime(notice.interviewAt) }}</span>
        <span v-if="until" class="until">还有 {{ until }}</span>
      </dd>
    </div>
    <div class="kv">
      <dt>集合地点</dt>
      <dd>
        {{ notice.address }}
        <a v-if="nav" :href="nav" class="nav-link" target="_blank" rel="noopener" @click.stop>高德导航 ›</a>
      </dd>
    </div>
    <div v-if="notice.routeTips" class="kv"><dt>路线提示</dt><dd>{{ notice.routeTips }}</dd></div>
    <div v-if="notice.documents?.length" class="kv"><dt>携带证件</dt><dd>{{ notice.documents.join('、') }}</dd></div>
    <div v-if="notice.contactName || notice.contactPhone" class="kv">
      <dt>驻场老师</dt>
      <dd>
        {{ notice.contactName }}<template v-if="notice.contactPhone"> · <span class="num">{{ notice.contactPhone }}</span></template>
        <a v-if="tel" :href="tel" class="nav-link" @click.stop>拨打</a>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.until { display: block; font-size: 11px; color: var(--signal); font-weight: 500; }
.nav-link { display: inline-block; margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--info); white-space: nowrap; }
.notice .kv { border-color: rgba(112, 72, 168, .2); align-items: flex-start; }
.notice.plain .kv { border-color: var(--line); }
</style>
