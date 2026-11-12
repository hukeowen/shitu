<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { showToast } from 'vant'
import { errorMessage, seekerApi, type Disclaimer } from '@shitu/api-client'
import { IconCheck, IconFileText } from '@shitu/ui-icons'

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
      <IconFileText :size="32" :stroke-width="1.5" />
      <h3>{{ doc?.title || '求职告知书与免责声明' }}</h3>
      <p>首次报名岗位需阅读并同意<template v-if="doc"> · 版本 {{ doc.version }}</template></p>
    </div>

    <div v-if="loading" class="body center"><van-loading size="24" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="body center">
      <p>{{ loadError }}</p>
      <van-button class="reload" @click="load">重新加载</van-button>
    </div>
    <div v-else-if="doc" ref="box" class="body" tabindex="0" @scroll.passive="onScroll">
      <p v-for="(p, i) in doc.paragraphs" :key="i"><b>{{ i + 1 }}.</b> {{ p }}</p>
      <p v-if="props.companyName">本次报名岗位的劳动关系归属于：<b>{{ props.companyName }}</b>，劳动合同、社保与工资发放由该公司负责。</p>
      <p class="end">— 已到底部 —</p>
    </div>

    <button type="button" class="chk" role="checkbox" :aria-checked="checked" :class="{ dim: !readToEnd }" @click="onCheck">
      <span class="box" :class="{ on: checked }"><IconCheck v-if="checked" :size="14" :stroke-width="3" /></span>
      <span>我已完整阅读并同意上述告知书与免责声明<template v-if="!readToEnd">（请先滑动读完）</template></span>
    </button>
    <div class="btns">
      <van-button class="b1" @click="show = false">再看看</van-button>
      <van-button class="b2" type="primary" :disabled="!checked || !doc" :loading="agreeing" @click="agree">同意并继续</van-button>
    </div>
    <p class="foot">同意记录将永久存档：用户 ID · 操作时间 · IP 地址 · 版本号</p>
  </van-popup>
</template>

<style scoped>
.disc { width: calc(100% - 48px); max-width: 420px; padding: var(--space-5) var(--space-4) var(--space-4); }
.hd { margin-bottom: var(--space-3); text-align: center; }
.hd svg { color: var(--primary); }
.hd h3 { margin-top: var(--space-2); font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.hd p { margin-top: 2px; font-size: var(--font-size-aux); color: var(--text-3); }
.body { max-height: min(46vh, 300px); padding: var(--space-3); overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-page); font-size: var(--font-size-body); line-height: 24px; color: var(--text-2); }
.body p + p { margin-top: var(--space-2); }
.body b { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.body .end { font-size: var(--font-size-aux); color: var(--text-3); text-align: center; }
.body.center { --van-loading-spinner-color: var(--primary); padding: var(--space-6) var(--space-3); text-align: center; }
.reload { margin-top: var(--space-3); }
.chk { display: flex; align-items: flex-start; gap: var(--space-2); width: 100%; min-height: 44px; margin-top: var(--space-3); padding: 0; border: 0; background: none; font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); text-align: left; }
.chk.dim { color: var(--text-3); }
.box { flex: none; display: grid; place-items: center; width: 20px; height: 20px; margin-top: 1px; border: 1px solid var(--text-3); border-radius: var(--radius-tag); background: var(--bg-card); color: var(--text-on-primary); }
.box.on { border-color: var(--primary); background: var(--primary); }
.btns { display: flex; gap: var(--space-3); margin-top: var(--space-3); }
.b1 { flex: 1; }
.b2 { flex: 2; }
.foot { text-wrap: balance; margin-top: var(--space-3); font-size: var(--font-size-min); color: var(--text-3); text-align: center; }
</style>
