<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { logout, useDict } from '@shitu/api-client'
import { BrandMark, IconTriangleExclamationPoint } from '@shitu/ui-icons'
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
/** 进入页面时把选中的菜单项滚进侧栏可视区（1280×800 下菜单比侧栏高，靠下的项会被藏住） */
const navRef = ref<HTMLElement>()
function revealActive() {
  const nav = navRef.value, it = nav?.querySelector<HTMLElement>('.item.is-active')
  if (!nav || !it) return
  const n = nav.getBoundingClientRect(), r = it.getBoundingClientRect()
  if (r.top < n.top) nav.scrollTop -= n.top - r.top + 8
  else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom + 8
}
// immediate 的回调在挂载前执行、拿不到 nav，首次进入页面由 onMounted 负责
onMounted(revealActive)
watch(() => [route.path, menu.value.length], revealActive, { flush: 'post' })
const company = computed(() => meStore.me?.company)
const companyName = computed(() => company.value?.shortName || company.value?.name || '')
const roleText = computed(() => (meStore.me?.roles ?? []).map((r) => label('ActorRole', r)).join(' · '))

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
        <BrandMark :size="24" />
        <b>{{ APP_TITLE }}</b>
      </div>
      <div v-if="company" class="tenant">
        <b :title="company.name">{{ company.name }}</b>
        <span>{{ company.creditScore != null ? `诚信分 ${company.creditScore}` : company.unifiedCreditCode }}</span>
      </div>
      <nav ref="navRef" class="nav" aria-label="主菜单">
        <template v-for="g in menu" :key="g.key">
          <div class="grp">{{ g.title }}</div>
          <router-link v-for="it in g.items.filter((x) => !x.hidden)" :key="it.path" :to="it.path" class="item" :class="{ 'is-active': route.path === it.path || route.path.startsWith(it.path + '/') }">
            <component :is="it.icon" :size="18" />
            <span>{{ it.title }}</span>
          </router-link>
        </template>
      </nav>
      <div class="side-user">
        <div class="avatar">{{ meStore.me?.name.slice(0, 1) }}</div>
        <div class="su">
          <b>{{ meStore.me?.name }}</b>
          <span>{{ roleText }}</span>
        </div>
      </div>
    </aside>
    <section class="main">
      <header class="top">
        <nav class="crumb" aria-label="面包屑">
          <span>{{ route.meta.group ?? APP_TITLE }}</span>
          <span aria-hidden="true">/</span>
          <b>{{ route.meta.title }}</b>
        </nav>
        <span class="spacer" />
        <div v-if="company" class="who">
          <span class="cn">{{ companyName }}</span>
          <DictTag type="CompanyStatus" :value="company.status" />
        </div>
        <span class="sep" />
        <div class="who">
          <span class="mn">{{ meStore.me?.name }}</span>
          <DictTag v-for="r in meStore.me?.roles ?? []" :key="r" type="ActorRole" :value="r" />
        </div>
        <MessageBell />
        <el-button @click="doLogout">退出</el-button>
      </header>
      <div v-if="company?.status === 'THROTTLED'" class="throttle" role="status">
        <IconTriangleExclamationPoint :size="18" class="throttle-i" />
        <div><b>公司当前处于平台处罚期</b>。{{ company.statusRemark }} 如有异议请联系平台运营。</div>
      </div>
      <main class="content">
        <router-view />
      </main>
    </section>
  </div>
</template>

<style scoped>
/* 顶栏高度只在这里定义一次，页面里的吸顶 / 贴底计算也读它 */
.shell { --layout-top-height: 56px; display: flex; min-height: 100vh; background: var(--bg-page); }
.side { width: 220px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--bg-card); border-right: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: var(--space-2); height: 56px; padding: 0 var(--space-4); }
.brand b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tenant { margin: 0 var(--space-3) var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); }
.tenant b { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tenant span { font-size: var(--font-size-min); color: var(--text-3); }
.nav { flex: 1; overflow: auto; padding: 0 var(--space-3) var(--space-4); }
.grp { padding: var(--space-4) var(--space-2) var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.item { display: flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-2); border-radius: var(--radius-control); font-size: var(--font-size-body); color: var(--text-2); text-decoration: none; }
.item span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item:hover { background: var(--bg-hover); color: var(--text-1); }
.item.is-active { background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.side-user { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--divider); display: flex; align-items: center; gap: var(--space-2); }
.avatar { width: 32px; height: 32px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); background: var(--primary-bg); color: var(--primary-text); }
.su { flex: 1; min-width: 0; }
.su b { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.su span { font-size: var(--font-size-min); color: var(--text-3); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: var(--layout-top-height); flex: none; display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-6); background: var(--bg-card); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 50; }
.crumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.crumb b { color: var(--text-1); font-weight: var(--font-weight-medium); }
.who { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); }
.who .cn { color: var(--text-2); }
.who .mn { color: var(--text-1); font-weight: var(--font-weight-medium); }
.sep { width: 1px; height: 18px; background: var(--border); }
.throttle { display: flex; align-items: flex-start; gap: var(--space-2); margin: var(--space-4) var(--space-6) 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-card); background: var(--warning-soft); color: var(--text-1); font-size: var(--font-size-body); line-height: 1.6; }
.throttle-i { flex: none; margin-top: 2px; color: var(--warning-text); }
.content { flex: 1; padding: var(--space-page); }
@media (max-width: 980px) { .side { display: none; } }
</style>
