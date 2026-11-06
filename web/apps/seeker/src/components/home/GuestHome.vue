<script setup lang="ts">
import { useDict } from '@shitu/api-client'
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
  { key: 'refer', title: '推荐裂变', desc: '推荐工友，得推荐奖励' },
  { key: 'advance', title: '薪资预支', desc: '仅在岗员工可用', off: true, pill: '置灰' },
  { key: 'points', title: '工分变现', desc: '在岗积累工分兑换', off: true, pill: 'V1.5' },
]

const steps = [
  { t: '回答 7 道题', d: '不用打字，点选即可' },
  { t: '生成你的求职画像', d: '薪资 / 班次 / 住宿 / 地域 / 经验' },
  { t: '匹配 3 个岗位', d: '匹配度 ≥80% 才推给你' },
  { t: '报名 → 面试 → 入职', d: '驻场老师全程跟进' },
]

const guarantees = [
  { k: '合同', v: '电子签约，合同永久留存可下载' },
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
    <header class="hero">
      <div class="hero-top">
        <div class="avatar avatar--glass">游</div>
        <div class="who"><b>你好，访客</b><span>未注册 · 尚未生成用户 ID</span></div>
      </div>
      <div class="hero-state">
        <span class="tag tag--lg tag-public"><i class="dot"></i>{{ label('UserStatus', 'GUEST') }}</span>
        <span class="tag tag--glass">匹配范围：{{ label('MatchScope', 'NONE') }}</span>
      </div>
      <p class="hero-desc">平台采用匹配逻辑，没有岗位列表。<br />完成 AI 问薪后，岗位才会以匹配结果出现。</p>
    </header>

    <div class="pad stack">
      <button v-if="channel.inviter" type="button" class="inviter" @click="onTap">
        <div class="avatar avatar--o avatar--sm">{{ channel.inviter.slice(0, 1) }}</div>
        <div class="flex1">
          <b>{{ channel.inviter }} 邀请你加入仕兔</b>
          <span class="t-xs">注册后由该公司专属顾问 24 小时内跟进</span>
        </div>
        <van-icon name="arrow" class="chev" />
      </button>

      <div class="acard cta">
        <div class="row" style="gap: 12px">
          <div class="flex1">
            <div class="cta-t">还没找到活儿？</div>
            <div class="t-sm" style="margin-top: 3px">7 道题，1 分钟，出 3 个岗位</div>
          </div>
          <van-button type="primary" size="small" @click="onTap">开始匹配</van-button>
        </div>
      </div>

      <QuadGrid :items="quad" @tap="onTap" />

      <section class="acard">
        <div class="acard-hd"><h4>平台怎么帮你找活儿</h4></div>
        <ul class="tl">
          <li v-for="(s, i) in steps" :key="s.t">
            <div class="tl-t">{{ i + 1 }} · {{ s.t }}</div>
            <div class="t-xs">{{ s.d }}</div>
          </li>
        </ul>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>在岗工友的保障</h4></div>
        <div class="guar">
          <div v-for="g in guarantees" :key="g.k" class="row">
            <span class="tag tag-ok">{{ g.k }}</span><span class="t-sm">{{ g.v }}</span>
          </div>
        </div>
      </section>

      <p class="t-xs foot">平台仅提供匹配服务，不直接雇佣</p>
    </div>
  </div>
</template>

<style scoped>
.inviter { display: flex; gap: 10px; align-items: center; width: 100%; padding: 11px 13px; text-align: left; background: var(--private-bg); border: 1px solid var(--private-line); border-radius: var(--r-lg); }
.inviter b { display: block; font-size: 13px; font-weight: 700; color: var(--private); }
.inviter .chev { color: var(--private); }
.cta { border-color: var(--signal-300); background: linear-gradient(180deg, var(--signal-50), var(--surface)); }
.cta-t { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.tl { position: relative; padding-left: 20px; margin-top: 4px; }
.tl::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--line-2); }
.tl li { position: relative; padding: 0 0 16px; }
.tl li:last-child { padding-bottom: 0; }
.tl li::before { content: ""; position: absolute; left: -18px; top: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--ok); border: 2px solid var(--ok); }
.tl-t { font-size: 13px; font-weight: 600; color: var(--ink-900); }
.guar { display: grid; gap: 8px; }
.foot { text-align: center; padding: 4px 0 8px; }
</style>
