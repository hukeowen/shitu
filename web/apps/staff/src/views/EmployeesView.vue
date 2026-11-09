<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, isApiError, tenantApi, useDict, type StaffRow } from '@shitu/api-client'
import AbsencePopup from '@/components/AbsencePopup.vue'
import { fmtPhone } from '@/utils/time'

/** 在岗人员（M-15 入口）：按工号 / 完整手机号搜索，点选员工标记请假 / 旷工 */
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

function back() {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
</script>

<template>
  <div class="emp">
    <van-nav-bar title="在岗人员" left-arrow safe-area-inset-top fixed placeholder z-index="30" @click-left="back" />
    <div class="sticky">
      <van-search v-model="keyword" placeholder="输入工号或完整手机号" shape="round" @search="onSearch" @clear="onClear" />
    </div>
    <van-pull-refresh v-model="refreshing" class="pr" @refresh="onRefresh">
      <div v-if="forbidden" class="state"><van-empty description="你的角色暂无人员管理权限" /></div>
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
        <p v-if="rows.length" class="note">点选员工可按日标记<b>请假 / 旷工</b>，标记的日期不计入有效在岗日。共 {{ total }} 人在岗。</p>
        <div v-for="r in rows" :key="r.employmentId" role="button" tabindex="0" class="acard item" @click="openAbsence(r)" @keyup.enter="openAbsence(r)">
          <div class="row" style="gap: 10px">
            <div class="avatar avatar--o">{{ r.name.slice(0, 1) }}</div>
            <div class="flex1">
              <div class="name">{{ r.name }}<span v-if="r.employeeNo" class="mono no">{{ r.employeeNo }}</span></div>
              <div class="t-xs ellipsis">{{ r.jobTitle ?? '—' }} · {{ r.projectName ?? '—' }}</div>
            </div>
            <span v-if="r.source !== 'OWN'" class="tag tag-public">{{ label('StaffSource', r.source) }}</span>
          </div>
          <div class="meta">
            <div><span>入职</span><b class="num">{{ r.startDate }}</b></div>
            <div><span>在岗</span><b class="num">{{ r.dutyDays }} 天</b></div>
            <div><span>本月缺勤</span><b class="num" :class="{ warn: r.absenceDaysThisMonth > 0 }">{{ r.absenceDaysThisMonth }} 天</b></div>
          </div>
          <div class="ft">
            <a v-if="r.phone" :href="`tel:${r.phone}`" class="tel mono" @click.stop>{{ fmtPhone(r.phone) }}</a>
            <span v-else class="t-xs">—</span>
            <span class="go">请假 / 旷工<van-icon name="arrow" /></span>
          </div>
        </div>
        <van-empty v-if="finished && !rows.length && !error" image="search" :description="applied ? '没有找到匹配的在岗员工' : '暂无在岗员工'" />
      </van-list>
    </van-pull-refresh>
    <AbsencePopup v-model:show="absShow" :row="absRow" @changed="reset" />
  </div>
</template>

<style scoped>
.emp { min-height: 100vh; }
.sticky { position: sticky; top: calc(46px + env(safe-area-inset-top)); z-index: 20; border-bottom: 1px solid var(--line); }
.pr { min-height: calc(100vh - 110px); }
.list { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
.item { width: 100%; text-align: left; display: block; font: inherit; color: inherit; }
.item:active { background: var(--surface-3); }
.name { font-size: 14.5px; font-weight: 700; color: var(--ink-900); }
.no { font-size: 11.5px; font-weight: 500; color: var(--ink-400); margin-left: 6px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; padding: 8px 0; border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line); }
.meta span { display: block; font-size: 11px; color: var(--ink-400); }
.meta b { display: block; font-size: 13px; color: var(--ink-900); margin-top: 2px; }
.meta b.warn { color: var(--warn); }
.ft { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.tel { font-size: 12.5px; color: var(--signal-700); text-decoration: none; }
.go { font-size: 12px; color: var(--ink-500); display: inline-flex; align-items: center; gap: 2px; }
.state { padding-top: 40px; }
</style>
