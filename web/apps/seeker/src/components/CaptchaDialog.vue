<script setup lang="ts">
/** 图形验证码弹窗：短信发送触发风控（AUTH_4004 / AUTH_4005）时出现，点图片可刷新 */
const props = defineProps<{
  image: string
  loading: boolean
  confirm: () => Promise<boolean>
}>()
const show = defineModel<boolean>('show', { required: true })
const code = defineModel<string>('code', { required: true })
const emit = defineEmits<{ refresh: [] }>()

function beforeClose(action: string): boolean | Promise<boolean> {
  if (action !== 'confirm') return true
  return props.confirm()
}
</script>

<template>
  <van-dialog
    v-model:show="show"
    title="请完成安全验证"
    show-cancel-button
    confirm-button-text="确定"
    :before-close="beforeClose"
    teleport="body"
  >
    <div class="cap">
      <p class="tip">为保障账号安全，请输入图中字符</p>
      <div class="cap-row">
        <input
          v-model="code"
          class="cap-inp"
          maxlength="6"
          autocomplete="off"
          autocapitalize="off"
          placeholder="图中字符"
        />
        <button type="button" class="cap-img" aria-label="刷新图形验证码" @click="emit('refresh')">
          <van-loading v-if="loading" size="18" />
          <img v-else-if="image" :src="image" alt="图形验证码" />
          <span v-else class="hint">点击加载</span>
        </button>
      </div>
      <p class="hint more">看不清？点击图片换一张</p>
    </div>
  </van-dialog>
</template>

<style scoped>
.cap { padding: var(--space-3) var(--space-5) var(--space-5); }
.tip { font-size: var(--font-size-aux); color: var(--text-2); text-align: center; margin-bottom: var(--space-3); }
.cap-row { display: flex; gap: var(--space-3); align-items: center; }
.cap-inp { flex: 1; min-width: 0; height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); font-size: 16px; letter-spacing: .1em; color: var(--text-1); outline: none; background: var(--bg-card); }
.cap-inp:focus { border-color: var(--primary); }
.cap-inp::placeholder { letter-spacing: 0; color: var(--text-placeholder); }
.cap-img { flex: none; width: 120px; height: var(--control-height); padding: 0; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-fill); display: grid; place-items: center; overflow: hidden; }
.cap-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hint { margin: 0; font-size: var(--font-size-min); color: var(--text-3); }
.more { margin-top: var(--space-2); text-align: right; }
</style>
