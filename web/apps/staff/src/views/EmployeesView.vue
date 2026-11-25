<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { errorMessage, isApiError, tenantApi, useDict, type StaffRow } from '@shitu/api-client'
import { IconChevronRight, IconCircleExclamationPoint, IconLock, IconPhone, IconUsers } from '@shitu/ui-icons'
import AbsencePopup from '@/components/AbsencePopup.vue'
import BatchAbsencePopup from '@/components/BatchAbsencePopup.vue'
import { fmtPhone } from '@/utils/time'

/** 在岗人员（M-15 入口）：按工号 / 手机号后四位（驻场）/ 完整手机号搜索，点选员工标记请假 / 旷工 */
const router = useRouter()
const { label } = useDict()
const PAGE_SIZE = 20

const keyword = ref('')
const applied = ref('')
const rows = shallowRef<StaffRow[]>([])
const loading = ref(false)
const finished = ref(false)
const error = ref(false)
const errorText = ref('')
const forbidden = ref(false)
const refreshing = ref(false)
const total = ref(0)
let page = 0
let seq = 0

async function loadMore() {
  const my = seq
  try {
    const r = await tenantApi.employments({ active: true, keyword: applied.value || undefined, page: page + 1, pageSize: PAGE_SIZE })
    if (my !== seq) return
    page += 1
    rows.value = [...rows.value, ...r.records]
    total.value = r.total
    finished.value = rows.value.length >= r.total || r.records.length < PAGE_SIZE
  } catch (e) {
    if (my !== seq) return
    if (isApiError(e) && e.status === 403) {
      forbidden.value = true
      finished.value = true
    } else {
      error.value = true
      errorText.value = errorMessage(e, '加载失败')
    }
  } finally {
    if (my === seq) loading.value = false
  }
}
function reset() {
  seq += 1
  page = 0
  rows.value = []
  total.value = 0
  error.value = false
  forbidden.value = false
  finished.value = false
  loading.value = true
  void loadMore()
}
reset()

function onSearch() {
  applied.value = keyword.value.trim()
  reset()
}
function onClear() {
  keyword.value = ''
  if (applied.value) onSearch()
}
async function onRefresh() {
  reset()
  const stop = watch(loading, (v) => {
    if (!v) {
      refreshing.value = false
      stop()
    }
  })
}

const absShow = ref(false)
const absRow = shallowRef<StaffRow | null>(null)
function openAbsence(r: StaffRow) {
  absRow.value = r
  absShow.value = true
}

