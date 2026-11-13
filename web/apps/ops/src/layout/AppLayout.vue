<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { logout, useDict } from '@shitu/api-client'
import { BrandMark, IconChevronDown, IconUser } from '@shitu/ui-icons'
import ChangePasswordForm from '@/components/ChangePasswordForm.vue'
import { APP_TITLE, MENU, type MenuItem } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const pending = usePendingStore()
const { label } = useDict()

const menu = computed(() =>
  MENU.map((g) => ({ ...g, items: g.items.filter((it) => auth.hasAnyRole(it.roles)) })).filter((g) => g.items.length > 0),
)

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
watch(() => [route.path, menu.value.length], revealActive, { flush: 'post' })

function badgeOf(it: MenuItem): number {
  const c = pending.counts
  if (!c || !it.badge) return 0
  return it.badge === 'companies' ? c.companies : c.jobs + c.contracts
}

const avatarChar = computed(() => (auth.me?.displayName ?? '运').slice(0, 1))

const pwdVisible = ref(false)
function onPasswordChanged() {
  pwdVisible.value = false
  auth.clear()
  router.replace({ path: '/login', query: { changed: '1' } })
}

async function onCommand(cmd: string) {
  if (cmd === 'password') pwdVisible.value = true
  if (cmd === 'logout') {
    try {
      await logout()
    } finally {
      auth.clear()
      router.replace('/login')
    }
  }
}

onMounted(() => {
  revealActive()
  pending.refresh()
})
</script>

<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <BrandMark :size="24" />
        <b>{{ APP_TITLE }}</b>
      </div>
      <nav ref="navRef" class="nav" aria-label="主菜单">
        <template v-for="g in menu" :key="g.key">
          <div class="grp">{{ g.title }}</div>
          <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item" active-class="is-active" :class="{ 'is-active': route.meta.activeMenu === it.path }">
            <component :is="it.icon" :size="18" />
            <span class="it-t">{{ it.title }}</span>
            <span v-if="badgeOf(it) > 0" class="bdg">{{ badgeOf(it) > 99 ? '99+' : badgeOf(it) }}</span>
            <span v-else-if="!it.ready" class="soon">待建</span>
          </router-link>
        </template>
      </nav>
      <div class="side-user">
        <div class="avatar">{{ avatarChar }}</div>
        <div class="su">
          <b>{{ auth.me?.displayName }}</b>
          <span>{{ auth.me?.username }}</span>
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
        <el-dropdown trigger="click" @command="onCommand">
          <button type="button" class="me">
            <IconUser :size="16" />
            <span class="mn">{{ auth.me?.username }}</span>
            <span v-for="r in auth.me?.roles ?? []" :key="r" class="status-tag status-tag--info">{{ label('OpsRole', r) }}</span>
            <IconChevronDown :size="16" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="password">修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>
      <main class="content">
        <router-view />
      </main>
    </section>

    <el-dialog v-model="pwdVisible" title="修改密码" width="480px" destroy-on-close :close-on-click-modal="false">
      <div class="notice-bar pwd-tip">修改成功后，所有设备上的登录都会失效，需要用新密码重新登录。</div>
      <ChangePasswordForm show-cancel @success="onPasswordChanged" @cancel="pwdVisible = false" />
    </el-dialog>
  </div>
</template>

<style scoped>
/* 外壳和企业后台（console layout/AppLayout.vue）是同一套：侧栏、顶栏、内容区的尺寸和颜色一致 */
.shell { --layout-top-height: 56px; display: flex; min-height: 100vh; background: var(--bg-page); }
.side { width: 220px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--bg-card); border-right: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: var(--space-2); height: var(--layout-top-height); flex: none; padding: 0 var(--space-4); }
.brand b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.nav { flex: 1; overflow: auto; padding: 0 var(--space-3) var(--space-4); }
.grp { padding: var(--space-4) var(--space-2) var(--space-1); font-size: var(--font-size-min); color: var(--text-3); }
.item { display: flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-2); border-radius: var(--radius-control); font-size: var(--font-size-body); color: var(--text-2); text-decoration: none; }
.it-t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item:hover { background: var(--bg-hover); color: var(--text-1); }
.item.is-active { background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
/* 待办角标：危险文字色底配白字（对比度见 design-guard CONTRAST_PAIRS 的组件库实心按钮那一组） */
.bdg { flex: none; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-card); font-size: var(--font-size-min); font-weight: var(--font-weight-medium); line-height: 18px; text-align: center; background: var(--danger-text); color: var(--text-on-primary); }
.soon { flex: none; font-size: var(--font-size-min); color: var(--text-3); }
.side-user { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--divider); display: flex; align-items: center; gap: var(--space-2); }
.avatar { width: 32px; height: 32px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); background: var(--primary-bg); color: var(--primary-text); }
.su { flex: 1; min-width: 0; }
.su b { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.su span { font-size: var(--font-size-min); color: var(--text-3); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: var(--layout-top-height); flex: none; display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-6); background: var(--bg-card); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 50; }
.crumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.spacer { flex: 1; }
.crumb b { color: var(--text-1); font-weight: var(--font-weight-medium); }
.me { display: flex; align-items: center; gap: var(--space-2); height: var(--control-height); padding: 0 var(--space-2); border: 0; border-radius: var(--radius-control); background: transparent; cursor: pointer; font-family: inherit; font-size: var(--font-size-aux); color: var(--text-2); }
.me:hover { background: var(--bg-hover); }
.me:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.me .mn { color: var(--text-1); font-weight: var(--font-weight-medium); }
.content { flex: 1; min-width: 0; padding: var(--space-page); }
.pwd-tip { margin-bottom: var(--space-4); }
</style>
