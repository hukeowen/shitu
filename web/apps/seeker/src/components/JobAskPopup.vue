<script lang="ts">
import { reactive } from 'vue'

export interface AskMsg {
  id: number
  role: 'me' | 'bot'
  text: string
  /** bot：true = 知识库命中；false = 已转岗位负责人 */
  answered?: boolean
  matchedQuestion?: string | null
  pending?: boolean
  /** bot：对应的提问原文 */
  asked?: string
  failed?: boolean
}

/** 本次会话内按岗位保留问答记录（关闭弹层 / 返回再进不丢；刷新页面清空） */
const histories = reactive(new Map<string, AskMsg[]>())
let seq = 0
</script>

<script setup lang="ts">
import { computed, nextTick, reactive as reactiveObj, ref, watch } from 'vue'
import { errorMessage, seekerApi } from '@shitu/api-client'
import { IconX } from '@shitu/ui-icons'

/**
 * C-409 岗位 AI 问答（S-44）：基于岗位知识库回答；未命中 → 转岗位负责人，回复后站内信通知，并回流知识库待补充。
 * 问题 2–100 字，每人每小时最多 30 次（后端限流）。
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ jobId: string; jobTitle?: string }>()

const MIN = 2
const MAX = 100
const SUGGEST = ['包吃住吗？', '工资几号发？', '有夜班吗？', '体检要自费吗？', '需要带什么材料？']

const input = ref('')
const sending = ref(false)
const listEl = ref<HTMLElement | null>(null)
const msgs = computed<AskMsg[]>(() => histories.get(props.jobId) ?? [])
function listFor(id: string): AskMsg[] {
  if (!histories.has(id)) histories.set(id, [])
  return histories.get(id)!
}
const len = computed(() => input.value.trim().length)
const canSend = computed(() => len.value >= MIN && len.value <= MAX && !sending.value)

async function scrollBottom() {
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}
watch(show, (v) => {
  if (v) void scrollBottom()
})

async function ask(text?: string) {
  const q = (text ?? input.value).trim()
  if (sending.value) return
  if (q.length < MIN || q.length > MAX) return
  const list = listFor(props.jobId)
  list.push({ id: ++seq, role: 'me', text: q })
  const bot = reactiveObj<AskMsg>({ id: ++seq, role: 'bot', text: '', pending: true, asked: q })
  list.push(bot)
  if (!text) input.value = ''
  sending.value = true
  void scrollBottom()
  try {
    const r = await seekerApi.askJob(props.jobId, q)
    bot.text = r.answer
    bot.answered = r.answered
    bot.matchedQuestion = r.matchedQuestion
  } catch (e) {
    bot.failed = true
    bot.text = errorMessage(e, '发送失败，请稍后重试')
  } finally {
    bot.pending = false
    sending.value = false
    void scrollBottom()
  }
}

function retry(m: AskMsg) {
  const list = listFor(props.jobId)
  const i = list.indexOf(m)
  const q = i > 0 ? list[i - 1] : null
  if (!q || q.role !== 'me') return
  list.splice(i - 1, 2)
  void ask(q.text)
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="ask-sheet">
    <div class="sheet-head">
      <div class="flex1">
        <h3>问问这个岗位</h3>
        <p v-if="jobTitle" class="sheet-sub">{{ jobTitle }}</p>
      </div>
      <button type="button" class="sheet-x" aria-label="关闭" @click="show = false"><IconX :size="20" /></button>
    </div>

    <div ref="listEl" class="msgs" aria-live="polite">
      <div class="m bot">
        <div class="bub">你好！关于这个岗位的吃住、薪资发放、班次、体检等问题都可以问我。没有现成答案的问题会转给岗位负责人，回复后在消息中心通知你。</div>
      </div>
      <div v-for="m in msgs" :key="m.id" class="m" :class="m.role">
        <div class="bub" :class="{ fwd: m.role === 'bot' && m.answered === false, fail: m.failed }">
          <van-loading v-if="m.pending" size="16" type="spinner" />
          <template v-else>
            <span v-if="m.role === 'bot' && m.answered === false" class="status-tag status-tag--warning fwd-tag">已转岗位负责人</span>
            <span class="txt">{{ m.text }}</span>
            <span v-if="m.role === 'bot' && m.answered && m.matchedQuestion && m.matchedQuestion !== m.asked" class="ref">参考问题：{{ m.matchedQuestion }}</span>
            <button v-if="m.failed" type="button" class="retry" @click="retry(m)">重试</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="!msgs.length" class="sugs">
      <button v-for="s in SUGGEST" :key="s" type="button" class="chip-tap" :disabled="sending" @click="ask(s)"><span class="chip sug">{{ s }}</span></button>
    </div>

    <div class="composer">
      <input
        v-model="input"
        class="inp"
        :maxlength="MAX"
        placeholder="输入你的问题（2–100 字）"
        aria-label="你的问题"
        enterkeyhint="send"
        @keyup.enter="ask()"
      />
      <van-button type="primary" class="send" :disabled="!canSend" :loading="sending" @click="ask()">发送</van-button>
    </div>
    <div class="cnt" :class="{ over: len > MAX }">
      <span>答案仅供参考，以面试时劳务公司说明为准</span><span>{{ len }} / {{ MAX }}</span>
    </div>
  </van-popup>
</template>

<style scoped>
.ask-sheet { display: flex; flex-direction: column; height: 78vh; padding: var(--space-4) var(--space-page) var(--space-3); box-sizing: border-box; background: var(--bg-page); }
.msgs { flex: 1; display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-2); padding: var(--space-1) 0 var(--space-3); overflow-y: auto; -webkit-overflow-scrolling: touch; }
.m { display: flex; }
.m.me { justify-content: flex-end; }
.bub { max-width: 82%; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--bg-card); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); word-break: break-word; }
.m.me .bub { border-color: var(--primary-line); background: var(--primary-bg); }
.bub .van-loading { --van-loading-spinner-color: var(--primary); }
.bub.fwd { border-color: transparent; background: var(--warning-soft); }
.bub.fail { border-color: transparent; background: var(--danger-soft); }
.fwd-tag { margin-bottom: var(--space-2); background: var(--bg-card); }
.txt { display: block; white-space: pre-wrap; }
.ref { display: block; margin-top: var(--space-2); font-size: var(--font-size-aux); color: var(--text-3); }
.retry { display: block; min-height: 44px; margin-bottom: calc(var(--space-3) * -1); padding: 0; border: 0; background: none; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--danger-text); }
.sugs { flex: none; display: flex; flex-wrap: wrap; gap: 0 var(--space-2); padding-bottom: var(--space-2); }
.sug { padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-aux); line-height: 30px; }
.composer { flex: none; display: flex; align-items: center; gap: var(--space-2); }
.composer .inp { flex: 1; min-width: 0; }
.send { flex: none; }
.cnt { flex: none; display: flex; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-2); font-size: var(--font-size-min); color: var(--text-3); }
.cnt.over { color: var(--danger-text); }
</style>
