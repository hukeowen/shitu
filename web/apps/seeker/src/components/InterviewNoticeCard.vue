<script setup lang="ts">
import { computed } from 'vue'
import type { InterviewNoticeView } from '@shitu/api-client'
import { amapLink } from '@/utils/map'
import { telHref } from '@/utils/format'
import { formatServerTime, untilText } from '@/utils/time'

/** C-408 / S-24 驻场推送的面试信息（首页提醒卡、我的报备卡片内复用） */
const props = defineProps<{ notice: InterviewNoticeView }>()
const nav = computed(() => amapLink({ address: props.notice.address, name: props.notice.address }))
const tel = computed(() => telHref(props.notice.contactPhone))
const until = computed(() => untilText(props.notice.interviewAt))
</script>

<template>
  <dl class="notice">
    <div class="kv">
      <dt>面试时间</dt>
      <dd>
        <span>{{ formatServerTime(notice.interviewAt) }}</span>
        <span v-if="until" class="until">还有 {{ until }}</span>
      </dd>
    </div>
    <div class="kv">
      <dt>集合地点</dt>
      <dd>
        {{ notice.address }}
        <a v-if="nav" :href="nav" class="nav-link nav-line" target="_blank" rel="noopener" @click.stop>高德导航</a>
      </dd>
    </div>
    <div v-if="notice.routeTips" class="kv"><dt>路线提示</dt><dd>{{ notice.routeTips }}</dd></div>
    <div v-if="notice.documents?.length" class="kv"><dt>携带证件</dt><dd>{{ notice.documents.join('、') }}</dd></div>
    <div v-if="notice.contactName || notice.contactPhone" class="kv">
      <dt>驻场老师</dt>
      <dd>
        {{ notice.contactName }}<template v-if="notice.contactPhone"> · {{ notice.contactPhone }}</template>
        <a v-if="tel" :href="tel" class="nav-link" @click.stop>拨打</a>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.until { display: block; font-size: var(--font-size-min); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.nav-link { display: inline-block; margin: calc(var(--space-3) * -1) 0; padding: var(--space-3) 0 var(--space-3) var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--primary-text); white-space: nowrap; }
/* 地址可能很长：导航链接单独占一行，不跟着折行的末尾 */
.nav-line { display: block; padding-left: 0; }
.notice .kv { align-items: flex-start; }
/* 长地址、路线折行时各行尽量等长，不留孤字 */
.notice dd { word-break: normal; overflow-wrap: anywhere; text-wrap: balance; }
</style>
