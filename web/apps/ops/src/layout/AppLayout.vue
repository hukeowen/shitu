<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { logout, useDict } from '@shitu/api-client'
import ChangePasswordForm from '@/components/ChangePasswordForm.vue'
import DictTags from '@/components/DictTags.vue'
import { APP_TITLE, MENU, type MenuItem } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const pending = usePendingStore()
useDict()

const menu = computed(() =>
  MENU.map((g) => ({ ...g, items: g.items.filter((it) => auth.hasAnyRole(it.roles)) })).filter((g) => g.items.length > 0),
)

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

onMounted(() => pending.refresh())
</script>

<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--signal)" />
          <path d="M12 5.5 18 8v4.2c0 3.2-2.5 5.3-6 6.3-3.5-1-6-3.1-6-6.3V8z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
        <b>{{ APP_TITLE }}</b>
      </div>
      <nav class="nav">
        <template v-for="g in menu" :key="g.key">
          <div class="grp">{{ g.title }}</div>
          <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item" active-class="is-active" :class="{ 'is-active': route.meta.activeMenu === it.path }">
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
          <span class="mono">{{ auth.me?.username }}</span>
        </div>
      </div>
    </aside>
    <section class="main">
      <header class="top">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>{{ route.meta.group ?? APP_TITLE }}</el-breadcrumb-item>
          <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="spacer" />
        <el-dropdown trigger="click" @command="onCommand">
          <button type="button" class="me">
            <span class="avatar sm">{{ avatarChar }}</span>
            <span class="me-t">
              <b>{{ auth.me?.displayName }}</b>
              <DictTags type="OpsRole" :values="auth.me?.roles" />
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
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

    <el-dialog v-model="pwdVisible" title="修改密码" width="420px" destroy-on-close :close-on-click-modal="false">
      <div class="notice notice--info pwd-tip">修改成功后，所有设备上的登录都会失效，需要用新密码重新登录。</div>
      <ChangePasswordForm show-cancel @success="onPasswordChanged" @cancel="pwdVisible = false" />
    </el-dialog>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side { width: 236px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--surface); border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; height: 60px; flex: none; padding: 0 20px; }
.brand b { font-size: 16px; font-weight: 650; color: var(--ink-900); letter-spacing: -.01em; }
.nav { flex: 1; overflow: auto; padding: 4px 12px 24px; }
.grp { padding: 18px 12px 6px; font-size: 12px; font-weight: 500; color: var(--ink-400); }
.item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 2px; border-radius: 8px; font-size: 14px; color: var(--ink-600); text-decoration: none; transition: background .14s, color .14s; }
.item:hover { background: var(--surface-2); color: var(--ink-900); }
.item.is-active { background: var(--signal-50); color: var(--signal-700); font-weight: 600; }
.side-user { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-top: 1px solid var(--line); }
.su { flex: 1; min-width: 0; }
.su b { display: block; font-size: 13.5px; font-weight: 600; color: var(--ink-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.su span { font-size: 12px; color: var(--ink-400); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: 60px; flex: none; position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 14px; padding: 0 28px; background: rgba(255, 255, 255, .92); backdrop-filter: saturate(1.4) blur(8px); border-bottom: 1px solid var(--line); }
.spacer { flex: 1; }
.content { flex: 1; min-width: 0; padding: 24px 28px 64px; }
@media (max-width: 980px) { .side { display: none; } }

.brand .env { margin-left: auto; font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 6px; background: var(--temp-bg); color: var(--temp); }
.it-t { flex: 1; min-width: 0; }
.bdg { font-size: 11.5px; font-weight: 600; background: var(--danger); color: #fff; padding: 0 6px; height: 18px; line-height: 18px; border-radius: 9px; min-width: 18px; text-align: center; }
.soon { font-size: 11.5px; color: var(--ink-300); }
.avatar { width: 32px; height: 32px; flex: none; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #8B6BE8, var(--temp)); color: #fff; font-size: 13.5px; font-weight: 600; }
.avatar.sm { width: 28px; height: 28px; font-size: 12.5px; }
.me { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border: 0; background: transparent; border-radius: 8px; cursor: pointer; color: var(--ink-500); font-family: inherit; }
.me:hover { background: var(--surface-2); }
.me-t { display: flex; align-items: center; gap: 8px; }
.me-t b { font-size: 13.5px; font-weight: 600; color: var(--ink-900); }
.pwd-tip { margin-bottom: 14px; }
</style>
