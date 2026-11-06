<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, seekerApi, type InboxItem } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { useInboxStore } from '@/stores/inbox'
import { formatRelative } from '@/utils/time'

/** S-40 消息中心（C-507）：站内信列表、未读红点、点击已读并跳转站内链接、全部已读 */
const router = useRouter()
const inbox = useInboxStore()

const items = ref<InboxItem[]>([])
const page = ref(0)
const finished = ref(false)
const loading = ref(false)
const error = ref(false)
const firstLoad = ref(true)
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
    showToast(errorMessage(e, '消息加载失败'))
  } finally {
    loading.value = false
    firstLoad.value = false
  }
}

async function onRefresh() {
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
async function readAll() {
  if (marking.value) return
  if (!items.value.some((x) => !x.read) && inbox.unread === 0) {
    showToast('没有未读消息')
    return
  }
  marking.value = true
  try {
    await seekerApi.markRead()
    items.value.forEach((x) => (x.read = true))
    inbox.unread = 0
    showToast('已全部标为已读')
  } catch (e) {
    showToast(errorMessage(e, '操作失败，请稍后重试'))
  } finally {
    marking.value = false
  }
}

type Kind = 'interview' | 'release' | 'apply' | 'other'
function kindOf(m: InboxItem): Kind {
  const c = m.templateCode.toUpperCase()
  if (c.includes('INTERVIEW')) return 'interview'
  if (c.includes('RELEASE')) return 'release'
  if (c.includes('APPLICATION') || c.includes('APPLY')) return 'apply'
  return 'other'
}
</script>

<template>
  <div class="msgs">
    <AppBar title="消息中心" fallback="/">
      <template #right><span class="all" :class="{ dis: marking }" @click="readAll">全部已读</span></template>
    </AppBar>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <van-list
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :finished-text="items.length ? '没有更多了' : ''"
        error-text="加载失败，点击重试"
        loading-text="加载中…"
        class="list"
        @load="loadMore"
      >
        <button v-for="m in items" :key="m.id" type="button" class="lrow msg" :class="{ unread: !m.read, hi: m.priority >= 2 }" @click="open(m)">
          <div class="ic" :class="kindOf(m)">
            <svg v-if="kindOf(m) === 'interview'" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.9" /><path d="M3 10h18M8 3v4m8-4v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
            <svg v-else-if="kindOf(m) === 'release'" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9" /><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
            <svg v-else-if="kindOf(m) === 'apply'" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /></svg>
          </div>
          <div class="lt">
            <b>{{ m.title }}</b>
            <span class="ct" :class="{ open: expanded[m.id] }">{{ m.content }}</span>
          </div>
          <div class="side">
            <span class="t-xs">{{ formatRelative(m.createdAt) }}</span>
            <i v-if="!m.read" class="red" aria-label="未读"></i>
          </div>
        </button>
      </van-list>
      <div v-if="!firstLoad && !items.length && !error" class="page-state">
        <van-empty description="暂无消息" />
      </div>
      <div class="pad">
        <div class="note note--info">系统消息覆盖：面试确认、到厂 / 确权、状态释放变更等。状态变化都会在这里告诉你。</div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.msgs { min-height: 100vh; background: var(--surface-2); }
.all { font-size: 12.5px; color: var(--ink-500); padding: 4px 0 4px 8px; }
.all.dis { opacity: .5; }
.list { background: var(--surface); }
.msg { align-items: flex-start; border-left: 0; border-right: 0; border-top: 0; }
.msg.unread { background: var(--signal-50); }
.msg.hi .lt b { color: var(--danger); }
.ic { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--surface-3); color: var(--ink-600); }
.ic.interview { background: var(--temp-bg); color: var(--temp); }
.ic.release { background: var(--public-bg); color: var(--public); }
.ic.apply { background: var(--ok-bg); color: var(--ok); }
.ct { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 2px; line-height: 1.5; }
.ct.open { display: block; -webkit-line-clamp: unset; }
.side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: none; }
.red { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); display: block; }
.page-state { padding-top: 30px; }
</style>
