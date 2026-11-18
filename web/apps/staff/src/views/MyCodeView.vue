<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showImagePreview, showToast } from 'vant'
import 'vant/es/image-preview/style'
import { errorMessage, isApiError, tenantApi, useDict, type ChannelItem } from '@shitu/api-client'
import { BrandMark, IconCircleExclamationPoint, IconCopy, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { useAuthStore } from '@/stores/auth'
import { copyText, isWeChat } from '@/utils/clipboard'
import { composePoster } from '@/utils/poster'
import { qrDataUrl } from '@/utils/qr'

/** T-501 我的专属码（权限 CHANNEL_MINE）：求职者扫码注册即成为本公司私域用户，享 24h 专属跟进 */
const auth = useAuthStore()
const { label } = useDict()
const router = useRouter()
const item = ref<ChannelItem | null>(null)
const qr = ref('')
const loading = ref(true)
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
    qr.value = await qrDataUrl(it.url, 560)
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
    <van-nav-bar title="我的专属码" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !item" class="state-block">
      <IconCircleExclamationPoint :size="48" />
      <p class="state-block-t">{{ loadError || '专属码加载失败' }}</p>
      <p class="state-block-d">请检查网络后重新加载</p>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard poster">
          <div class="brand"><BrandMark :size="24" /><span>仕兔</span></div>
          <h2 class="p-co">{{ companyName }}</h2>
          <p class="p-who">驻场老师 {{ memberName }} 邀请你加入仕兔</p>
          <div class="qr-box">
            <img :src="qr" alt="专属二维码" class="qr" />
            <span v-if="item.status === 'DISABLED'" class="disabled">已停用</span>
          </div>
          <p class="p-ft">微信扫一扫 · 注册即享 24 小时专属跟进</p>
        </section>

        <div v-if="item.status === 'DISABLED'" class="tipbar tipbar--warn">
          <IconTriangleExclamationPoint :size="20" />
          <p class="tipbar-d first">该专属码已被公司停用，扫码注册不再绑定本公司，请联系公司管理员。</p>
        </div>
        <p v-if="inWeChat" class="hint">提示：可直接长按二维码保存，或点「保存图片」生成海报</p>

        <section class="acard stats">
          <div><b>{{ item.visits }}</b><span>扫码访问</span></div>
          <div><b>{{ item.registrations }}</b><span>扫码注册</span></div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>专属码说明</h4></div>
          <ul class="tips">
            <li>求职者扫描此码并<b>首次注册</b>，即成为<span class="nowrap">本公司<span class="status-tag status-tag--private">{{ label('DomainTag', 'PRIVATE') }}</span>用户</span>，来源归属永久锁定为本公司。</li>
            <li>私域用户享有 <b>24 小时专属响应窗口</b>，请在窗口内及时联系跟进，超时系统将自动释放至公域。</li>
            <li>已注册的老用户扫码不会改变其归属。</li>
          </ul>
          <button type="button" class="url" @click="copy"><span>{{ item.url }}</span><IconCopy :size="16" /></button>
        </section>
        <div class="bottom-bar-gap" />
      </div>

      <div class="bottom-bar">
        <div class="bar-acts">
          <van-button size="large" type="primary" :loading="saving" loading-text="生成中…" @click="save">保存图片</van-button>
          <van-button size="large" plain type="primary" @click="copy">复制链接</van-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mc { min-height: 100vh; }
.poster { text-align: center; padding: var(--space-5) var(--space-4); }
.brand { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.p-co { margin-top: var(--space-3); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); overflow-wrap: anywhere; }
.p-who { margin-top: var(--space-1); font-size: var(--font-size-body); line-height: 22px; color: var(--text-3); }
/* 二维码外面的白底和边框留出静区；码点本身是纯黑白 */
.qr-box { position: relative; width: min(64vw, 240px); margin: var(--space-4) auto 0; padding: var(--space-3); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); }
.qr { display: block; width: 100%; height: auto; image-rendering: pixelated; -webkit-touch-callout: default; }
.disabled { position: absolute; inset: 0; display: grid; place-items: center; border-radius: var(--radius-card); background: var(--bg-card); opacity: .92; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--danger-text); }
.p-ft { display: inline-block; margin-top: var(--space-4); padding: var(--space-1) var(--space-3); border-radius: var(--radius-control); background: var(--primary-bg); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--primary-text); }
.tipbar-d.first { margin-top: 0; }
.hint { font-size: var(--font-size-aux); color: var(--text-3); text-align: center; }
.stats { display: grid; grid-template-columns: 1fr 1fr; text-align: center; }
.stats div + div { border-left: 1px solid var(--divider); }
.stats b { display: block; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.stats span { font-size: var(--font-size-aux); color: var(--text-2); }
.tips { display: grid; gap: var(--space-2); padding-left: var(--space-4); list-style: disc; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); }
.tips b { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.tips .status-tag { margin: 0 2px; vertical-align: 1px; }
.url { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 44px; margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-control); background: var(--bg-fill); text-align: left; color: var(--text-2); }
.url span { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--font-size-aux); word-break: break-all; -webkit-user-select: text; user-select: text; }
.url svg { flex: none; color: var(--primary-text); }
.bar-acts { display: flex; gap: var(--space-3); }
.bar-acts .van-button { flex: 1; min-width: 0; }
</style>
