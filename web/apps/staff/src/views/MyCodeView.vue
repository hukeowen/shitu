<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showImagePreview, showToast } from 'vant'
import 'vant/es/image-preview/style'
import QRCode from 'qrcode'
import { errorMessage, isApiError, tenantApi, useDict, type ChannelItem } from '@shitu/api-client'
import { useAuthStore } from '@/stores/auth'
import { copyText, isWeChat } from '@/utils/clipboard'
import { composePoster } from '@/utils/poster'

/** T-501 我的专属码（权限 CHANNEL_MINE）：求职者扫码注册即成为本公司私域用户，享 24h 专属跟进 */
const auth = useAuthStore()
const { label } = useDict()
const router = useRouter()
const item = ref<ChannelItem | null>(null)
const qr = ref('')
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const inWeChat = isWeChat()

const companyName = computed(() => auth.me?.company.shortName || auth.me?.company.name || '')
const memberName = computed(() => item.value?.memberName || auth.me?.name || '')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const it = await tenantApi.myChannelCode()
    item.value = it
    qr.value = await QRCode.toDataURL(it.url, { width: 560, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0D1117', light: '#FFFFFF' } })
  } catch (e) {
    loadError.value = isApiError(e) && e.status === 403 ? '你的角色暂无专属码权限' : errorMessage(e, '专属码加载失败')
  } finally {
    loading.value = false
  }
}
void load()

async function save() {
  if (!qr.value || saving.value) return
  saving.value = true
  try {
    const poster = await composePoster({ qrDataUrl: qr.value, name: memberName.value, company: companyName.value })
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (inWeChat || isIOS) {
      // 微信 / iOS WebView 不支持 a[download]，改为预览后长按保存
      showImagePreview({ images: [poster], closeable: true, showIndex: false })
      showToast({ message: '长按图片保存到相册', duration: 2500 })
    } else {
      const a = document.createElement('a')
      a.href = poster
      a.download = `仕兔专属码-${memberName.value || item.value?.code}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      showToast('图片已开始下载')
    }
  } catch (e) {
    showToast(errorMessage(e, '生成图片失败'))
  } finally {
    saving.value = false
  }
}

async function copy() {
  if (!item.value) return
  const ok = await copyText(item.value.url)
  showToast(ok ? '链接已复制，可粘贴发送给求职者' : '复制失败，请长按链接手动复制')
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="mc">
    <van-nav-bar title="我的专属码" left-arrow safe-area-inset-top @click-left="back" />

    <div v-if="loading" class="state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !item" class="state">
      <van-empty image="error" :description="loadError || '专属码加载失败'">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <div v-else class="pad stack">
      <section class="poster">
        <div class="p-hd">
          <b>{{ companyName }}</b>
          <span>驻场老师 {{ memberName }} 邀请你加入仕兔</span>
        </div>
        <div class="qr-box">
          <img :src="qr" alt="专属二维码" class="qr" />
          <span v-if="item.status === 'DISABLED'" class="disabled">已停用</span>
        </div>
        <p class="p-ft">微信扫一扫 · 注册即享 24 小时专属跟进</p>
      </section>

      <p v-if="item.status === 'DISABLED'" class="note warn">该专属码已被公司停用，扫码注册不再绑定本公司，请联系公司管理员。</p>
      <p v-if="inWeChat" class="t-xs center">提示：可直接长按二维码保存，或点「保存图片」生成海报</p>

      <div class="actions">
        <van-button type="primary" class="btn-cta" :loading="saving" @click="save">保存图片</van-button>
        <van-button plain type="primary" class="btn-cta" @click="copy">复制链接</van-button>
      </div>

      <section class="acard stats">
        <div><b class="num">{{ item.visits }}</b><span>扫码访问</span></div>
        <div><b class="num">{{ item.registrations }}</b><span>扫码注册</span></div>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>专属码说明</h4></div>
        <ul class="tips t-sm">
          <li>求职者扫描此码并<b>首次注册</b>，即成为<span class="nowrap">本公司<span class="tag tag-private">{{ label('DomainTag', 'PRIVATE') }}</span>用户</span>，来源归属永久锁定为本公司。</li>
          <li>私域用户享有 <b>24 小时专属响应窗口</b>，请在窗口内及时联系跟进，超时系统将自动释放至公域。</li>
          <li>已注册的老用户扫码不会改变其归属。</li>
        </ul>
        <p class="t-xs link mono" @click="copy">{{ item.url }}</p>
      </section>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.mc { min-height: 100vh; }
.state { padding-top: 80px; }
.poster { padding: 20px 18px 18px; border-radius: var(--r-lg); color: #fff; background: linear-gradient(160deg, #22303F, #0D1117); position: relative; overflow: hidden; text-align: center; }
.poster::after { content: ""; position: absolute; right: -30px; top: -30px; width: 150px; height: 150px; border-radius: 50%; background: radial-gradient(circle, rgba(232, 89, 12, .45), transparent 68%); pointer-events: none; z-index: 0; }
.poster > * { position: relative; z-index: 1; }
.p-hd b { display: block; font-size: 18px; font-weight: 700; }
.p-hd span { display: block; margin-top: 4px; font-size: 12.5px; color: rgba(255, 255, 255, .62); }
.qr-box { position: relative; width: min(72vw, 260px); margin: 16px auto 0; padding: 10px; background: #fff; border-radius: 12px; }
.qr { display: block; width: 100%; height: auto; -webkit-touch-callout: default; }
.disabled { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255, 255, 255, .8); color: var(--danger); font-weight: 700; font-size: 18px; border-radius: 12px; }
.p-ft { margin-top: 14px; font-size: 12.5px; color: var(--signal-300); font-weight: 600; }
.warn { border-color: var(--warn); background: var(--warn-bg); }
.center { text-align: center; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stats { display: grid; grid-template-columns: 1fr 1fr; text-align: center; }
.stats div + div { border-left: 1px solid var(--line); }
.stats b { display: block; font-size: 24px; font-weight: 700; color: var(--ink-900); }
.stats span { font-size: 12px; color: var(--ink-500); }
.tips { display: grid; gap: 8px; padding-left: 16px; list-style: disc; line-height: 1.7; }
.tips b { color: var(--ink-900); }
.tips .tag { margin: 0 2px; vertical-align: 1px; }
.link { margin-top: 12px; padding: 8px 10px; background: var(--surface-2); border-radius: var(--r-sm); word-break: break-all; -webkit-user-select: text; user-select: text; }
</style>
