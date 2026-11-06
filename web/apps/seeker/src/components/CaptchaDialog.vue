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
          <span v-else class="t-xs">点击加载</span>
        </button>
      </div>
      <p class="t-xs hint">看不清？点击图片换一张</p>
    </div>
  </van-dialog>
</template>

<style scoped>
.cap { padding: 12px 20px 18px; }
.tip { font-size: 13px; color: var(--ink-500); text-align: center; margin-bottom: 12px; }
.cap-row { display: flex; gap: 10px; align-items: center; }
.cap-inp { flex: 1; min-width: 0; height: 40px; padding: 0 10px; border: 1.5px solid var(--line-2); border-radius: var(--r-md); font-size: 16px; letter-spacing: .1em; outline: none; background: var(--surface); }
.cap-inp:focus { border-color: var(--ink-900); }
.cap-img { flex: none; width: 120px; height: 40px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-2); display: grid; place-items: center; overflow: hidden; }
.cap-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hint { margin-top: 8px; text-align: right; }
</style>
