<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, useDict } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'

/** M-01 驻场工作台（Sprint 1：身份信息 + 入口；待办 / KPI 数据在 Sprint 2+ 接入） */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const me = computed(() => auth.me)
const loading = ref(false)
const loadError = ref('')

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    const m = await auth.loadMe()
    if (!m.operational) await router.replace('/notice')
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
if (!auth.me) void reload()

const roleText = computed(() => (me.value?.roles ?? []).map((r) => label('ActorRole', r)).join(' / '))
const companyName = computed(() => me.value?.company.shortName || me.value?.company.name || '')
const canMyCode = computed(() => auth.can('CHANNEL_MINE'))

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const kpis = ['今日到厂', '今日确权', '本月入职', '在岗人数']

interface Entry {
  key: string
  title: string
  desc: string
  icon: string
}
const entries: Entry[] = [
  { key: 'interview', title: '待面试', desc: '已报名待面试', icon: 'calendar-o' },
  { key: 'confirm', title: '待确权', desc: '已到厂待确权', icon: 'passed' },
  { key: 'onboard', title: '待入职', desc: '待办总入口', icon: 'todo-list-o' },
  { key: 'advance', title: '预支初审', desc: '待你初审', icon: 'balance-o' },
]

function soon() {
  showToast('即将上线')
}
</script>

<template>
  <div class="wb">
    <template v-if="me">
      <header class="hero">
        <div class="hero-top">
          <div class="avatar avatar--o">{{ me.name.slice(0, 1) }}</div>
          <div class="who">
            <b>{{ greeting }}，{{ me.name }}</b>
            <span class="sub">{{ companyName }}<template v-if="roleText"> · {{ roleText }}</template></span>
          </div>
        </div>
        <div class="hero-meta">
          <div v-for="k in kpis" :key="k">{{ k }}<b class="num">—</b></div>
        </div>
      </header>

      <div class="pad stack">
        <router-link v-if="canMyCode" to="/my-code" class="acard mycode">
          <div class="qr-ic"><van-icon name="qr" size="26" /></div>
          <div class="flex1">
            <b>我的专属码</b>
            <span>求职者扫码注册即成为本公司私域用户</span>
          </div>
          <van-icon name="arrow" class="chev" />
        </router-link>

        <section class="acard info">
          <b>24 小时响应窗口</b>
          <p>私域用户每个阶段完成后 24 小时内必须跟进，超时系统将被动释放至公域。跟进提醒将在后续版本上线。</p>
        </section>

        <div class="quad">
          <button v-for="e in entries" :key="e.key" type="button" class="quad-i has-pill" @click="soon">
            <div class="ic"><van-icon :name="e.icon" size="18" /></div>
            <div class="flex1"><b>{{ e.title }}</b><span>{{ e.desc }}</span></div>
            <i class="pill">即将上线</i>
          </button>
        </div>

        <section class="acard">
          <div class="acard-hd"><h4>今日待办</h4></div>
          <div class="empty-box">
            <van-icon name="todo-list-o" size="32" class="empty-ic" />
            <div class="t-sm">暂无待办</div>
            <div class="t-xs" style="margin-top: 4px">求职者报名后，面试 / 到厂 / 确权待办将在此展示</div>
          </div>
        </section>
      </div>
    </template>

    <div v-else-if="loading" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else class="state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="reload">重新加载</van-button>
      </van-empty>
    </div>
  </div>
</template>

<style scoped>
.hero-top .who .sub { font-family: var(--f-cn); }
.mycode { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; border-color: var(--signal-300); background: linear-gradient(180deg, var(--signal-50), var(--surface)); }
.qr-ic { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--signal); color: #fff; }
.mycode b { display: block; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.mycode span { display: block; font-size: 12px; color: var(--ink-500); margin-top: 2px; }
.mycode .chev { color: var(--ink-300); }
.info { border-color: var(--warn-line); background: var(--warn-bg); color: var(--warn); }
.info b { font-size: 13.5px; }
.info p { margin-top: 4px; font-size: 12px; line-height: 1.6; }
.quad-i .pill { font-family: var(--f-cn); }
.empty-ic { display: block; margin-bottom: 8px; opacity: .5; }
.state { padding-top: calc(80px + env(safe-area-inset-top)); }
</style>
