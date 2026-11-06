<script setup lang="ts">
import { computed } from 'vue'
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
        <span class="env">TENANT</span>
      </div>
      <div v-if="company" class="tenant">
        <div class="avatar">{{ companyName.slice(0, 1) }}</div>
        <div class="tn">
          <b :title="company.name">{{ company.name }}</b>
          <span>{{ company.creditScore != null ? `诚信分 ${company.creditScore}` : company.unifiedCreditCode }}</span>
        </div>
      </div>
      <nav class="nav">
        <template v-for="g in menu" :key="g.key">
          <div class="grp">{{ g.title }} <i>{{ g.en }}</i></div>
          <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item" exact-active-class="is-active">
            {{ it.title }}
          </router-link>
        </template>
      </nav>
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
          <span>{{ route.meta.group ?? APP_TITLE }}</span>
          <span>/</span>
          <b>{{ route.meta.title }}</b>
          <span v-if="route.meta.proto" class="ref">原型 <b>{{ route.meta.proto }}</b></span>
        </div>
        <span class="spacer" />
        <div v-if="company" class="who">
          <span class="cn">{{ companyName }}</span>
          <DictTag type="CompanyStatus" :value="company.status" />
        </div>
        <span class="sep" />
        <div class="who">
          <span class="mn">{{ meStore.me?.name }}</span>
          <span v-for="r in meStore.me?.roles ?? []" :key="r"><DictTag type="ActorRole" :value="r" /></span>
        </div>
        <MessageBell />
        <el-button size="small" @click="doLogout">退出</el-button>
      </header>
      <div v-if="company?.status === 'THROTTLED'" class="throttle note note--warn">
        <b>公司当前处于限流状态</b>：岗位曝光与匹配权重受限。{{ company.statusRemark }}
      </div>
      <main class="content">
        <router-view />
      </main>
    </section>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; background: var(--surface-2); }
.side { width: 228px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--chrome); color: #fff; }
.brand { display: flex; align-items: center; gap: 9px; padding: 16px 16px 14px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.brand b { font-family: var(--f-dis); font-size: 15px; letter-spacing: .02em; }
.env { margin-left: auto; font-family: var(--f-mono); font-size: 9px; letter-spacing: .1em; border: 1px solid rgba(255, 255, 255, .22); color: rgba(255, 255, 255, .6); padding: 1px 5px; border-radius: 3px; }
.tenant { margin: 12px 12px 4px; padding: 9px 10px; border-radius: var(--r-sm); background: rgba(255, 255, 255, .055); border: 1px solid rgba(255, 255, 255, .09); display: flex; align-items: center; gap: 9px; }
.tn { flex: 1; min-width: 0; }
.tn b { display: block; font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tn span { font-size: 10px; font-family: var(--f-mono); color: rgba(255, 255, 255, .42); }
.avatar { width: 28px; height: 28px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--signal); color: #fff; }
.avatar--u { background: var(--chrome-3); border: 1px solid rgba(255, 255, 255, .15); }
.nav { flex: 1; overflow: auto; padding: 8px 10px 22px; }
.grp { display: flex; align-items: center; gap: 6px; padding: 14px 8px 5px; font-size: 11px; color: rgba(255, 255, 255, .45); }
.grp i { font-style: normal; font-family: var(--f-mono); font-size: 9.5px; letter-spacing: .12em; color: rgba(255, 255, 255, .28); }
.grp::after { content: ""; flex: 1; height: 1px; background: rgba(255, 255, 255, .08); }
.item { display: block; padding: 7px 9px; border-radius: var(--r-sm); font-size: 12.5px; color: rgba(255, 255, 255, .68); text-decoration: none; transition: .14s; }
.item:hover { background: rgba(255, 255, 255, .07); color: #fff; }
.item.is-active { background: var(--signal); color: #fff; font-weight: 600; }
.side-user { padding: 10px 12px; border-top: 1px solid rgba(255, 255, 255, .08); display: flex; align-items: center; gap: 9px; }
.su { flex: 1; min-width: 0; }
.su b { display: block; font-size: 12.5px; }
.su span { font-size: 10.5px; color: rgba(255, 255, 255, .42); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: 52px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 50; }
.crumb { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-400); }
.crumb b { color: var(--ink-900); font-size: 14px; font-weight: 700; }
.crumb .ref b { font-size: 10px; color: var(--signal-700); }
.who { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.who .cn { color: var(--ink-700); font-weight: 600; }
.who .mn { color: var(--ink-900); font-weight: 600; }
.sep { width: 1px; height: 18px; background: var(--line); }
.throttle { margin: 14px 22px 0; }
.content { flex: 1; padding: 20px 22px 60px; }
@media (max-width: 980px) { .side { display: none; } }
</style>
