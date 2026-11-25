<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDict } from '@shitu/api-client'
import { IconCheck, IconChevronRight, IconCircleCheck, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import DeadlineBar from '@/components/DeadlineBar.vue'
import { useMatchSession } from '@/composables/useMatchSession'
import { STATUS_TONE, deadlineCopy } from '@/utils/status'
import { formatServerTime } from '@/utils/time'

/** S-23 报名成功（C-407）：状态变更为待面试（临时私域），驻场在 24h 内联系 */
const router = useRouter()
const { label } = useDict()
const { match, profile } = useMatchSession()
const r = computed(() => match.applyResult)
if (!r.value) void router.replace('/reports')

const deadline = computed(() => formatServerTime(r.value?.responseDeadline))
const status = computed(() => profile.value?.status ?? 'PENDING_INTERVIEW')
const CHECKS = ['你没有别的报名在进行', '这个岗位还有名额', '实名信息已核对']
const dlCopy = deadlineCopy('PENDING_INTERVIEW')
</script>

<template>
  <div v-if="r" class="ok-page">
    <AppBar title="报名成功" :back="false" />

    <div class="pad stack">
      <section class="state-block head">
        <IconCircleCheck :size="48" :stroke-width="1.5" />
        <h1 class="state-block-t">报名成功</h1>
        <p class="state-block-d">报名编号 <span class="code">{{ r.applicationId }}</span></p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>报名岗位</h4></div>
        <div class="jt">{{ r.jobTitle }}</div>
        <p v-if="r.companyName" class="jd">{{ r.companyName }}</p>
        <dl v-if="r.interviewAddress" class="jkv">
          <div class="kv"><dt>面试地点</dt><dd>{{ r.interviewAddress }}</dd></div>
        </dl>
        <DeadlineBar v-if="r.responseDeadline" class="dl-gap" :deadline="r.responseDeadline" v-bind="dlCopy" />
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>接下来</h4></div>
        <ul class="tl">
          <li class="done"><div class="tl-t">报名记录已生成<span class="status-tag status-tag--success">已完成</span></div><div class="tl-m">刚刚</div></li>
          <li class="now">
            <div class="tl-t">系统已通知驻场<span class="status-tag status-tag--info">进行中</span></div>
            <div class="tl-m">驻场会在 {{ deadline }} 前联系你，并推送面试确认信息</div>
          </li>
          <li><div class="tl-t">收到面试确认信息</div><div class="tl-m">时间 · 地点 · 路线 · 证件清单</div></li>
          <li><div class="tl-t">按时到厂面试</div><div class="tl-m">到了厂里，驻场老师会帮你登记到场</div></li>
        </ul>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>你的状态已变更</h4></div>
        <div class="tags">
          <span class="status-tag" :class="STATUS_TONE[status]"><i class="dot"></i>{{ label('UserStatus', status) }}</span>
          <span class="status-tag status-tag--pending">{{ label('DomainTag', profile?.domainTag ?? 'TEMP_PRIVATE') }}</span>
        </div>
        <p class="lock-d">现在只等{{ r.companyName || '这家公司' }}给你安排面试，<b class="strong">面试结果出来前不能再匹配，也不能报名别的岗位</b>。</p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>报名前已帮你核对</h4></div>
        <ul class="cks">
          <li v-for="c in CHECKS" :key="c"><IconCheck :size="16" :stroke-width="2.25" /><span class="flex1">{{ c }}</span><span class="status-tag status-tag--success">通过</span></li>
        </ul>
      </section>

      <section class="tipbar tipbar--warn">
        <IconTriangleExclamationPoint :size="20" />
        <div class="flex1">
          <div class="tipbar-t">无法自行取消报名。</div>
          <div class="tipbar-d">如误操作或需更换岗位，可在「我的报名」里申请取消报名，驻场老师同意后即可重新进入 AI 问薪。</div>
        </div>
      </section>

      <button type="button" class="link home" @click="router.replace('/')">回首页<IconChevronRight :size="16" /></button>
      <div class="bottom-bar-gap"></div>
    </div>

    <div class="bottom-bar">
      <van-button type="primary" size="large" block @click="router.replace('/reports')">查看我的报名</van-button>
    </div>
  </div>
</template>

<style scoped>
.ok-page { min-height: 100vh; }
.head { padding: var(--space-4) 0 var(--space-2); }
.head > svg { color: var(--success-text); }
.code { font-family: var(--font-mono); color: var(--text-1); }
.jt { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); line-height: 24px; color: var(--text-1); }
.jd { margin-top: 2px; font-size: var(--font-size-aux); color: var(--text-3); }
.jkv { margin-top: var(--space-2); }
.dl-gap { margin-top: var(--space-3); }
/* 长地址折行时两行尽量等长，不留孤字 */
.jkv dd { word-break: normal; overflow-wrap: anywhere; text-wrap: balance; }
.tl-t .status-tag { margin-left: var(--space-2); vertical-align: 1px; }
.tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.lock-d { margin-top: var(--space-3); font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.cks { display: grid; gap: var(--space-3); }
.cks li { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-body); color: var(--text-2); }
.cks svg { flex: none; color: var(--success-text); }
.home { justify-self: center; min-height: 44px; }
</style>
