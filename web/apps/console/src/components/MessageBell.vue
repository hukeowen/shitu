<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage, isApiError, tenantApi, type InboxItem } from '@shitu/api-client'
import { IconBell, IconChevronRight, IconCircleExclamationPoint, IconInbox } from '@shitu/ui-icons'
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
/** 「全部已读」失败的原因留在抽屉里；后端业务拒绝才置灰（重新打开抽屉后再判断），网络失败可以直接重试 */
const readAllError = ref('')
const readAllBlocked = ref(false)

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
  readAllError.value = ''
  readAllBlocked.value = false
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
  readAllError.value = ''
  readAllBlocked.value = false
  try {
    await tenantApi.markRead()
    list.value.forEach((m) => (m.read = true))
    await inbox.refresh()
    ElMessage.success('已全部标为已读')
    if (unreadOnly.value) load()
  } catch (e) {
    readAllError.value = errorMessage(e)
    // 断网、超时也会包成 ApiError（code 为 NETWORK），只有后端真的回了业务错误才置灰
    readAllBlocked.value = isApiError(e) && e.code !== 'NETWORK'
    marking.value = false
    ElMessage.error(readAllError.value)
  } finally {
    marking.value = false
  }
}
</script>

<template>
  <el-badge :value="inbox.unread" :hidden="inbox.unread === 0" :max="99" class="bell-badge">
    <button class="bell" type="button" aria-label="消息" title="消息" @click="open">
      <IconBell :size="18" />
    </button>
  </el-badge>

  <el-drawer v-model="visible" title="消息" size="560px" class="msg-drawer" append-to-body>
    <div class="row bar-top">
      <el-switch v-model="unreadOnly" active-text="只看未读" @change="load()" />
      <span class="spacer" />
      <el-button link type="primary" :loading="marking" :disabled="inbox.unread === 0 || loading || !!error || readAllBlocked" @click="readAll">全部已读</el-button>
    </div>
    <p v-if="readAllError" class="form-err" role="alert">{{ readAllBlocked ? '暂时不能全部标为已读' : '全部已读没有成功，可以再试一次' }}：{{ readAllError }}</p>
    <div v-if="error" class="state">
      <IconCircleExclamationPoint :size="48" class="state-i" />
      <p class="state-t">消息加载失败</p>
      <p class="state-d">{{ error }}</p>
      <el-button type="primary" @click="load()">重新加载</el-button>
    </div>
    <div v-else v-loading="loading && !list.length" class="msgs">
      <div v-for="m in list" :key="m.id" class="msg" :class="{ unread: !m.read }" role="button" tabindex="0" @click="read(m)" @keydown.enter.prevent="read(m)" @keydown.space.prevent="read(m)">
        <div class="msg-hd">
          <i class="dot" aria-hidden="true" />
          <b class="mt">{{ m.title }}</b>
          <span v-if="m.priority >= 2" class="status-tag status-tag--danger">紧急</span>
          <span class="spacer" />
          <span class="time">{{ fmtDateTime(m.createdAt).slice(5) }}</span>
        </div>
        <p class="mc">{{ m.content }}</p>
        <span v-if="routeOf(m.link)" class="go">查看<IconChevronRight :size="14" /></span>
      </div>
      <div v-if="!loading && !list.length" class="state">
        <IconInbox :size="48" class="state-i" />
        <p class="state-t">{{ unreadOnly ? '没有未读消息' : '暂无消息' }}</p>
        <p class="state-d">{{ unreadOnly ? '关掉「只看未读」可以看到全部消息' : '有新的待办和提醒时会出现在这里' }}</p>
      </div>
      <div v-if="list.length < page.total" class="more">
        <el-button link type="primary" :loading="loading" @click="more">加载更多</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.bell-badge { line-height: 1; margin-right: var(--space-3); }  /* 角标向右探出半个宽度，留出位置不压住旁边的按钮 */
.bell { width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--radius-control); border: 1px solid var(--border); background: var(--bg-card); color: var(--text-2); cursor: pointer; }
.bell:hover { color: var(--text-1); background: var(--bg-hover); }
.bell:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.bar-top { margin-bottom: var(--space-3); }
.form-err { margin-bottom: var(--space-3); }
.msgs { min-height: 120px; }
.msg { padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); margin-bottom: var(--space-2); cursor: pointer; background: var(--bg-card); }
.msg:hover { background: var(--bg-hover); }
.msg:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.msg-hd { display: flex; align-items: center; gap: var(--space-2); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: transparent; }
.msg.unread .dot { background: var(--primary); }
.mt { min-width: 0; font-size: var(--font-size-body); font-weight: var(--font-weight-regular); color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg.unread .mt { font-weight: var(--font-weight-medium); }
.time { flex: none; font-size: var(--font-size-min); color: var(--text-3); }
.mc { margin: var(--space-1) 0 0 var(--space-4); font-size: var(--font-size-aux); line-height: 1.6; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.go { display: inline-flex; align-items: center; gap: 2px; margin: var(--space-1) 0 0 var(--space-4); font-size: var(--font-size-aux); color: var(--primary-text); }
.state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) var(--space-4); text-align: center; }
.state-i { color: var(--text-3); }
.state-t { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.state-d { font-size: var(--font-size-aux); color: var(--text-3); }
.more { text-align: center; padding: var(--space-2); }
</style>

<style>
/* 抽屉挂在 body 上，标题样式写在不带 scoped 的块里，只作用于消息抽屉 */
.msg-drawer .el-drawer__title { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
</style>
