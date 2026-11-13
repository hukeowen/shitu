<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, tenantApi, type PmBoard } from '@shitu/api-client'
import {
  IconBriefcase,
  IconBuildingComplex,
  IconCircleExclamationPoint,
  IconClipboardList,
  IconFactory,
  IconUserCheck,
  IconUsers,
} from '@shitu/ui-icons'
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
/** 待我处理拿到结果之前不下「暂无待处理事项」的结论 */
const todoLoading = ref(true)

const empty = computed(() => board.value != null && Object.keys(board.value).length === 0)

function menuAccess(path: string) {
  return MENU.flatMap((g) => g.items).find((it) => it.path === path)?.access
}
function can(path: string) {
  return canAccess(meStore.me, menuAccess(path))
}

type Link = { path: string; query?: Record<string, string> }
interface Card {
  key: keyof PmBoard
  label: string
  desc: string
  to?: Link
  icon?: Component
}
/** 一排五张指标卡（规范第 1 类）；本月入职 / 离职 / 净增放进主体的「本月人员变动」 */
const KPIS: Card[] = [
  { key: 'pendingInterview', label: '待面试', desc: '已报名 · 待到厂 / 面试结果', to: { path: '/site/todo', query: { tab: 'interview' } }, icon: IconClipboardList },
  { key: 'pendingConfirm', label: '待确权', desc: '面试通过 · 待入职确权 / 签约', to: { path: '/site/onboard' }, icon: IconUserCheck },
  { key: 'arrivedToday', label: '今日到厂', desc: '今天已确认到厂', to: { path: '/site/todo', query: { tab: 'arrived' } }, icon: IconFactory },
  { key: 'employed', label: '在岗人数', desc: '当前在岗', to: { path: '/pm/staff' }, icon: IconUsers },
  { key: 'recruitingJobs', label: '招聘中岗位', desc: '状态为招聘中', to: { path: '/pm/jobs' }, icon: IconBriefcase },
]
const MONTH: Card[] = [
  { key: 'hiredThisMonth', label: '本月入职', desc: '本月入职日期计', to: { path: '/pm/staff' } },
  { key: 'resignedThisMonth', label: '本月离职', desc: '本月离职日期计', to: { path: '/pm/resign' } },
]
const withLink = (c: Card) => ({ ...c, link: c.to && can(c.to.path) ? c.to : undefined })
const kpis = computed(() => KPIS.map(withLink))
const month = computed(() => MONTH.map(withLink))
/** 拿到了数据（没拿到或没有负责项目时，数字显示「—」） */
const ready = computed(() => board.value != null && !empty.value)
const num = (k: keyof PmBoard) => (ready.value ? (board.value?.[k] ?? '—') : '—')
const net = computed(() => (board.value?.hiredThisMonth ?? 0) - (board.value?.resignedThisMonth ?? 0))
/** 净增带 +/−，不靠颜色区分增减 */
const netText = computed(() => (!ready.value ? '—' : net.value > 0 ? `+${net.value}` : net.value < 0 ? `−${-net.value}` : '0'))

async function load() {
  // 待我处理是独立请求的区块，和看板同时取，各自带加载遮罩
  loadTodo()
  loading.value = true
  loadError.value = ''
  board.value = null
  try {
    board.value = await tenantApi.reportBoard()
  } catch (e) {
    loadError.value = errorMessage(e, '看板加载失败')
    board.value = null
  } finally {
    loading.value = false
  }
}
async function loadTodo() {
  todoLoading.value = true
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
  todoLoading.value = false
}
onMounted(load)

