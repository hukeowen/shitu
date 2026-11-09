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
  <van-popup v-model:show="show" position="bottom" round teleport="body" safe-area-inset-bottom :close-on-popstate="true" class="ask">
    <div class="sheet-h" aria-hidden="true"></div>
    <div class="row-b hd">
      <div class="flex1">
        <h3 class="ttl">问问这个岗位</h3>
        <p v-if="jobTitle" class="t-xs sub">{{ jobTitle }}</p>
      </div>
      <button type="button" class="x" aria-label="关闭" @click="show = false"><van-icon name="cross" size="18" /></button>
    </div>

    <div ref="listEl" class="msgs" aria-live="polite">
      <div class="m bot">
        <div class="bub">你好！关于这个岗位的吃住、薪资发放、班次、体检等问题都可以问我。没有现成答案的问题会转给岗位负责人，回复后在消息中心通知你。</div>
      </div>
      <div v-for="m in msgs" :key="m.id" class="m" :class="m.role">
        <div class="bub" :class="{ fwd: m.role === 'bot' && m.answered === false, fail: m.failed }">
          <van-loading v-if="m.pending" size="16" type="spinner" />
          <template v-else>
            <span v-if="m.role === 'bot' && m.answered === false" class="tag tag-warn fwd-tag">已转岗位负责人</span>
            <span class="txt">{{ m.text }}</span>
            <span v-if="m.role === 'bot' && m.answered && m.matchedQuestion && m.matchedQuestion !== m.asked" class="t-xs ref">参考问题：{{ m.matchedQuestion }}</span>
            <button v-if="m.failed" type="button" class="retry" @click="retry(m)">重试</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="!msgs.length" class="sugs">
      <button v-for="s in SUGGEST" :key="s" type="button" class="chip-btn" :disabled="sending" @click="ask(s)">{{ s }}</button>
    </div>

    <div class="composer">
      <input
        v-model="input"
        class="inp"
        :maxlength="MAX"
        placeholder="输入你的问题（2–100 字）"
        enterkeyhint="send"
        @keyup.enter="ask()"
      />
      <van-button type="primary" class="send" :disabled="!canSend" :loading="sending" @click="ask()">发送</van-button>
    </div>
    <div class="t-xs cnt" :class="{ over: len > MAX }">
      <span>答案仅供参考，以面试时劳务公司说明为准</span><span class="num">{{ len }} / {{ MAX }}</span>
    </div>
  </van-popup>
</template>

<style scoped>
.ask { padding: 8px 14px 10px; height: 78vh; display: flex; flex-direction: column; box-sizing: border-box; background: var(--surface-2); }
.sheet-h { width: 36px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 auto 10px; flex: none; }
.hd { flex: none; margin-bottom: 8px; }
.ttl { font-size: 17px; font-weight: 700; color: var(--ink-900); }
.sub { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { width: 32px; height: 32px; display: grid; place-items: center; background: none; border: 0; color: var(--ink-500); padding: 0; margin-right: -6px; }
.msgs { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; gap: 10px; padding: 4px 0 10px; }
.m { display: flex; }
.m.me { justify-content: flex-end; }
.bub { max-width: 82%; padding: 10px 12px; font-size: 14px; line-height: 1.6; color: var(--ink-900); background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; word-break: break-word; }
.m.me .bub { background: var(--signal); border-color: var(--signal); color: #fff; border-radius: 14px 4px 14px 14px; }
.bub.fwd { background: var(--warn-bg); border-color: var(--warn-line); }
.bub.fail { background: var(--danger-bg); border-color: var(--danger-line); color: var(--danger); }
.fwd-tag { margin-bottom: 6px; }
.txt { display: block; white-space: pre-wrap; }
.ref { display: block; margin-top: 6px; }
.retry { margin-top: 6px; border: 0; background: none; padding: 0; color: var(--danger); font-weight: 700; font-size: 12.5px; text-decoration: underline; }
.sugs { flex: none; display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 10px; }
.chip-btn { height: 30px; padding: 0 12px; border-radius: 15px; border: 1px solid var(--line-2); background: var(--surface); font-size: 12.5px; color: var(--ink-700); }
.chip-btn:active { background: var(--surface-3); }
.composer { flex: none; display: flex; gap: 8px; align-items: center; }
.composer .inp { flex: 1; min-width: 0; height: 42px; }
.send { flex: none; height: 42px; border-radius: 10px; padding: 0 16px; font-weight: 600; }
.cnt { flex: none; display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; }
.cnt.over { color: var(--warn); }
</style>
