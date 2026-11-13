<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { logout, useDict } from '@shitu/api-client'
import BrandMark from '@/components/BrandMark.vue'
import DictTag from '@/components/DictTag.vue'
import MessageBell from '@/components/MessageBell.vue'
import { visibleMenu } from '@/router/access'
import { APP_TITLE } from '@/router/menu'
import { useMeStore } from '@/stores/me'

const route = useRoute()
const router = useRouter()
const meStore = useMeStore()
const { label } = useDict()

const menu = computed(() => visibleMenu(meStore.me))
const company = computed(() => meStore.me?.company)
const companyName = computed(() => company.value?.shortName || company.value?.name || '')
const roleText = computed(() => (meStore.me?.roles ?? []).map((r) => label('ActorRole', r)).join(' · '))

/** 当前路由对应的菜单项：精确匹配优先，其次是子页面（如 /pm/jobs/edit 归到「岗位管理」）；隐藏项不参与高亮 */
const activePath = computed(() => {
  const items = menu.value.flatMap((g) => g.items.filter((x) => !x.hidden))
  const hit = items.find((it) => it.path === route.path) ?? items.filter((it) => route.path.startsWith(it.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
  return hit?.path ?? ''
})
/** 面包屑的分组名以菜单为准（当前角色看得到的那个分组），保证和侧栏高亮一致；不在菜单里的页面（404）只显示标题 */
const crumbGroup = computed(() => menu.value.find((g) => g.items.some((it) => it.path === activePath.value))?.title ?? '')

/**
 * 菜单较长时，靠下的菜单项（费用账单、公司设置…）会在滚动区之外，看起来像没有选中。
 * 进入页面和每次切换路由后把当前项滚进可视范围；底部渐隐条提示下面还有内容，滚到底时隐藏。
 */
const navEl = ref<HTMLElement | null>(null)
const navMore = ref(false)
function updateNavMore() {
  const el = navEl.value
  navMore.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 8
}
async function revealActive() {
  await nextTick()
  navEl.value?.querySelector<HTMLElement>('.item.is-active')?.scrollIntoView({ block: 'nearest' })
  updateNavMore()
}
watch([() => route.path, menu], revealActive, { flush: 'post' })
onMounted(() => {
  revealActive()
  window.addEventListener('resize', updateNavMore)
})

async function doLogout() {
  try {
    await ElMessageBox.confirm('确定退出登录？', '退出', { confirmButtonText: '退出', cancelButtonText: '取消', type: 'warning' })
  } catch {
    return
  }
  await logout().catch(() => undefined)
  meStore.clear()
  router.replace('/login')
}
</script>

<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <BrandMark />
        <b>{{ APP_TITLE }}</b>
      </div>
      <div v-if="company" class="tenant">
        <div class="avatar">{{ companyName.slice(0, 1) }}</div>
        <div class="tn">
          <b :title="company.name">{{ company.name }}</b>
          <span>{{ company.creditScore != null ? `诚信分 ${company.creditScore}` : company.unifiedCreditCode }}</span>
        </div>
      </div>
      <div class="nav-wrap" :class="{ 'has-more': navMore }">
        <nav ref="navEl" class="nav" @scroll.passive="updateNavMore">
          <template v-for="g in menu" :key="g.key">
            <div class="grp">{{ g.title }}</div>
            <router-link v-for="it in g.items.filter((x) => !x.hidden)" :key="it.path" :to="it.path" class="item" :class="{ 'is-active': it.path === activePath }">
              {{ it.title }}
            </router-link>
          </template>
        </nav>
      </div>
      <div class="side-user">
        <div class="avatar avatar--u">{{ meStore.me?.name.slice(0, 1) }}</div>
        <div class="su">
          <b>{{ meStore.me?.name }}</b>
          <span>{{ roleText }}</span>
        </div>
      </div>
    </aside>
    <section class="main">
      <header class="top">
        <div class="crumb">
          <template v-if="crumbGroup">
            <span>{{ crumbGroup }}</span>
            <span>/</span>
          </template>
          <b>{{ route.meta.title }}</b>
        </div>
        <span class="spacer" />
        <div v-if="company" class="who">
          <span class="cn">{{ companyName }}</span>
          <DictTag type="CompanyStatus" :value="company.status" />
        </div>
        <span class="sep" />
        <div class="who">
          <span class="mn">{{ meStore.me?.name }}</span>
          <span v-for="r in meStore.me?.roles ?? []" :key="r" class="tag">{{ label('ActorRole', r) }}</span>
        </div>
        <MessageBell />
        <el-button size="small" @click="doLogout">退出</el-button>
      </header>
      <div v-if="company?.status === 'THROTTLED'" class="throttle note note--warn">
        <b>公司当前处于平台处罚期</b>。{{ company.statusRemark }} 如有异议请联系平台运营。
      </div>
      <main class="content">
        <router-view />
      </main>
    </section>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side { width: 236px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--surface); border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; height: 60px; flex: none; padding: 0 20px; }
.brand b { font-size: 16px; font-weight: 650; color: var(--ink-900); letter-spacing: -.01em; }
.nav-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.nav { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 2px 12px 16px; scroll-padding-block: 34px 16px; }
/* 下面还有菜单时的渐隐提示 */
.nav-wrap::after { content: ""; position: absolute; left: 0; right: 8px; bottom: 0; height: 36px; pointer-events: none; opacity: 0; transition: opacity .16s;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0), var(--surface)); }
.nav-wrap.has-more::after { opacity: 1; }
.grp { padding: 14px 12px 4px; font-size: 12px; font-weight: 500; color: var(--ink-400); }
.grp:first-child { padding-top: 8px; }
.item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; margin-bottom: 1px; border-radius: 8px; font-size: 14px; color: var(--ink-600); text-decoration: none; transition: background .14s, color .14s; }
.item:hover { background: var(--surface-2); color: var(--ink-900); }
.item.is-active { background: var(--signal-50); color: var(--signal-700); font-weight: 600; }
.side-user { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--line); }
.su { flex: 1; min-width: 0; }
.su b { display: block; font-size: 13.5px; font-weight: 600; color: var(--ink-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.su span { font-size: 12px; color: var(--ink-400); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: 60px; flex: none; position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 14px; padding: 0 28px; background: rgba(255, 255, 255, .92); backdrop-filter: saturate(1.4) blur(8px); border-bottom: 1px solid var(--line); }
.spacer { flex: 1; }
.content { flex: 1; min-width: 0; padding: 24px 28px 64px; }
@media (max-width: 980px) { .side { display: none; } }

.tenant { flex: none; margin: 0 12px 4px; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); display: flex; align-items: center; gap: 10px; }
.tn { flex: 1; min-width: 0; }
.tn b { display: block; font-size: 13px; font-weight: 600; color: var(--ink-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tn span { font-size: 12px; color: var(--ink-500); }
.avatar { width: 32px; height: 32px; flex: none; border-radius: 9px; display: grid; place-items: center; font-size: 13.5px; font-weight: 600; background: linear-gradient(135deg, #FF8A3D, var(--signal)); color: #fff; }
.avatar--u { border-radius: 50%; background: var(--surface-3); color: var(--ink-700); }
.crumb { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink-400); }
.crumb b { color: var(--ink-900); font-size: 14px; font-weight: 600; }
.who { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.who .cn { color: var(--ink-600); }
.who .mn { color: var(--ink-900); font-weight: 600; }
.sep { width: 1px; height: 18px; background: var(--line); }
.throttle { margin: 16px 28px 0; }
</style>
