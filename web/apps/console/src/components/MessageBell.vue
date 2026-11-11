<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, tenantApi, type InboxItem } from '@shitu/api-client'
import { canAccess } from '@/router/access'
import { MENU } from '@/router/menu'
import { useInboxStore } from '@/stores/inbox'
import { useMeStore } from '@/stores/me'
import { fmtDateTime } from '@/utils/format'

/** 顶栏消息铃铛：未读数 + 站内信抽屉（点击标记已读并跳转） */
const router = useRouter()
const inbox = useInboxStore()
const meStore = useMeStore()

const visible = ref(false)
const unreadOnly = ref(false)
const list = ref<InboxItem[]>([])
const page = reactive({ page: 1, pageSize: 20, total: 0 })
const loading = ref(false)
const error = ref('')
const marking = ref(false)

onMounted(() => inbox.start())
onBeforeUnmount(() => inbox.stop())

async function load(reset = true) {
  if (reset) page.page = 1
  loading.value = true
  error.value = ''
  try {
    const r = await tenantApi.messages({ unreadOnly: unreadOnly.value || undefined, page: page.page, pageSize: page.pageSize })
    list.value = reset ? r.records : [...list.value, ...r.records]
    page.total = r.total
  } catch (e) {
    error.value = errorMessage(e, '消息加载失败')
  } finally {
    loading.value = false
  }
}
function open() {
  visible.value = true
  load()
  inbox.refresh()
}
function more() {
  page.page += 1
  load(false)
}

/** 后端链接按驻场手机端 / 后台混用，这里映射到后台路由；无权限或无对应页面则不跳转 */
function routeOf(link?: string): string | null {
  if (!link) return null
  let p = link
  if (p.startsWith('/applications') || p === '/todo') p = '/site/todo'
  else if (p.startsWith('/advance')) p = '/pm/advance'
  else if (p === '/reminders') p = '/site/follow'
  else if (p === '/incidents') p = '/pm/incidents'
  const item = MENU.flatMap((g) => g.items).find((it) => it.path === p)
  return item && canAccess(meStore.me, item.access) ? p : null
}

async function read(m: InboxItem) {
  if (!m.read) {
    try {
      await tenantApi.markRead([m.id])
      m.read = true
      inbox.refresh()
    } catch {
      /* 标记失败不影响跳转 */
    }
  }
  const to = routeOf(m.link)
  if (to) {
    visible.value = false
    router.push(to)
  }
}
async function readAll() {
  marking.value = true
  try {
    await tenantApi.markRead()
    list.value.forEach((m) => (m.read = true))
    await inbox.refresh()
    ElMessage.success('已全部标为已读')
    if (unreadOnly.value) load()
  } catch (e) {
    ElMessage.error(errorMessage(e))
  } finally {
    marking.value = false
  }
}
</script>

<template>
  <el-badge :value="inbox.unread" :hidden="inbox.unread === 0" :max="99" class="bell-badge">
    <button class="bell" type="button" title="消息" @click="open">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" />
        <path d="M10 20.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
      </svg>
    </button>
  </el-badge>

  <el-drawer v-model="visible" title="消息" size="420px" append-to-body>
    <div class="row" style="margin-bottom: 10px">
      <el-switch v-model="unreadOnly" active-text="只看未读" @change="load()" />
      <span class="spacer" />
      <el-button size="small" :loading="marking" :disabled="inbox.unread === 0" @click="readAll">全部已读</el-button>
    </div>
    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
    <div v-loading="loading && !list.length" class="msgs">
      <div v-for="m in list" :key="m.id" class="msg" :class="{ unread: !m.read, hi: m.priority >= 2 }" @click="read(m)">
        <div class="row" style="gap: 6px">
          <i v-if="!m.read" class="dot" />
          <b class="mt">{{ m.title }}</b>
          <span class="spacer" />
          <span class="mono t-xs">{{ fmtDateTime(m.createdAt).slice(5) }}</span>
        </div>
        <p class="t-sm mc">{{ m.content }}</p>
        <span v-if="routeOf(m.link)" class="t-xs go">查看 →</span>
      </div>
      <el-empty v-if="!loading && !list.length && !error" :image-size="70" :description="unreadOnly ? '没有未读消息' : '暂无消息'" />
      <div v-if="list.length < page.total" style="text-align: center; padding: 8px">
        <el-button size="small" link type="primary" :loading="loading" @click="more">加载更多</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.bell-badge { line-height: 1; }
.bell { width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--surface); color: var(--ink-600); cursor: pointer; }
.bell:hover { color: var(--ink-900); border-color: var(--line-2); }
.msgs { min-height: 120px; }
.msg { padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-md); margin-bottom: 8px; cursor: pointer; transition: .14s; }
.msg:hover { border-color: var(--line-2); background: var(--surface-2); }
.msg.unread { border-color: var(--signal-300); }
.msg.hi { border-left: 3px solid var(--danger); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--signal); flex: none; }
.mt { font-size: 13px; color: var(--ink-900); }
.mc { margin-top: 4px; line-height: 1.6; color: var(--ink-700); }
.go { color: var(--signal-700); }
</style>
