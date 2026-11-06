<script setup lang="ts">
import { useRoute } from 'vue-router'
import { APP_TITLE, MENU } from '@/router/menu'

const route = useRoute()
</script>

<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <b>{{ APP_TITLE }}</b>
        <span>V1.0 MVP</span>
      </div>
      <nav class="nav">
        <template v-for="g in MENU" :key="g.key">
          <div class="grp">{{ g.title }} <i>{{ g.en }}</i></div>
          <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item" exact-active-class="is-active">
            {{ it.title }}
          </router-link>
        </template>
      </nav>
    </aside>
    <section class="main">
      <header class="top">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>{{ route.meta.group ?? APP_TITLE }}</el-breadcrumb-item>
          <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
        </el-breadcrumb>
        <span class="proto mono">{{ route.meta.proto }}</span>
      </header>
      <main class="content">
        <router-view />
      </main>
    </section>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side { width: 220px; flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--chrome); color: #fff; }
.brand { padding: 16px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.brand b { display: block; font-family: var(--f-dis); font-size: 16px; }
.brand span { font-family: var(--f-mono); font-size: 10px; letter-spacing: .12em; color: rgba(255, 255, 255, .42); }
.nav { flex: 1; overflow: auto; padding: 8px 10px 20px; }
.grp { padding: 14px 8px 6px; font-size: 11px; color: rgba(255, 255, 255, .45); }
.grp i { font-style: normal; font-family: var(--f-mono); font-size: 9.5px; letter-spacing: .12em; margin-left: 4px; color: rgba(255, 255, 255, .28); }
.item { display: block; padding: 7px 10px; border-radius: var(--r-sm); font-size: 13px; color: rgba(255, 255, 255, .7); text-decoration: none; }
.item:hover { background: rgba(255, 255, 255, .07); color: #fff; }
.item.is-active { background: var(--signal); color: #fff; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { height: 52px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--line); }
.proto { font-size: 11px; color: var(--ink-400); }
.content { flex: 1; padding: 20px; }
</style>
