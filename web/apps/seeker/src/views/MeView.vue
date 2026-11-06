<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { DomainTag } from '@shitu/ui-mobile'
import { errorMessage, useDict } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'
import { useInboxStore } from '@/stores/inbox'
import { STATUS_TAG_CLASS } from '@/utils/status'
import { formatServerTime } from '@/utils/time'

/** S-26 我的（Sprint 1 范围：身份档案 + 退出登录）。所属劳务公司按原型只在「我的工作」中展示 */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const inbox = useInboxStore()
void inbox.refresh()
const profile = computed(() => auth.profile)
const loading = ref(false)
const loadError = ref('')

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    await auth.loadProfile()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
if (!auth.profile) void reload()

const rows = [
  { key: 'reports', title: '我的报备', desc: '报名 / 面试进度', to: '/reports' },
  { key: 'messages', title: '消息中心', desc: '面试通知、状态变更提醒', to: '/messages' },
  { key: 'kyc', title: '实名认证', desc: '报名前需完成，提交后不可修改', to: '/kyc' },
  { key: 'feedback', title: '问题反馈', desc: '投诉、建议、维权求助', to: '/feedback' },
]
const soon = [
  { key: 'contract', title: '我的合同', desc: '电子合同永久留存', pill: '即将上线' },
  { key: 'resume', title: '我的简历', desc: '完善基础信息', pill: '即将上线' },
  { key: 'refer', title: '推荐裂变', desc: '推荐工友入职得奖励', pill: '预留' },
]

async function onLogout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？', confirmButtonText: '退出' })
  } catch {
    return
  }
  try {
    await auth.logout()
  } catch {
    /* 服务端吊销失败也已清空本地登录态 */
  }
  showToast('已退出登录')
  await router.replace('/')
}
</script>

<template>
  <div class="me">
    <header class="hero">
      <div class="hero-row"><span class="ttl">我的</span></div>
      <div v-if="profile" class="row" style="gap: 12px">
        <div class="avatar avatar--o avatar--lg">我</div>
        <div class="flex1">
          <div class="name num">{{ profile.phoneMasked }}</div>
          <div class="row" style="gap: 6px; margin-top: 5px; flex-wrap: wrap">
            <span class="tag" :class="STATUS_TAG_CLASS[profile.status]"><i class="dot"></i>{{ label('UserStatus', profile.status) }}</span>
            <DomainTag :domain="profile.domainTag" />
          </div>
        </div>
      </div>
      <p class="hero-tip">所属劳务公司信息将在「我的工作」中展示</p>
    </header>

    <div class="pad stack">
      <section v-if="profile" class="acard">
        <div class="acard-hd"><h4>身份档案</h4></div>
        <dl>
          <div class="kv"><dt>用户 ID</dt><dd class="num">{{ profile.userId }}</dd></div>
          <div class="kv"><dt>手机号</dt><dd class="num">{{ profile.phoneMasked }}</dd></div>
          <div class="kv"><dt>当前状态</dt><dd>{{ label('UserStatus', profile.status) }}</dd></div>
          <div class="kv"><dt>匹配范围</dt><dd>{{ label('MatchScope', profile.matchScope) }}</dd></div>
          <div class="kv"><dt>来源</dt><dd>{{ profile.sourceIsPlatform ? '平台自主注册' : '渠道注册' }}</dd></div>
          <div class="kv"><dt>注册时间</dt><dd class="num">{{ formatServerTime(profile.registeredAt) }}</dd></div>
        </dl>
      </section>
      <div v-else-if="loading" class="acard"><van-loading size="22" vertical>加载中…</van-loading></div>
      <section v-else class="acard">
        <van-empty image="error" image-size="72" :description="loadError || '加载失败'">
          <van-button round size="small" type="primary" @click="reload">重新加载</van-button>
        </van-empty>
      </section>

      <section class="acard list">
        <router-link v-for="r in rows" :key="r.key" :to="r.to" class="lrow">
          <div class="lt"><b>{{ r.title }}</b><span>{{ r.key === 'kyc' && profile?.kycStatus === 'VERIFIED' ? '已完成实名认证' : r.desc }}</span></div>
          <i v-if="r.key === 'messages' && inbox.unread > 0" class="badge num">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</i>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <button v-for="r in soon" :key="r.key" type="button" class="lrow" @click="showToast('即将上线')">
          <div class="lt"><b>{{ r.title }}</b><span>{{ r.desc }}</span></div>
          <span class="tag">{{ r.pill }}</span>
        </button>
      </section>

      <van-button block class="btn-cta logout" @click="onLogout">退出登录</van-button>

      <p class="t-xs foot">
        <template v-if="profile">用户 ID {{ profile.userId }} · </template>仕兔 V1.0.0<br />平台仅提供匹配服务，不直接雇佣
      </p>
    </div>
  </div>
</template>

<style scoped>
.hero { padding-bottom: 22px; }
.hero-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.ttl { font-size: 15px; font-weight: 700; }
.name { font-size: 18px; font-weight: 700; }
.hero-tip { font-size: 11px; color: rgba(255, 255, 255, .42); margin-top: 12px; }
.list { padding: 0; overflow: hidden; }
.list .lrow { text-decoration: none; color: inherit; border-left: 0; border-right: 0; border-top: 0; }
.badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--danger); color: #fff; font-size: 10.5px; font-style: normal; line-height: 18px; text-align: center; box-sizing: border-box; flex: none; }
.logout { color: var(--danger); border-color: var(--danger-line); }
.foot { text-align: center; padding: 6px 0 16px; line-height: 1.7; }
</style>