function go(to?: Link) {
  if (to) router.push(to)
}
const projectsText = computed(() => {
  const n = meStore.me?.roles.includes('OWNER') ? '全公司' : '负责项目'
  return `${n} · ${meStore.me?.name ?? ''}`
})
const noTodo = computed(() => todo.value.advances == null && todo.value.resign == null && todo.value.kb == null && !board.value?.pendingConfirm)
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

    <div v-loading="loading" class="kpis">
      <div
        v-for="c in kpis"
        :key="c.key"
        class="stat stat--icon"
        :class="{ 'stat--link': c.link }"
        :role="c.link ? 'link' : undefined"
        :tabindex="c.link ? 0 : undefined"
        @click="go(c.link)"
        @keydown.enter.space.prevent="go(c.link)"
      >
        <component :is="c.icon" :size="20" class="stat-i" />
        <div class="stat-l">{{ c.label }}</div>
        <div class="stat-v">{{ num(c.key) }}</div>
        <div class="stat-d">{{ c.desc }}</div>
      </div>
    </div>

    <div v-if="loadError" class="card blk-gap">
      <div class="state-box">
        <IconCircleExclamationPoint :size="48" />
        <h4>{{ loadError }}</h4>
        <p>请检查网络后重新加载</p>
        <el-button @click="load">重新加载</el-button>
      </div>
    </div>
    <div v-else-if="empty" class="card blk-gap">
      <div class="state-box">
        <IconBuildingComplex :size="48" />
        <h4>你还没有被分配负责项目</h4>
        <p>看板按负责项目汇总数据。请联系老板在「组织与权限」中分配项目，分配后这里显示项目数据</p>
      </div>
    </div>

    <div class="body">
      <div class="card">
        <div class="card__hd"><h3>待我处理</h3><span class="hint">按你的角色与负责项目</span></div>
        <div v-loading="todoLoading" class="card__bd todo">
          <div v-if="todo.advances != null" class="lrow">
            <span class="lrow-tag status-tag status-tag--warning">预支审批</span>
            <div class="lt"><b>{{ todo.advances }} 笔预支待处理</b><span>初审 / 终审 / 登记拨款</span></div>
            <el-button size="small" @click="go({ path: '/pm/advance' })">去处理</el-button>
          </div>
          <div v-if="todo.resign != null" class="lrow">
            <span class="lrow-tag status-tag status-tag--info">离职审核</span>
            <div class="lt"><b>{{ todo.resign }} 份离职申请待审核</b><span>审核通过后结束任职</span></div>
            <el-button size="small" @click="go({ path: '/pm/resign' })">去审核</el-button>
          </div>
          <div v-if="todo.kb != null" class="lrow">
            <span class="lrow-tag status-tag status-tag--pending">知识库</span>
            <div class="lt"><b>{{ todo.kb }} 个求职者问题待补充答案</b><span>未命中知识库，补充后自动通知提问人</span></div>
            <el-button size="small" @click="go({ path: '/pm/kb', query: { tab: 'pending' } })">去补充</el-button>
          </div>
          <div v-if="board && (board.pendingConfirm ?? 0) > 0 && can('/site/onboard')" class="lrow">
            <span class="lrow-tag status-tag status-tag--info">入职确权</span>
            <div class="lt"><b>{{ board.pendingConfirm }} 人面试通过待确权</b><span>24 小时内未确权将释放至公域</span></div>
            <el-button size="small" @click="go({ path: '/site/onboard' })">去确权</el-button>
          </div>
          <p v-if="!todoLoading && !loading && noTodo" class="hint none">暂无待处理事项</p>
        </div>
      </div>

      <div class="col-r">
        <div class="card">
          <div class="card__hd"><h3>本月人员变动</h3></div>
          <div class="card__bd month">
            <div
              v-for="c in month"
              :key="c.key"
              class="m-cell"
              :class="{ 'm-link': c.link }"
              :role="c.link ? 'link' : undefined"
              :tabindex="c.link ? 0 : undefined"
              @click="go(c.link)"
              @keydown.enter.space.prevent="go(c.link)"
            >
              <span class="m-l">{{ c.label }}</span>
              <b class="m-v">{{ num(c.key) }}</b>
              <span class="m-d">{{ c.desc }}</span>
            </div>
            <div class="m-cell">
              <span class="m-l">本月净增</span>
              <b class="m-v">{{ netText }}</b>
              <span class="m-d">本月入职 − 本月离职</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__hd"><h3>口径说明</h3></div>
          <div class="card__bd">
            <dl class="kv"><dt>统计范围</dt><dd>驻场 / 项目经理：负责项目</dd></dl>
            <dl class="kv"><dt>在岗</dt><dd>任职未结束</dd></dl>
            <dl class="kv"><dt>本月入职 / 离职</dt><dd>按入职日 / 离职日</dd></dl>
            <dl class="kv"><dt>今日到厂</dt><dd>今日完成到厂确认</dd></dl>
            <p class="hint foot">看板只展示汇总数字，不含单个求职者信息；明细请进入对应列表查看。</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-gap); }
.blk-gap { margin-top: var(--space-gap); }
.body { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--space-gap); margin-top: var(--space-gap); align-items: start; }
.col-r { display: grid; gap: var(--space-gap); }
.hint { font-size: var(--font-size-aux); color: var(--text-3); }
.todo { min-height: 120px; padding-top: var(--space-1); padding-bottom: var(--space-1); }
.lrow { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--divider); }
.lrow:last-of-type { border-bottom: 0; }
.lrow-tag { flex: none; width: 72px; justify-content: center; }
.lt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.lt b { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.lt span { font-size: var(--font-size-min); color: var(--text-3); }
.none { margin: 0; padding: var(--space-6) 0; text-align: center; }
.month { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.m-cell { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; padding: var(--space-2); border-radius: var(--radius-control); }
.m-link { cursor: pointer; }
.m-link:hover { background: var(--bg-hover); }
.m-l { font-size: var(--font-size-aux); color: var(--text-2); }
.m-v { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--text-1); font-variant-numeric: tabular-nums; }
.m-d { font-size: var(--font-size-min); color: var(--text-3); }
.foot { margin: var(--space-3) 0 0; line-height: 1.6; }
</style>
