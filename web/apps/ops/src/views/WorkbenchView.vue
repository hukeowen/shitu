<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useDict } from '@shitu/api-client'
import { MENU, PENDING_ROLES } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'
import { fmtDateTime } from '@/utils/format'

const auth = useAuthStore()
const pending = usePendingStore()
const { label } = useDict()

const canPending = computed(() => auth.hasAnyRole(PENDING_ROLES))

const cards = computed(() => {
  const c = pending.counts
  return [
    { key: 'companies', title: '待审核入驻', desc: '劳务公司入驻申请，核验营业执照与派遣许可', n: c?.companies, to: { path: '/companies/list', query: { status: 'PENDING_AUDIT' } } },
    { key: 'contracts', title: '待备案合同', desc: '劳务公司与甲方的合作合同，备案后才能发岗', n: c?.contracts, to: { path: '/governance/job-audit', query: { tab: 'contracts' } } },
    { key: 'jobs', title: '待审核岗位', desc: '按提交时间排队，通过后进入匹配池', n: c?.jobs, to: { path: '/governance/job-audit', query: { tab: 'jobs' } } },
  ]
})

const modules = computed(() =>
  MENU.flatMap((g) => g.items.filter((it) => it.ready && it.path !== '/workbench' && auth.hasAnyRole(it.roles)).map((it) => ({ ...it, group: g.title }))),
)

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? '夜深了' : h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好'
})

onMounted(() => pending.refresh())
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>{{ greeting }}，{{ auth.me?.displayName }}</h2>
        <p>
          角色：{{ auth.roles.map((r) => label('OpsRole', r)).join('、') || '—' }}
          <template v-if="auth.me?.lastLoginAt"> · 上次登录 {{ fmtDateTime(auth.me.lastLoginAt) }}</template>
        </p>
      </div>
      <div class="spacer" />
      <el-button v-if="canPending" size="small" :loading="pending.loading" @click="pending.refresh()">刷新待办</el-button>
    </div>

    <template v-if="canPending">
      <div v-if="pending.error" class="notice notice--danger err">待办加载失败：{{ pending.error }}</div>
      <div class="grid g-3">
        <router-link v-for="c in cards" :key="c.key" :to="c.to" class="stat todo" :class="{ hot: (c.n ?? 0) > 0 }">
          <div class="stat-l">{{ c.title }}</div>
          <div class="stat-v">
            <el-skeleton v-if="c.n == null && pending.loading" animated :rows="0" class="sk" />
            <template v-else>{{ c.n ?? '—' }}<small>项</small></template>
          </div>
          <div class="stat-d">{{ c.desc }}</div>
          <span class="go">去处理 →</span>
        </router-link>
      </div>
    </template>

    <div class="card mod">
      <div class="card__hd"><h3>我的功能</h3><span class="t-xs">根据账号角色显示</span></div>
      <div class="card__bd">
        <div v-if="modules.length" class="grid g-4">
          <router-link v-for="m in modules" :key="m.path" :to="m.path" class="mod-it">
            <span class="ref">{{ m.proto }}</span>
            <b>{{ m.title }}</b>
            <span class="t-xs">{{ m.group }}</span>
          </router-link>
        </div>
        <el-empty v-else :image-size="72" description="当前角色在 Sprint 1 暂无可用功能，后续版本开放" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.err { margin-bottom: 12px; }
.todo { position: relative; display: block; text-decoration: none; transition: .15s; box-shadow: var(--sh-1); }
.todo:hover { border-color: var(--ink-400); box-shadow: var(--sh-2); }
.todo.hot { border-color: var(--warn-line); }
.todo.hot .stat-v { color: var(--warn); }
.stat-v small { font-size: 13px; font-weight: 600; color: var(--ink-500); margin-left: 3px; }
.sk { width: 60px; }
.go { position: absolute; right: 16px; top: 14px; font-size: 12px; color: var(--signal-700); font-weight: 600; }
.mod { margin-top: 14px; }
.mod-it { display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-md); text-decoration: none; background: var(--surface-2); transition: .15s; }
.mod-it .ref { align-self: flex-start; }
.mod-it b { color: var(--ink-900); font-size: 14px; }
.mod-it:hover { border-color: var(--signal-300); background: var(--signal-50); }
</style>
