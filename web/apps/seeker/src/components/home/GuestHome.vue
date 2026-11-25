<script setup lang="ts">
import { useDict } from '@shitu/api-client'
import { BrandMark, IconChevronRight } from '@shitu/ui-icons'
import QuadGrid from '@/components/QuadGrid.vue'
import type { QuadItem } from '@/components/quad'
import { useChannelStore } from '@/stores/channel'
import { useGuideStore } from '@/stores/guide'

/** S-02 游客首页（C-102）：可浏览功能介绍与入口，不展示任何岗位；任何交互均弹 S-03（C-103） */
const { label } = useDict()
const channel = useChannelStore()
const guide = useGuideStore()

const quad: QuadItem[] = [
  { key: 'match', title: 'AI 问薪', desc: '7 题定岗，出 3 个匹配岗位' },
  { key: 'reports', title: '我的报备', desc: '报名、面试、入职进度' },
  { key: 'advance', title: '薪资预支', desc: '入职满 7 天可申请' },
  { key: 'contracts', title: '电子合同', desc: '线上签约，随时查看' },
]

const steps = [
  { t: '回答 7 道题', d: '不用打字，点选即可' },
  { t: '弄清你的找活要求', d: '薪资 / 班次 / 住宿 / 地域 / 经验' },
  { t: '推荐最多 3 个岗位', d: '条件对得上的才推给你' },
  { t: '报名 → 面试 → 入职', d: '驻场老师全程跟进' },
]

const guarantees = [
  { k: '合同', v: '电子签约，合同在线留存随时可查' },
  { k: '台账', v: '报名 / 面试 / 入职 / 出勤全程可查' },
  { k: '预支', v: '在岗满 7 天可申请薪酬预支' },
  { k: '投诉', v: '岗位信息不实可一键投诉' },
]

function onTap() {
  guide.open('/')
}
</script>

<template>
  <div class="guest">
    <header class="home-head">
      <div class="home-brand"><BrandMark :size="24" /><span>仕兔</span></div>
      <h1>你好，访客</h1>
      <p class="home-sub">注册后即可匹配岗位</p>
      <div class="home-tags">
        <span class="status-tag"><i class="dot"></i>{{ label('UserStatus', 'GUEST') }}</span>
      </div>
      <p class="home-desc">这里没有岗位列表。登录后答几道题，就给你推荐条件对得上的岗位。</p>
    </header>

    <div class="pad stack">
      <button v-if="channel.inviter" type="button" class="tipbar inviter" @click="onTap">
        <div class="avatar">{{ channel.inviter.slice(0, 1) }}</div>
        <div class="flex1">
          <div class="tipbar-t">{{ channel.inviter }} 邀请你加入仕兔</div>
          <div class="tipbar-d">注册后由该公司专属顾问 24 小时内跟进</div>
        </div>
        <IconChevronRight :size="20" class="chev" />
      </button>

      <section class="acard lead">
        <h2>还没找到活儿？</h2>
        <p class="lead-sub">7 道题，1 分钟，最多出 3 个岗位</p>
        <van-button type="primary" block @click="onTap">开始匹配</van-button>
      </section>

      <QuadGrid :items="quad" @tap="onTap" />

      <section class="acard">
        <div class="acard-hd"><h4>平台怎么帮你找活儿</h4></div>
        <ol class="how">
          <li v-for="(s, i) in steps" :key="s.t">
            <i>{{ i + 1 }}</i>
            <div class="flex1">
              <div class="how-t">{{ s.t }}</div>
              <div class="how-d">{{ s.d }}</div>
            </div>
          </li>
        </ol>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>在岗工友的保障</h4></div>
        <div class="guar">
          <div v-for="g in guarantees" :key="g.k" class="guar-i">
            <span class="status-tag status-tag--success">{{ g.k }}</span><span class="flex1">{{ g.v }}</span>
          </div>
        </div>
      </section>

      <p class="foot">平台仅提供匹配服务，不直接雇佣</p>
    </div>
  </div>
</template>

<style scoped>
.inviter { width: 100%; align-items: center; border: 0; text-align: left; }
.inviter .avatar { background: var(--bg-card); }
.inviter .chev { margin-top: 0; }
.how { display: grid; gap: var(--space-4); }
.how li { display: flex; gap: var(--space-3); align-items: flex-start; }
.how i { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--primary-text); background: var(--primary-bg); }
.how-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 24px; color: var(--text-1); }
.how-d { font-size: var(--font-size-aux); color: var(--text-3); }
.guar { display: grid; gap: var(--space-3); }
.guar-i { display: flex; gap: var(--space-3); align-items: flex-start; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.guar-i .status-tag { flex: none; }
.foot { text-align: center; padding: var(--space-1) 0 var(--space-2); font-size: var(--font-size-min); color: var(--text-3); }
</style>