// ---------- 批量标记：勾选多个人（换搜索词也不丢已勾的），一次选多天 ----------
const BATCH_MAX = 100
const picking = ref(false)
const picked = shallowRef(new Map<string, StaffRow>())
const pickedRows = computed(() => [...picked.value.values()])
const allLoadedPicked = computed(() => rows.value.length > 0 && rows.value.every((r) => picked.value.has(r.employmentId)))
const batchShow = ref(false)
function togglePicking() {
  picking.value = !picking.value
  picked.value = new Map()
}
function toggle(r: StaffRow) {
  const m = new Map(picked.value)
  if (m.has(r.employmentId)) m.delete(r.employmentId)
  else if (m.size >= BATCH_MAX) return void showToast(`一次最多选 ${BATCH_MAX} 人`)
  else m.set(r.employmentId, r)
  picked.value = m
}
function toggleAll() {
  const m = new Map(picked.value)
  if (allLoadedPicked.value) rows.value.forEach((r) => m.delete(r.employmentId))
  else {
    for (const r of rows.value) {
      if (m.size >= BATCH_MAX) {
        showToast(`一次最多选 ${BATCH_MAX} 人`)
        break
      }
      m.set(r.employmentId, r)
    }
  }
  picked.value = m
}
function onCard(r: StaffRow) {
  if (picking.value) toggle(r)
  else openAbsence(r)
}
function onBatchDone() {
  picking.value = false
  picked.value = new Map()
  reset()
}

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="emp">
    <van-nav-bar title="在岗人员" left-arrow safe-area-inset-top fixed placeholder z-index="30" :right-text="forbidden ? '' : picking ? '取消' : '批量标记'" @click-left="back" @click-right="togglePicking" />
    <div class="sticky">
      <van-search v-model="keyword" :placeholder="rows.length && !rows.some((r) => r.phone) ? '输入工号' : '工号 / 手机号后四位 / 完整手机号'" shape="round" @search="onSearch" @clear="onClear" />
    </div>
    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="forbidden" class="state-block">
        <IconLock :size="48" />
        <p class="state-block-t">暂无人员管理权限</p>
        <p class="state-block-d">你的角色暂无人员管理权限</p>
      </div>
      <div v-else-if="error && !rows.length" class="state-block">
        <IconCircleExclamationPoint :size="48" />
        <p class="state-block-t">{{ errorText || '加载失败' }}</p>
        <p class="state-block-d">请检查网络后重新加载</p>
        <van-button type="primary" @click="reset">重新加载</van-button>
      </div>
      <div v-else-if="loading && !rows.length" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
      <van-list
        v-else
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :immediate-check="false"
        :error-text="`${errorText || '加载失败'}，点击重试`"
        :finished-text="rows.length ? '没有更多了' : ''"
        class="pad stack list"
        @load="loadMore"
      >
        <div v-if="rows.length && picking" class="note pick-note">
          <span>勾选要标记的人，可以搜索后继续勾选。</span>
          <button type="button" class="all" @click="toggleAll">{{ allLoadedPicked ? '取消全选' : `全选这 ${rows.length} 人` }}</button>
        </div>
        <p v-else-if="rows.length" class="note">点选员工可按日标记<b>请假 / 旷工</b>，标记的日期不计入有效在岗日。多人一起标，点右上角「批量标记」。共 {{ total }} 人在岗。</p>
        <article
          v-for="r in rows"
          :key="r.employmentId"
          role="button"
          tabindex="0"
          class="acard item"
          :class="{ 'item--on': picking && picked.has(r.employmentId) }"
          :aria-pressed="picking ? picked.has(r.employmentId) : undefined"
          @click="onCard(r)"
          @keydown.enter="onCard(r)"
          @keydown.space.prevent="onCard(r)"
        >
          <div class="item-hd">
            <van-checkbox v-if="picking" :model-value="picked.has(r.employmentId)" shape="square" class="ck" aria-hidden="true" tabindex="-1" />
            <h3>{{ r.name }}<span v-if="r.employeeNo" class="no">{{ r.employeeNo }}</span></h3>
            <span v-if="r.source !== 'OWN'" class="status-tag status-tag--public">{{ label('StaffSource', r.source) }}</span>
          </div>
          <p class="item-sub">{{ r.jobTitle ?? '—' }} · {{ r.projectName ?? '—' }}</p>
          <dl class="meta">
            <div><dt>入职</dt><dd>{{ r.startDate }}</dd></div>
            <div><dt>在岗</dt><dd>{{ r.dutyDays }} 天</dd></div>
            <div><dt>本月缺勤</dt><dd :class="{ warn: r.absenceDaysThisMonth > 0 }">{{ r.absenceDaysThisMonth }} 天</dd></div>
          </dl>
          <div v-if="!picking" class="ft">
            <a v-if="r.phone" :href="`tel:${r.phone}`" class="tel" @click.stop @keydown.stop><IconPhone :size="16" />{{ fmtPhone(r.phone) }}</a>
            <span v-else class="tel-none">手机号仅驻场可见</span>
            <span class="go">请假 / 旷工<IconChevronRight :size="16" /></span>
          </div>
        </article>
        <div v-if="finished && !rows.length && !error" class="state-block">
          <IconUsers :size="48" />
          <p class="state-block-t">{{ applied ? '没有找到匹配的在岗员工' : '暂无在岗员工' }}</p>
          <p class="state-block-d">{{ applied ? '工号或手机号要输完整，可清空后查看全部' : '下拉可刷新' }}</p>
        </div>
      </van-list>
    </van-pull-refresh>
    <div v-if="picking" class="bbar">
      <span class="bbar-n">已选 <b>{{ picked.size }}</b> 人</span>
      <van-button type="primary" size="large" :disabled="!picked.size" class="bbar-go" @click="batchShow = true">选日期并标记</van-button>
    </div>
    <AbsencePopup v-model:show="absShow" :row="absRow" @changed="reset" />
    <BatchAbsencePopup v-model:show="batchShow" :rows="pickedRows" @done="onBatchDone" />
  </div>
</template>

<style scoped>
.emp { min-height: 100vh; }
.sticky { position: sticky; top: calc(44px + env(safe-area-inset-top)); z-index: 20; border-bottom: 1px solid var(--divider); }
.pr { min-height: calc(100vh - 110px); }
.list { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
.emp:has(.bbar) .list { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
.pick-note { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.all { flex: none; min-height: 44px; padding: 0 var(--space-2); border: 0; background: none; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); }
.item--on { outline: 2px solid var(--primary); outline-offset: -2px; }
.emp:has(.bbar) .meta { padding-bottom: 0; border-bottom: 0; }
.item-hd .ck { flex: none; margin-right: var(--space-2); pointer-events: none; }
.item-hd:has(.ck) h3 { flex: 1; min-width: 0; }
.bbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 25; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom)); background: var(--bg-card); border-top: 1px solid var(--divider); }
.bbar-n { flex: none; font-size: var(--font-size-body); color: var(--text-2); }
.bbar-n b { font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.bbar-go { flex: 1; }
.item { display: block; width: 100%; text-align: left; color: inherit; cursor: pointer; }
.item:active { background: var(--bg-hover); }
.item:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.no { margin-left: var(--space-2); font-family: var(--font-mono); font-size: var(--font-size-aux); font-weight: var(--font-weight-regular); color: var(--text-3); }
.meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-3); padding: var(--space-3) 0; border-top: 1px solid var(--divider); border-bottom: 1px solid var(--divider); }
.meta dt { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.meta dd { margin-top: 2px; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.meta dd.warn { color: var(--warning-text); }
.ft { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-1); }
.tel { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 44px; font-size: var(--font-size-body); color: var(--primary-text); text-decoration: none; }
.tel-none { font-size: var(--font-size-aux); color: var(--text-3); }
.go { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); }
</style>
