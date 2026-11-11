<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, tenantApi, type InboxItem } from '@shitu/api-client'
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
}

async function readAll() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    await tenantApi.markRead()
    patchRead('all')
    inbox.unread = 0
    showToast('已全部标为已读')
  } catch (e) {
    showToast(errorMessage(e))
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
        <button type="button" class="all" :disabled="markingAll || inbox.unread === 0" @click="readAll">全部已读</button>
      </template>
    </van-nav-bar>

    <van-pull-refresh v-model="refreshing" class="pr" @refresh="reset">
      <van-list
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :immediate-check="false"
        :error-text="`${errorText || '加载失败'}，点击重试`"
        :finished-text="rows.length ? '没有更多了' : ''"
        @load="loadMore"
      >
        <div v-if="rows.length" class="list">
          <button v-for="m in rows" :key="m.id" type="button" class="msg" :class="{ unread: !m.read }" @click="open(m)">
            <i class="d" aria-hidden="true" />
            <div class="flex1">
              <div class="hd">
                <b>{{ m.title }}</b>
                <span v-if="m.priority >= 2" class="tag tag-danger">紧急</span>
                <span class="t-xs num tm">{{ fmtTime(m.createdAt) }}</span>
              </div>
              <p class="ct">{{ m.content }}</p>
            </div>
            <van-icon v-if="m.link && INTERNAL.test(m.link)" name="arrow" class="chev" />
          </button>
        </div>
        <van-empty v-else-if="finished && !error" description="暂无消息" />
      </van-list>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.msgs { min-height: 100vh; }
.pr { min-height: calc(100vh - 60px); }
.all { border: 0; background: transparent; font-size: 13px; color: var(--signal); padding: 0; }
.all:disabled { color: var(--ink-300); }
.list { margin: 12px 14px; border-radius: var(--r-lg); border: 1px solid var(--line); overflow: hidden; background: var(--surface); }
.msg { display: flex; gap: 10px; align-items: flex-start; width: 100%; padding: 13px 14px; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: var(--surface); }
.msg:last-child { border-bottom: 0; }
.msg:active { background: var(--surface-3); }
.d { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex: none; background: transparent; }
.msg.unread .d { background: var(--danger); }
.hd { display: flex; align-items: center; gap: 6px; }
.hd b { font-size: 14px; font-weight: 600; color: var(--ink-700); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg.unread .hd b { color: var(--ink-900); font-weight: 700; }
.tm { margin-left: auto; flex: none; }
.ct { margin-top: 4px; font-size: 12.5px; color: var(--ink-500); line-height: 1.6; word-break: break-all; }
.chev { color: var(--ink-300); margin-top: 4px; flex: none; }
</style>
