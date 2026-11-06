<script setup lang="ts">
import BrandMark from '@/components/BrandMark.vue'
import { APP_TITLE } from '@/router/menu'

/** 登录 / 入驻页外框：左侧品牌区 + 右侧表单区 */
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
</script>

<template>
  <div class="auth" :class="{ wide }">
    <aside class="brand">
      <div class="b1">
        <BrandMark :size="26" />
        <b>{{ APP_TITLE }}</b>
        <span class="env">TENANT</span>
      </div>
      <div class="hero">
        <div class="eyebrow-l">LABOR COMPANY CONSOLE</div>
        <h1>蓝领招聘<br />从驻场到发薪，一站协同</h1>
        <p>面向劳务公司的多角色工作台：驻场、人才经纪人、项目经理与老板共用一套数据，按角色看到各自该看的内容。</p>
        <ul>
          <li><i />岗位发布即进入平台审核，必须关联已备案甲方合同</li>
          <li><i />渠道二维码决定注册用户初始归属，私域受保护</li>
          <li><i />成员角色与数据权限按矩阵精确控制</li>
        </ul>
      </div>
      <div class="foot mono">© 仕兔平台 · V1.0 MVP</div>
    </aside>
    <main class="pane">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.auth { min-height: 100vh; display: flex; background: var(--paper); }
.brand {
  width: 44%; max-width: 560px; flex: none; display: flex; flex-direction: column; padding: 32px 40px; color: #fff;
  background:
    linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px) 0 0 / 28px 28px,
    linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px) 0 0 / 28px 28px,
    var(--chrome);
}
.auth.wide .brand { width: 32%; }
.b1 { display: flex; align-items: center; gap: 10px; }
.b1 b { font-family: var(--f-dis); font-size: 18px; letter-spacing: .02em; }
.env { font-family: var(--f-mono); font-size: 9px; letter-spacing: .1em; border: 1px solid rgba(255,255,255,.22); color: rgba(255,255,255,.6); padding: 1px 5px; border-radius: 3px; }
.hero { margin: auto 0; }
.eyebrow-l { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: .2em; color: var(--signal-300); }
.hero h1 { font-family: var(--f-dis); font-size: 32px; line-height: 1.3; margin: 14px 0 14px; }
.hero p { color: rgba(255,255,255,.62); font-size: 13.5px; line-height: 1.8; max-width: 420px; }
.hero ul { list-style: none; padding: 0; margin: 26px 0 0; display: grid; gap: 12px; }
.hero li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: rgba(255,255,255,.78); }
.hero li i { width: 6px; height: 6px; background: var(--signal); border-radius: 1px; flex: none; }
.foot { font-size: 10.5px; color: rgba(255,255,255,.35); letter-spacing: .08em; }
.pane { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
@media (max-width: 900px) { .brand { display: none; } }
</style>
