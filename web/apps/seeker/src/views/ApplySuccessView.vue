<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDict } from '@shitu/api-client'
import { useMatchSession } from '@/composables/useMatchSession'
import { formatServerTime } from '@/utils/time'

/** S-23 报名成功（C-407）：状态变更为待面试（临时私域），驻场在 24h 内联系 */
const router = useRouter()
const { label } = useDict()
const { match, profile } = useMatchSession()
const r = computed(() => match.applyResult)
if (!r.value) void router.replace('/reports')

const deadline = computed(() => formatServerTime(r.value?.responseDeadline))
</script>

<template>
  <div v-if="r" class="ok-page">
    <div class="pad top">
      <div class="ok-ic">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <h2>报名成功</h2>
      <p class="t-sm" style="margin-top: 6px">报名单号 <span class="mono strong">{{ r.applicationId }}</span></p>
    </div>

    <div class="pad-x stack">
      <section class="acard">
        <div class="acard-hd"><h4>报名岗位</h4></div>
        <div class="jt">{{ r.jobTitle }}</div>
        <div v-if="r.companyName" class="t-sm" style="margin-top: 2px">{{ r.companyName }}</div>
        <dl style="margin-top: 8px">
          <div v-if="r.interviewAddress" class="kv"><dt>面试地点</dt><dd>{{ r.interviewAddress }}</dd></div>
          <div v-if="r.responseDeadline" class="kv"><dt>驻场联系</dt><dd class="num">{{ deadline }} 前</dd></div>
        </dl>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>系统校验结果</h4></div>
        <div class="stack-sm">
          <div class="row"><span class="ck">✓</span><span class="t-sm flex1">同一时段无重复有效报名</span><span class="tag tag-ok">通过</span></div>
          <div class="row"><span class="ck">✓</span><span class="t-sm flex1">岗位剩余名额充足</span><span class="tag tag-ok">通过</span></div>
          <div class="row"><span class="ck">✓</span><span class="t-sm flex1">实名信息已绑定用户 ID</span><span class="tag tag-ok">通过</span></div>
        </div>
      </section>

      <section class="acard temp">
        <div class="acard-hd"><h4>你的状态已变更</h4></div>
        <div class="row" style="gap: 10px; flex-wrap: wrap">
          <span class="tag tag--lg tag-temp"><i class="dot"></i>{{ label('UserStatus', profile?.status ?? 'PENDING_INTERVIEW') }}</span>
          <span class="tag tag--lg tag-temp">{{ label('DomainTag', profile?.domainTag ?? 'TEMP_PRIVATE') }}</span>
        </div>
        <p class="t-xs temp-d">你已被锁定在{{ r.companyName || '该公司' }}的岗位池，<b>面试结果出来前不能再次匹配或报名其他岗位</b>。</p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>接下来</h4></div>
        <ul class="tl">
          <li class="done"><div class="tl-t">报名记录已生成</div><div class="tl-m">刚刚</div></li>
          <li class="now">
            <div class="tl-t">系统已通知驻场</div>
            <div class="tl-m">驻场会在 {{ deadline }} 前联系你，并推送面试确认信息</div>
          </li>
          <li><div class="tl-t">收到面试确认信息</div><div class="tl-m">时间 · 地点 · 路线 · 证件清单</div></li>
          <li><div class="tl-t">按时到厂面试</div><div class="tl-m">驻场执行「到厂确认」</div></li>
        </ul>
      </section>

      <div class="note note--warn"><b>无法自行取消报名。</b>如误操作或需更换岗位，请联系驻场老师在后台操作取消，取消后可重新进入 AI 问薪。</div>

      <van-button type="primary" block class="btn-cta" @click="router.replace('/reports')">查看我的报备</van-button>
      <van-button block class="btn-cta" @click="router.replace('/')">回首页</van-button>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.ok-page { min-height: 100vh; background: var(--surface-2); }
.top { padding-top: calc(30px + env(safe-area-inset-top)); text-align: center; }
.ok-ic { width: 70px; height: 70px; border-radius: 22px; background: var(--ok); color: #fff; display: grid; place-items: center; margin: 0 auto 16px; }
.top h2 { font-size: 21px; font-weight: 700; color: var(--ink-900); }
.jt { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.ck { color: var(--ok); }
.temp { border-color: var(--temp-line); background: var(--temp-bg); }
.temp h4 { color: var(--temp); }
.temp-d { color: var(--temp); margin-top: 10px; line-height: 1.7; }
.temp-d b { color: var(--temp); }
</style>
