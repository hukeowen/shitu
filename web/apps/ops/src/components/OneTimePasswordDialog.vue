<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

/** 一次性密码展示：只显示这一次，关闭后无法再次查看 */
const props = defineProps<{ title: string; username: string; password: string }>()
const visible = defineModel<boolean>({ required: true })
const copied = ref(false)

async function copy() {
  const text = props.password
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 非 https / 无剪贴板权限时降级
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  ElMessage.success('已复制到剪贴板')
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="480px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @closed="copied = false"
  >
    <div class="notice-bar notice-bar--warn">该密码仅显示这一次，关闭后无法再次查看。请立即复制并通过安全渠道交给账号使用人，对方首次登录须修改密码。</div>
    <dl class="kv-grid one box">
      <div class="kv"><dt>用户名</dt><dd>{{ username }}</dd></div>
      <div class="kv"><dt>一次性密码</dt><dd class="pwd">{{ password }}</dd></div>
    </dl>
    <template #footer>
      <el-button @click="copy">{{ copied ? '再次复制' : '复制密码' }}</el-button>
      <el-button type="primary" @click="visible = false">我已记录，关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.box { margin-top: var(--space-4); }
/* 密码是一串编码：等宽字体，加大字号方便抄写 */
.pwd { font-family: var(--font-mono); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); letter-spacing: .08em; color: var(--text-1); user-select: all; }
</style>
