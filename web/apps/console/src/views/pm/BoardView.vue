<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type PmBoard } from '@shitu/api-client'
import { canAccess } from '@/router/access'
import { MENU } from '@/router/menu'
import { useMeStore } from '@/stores/me'

/**
 * T-306 项目数据看板（项目经理 / 驻场，按负责项目聚合）：KPI 卡片可点击进入对应列表；
 * 右侧「待我处理」汇总预支审批、离职审核、知识库待补充（按权限各自加载，失败不影响看板）。
 * 后端对没有负责项目的成员返回空对象。
 */
const router = useRouter()
const meStore = useMeStore()

const board = ref<Partial<PmBoard> | null>(null)
const loading = ref(false)
const loadError = ref('')
const todo = ref<{ advances: number | null; resign: number | null; kb: number | null }>({ advances: null, resign: null, kb: null })

const empty = computed(() => board.value != null && Object.keys(board.value).length === 0)

function menuAccess(path: string) {
  return MENU.flatMap((g) => g.items).find((it) => it.path === path)?.access
}
function can(path: string) {
  return canAccess(meStore.me, menuAccess(path))
}

interface Card {
  key: keyof PmBoard
  label: string
  desc: string
  to?: { path: string; query?: Record<string, string> }
  tone?: string
}
const CARDS: Card[] = [
  { key: 'pendingInterview', label: '待面试', desc: '已报名 · 待到厂 / 面试结果', to: { path: '/site/todo', query: { tab: 'interview' } } },
  { key: 'pendingConfirm', label: '待确权', desc: '面试通过 · 待入职确权 / 签约', to: { path: '/site/onboard' }, tone: 'stat--signal' },
  { key: 'arrivedToday', label: '今日到厂', desc: '今天已确认到厂', to: { path: '/site/todo', query: { tab: 'arrived' } } },
  { key: 'employed', label: '在岗人数', desc: '当前在岗', to: { path: '/pm/staff' } },
  { key: 'hiredThisMonth', label: '本月入职', desc: '本月入职日期计', to: { path: '/pm/staff' } },
  { key: 'resignedThisMonth', label: '本月离职', desc: '本月离职日期计', to: { path: '/pm/resign' } },
  { key: 'recruitingJobs', label: '招聘中岗位', desc: '状态为招聘中', to: { path: '/pm/jobs' } },
]
const cards = computed(() => CARDS.map((c) => ({ ...c, link: c.to && can(c.to.path) ? c.to : undefined })))
const net = computed(() => (board.value?.hiredThisMonth ?? 0) - (board.value?.resignedThisMonth ?? 0))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    board.value = await tenantApi.reportBoard()
  } catch (e) {
    loadError.value = errorMessage(e, '看板加载失败')
    board.value = null
  } finally {
    loading.value = false
  }
  loadTodo()
}
async function loadTodo() {
  const [a, r, k] = await Promise.allSettled([
    can('/pm/advance') ? tenantApi.advances() : Promise.reject(new Error('skip')),
    meStore.can('RESIGN_AUDIT') ? tenantApi.resignRequests('PENDING') : Promise.reject(new Error('skip')),
    can('/pm/kb') ? tenantApi.kbPending() : Promise.reject(new Error('skip')),
  ])
  todo.value = {
    advances: a.status === 'fulfilled' ? a.value.filter((x) => x.allowedActions.length > 0).length : null,
    resign: r.status === 'fulfilled' ? r.value.length : null,
    kb: k.status === 'fulfilled' ? k.value.length : null,
  }
}
onMounted(load)

