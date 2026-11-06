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
        <span class="env">OPS</span>
      </div>
      <nav class="nav">
        <template v-for="g in menu" :key="g.key">
          <div class="grp">{{ g.title }} {{ g.en }}</div>
          <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item" active-class="is-active">
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
        <span v-if="route.meta.proto" class="ref">原型 <b>{{ route.meta.proto }}</b></span>
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
.shell { display: flex; min-height: 100vh; background: var(--surface-2); }
.side { width: 228px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--chrome); color: #fff; }
.brand { display: flex; align-items: center; gap: 9px; padding: 16px 16px 14px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.brand b { font-family: var(--f-dis); font-size: 16px; letter-spacing: .02em; }
.env { margin-left: auto; font-family: var(--f-mono); font-size: 9px; letter-spacing: .1em; border: 1px solid rgba(255, 255, 255, .22); color: rgba(255, 255, 255, .6); padding: 1px 5px; border-radius: 3px; }
.nav { flex: 1; overflow: auto; padding: 8px 10px 22px; }
.grp { display: flex; align-items: center; gap: 6px; padding: 14px 8px 5px; font-family: var(--f-mono); font-size: 9.5px; letter-spacing: .14em; color: rgba(255, 255, 255, .32); }
.grp::after { content: ""; flex: 1; height: 1px; background: rgba(255, 255, 255, .08); }
.item { display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: var(--r-sm); font-size: 12.5px; color: rgba(255, 255, 255, .68); text-decoration: none; transition: .14s; }
.item:hover { background: rgba(255, 255, 255, .07); color: #fff; }
.item.is-active { background: var(--signal); color: #fff; font-weight: 600; }
.it-t { flex: 1; min-width: 0; }
.bdg { font-family: var(--f-mono); font-size: 10px; background: var(--danger); color: #fff; padding: 0 5px; height: 15px; line-height: 15px; border-radius: 8px; min-width: 17px; text-align: center; }
.item.is-active .bdg { background: rgba(0, 0, 0, .35); }
.soon { font-size: 10px; color: rgba(255, 255, 255, .25); }
.side-user { display: flex; align-items: center; gap: 9px; padding: 10px 12px; border-top: 1px solid rgba(255, 255, 255, .08); }
.su { flex: 1; min-width: 0; }
.su b { display: block; font-size: 12.5px; }
.su span { font-size: 10.5px; color: rgba(255, 255, 255, .42); }
.avatar { width: 30px; height: 30px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--temp); color: #fff; font-size: 13px; font-weight: 700; }
.avatar.sm { width: 26px; height: 26px; font-size: 12px; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: 52px; flex: none; position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 14px; padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--line); }
.spacer { flex: 1; }
.me { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 0; background: transparent; border-radius: var(--r-sm); cursor: pointer; color: var(--ink-600); font-family: inherit; }
.me:hover { background: var(--surface-3); }
.me-t { display: flex; align-items: center; gap: 8px; }
.me-t b { font-size: 13px; color: var(--ink-900); }
.content { flex: 1; padding: 20px 22px 60px; min-width: 0; }
.pwd-tip { margin-bottom: 14px; }
</style>
