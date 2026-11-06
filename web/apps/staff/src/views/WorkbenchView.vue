<script setup lang="ts">
import { DomainTag } from '@shitu/ui-mobile'
import type { Domain } from '@shitu/ui-mobile'

/** M-01 驻场工作台。数据接口在 Sprint 2/3 接入，当前为静态占位 */
const kpis = [
  { label: '今日到厂', value: 0, unit: '人' },
  { label: '今日确权', value: 0, unit: '人' },
  { label: '本月入职', value: 0, unit: '人' },
  { label: '在岗人数', value: 0, unit: '人' },
]

const todos = [
  { key: 'interview', title: '待面试', desc: '已报名待面试', count: 0, to: '/todo/interview' },
  { key: 'confirm', title: '待确权', desc: '已到厂待确权', count: 0, to: '/todo/confirm' },
  { key: 'onboard', title: '待入职', desc: '待办总入口', count: 0, to: '/todo/onboard' },
  { key: 'advance', title: '预支初审', desc: '待你初审', count: 0, to: '/advance' },
]

const sample: { name: string; job: string; domain: Domain }[] = []
</script>

<template>
  <div class="wb">
    <header class="hero">
      <div class="avatar">驻</div>
      <div>
        <div class="name">驻场老师</div>
        <div class="sub">登录后显示所属公司 · 负责项目</div>
      </div>
    </header>

    <section class="kpis">
      <div v-for="k in kpis" :key="k.label" class="kpi">
        <b class="num">{{ k.value }}</b><small>{{ k.unit }}</small>
        <span>{{ k.label }}</span>
      </div>
    </section>

    <section class="alert">
      <b>24 小时响应窗口</b>
      <p>私域用户每个阶段完成后 24 小时内必须跟进，超时系统将被动释放至公域。</p>
    </section>

    <section class="todo">
      <router-link v-for="t in todos" :key="t.key" :to="t.to" class="cell">
        <span class="t">{{ t.title }}</span>
        <span class="d">{{ t.desc }}</span>
        <b class="num">{{ t.count }}</b>
      </router-link>
    </section>

    <section class="list">
      <h3>今日待办</h3>
      <van-empty v-if="sample.length === 0" image-size="64" description="暂无待办" />
      <div v-for="s in sample" :key="s.name" class="row">
        {{ s.name }} · {{ s.job }} <DomainTag :domain="s.domain" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.wb { padding: 16px; }
.hero { display: flex; gap: 12px; align-items: center; padding: 16px; color: #fff; background: var(--chrome); border-radius: var(--r-lg); }
.avatar { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--chrome-3); font-weight: 700; }
.name { font-size: 17px; font-weight: 700; }
.sub { font-size: 12px; color: var(--ink-300); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.kpi { padding: 10px 8px; background: var(--surface); border-radius: var(--r-md); box-shadow: var(--sh-1); text-align: center; }
.kpi b { font-size: 20px; color: var(--ink-900); }
.kpi small { font-size: 11px; color: var(--ink-500); margin-left: 2px; }
.kpi span { display: block; font-size: 11px; color: var(--ink-500); margin-top: 2px; }
.alert { margin-top: 12px; padding: 12px; background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: var(--r-md); color: var(--warn); }
.alert p { margin: 4px 0 0; font-size: 12px; line-height: 1.6; }
.todo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.cell { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); color: inherit; text-decoration: none; }
.cell .t { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.cell .d { font-size: 12px; color: var(--ink-500); }
.cell b { position: absolute; right: 14px; top: 12px; font-size: 22px; color: var(--signal); }
.list { margin-top: 14px; padding: 14px; background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--sh-1); }
.list h3 { margin: 0; font-size: 15px; }
</style>
