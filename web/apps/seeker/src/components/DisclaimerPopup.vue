<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, seekerApi, type Disclaimer } from '@shitu/api-client'

/** S-20 求职告知书与免责声明（C-403）：首次报名强制；需滑动读完并勾选后才能同意 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ companyName?: string }>()
const emit = defineEmits<{ agreed: [] }>()

const doc = ref<Disclaimer | null>(null)
const loading = ref(false)
const loadError = ref('')
const readToEnd = ref(false)
const checked = ref(false)
const agreeing = ref(false)
const box = ref<HTMLElement | null>(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    doc.value = await seekerApi.disclaimer()
  } catch (e) {
    loadError.value = errorMessage(e, '告知书加载失败')
  } finally {
    loading.value = false
  }
  await nextTick()
  onScroll()
}

watch(show, (v) => {
  if (!v) return
  checked.value = false
  readToEnd.value = false
  if (!doc.value) void load()
  else void nextTick(onScroll)
})

/** 内容不足一屏时直接视为已读完 */
function onScroll() {
  const el = box.value
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) readToEnd.value = true
}

function onCheck() {
  if (!readToEnd.value) {
    showToast('请先滑动阅读完整告知书')
    return
  }
  checked.value = !checked.value
}

async function agree() {
  if (!doc.value || !checked.value || agreeing.value) return
  agreeing.value = true
  try {
    await seekerApi.agreeDisclaimer(doc.value.version)
    show.value = false
    emit('agreed')
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
  } finally {
    agreeing.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" round teleport="body" class="disc" :close-on-click-overlay="false" :close-on-popstate="true">
    <div class="hd">
      <div class="ic">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /><path d="M14 3v5h5M9 13h6M9 16.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <h3>{{ doc?.title || '求职告知书与免责声明' }}</h3>
      <p class="t-xs">首次报名岗位需阅读并同意<template v-if="doc"> · 版本 {{ doc.version }}</template></p>
    </div>

    <div v-if="loading" class="body center"><van-loading size="22" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="body center">
      <p class="t-sm">{{ loadError }}</p>
      <van-button size="small" round style="margin-top: 10px" @click="load">重新加载</van-button>
    </div>
    <div v-else-if="doc" ref="box" class="body" @scroll.passive="onScroll">
      <p v-for="(p, i) in doc.paragraphs" :key="i"><b>{{ i + 1 }}.</b> {{ p }}</p>
      <p v-if="props.companyName" class="rel">本次报名岗位的劳动关系归属于：<b>{{ props.companyName }}</b>，劳动合同、社保与工资发放由该公司负责。</p>
      <p class="end t-xs">— 已到底部 —</p>
    </div>

    <button type="button" class="chk" :class="{ dim: !readToEnd }" @click="onCheck">
      <span class="box" :class="{ on: checked }">
        <svg v-if="checked" width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </span>
      <span class="t-xs">我已完整阅读并同意上述告知书与免责声明<template v-if="!readToEnd">（请先滑动读完）</template></span>
    </button>
    <div class="row btns">
      <van-button class="b1" @click="show = false">再看看</van-button>
      <van-button class="b2" type="primary" :disabled="!checked || !doc" :loading="agreeing" @click="agree">同意并继续</van-button>
    </div>
    <p class="t-xs foot">同意记录将永久存档：用户 ID · 操作时间 · IP 地址 · 版本号</p>
  </van-popup>
</template>

<style scoped>
.disc { width: calc(100% - 44px); max-width: 420px; padding: 18px 16px 14px; }
.hd { text-align: center; margin-bottom: 14px; }
.hd .ic { width: 46px; height: 46px; border-radius: 14px; background: var(--info-bg); color: var(--info); display: grid; place-items: center; margin: 0 auto 11px; }
.hd h3 { font-size: 17px; font-weight: 700; color: var(--ink-900); }
.hd p { margin-top: 4px; }
.body { max-height: min(46vh, 300px); overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px 13px; font-size: 12.5px; line-height: 1.85; color: var(--ink-700); }
.body p + p { margin-top: 9px; }
.body b { color: var(--ink-900); }
.body .end { text-align: center; }
.body.center { text-align: center; padding: 28px 12px; }
.chk { display: flex; align-items: flex-start; gap: 8px; margin-top: 13px; background: none; border: 0; padding: 0; text-align: left; width: 100%; }
.chk.dim { opacity: .55; }
.chk .box { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--ink-300); display: grid; place-items: center; flex: none; margin-top: 2px; }
.chk .box.on { background: var(--signal); border-color: var(--signal); }
.btns { gap: 9px; margin-top: 14px; }
.btns .b1 { flex: 1; height: 44px; border-radius: 11px; }
.btns .b2 { flex: 1.4; height: 44px; border-radius: 11px; }
.foot { text-align: center; margin-top: 10px; }
</style>
