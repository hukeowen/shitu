<script setup lang="ts">
import { reactive, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, tenantApi, type InboxItem } from '@shitu/api-client'
import { IconBell, IconChevronRight, IconCircleExclamationPoint, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { useInboxStore } from '@/stores/inbox'
import { fmtTime } from '@/utils/time'

/** 站内信：新报名、释放通知等；点击标记已读并跳转 */
const router = useRouter()
const inbox = useInboxStore()
const PAGE_SIZE = 20

const rows = shallowRef<InboxItem[]>([])
const loading = ref(true)
const finished = ref(false)
const error = ref(false)
const errorText = ref('')
const refreshing = ref(false)
const markingAll = ref(false)
/** 「全部已读」没有成功：原因留在列表上方 */
const readAllError = ref('')
let page = 0
let seq = 0

async function loadMore() {
  const my = seq
  try {
    const r = await tenantApi.messages({ page: page + 1, pageSize: PAGE_SIZE })
    if (my !== seq) return
    page += 1
    rows.value = [...rows.value, ...r.records]
    finished.value = rows.value.length >= r.total || r.records.length < PAGE_SIZE
  } catch (e) {
    if (my !== seq) return
    error.value = true
    errorText.value = errorMessage(e, '加载失败')
  } finally {
    if (my === seq) {
      loading.value = false
      refreshing.value = false
    }
  }
}

function reset() {
  seq += 1
  page = 0
  rows.value = []
  error.value = false
  finished.value = false
  loading.value = true
  void inbox.refresh()
  void loadMore()
}
reset()

function patchRead(ids: number[] | 'all') {
  rows.value = rows.value.map((m) => (ids === 'all' || ids.includes(m.id) ? { ...m, read: true } : m))
}

/** 站内信 link 为驻场端内路径（如 /applications/xxx）；其他端的链接不跳转 */
const INTERNAL = /^\/(applications\/[\w-]+|todo|my-code|me|messages|advance(\/[\w-]+)?|reminders|private-pending|employees|incidents)?(\?.*)?$/

async function open(m: InboxItem) {
  if (!m.read) {
    patchRead([m.id])
    inbox.unread = Math.max(0, inbox.unread - 1)
    tenantApi.markRead([m.id]).catch(() => void inbox.refresh())
  }
  if (m.link && INTERNAL.test(m.link)) await router.push(m.link)
  // 列表只显示两行摘要；不跳转的消息点开就地展开全文
  else expanded[m.id] = !expanded[m.id]
}
const expanded = reactive<Record<number, boolean>>({})

async function readAll() {
  if (markingAll.value) return
  markingAll.value = true
  readAllError.value = ''
  try {
    await tenantApi.markRead()
    patchRead('all')
    inbox.unread = 0
    showToast('已全部标为已读')
  } catch (e) {
    readAllError.value = errorMessage(e)
    showToast(readAllError.value)
  } finally {
    markingAll.value = false
  }
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="msgs">
    <van-nav-bar title="消息通知" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back">
      <template #right>
        <button type="button" class="all" :disabled="markingAll || inbox.unread === 0" @click="readAll"><van-loading v-if="markingAll" size="16" />全部已读</button>
      </template>
    </van-nav-bar>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="reset">
      <div v-if="error && !rows.length" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ errorText || '加载失败' }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reset">重新加载</van-button>
      </div>
      <div v-else-if="loading && !rows.length" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <div v-else class="pad stack">
        <section v-if="readAllError" class="tipbar tipbar--danger" role="alert">
          <IconTriangleExclamationPoint :size="20" />
          <p class="tipbar-d first">没有标记成功：{{ readAllError }}</p>
        </section>
        <p v-if="rows.length && inbox.unread === 0" class="read-note">没有未读消息</p>
        <van-list
          v-model:loading="loading"
          v-model:error="error"
          :finished="finished"
          :immediate-check="false"
          :error-text="`${errorText || '加载失败'}，点击重试`"
          :finished-text="rows.length ? '没有更多了' : ''"
          v-show="rows.length"
          class="acard list"
          @load="loadMore"
        >
          <!-- 可点的是标题里的按钮，用伪元素铺满整行 -->
          <article v-for="m in rows" :key="m.id" class="msg" :class="{ unread: !m.read }">
            <i class="msg-dot" aria-hidden="true" />
            <div class="flex1">
              <div class="msg-hd">
                <h3><button type="button" class="msg-open" @click="open(m)"><span v-if="!m.read" class="sr-only">未读：</span>{{ m.title }}</button></h3>
                <span v-if="m.priority >= 2" class="status-tag status-tag--danger">紧急</span>
                <time>{{ fmtTime(m.createdAt) }}</time>
              </div>
              <p class="msg-c" :class="{ open: expanded[m.id] }">{{ m.content }}</p>
            </div>
            <IconChevronRight v-if="m.link && INTERNAL.test(m.link)" :size="16" class="chev" />
          </article>
        </van-list>
        <div v-if="finished && !rows.length && !error" class="state-block">
          <IconBell :size="48" />
          <p class="state-block-t">暂无消息</p>
          <p class="state-block-d">新报名、释放通知等站内信会出现在这里</p>
        </div>
        <div class="page-bottom-gap" />
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.msgs { min-height: 100vh; }
.pr { min-height: calc(100vh - 44px); }
.all { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 44px; padding: 0; border: 0; background: none; font-size: var(--font-size-body); color: var(--primary-text); --van-loading-spinner-color: var(--primary); }
.all:disabled { color: var(--text-placeholder); }
.read-note { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.list { padding: 0 var(--space-card); }
.list :deep(.van-list__finished-text), .list :deep(.van-list__error-text), .list :deep(.van-list__loading) { font-size: var(--font-size-aux); color: var(--text-3); }
.msg { position: relative; display: flex; align-items: flex-start; gap: var(--space-2); min-height: 44px; padding: var(--space-3) 0; border-bottom: 1px solid var(--divider); }
.msg:active { background: var(--bg-hover); }
.msg-open { padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; }
.msg-open::after { content: ''; position: absolute; inset: 0; }
.msg-open:focus-visible { outline: none; }
.msg-open:focus-visible::after { outline: 2px solid var(--primary); outline-offset: -2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* 圆点占位固定，已读未读的标题左边对齐 */
.msg-dot { flex: none; width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; }
.msg.unread .msg-dot { background: var(--primary); }
.msg-hd { display: flex; align-items: baseline; gap: var(--space-2); }
.msg-hd h3 { min-width: 0; font-size: var(--font-size-section); font-weight: var(--font-weight-regular); line-height: 24px; color: var(--text-1); overflow-wrap: anywhere; }
.msg.unread h3 { font-weight: var(--font-weight-medium); }
.msg-hd .status-tag { flex: none; align-self: center; }
.msg-hd time { flex: none; margin-left: auto; font-size: var(--font-size-aux); color: var(--text-3); white-space: nowrap; }
.msg-c { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); overflow-wrap: anywhere; }
.msg-c.open { display: block; -webkit-line-clamp: unset; }
.chev { flex: none; margin-top: 4px; color: var(--text-3); }
.tipbar-d.first { margin-top: 0; }
</style>
