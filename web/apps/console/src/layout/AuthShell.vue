<script setup lang="ts">
import BrandMark from '@/components/BrandMark.vue'
import { APP_TITLE } from '@/router/menu'

/** 登录 / 入驻页外框：左侧品牌区（产品预览）+ 右侧表单区 */
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
</script>

<template>
  <div class="auth" :class="{ wide }">
    <aside class="brand">
      <div class="glow g1" />
      <div class="glow g2" />
      <div class="grid" />

      <div class="b1">
        <BrandMark :size="28" />
        <b>{{ APP_TITLE }}</b>
      </div>

      <div class="hero">
        <div class="eyebrow-l"><i />劳务公司工作台</div>
        <h1>从驻场到发薪<br /><em>一站协同</em></h1>
        <p>驻场、人才经纪人、项目经理与老板共用一套数据，按角色看到各自该看的内容。</p>

        <div class="preview" aria-hidden="true">
          <div class="pv-card main">
            <div class="pv-hd"><span class="dot" />驻场工作台 · 今日</div>
            <div class="kpis">
              <div><b>12</b><span>今日到厂</span></div>
              <div><b>5</b><span>待确权</span></div>
              <div><b class="hot">3</b><span>24h 待跟进</span></div>
            </div>
            <div class="bars">
              <i style="height: 38%" /><i style="height: 55%" /><i style="height: 46%" /><i style="height: 72%" />
              <i style="height: 64%" /><i style="height: 88%" /><i class="on" style="height: 96%" />
            </div>
          </div>
          <div class="pv-card float f1">
            <span class="ring" />
            <div><b>张** 已签约入职</b><small>电子合同 · 刚刚</small></div>
          </div>
          <div class="pv-card float f2">
            <small>剩余响应时间</small>
            <b class="mono">03:42</b>
          </div>
        </div>

        <div class="roles">
          <span>驻场</span><span>人才经纪人</span><span>项目经理</span><span>老板</span>
        </div>
      </div>

      <div class="foot mono">© 仕兔平台 · V1.0</div>
    </aside>

    <main class="pane">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.auth { min-height: 100vh; display: flex; background: var(--paper); }

/* ------------------------------------------------------------ 品牌区 */
.brand {
  position: relative; overflow: hidden; isolation: isolate;
  width: 46%; max-width: 640px; flex: none; display: flex; flex-direction: column; padding: 36px 48px; color: #fff;
  background: linear-gradient(160deg, #161D27 0%, #10151C 55%, #1B1410 100%);
}
.auth.wide .brand { width: 34%; }
.glow { position: absolute; border-radius: 50%; filter: blur(70px); z-index: -1; pointer-events: none; }
.g1 { width: 420px; height: 420px; left: -140px; bottom: -160px; background: rgba(232, 89, 12, .38); }
.g2 { width: 360px; height: 360px; right: -160px; top: -120px; background: rgba(76, 110, 160, .22); }
.grid {
  position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background:
    linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 32px 32px,
    linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 32px 32px;
  mask-image: radial-gradient(ellipse 80% 70% at 30% 40%, #000 30%, transparent 75%);
}

.b1 { display: flex; align-items: center; gap: 10px; }
.b1 b { font-family: var(--f-dis); font-size: 18px; letter-spacing: .02em; }
.env { font-family: var(--f-mono); font-size: 9px; letter-spacing: .12em; border: 1px solid rgba(255,255,255,.2); color: rgba(255,255,255,.55); padding: 1px 6px; border-radius: 4px; }

.hero { margin: auto 0; padding: 32px 0; }
.eyebrow-l { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: .14em; color: var(--signal-300);
  padding: 5px 12px 5px 10px; border-radius: 999px; background: rgba(232, 89, 12, .12); border: 1px solid rgba(232, 89, 12, .28); }
.eyebrow-l i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); box-shadow: 0 0 0 4px rgba(232,89,12,.25); }
.hero h1 { font-family: var(--f-dis); font-size: 40px; line-height: 1.22; margin: 20px 0 14px; letter-spacing: .01em; }
.hero h1 em { font-style: normal; background: linear-gradient(90deg, #FF9A5C, #E8590C); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero p { color: rgba(255,255,255,.62); font-size: 14px; line-height: 1.8; max-width: 440px; margin: 0; }

/* 产品预览 */
.preview { position: relative; margin: 56px 0 30px; max-width: 440px; height: 214px; }
.pv-card { position: absolute; border-radius: 16px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  backdrop-filter: blur(14px); box-shadow: 0 24px 50px -20px rgba(0,0,0,.6); }
.main { left: 0; top: 0; width: 340px; padding: 18px 20px 16px; }
.pv-hd { display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,.6); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #3DD68C; box-shadow: 0 0 0 3px rgba(61,214,140,.2); }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0 16px; }
.kpis div { display: flex; flex-direction: column; gap: 2px; }
.kpis b { font-family: var(--f-dis); font-size: 26px; line-height: 1; }
.kpis b.hot { color: #FF9A5C; }
.kpis span { font-size: 11px; color: rgba(255,255,255,.5); }
.bars { display: flex; align-items: flex-end; gap: 8px; height: 56px; }
.bars i { flex: 1; border-radius: 4px 4px 2px 2px; background: rgba(255,255,255,.14); }
.bars i.on { background: linear-gradient(180deg, #FF9A5C, #E8590C); }
.float { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(28, 35, 45, .82); }
.f1 { right: -6px; top: -30px; animation: bob 6s ease-in-out infinite; }
.f2 { right: 34px; bottom: 0; flex-direction: column; align-items: flex-start; gap: 2px; animation: bob 7s ease-in-out -2s infinite; }
.float b { font-size: 13px; font-weight: 600; }
.float small { display: block; font-size: 11px; color: rgba(255,255,255,.5); }
.f2 b { font-family: var(--f-mono); font-size: 22px; color: #FF9A5C; letter-spacing: .04em; }
.ring { width: 28px; height: 28px; flex: none; border-radius: 50%; background: radial-gradient(circle, #3DD68C 34%, transparent 36%), rgba(61,214,140,.16); }
@keyframes bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
@media (prefers-reduced-motion: reduce) { .float { animation: none; } }

.roles { display: flex; flex-wrap: wrap; gap: 8px; }
.roles span { font-size: 12px; color: rgba(255,255,255,.72); padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); }
.foot { font-size: 10.5px; color: rgba(255,255,255,.32); letter-spacing: .1em; }

/* ------------------------------------------------------------ 表单区 */
.pane {
  flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 48px 24px;
  background: radial-gradient(rgba(16,20,26,.07) 1px, transparent 1px) 0 0 / 22px 22px, var(--paper);
}

@media (max-width: 1100px) { .preview { display: none; } .hero h1 { font-size: 34px; } }
@media (max-width: 900px) { .brand { display: none; } }
</style>
