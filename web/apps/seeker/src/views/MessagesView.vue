<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, seekerApi, type InboxItem } from '@shitu/api-client'
import { IconBell, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { useInboxStore } from '@/stores/inbox'
import { formatRelative } from '@/utils/time'

/** S-40 消息中心（C-507）：站内信列表、未读圆点、点击已读并跳转站内链接、全部已读 */
const router = useRouter()
const inbox = useInboxStore()

const items = ref<InboxItem[]>([])
const page = ref(0)
const finished = ref(false)
// 第一页自己拉（拉到之前整页是加载图标）；之后的翻页交给 van-list
const loading = ref(true)
const error = ref(false)
const firstLoad = ref(true)
const loadError = ref('')
const refreshing = ref(false)
const expanded = ref<Record<number, boolean>>({})
const PAGE_SIZE = 20

async function loadMore() {
  loading.value = true
  try {
    const r = await seekerApi.messages({ page: page.value + 1, pageSize: PAGE_SIZE })
    page.value = r.page || page.value + 1
    const seen = new Set(items.value.map((x) => x.id))
    items.value.push(...r.records.filter((x) => !seen.has(x.id)))
    finished.value = items.value.length >= r.total || r.records.length < PAGE_SIZE
    error.value = false
  } catch (e) {
    error.value = true
    loadError.value = errorMessage(e, '消息加载失败')
    // 第一页失败整页显示原因；翻页失败列表底部只有一句「点击重试」，原因用轻提示补上
    if (items.value.length) showToast(loadError.value)
  } finally {
    loading.value = false
    firstLoad.value = false
  }
}

void loadMore()

function retry() {
  firstLoad.value = true
  error.value = false
  void loadMore()
}

async function onRefresh() {
  readAllError.value = ''
  items.value = []
  page.value = 0
  finished.value = false
  await loadMore()
  void inbox.refresh()
  refreshing.value = false
}

/** 只跳转站内路径（且能匹配到真实页面） */
function inAppPath(link?: string): string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null
  const r = router.resolve(link)
  return r.matched.length && !r.matched.some((m) => m.path === '/:pathMatch(.*)*') ? r.fullPath : null
}

async function open(m: InboxItem) {
  if (!m.read) {
    m.read = true
    inbox.decrement()
    seekerApi.markRead([m.id]).catch(() => {
      m.read = false
      void inbox.refresh()
    })
  }
  const to = inAppPath(m.link)
  if (to) await router.push(to)
  else expanded.value[m.id] = !expanded.value[m.id]
}

const marking = ref(false)
const readAllError = ref('')
async function readAll() {
  if (marking.value) return
  if (!items.value.some((x) => !x.read) && inbox.unread === 0) {
    showToast('没有未读消息')
    return
  }
  marking.value = true
  readAllError.value = ''
  try {
    await seekerApi.markRead()
    items.value.forEach((x) => (x.read = true))
    inbox.unread = 0
    showToast('已全部标为已读')
  } catch (e) {
    readAllError.value = errorMessage(e, '操作失败，请稍后重试')
    showToast(readAllError.value)
  } finally {
    marking.value = false
  }
}

</script>

<template>
  <div class="msgs">
    <AppBar title="消息中心" fallback="/">
      <template #right>
        <button type="button" class="bar-act all" :disabled="marking" @click="readAll"><van-loading v-if="marking" size="16" />全部已读</button>
      </template>
    </AppBar>

    <div v-if="firstLoad && loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="error && !items.length" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="retry">重新加载</van-button>
    </div>
    <van-pull-refresh v-show="!(firstLoad && loading) && !(error && !items.length)" v-model="refreshing" class="body" @refresh="onRefresh">
      <div class="pad stack">
        <section v-if="readAllError" class="tipbar tipbar--danger" role="alert">
          <IconTriangleExclamationPoint :size="20" />
          <div class="flex1"><div class="tipbar-d first">没有标记成功：{{ readAllError }}</div></div>
        </section>
        <van-list
          v-model:loading="loading"
          v-model:error="error"
          :finished="finished"
          :finished-text="items.length ? '没有更多了' : ''"
          error-text="加载失败，点击重试"
          loading-text="加载中…"
          v-show="items.length"
          class="acard list"
          @load="loadMore"
        >
          <button v-for="m in items" :key="m.id" type="button" class="msg" :class="{ unread: !m.read, hi: m.priority >= 2 }" @click="open(m)">
            <i class="msg-dot" :aria-label="m.read ? undefined : '未读'"></i>
            <div class="flex1">
              <div class="msg-hd">
                <h3>{{ m.title }}</h3>
                <time>{{ formatRelative(m.createdAt) }}</time>
              </div>
              <p class="msg-c" :class="{ open: expanded[m.id] }">{{ m.content }}</p>
            </div>
          </button>
        </van-list>
        <div v-if="!loading && !items.length && !error" class="state-block">
          <IconBell :size="48" :stroke-width="1.5" />
          <div class="state-block-t">暂无消息</div>
        </div>
        <section class="tipbar">
          <IconInfo :size="20" />
          <div class="flex1"><div class="tipbar-d first">系统消息覆盖：面试确认、到厂、入职办理、状态变化等。状态变化都会在这里告诉你。</div></div>
        </section>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.msgs { min-height: 100vh; }
.body { min-height: calc(100vh - 44px); }
.all { display: inline-flex; align-items: center; gap: var(--space-1); --van-loading-spinner-color: var(--primary); }
.all:disabled { color: var(--text-placeholder); }
.list { padding: 0 var(--space-card); }
.list :deep(.van-list__finished-text), .list :deep(.van-list__error-text), .list :deep(.van-list__loading) { font-size: var(--font-size-aux); color: var(--text-3); }
.msg { display: flex; align-items: flex-start; gap: var(--space-2); width: 100%; min-height: 44px; padding: var(--space-3) 0; border: 0; border-bottom: 1px solid var(--divider); background: none; text-align: left; }
/* 圆点占位固定，已读未读的标题左边对齐 */
.msg-dot { flex: none; width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; }
.msg.unread .msg-dot { background: var(--primary); }
.msg-hd { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.msg-hd h3 { min-width: 0; font-size: var(--font-size-section); font-weight: var(--font-weight-regular); line-height: 24px; color: var(--text-1); overflow-wrap: anywhere; }
.msg.unread h3 { font-weight: var(--font-weight-medium); }
.msg.hi h3 { color: var(--danger-text); }
.msg-hd time { flex: none; font-size: var(--font-size-aux); color: var(--text-3); white-space: nowrap; }
.msg-c { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; color: var(--text-2); overflow-wrap: anywhere; }
.msg-c.open { display: block; -webkit-line-clamp: unset; }
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }
</style>