function go(to?: { path: string; query?: Record<string, string> }) {
  if (to) router.push(to)
}
const projectsText = computed(() => {
  const n = meStore.me?.roles.includes('OWNER') ? '全公司' : '负责项目'
  return `${n} · ${meStore.me?.name ?? ''}`
})
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h2>项目数据看板</h2>
        <p>{{ projectsText }} · 数据按负责项目聚合</p>
      </div>
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 14px">
      <el-button size="small" @click="load">重试</el-button>
    </el-alert>
    <div v-if="empty" class="note note--warn" style="margin-bottom: 14px">你还没有被分配负责项目，看板暂无数据。请联系老板在「组织与权限」中分配项目。</div>

    <div v-loading="loading" class="grid g-4">
      <div
        v-for="c in cards"
        :key="c.key"
        class="stat"
        :class="[c.tone, { 'stat--link': c.link }]"
        @click="go(c.link)"
      >
        <div class="stat-l">{{ c.label }}</div>
        <div class="stat-v">{{ board?.[c.key] ?? '—' }}</div>
        <div class="stat-d">{{ c.desc }}<span v-if="c.link" class="go"> →</span></div>
      </div>
      <div class="stat">
        <div class="stat-l">本月净增</div>
        <div class="stat-v" :style="{ color: net > 0 ? 'var(--ok)' : net < 0 ? 'var(--danger)' : undefined }">{{ board && !empty ? (net > 0 ? `+${net}` : net) : '—' }}</div>
        <div class="stat-d">本月入职 − 本月离职</div>
      </div>
    </div>

    <div class="grid g-32" style="margin-top: 14px">
      <div class="card">
        <div class="card__hd"><h3>待我处理</h3><span class="t-xs">按你的角色与负责项目</span></div>
        <div class="card__bd">
          <div v-if="todo.advances != null" class="lrow">
            <span class="tag tag--warn">预支审批</span>
            <div class="lt"><b>{{ todo.advances }} 笔预支待处理</b><span>初审 / 终审 / 登记拨款</span></div>
            <el-button size="small" @click="go({ path: '/pm/advance' })">去处理</el-button>
          </div>
          <div v-if="todo.resign != null" class="lrow">
            <span class="tag tag--info">离职审核</span>
            <div class="lt"><b>{{ todo.resign }} 份离职申请待审核</b><span>审核通过后结束任职</span></div>
            <el-button size="small" @click="go({ path: '/pm/resign' })">去审核</el-button>
          </div>
          <div v-if="todo.kb != null" class="lrow">
            <span class="tag tag--temp">知识库</span>
            <div class="lt"><b>{{ todo.kb }} 个求职者问题待补充答案</b><span>未命中知识库，补充后自动通知提问人</span></div>
            <el-button size="small" @click="go({ path: '/pm/kb', query: { tab: 'pending' } })">去补充</el-button>
          </div>
          <div v-if="board && (board.pendingConfirm ?? 0) > 0 && can('/site/onboard')" class="lrow">
            <span class="tag tag--signal">入职确权</span>
            <div class="lt"><b>{{ board.pendingConfirm }} 人面试通过待确权</b><span>24 小时内未确权将释放至公域</span></div>
            <el-button size="small" @click="go({ path: '/site/onboard' })">去确权</el-button>
          </div>
          <div v-if="todo.advances == null && todo.resign == null && todo.kb == null && !(board?.pendingConfirm)" class="t-sm dim">暂无待处理事项</div>
        </div>
      </div>

      <div class="card">
        <div class="card__hd"><h3>口径说明</h3></div>
        <div class="card__bd">
          <dl class="kv"><dt>统计范围</dt><dd>驻场 / 项目经理：负责项目</dd></dl>
          <dl class="kv"><dt>在岗</dt><dd>任职未结束</dd></dl>
          <dl class="kv"><dt>本月入职 / 离职</dt><dd>按入职日 / 离职日</dd></dl>
          <dl class="kv"><dt>今日到厂</dt><dd>今日完成到厂确认</dd></dl>
          <div class="note note--info" style="margin-top: 10px">看板只展示汇总数字，不含单个求职者信息；明细请进入对应列表查看。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.go { color: var(--signal-700); }
.lrow { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.lrow:last-child { border-bottom: 0; }
.lt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lt b { font-size: 13px; color: var(--ink-900); }
.lt span { font-size: 11.5px; color: var(--ink-500); }
</style>
