<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { StatusTag } from '@shitu/ui-mobile'
import { useAuthStore } from '@/stores/auth'

/** S-02 游客首页 / S-03 游客引导弹窗。登录后的 5 种状态首页（S-06~S-10）在 Sprint 2 实现 */
const auth = useAuthStore()
const router = useRouter()
const guideVisible = ref(false)

interface GridItem {
  key: string
  title: string
  desc: string
  disabled?: boolean
  badge?: string
}
const grid: GridItem[] = [
  { key: 'match', title: 'AI 问薪', desc: '7 题定岗，出 3 个匹配岗位' },
  { key: 'refer', title: '推荐裂变', desc: '推荐工友，得推荐奖励', badge: '预留' },
  { key: 'advance', title: '薪资预支', desc: '仅在岗员工可用', disabled: true },
  { key: 'points', title: '工分变现', desc: '在岗积累工分兑换', disabled: true, badge: 'V1.5' },
]

const steps = [
  { t: '回答 7 道题', d: '不用打字，点选即可' },
  { t: '生成你的求职画像', d: '薪资 / 班次 / 住宿 / 地域 / 经验' },
  { t: '匹配 3 个岗位', d: '匹配度 ≥80% 才推给你' },
  { t: '报名 → 面试 → 入职', d: '驻场老师全程跟进' },
]

function onTap(item: GridItem) {
  if (item.disabled) return
  if (auth.isGuest) {
    guideVisible.value = true
    return
  }
  // TODO(Sprint 2): 登录态下进入 AI 问薪
}
</script>

<template>
  <div class="home">
    <header class="hero">
      <div class="avatar">游</div>
      <div class="who">
        <div class="hello">你好，访客</div>
        <div class="sub">未注册 · 尚未生成用户 ID</div>
      </div>
      <StatusTag :status="auth.status" />
    </header>

    <section class="notice">
      <b>匹配范围：不展示岗位。</b>平台采用匹配逻辑，没有岗位列表。完成 AI 问薪后，岗位才会以匹配结果出现。
    </section>

    <section class="grid">
      <button
        v-for="it in grid"
        :key="it.key"
        class="cell"
        :class="{ 'is-disabled': it.disabled, 'is-primary': it.key === 'match' }"
        type="button"
        @click="onTap(it)"
      >
        <span v-if="it.badge" class="badge">{{ it.badge }}</span>
        <span class="t">{{ it.title }}</span>
        <span class="d">{{ it.desc }}</span>
      </button>
    </section>

    <section class="card">
      <h3>平台怎么帮你找活儿</h3>
      <ol class="steps">
        <li v-for="(s, i) in steps" :key="s.t">
          <i class="num">{{ i + 1 }}</i>
          <div>
            <b>{{ s.t }}</b>
            <span>{{ s.d }}</span>
          </div>
        </li>
      </ol>
    </section>

    <van-popup v-model:show="guideVisible" round position="bottom" class="guide">
      <h3>开始 AI 问薪匹配</h3>
      <p>仕兔不提供岗位列表 —— 需要先了解你的期望，才能匹配出真正合适的 3 个岗位。</p>
      <van-button type="primary" block round @click="router.push('/login')">立即匹配工作</van-button>
      <van-button block round plain class="later" @click="guideVisible = false">先逛逛</van-button>
      <p class="tip">仅需手机号 + 短信验证码，无需设置密码</p>
    </van-popup>
  </div>
</template>

<style scoped>
.home { padding: 16px; }
.hero { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--chrome); color: #fff; border-radius: var(--r-lg); }
.avatar { width: 44px; height: 44px; border-radius: 50%; background: var(--chrome-3); display: grid; place-items: center; font-weight: 700; }
.who { flex: 1; }
.hello { font-size: 17px; font-weight: 700; }
.sub { font-size: 12px; color: var(--ink-300); margin-top: 2px; }
.notice { margin: 12px 0; padding: 10px 12px; font-size: 12.5px; line-height: 1.6; color: var(--ink-600); background: var(--surface-2); border: 1px dashed var(--line-2); border-radius: var(--r-md); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cell { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px 14px; text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--sh-1); font: inherit; color: inherit; }
.cell .t { font-size: 16px; font-weight: 700; color: var(--ink-900); }
.cell .d { font-size: 12px; color: var(--ink-500); }
.cell.is-primary { background: var(--signal); border-color: var(--signal); }
.cell.is-primary .t, .cell.is-primary .d { color: #fff; }
.cell.is-disabled { opacity: .5; }
.badge { position: absolute; top: 8px; right: 8px; font-size: 10px; padding: 0 6px; border-radius: var(--r-xs); background: var(--muted-bg); color: var(--ink-500); }
.card { margin-top: 14px; padding: 14px; background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--sh-1); }
.card h3 { margin: 0 0 10px; font-size: 15px; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.steps li { display: flex; gap: 10px; align-items: flex-start; }
.steps i { font-style: normal; width: 22px; height: 22px; border-radius: 50%; background: var(--signal-50); color: var(--signal-700); display: grid; place-items: center; font-size: 12px; flex: none; }
.steps b { display: block; font-size: 14px; color: var(--ink-900); }
.steps span { font-size: 12px; color: var(--ink-500); }
.guide { padding: 20px 16px calc(16px + env(safe-area-inset-bottom)); }
.guide h3 { margin: 0 0 8px; font-size: 18px; }
.guide p { margin: 0 0 16px; font-size: 13px; line-height: 1.6; color: var(--ink-600); }
.guide .later { margin-top: 10px; }
.guide .tip { margin: 12px 0 0; text-align: center; font-size: 12px; color: var(--ink-400); }
</style>
