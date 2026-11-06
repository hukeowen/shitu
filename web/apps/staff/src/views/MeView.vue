<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { useDict } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'

/** 驻场「我的」：成员身份、所属公司、退出登录（成员接口不返回手机号，故不展示） */
const auth = useAuthStore()
const router = useRouter()
const { label } = useDict()
const me = computed(() => auth.me)

async function onLogout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？', confirmButtonText: '退出' })
  } catch {
    return
  }
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
    <header class="hero">
      <div class="ttl">我的</div>
      <div v-if="me" class="row" style="gap: 12px">
        <div class="avatar avatar--o avatar--lg">{{ me.name.slice(0, 1) }}</div>
        <div class="flex1">
          <div class="name">{{ me.name }}</div>
          <div class="roles">
            <span v-for="r in me.roles" :key="r" class="tag tag--glass">{{ label('ActorRole', r) }}</span>
          </div>
        </div>
      </div>
    </header>

    <div class="pad stack">
      <section v-if="me" class="acard">
        <div class="acard-hd"><h4>所属公司</h4></div>
        <dl>
          <div class="kv"><dt>公司</dt><dd>{{ me.company.name }}</dd></div>
          <div v-if="me.company.shortName" class="kv"><dt>简称</dt><dd>{{ me.company.shortName }}</dd></div>
          <div class="kv"><dt>公司状态</dt><dd>{{ label('CompanyStatus', me.company.status) }}</dd></div>
          <div class="kv"><dt>成员 ID</dt><dd class="num">{{ me.memberId }}</dd></div>
        </dl>
      </section>

      <section v-if="me && auth.operational" class="acard list">
        <router-link v-if="auth.can('CHANNEL_MINE')" to="/my-code" class="lrow">
          <div class="lt"><b>我的专属码</b><span>求职者扫码注册成为本公司私域用户</span></div>
          <van-icon name="arrow" class="chev" />
        </router-link>
        <button type="button" class="lrow" @click="showToast('即将上线')">
          <div class="lt"><b>消息通知</b><span>24h 跟进提醒、待办通知</span></div>
          <span class="tag">即将上线</span>
        </button>
      </section>

      <van-button block class="btn-cta logout" @click="onLogout">退出登录</van-button>
      <p class="t-xs foot">仕兔驻场 V1.0.0</p>
    </div>
  </div>
</template>

<style scoped>
.hero { padding-bottom: 22px; }
.ttl { font-size: 15px; font-weight: 700; margin-bottom: 16px; }
.name { font-size: 18px; font-weight: 700; }
.roles { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.list { padding: 0; overflow: hidden; }
.list .lrow { text-decoration: none; color: inherit; border-left: 0; border-right: 0; border-top: 0; }
.logout { color: var(--danger); border-color: var(--danger-line); }
.foot { text-align: center; padding: 6px 0 16px; }
</style>
