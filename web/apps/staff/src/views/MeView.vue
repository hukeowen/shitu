<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, useDict } from '@shitu/api-client'
import { IconBell, IconChevronRight, IconCircleExclamationPoint, IconCircleX, IconQrCode, IconShieldCheck, IconUsers, IconWallet } from '@shitu/ui-icons'
import { useAuthStore } from '@/stores/auth'
import { useCancelRequestsStore } from '@/stores/cancelRequests'
import { useInboxStore } from '@/stores/inbox'
import { advanceWording } from '@/utils/advance'

/** 驻场「我的」：成员身份、所属公司、功能入口、退出登录 */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const me = computed(() => auth.me)
const inbox = useInboxStore()
const adv = computed(() => advanceWording(me.value?.roles))
/** 取消申请只对驻场 / 项目经理开放（接口同此限制） */
const cancelReq = useCancelRequestsStore()
const canCancelReq = computed(() => (me.value?.roles ?? []).some((r) => r === 'SITE' || r === 'PM'))
function refreshBadges() {
  if (!auth.operational) return
  void inbox.refresh()
  if (canCancelReq.value) void cancelReq.refresh()
}
refreshBadges()

/** 成员信息在启动时拉取；没拉到时这里给重新加载 */
const reloading = ref(false)
const loadError = ref('')
async function reload() {
  reloading.value = true
  loadError.value = ''
  try {
    await auth.loadMe()
    refreshBadges()
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败')
  } finally {
    reloading.value = false
  }
}

const loggingOut = ref(false)
async function onLogout() {
  if (loggingOut.value) return
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？', confirmButtonText: '退出' })
  } catch {
    return
  }
  loggingOut.value = true
  try {
    await auth.logout()
  } catch {
    /* 已清空本地登录态 */
  }
  showToast('已退出登录')
  await router.replace('/login')
}
</script>

<template>
  <div class="me">
    <van-nav-bar title="我的" safe-area-inset-top fixed placeholder z-index="30" />

    <div class="pad stack">
      <section v-if="me" class="acard me-card">
        <div class="me-top">
          <span class="avatar avatar--lg">{{ me.name.slice(0, 1) }}</span>
          <div class="flex1">
            <b class="me-name">{{ me.name }}</b>
            <span v-if="me.phoneMasked" class="me-phone">{{ me.phoneMasked }}</span>
            <span class="me-tags"><span v-for="r in me.roles" :key="r" class="status-tag status-tag--info">{{ label('ActorRole', r) }}</span></span>
          </div>
        </div>
      </section>
      <div v-else-if="reloading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ loadError || '成员信息加载失败' }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reload">重新加载</van-button>
      </div>

      <section v-if="me" class="acard">
        <div class="acard-hd"><h4>所属公司</h4></div>
        <dl>
          <div class="kv"><dt>公司</dt><dd>{{ me.company.name }}</dd></div>
          <div v-if="me.company.shortName" class="kv"><dt>简称</dt><dd>{{ me.company.shortName }}</dd></div>
          <div class="kv"><dt>公司状态</dt><dd>{{ label('CompanyStatus', me.company.status) }}</dd></div>
          <div class="kv"><dt>成员编号</dt><dd>{{ me.memberId }}</dd></div>
        </dl>
      </section>

      <template v-if="me && auth.operational">
        <section class="acard me-group">
          <router-link v-if="auth.can('CHANNEL_MINE')" to="/my-code" class="lrow">
            <IconQrCode :size="20" class="ic" />
            <div class="lt"><b>我的专属码</b><span>求职者扫码注册成为本公司私域用户</span></div>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
          <router-link to="/employees" class="lrow">
            <IconUsers :size="20" class="ic" />
            <div class="lt"><b>在岗人员</b><span>请假 / 旷工标记</span></div>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
          <router-link to="/advance" class="lrow">
            <IconWallet :size="20" class="ic" />
            <div class="lt"><b>{{ adv.title }}</b><span>{{ adv.entryDesc }}</span></div>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
          <router-link v-if="canCancelReq" to="/cancel-requests" class="lrow">
            <IconCircleX :size="20" class="ic" />
            <div class="lt"><b>取消申请</b><span>求职者申请取消报名，由你同意或回复</span></div>
            <i v-if="cancelReq.pending > 0" class="cnt">{{ cancelReq.pending > 99 ? '99+' : cancelReq.pending }}</i>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
          <router-link to="/incidents" class="lrow">
            <IconShieldCheck :size="20" class="ic" />
            <div class="lt"><b>工伤上报</b><span>现场发生工伤第一时间上报，立刻通知老板</span></div>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
        </section>
        <section class="acard me-group">
          <router-link to="/messages" class="lrow">
            <IconBell :size="20" class="ic" />
            <div class="lt"><b>消息通知</b><span>新报名、释放通知等站内信</span></div>
            <i v-if="inbox.unread > 0" class="cnt">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</i>
            <IconChevronRight :size="16" class="chev" />
          </router-link>
        </section>
      </template>

      <van-button block plain type="danger" :loading="loggingOut" loading-text="退出登录" @click="onLogout">退出登录</van-button>
      <p class="foot">仕兔驻场 V1.0.0</p>
    </div>
  </div>
</template>

<style scoped>
.me { min-height: calc(100vh - var(--tabbar-h, 0px)); }
.me-top { display: flex; align-items: center; gap: var(--space-3); }
.me-name { display: block; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); overflow-wrap: anywhere; }
.me-phone { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.me-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.me-group { padding: 0; overflow: hidden; }
.me-group .lrow { text-decoration: none; color: inherit; }
.ic { flex: none; color: var(--text-2); }
/* 数字角标：危险文字色底配白字（和求职者端「我的」同一种用法） */
.cnt { flex: none; min-width: 18px; height: 18px; padding: 0 var(--space-1); border-radius: 9px; background: var(--danger-text); color: var(--text-on-primary); font-size: var(--font-size-min); font-style: normal; line-height: 18px; text-align: center; box-sizing: border-box; }
.foot { padding: var(--space-1) 0 var(--space-4); font-size: var(--font-size-min); line-height: 20px; color: var(--text-3); text-align: center; }
</style>
