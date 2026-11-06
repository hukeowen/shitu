<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type MyApplication } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import { telHref } from '@/utils/format'
import { amapLink } from '@/utils/map'
import { formatServerTime, formatShort, untilText } from '@/utils/time'

/** S-24 面试确认信息（C-408）：驻场「知悉」后推送的时间、地点、路线、证件清单 */
const route = useRoute()
const router = useRouter()
const { label } = useDict()
const app = ref<MyApplication | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const all = await seekerApi.myApplications()
    app.value = all.find((a) => a.applicationId === route.params.applicationId) ?? null
    if (!app.value) loadError.value = '报名记录不存在'
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const n = computed(() => app.value?.notice)
const nav = computed(() => (n.value ? amapLink({ address: n.value.address, name: n.value.address }) : null))
const tel = computed(() => telHref(n.value?.contactPhone))
const until = computed(() => untilText(n.value?.interviewAt))
const checked = ref<Record<string, boolean>>({})
</script>

<template>
  <div class="iv">
    <AppBar title="面试确认信息" fallback="/reports" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !app" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round size="small" @click="router.replace('/reports')">返回我的报备</van-button>
      </van-empty>
    </div>
    <div v-else-if="!n" class="page-state">
      <van-empty description="驻场老师还没有推送面试信息，请留意站内消息和短信">
        <van-button round size="small" @click="router.replace('/reports')">返回我的报备</van-button>
      </van-empty>
    </div>

    <div v-else class="pad stack">
      <section class="acard hero-card">
        <div class="row-b" style="margin-bottom: 12px">
          <span class="tag tag-temp">{{ label('ApplicationStatus', app.status) }}</span>
          <span class="mono t-xs" style="color: rgba(255, 255, 255, .5)">{{ app.applicationId }}</span>
        </div>
        <div class="h-t">{{ app.jobTitle }}</div>
        <div class="h-s">{{ [app.projectName, app.companyName].filter(Boolean).join(' · ') }}</div>
        <div class="h-time">
          <div class="h-l">面试时间</div>
          <div class="num h-v">{{ formatServerTime(n.interviewAt) }}</div>
          <div v-if="until" class="h-u">距面试还有 {{ until }}</div>
        </div>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>集合地点与路线</h4></div>
        <dl>
          <div class="kv"><dt>集合地点</dt><dd>{{ n.address }}</dd></div>
          <div v-if="n.routeTips" class="kv"><dt>路线提示</dt><dd>{{ n.routeTips }}</dd></div>
        </dl>
        <a v-if="nav" :href="nav" class="map" target="_blank" rel="noopener">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><circle cx="12" cy="10" r="2.6" fill="currentColor" /></svg>
          <span>点击用高德地图导航到集合点</span>
        </a>
      </section>

      <section v-if="n.documents?.length" class="acard">
        <div class="acard-hd"><h4>证件清单</h4><span class="tag tag-warn">必带</span></div>
        <div class="stack-sm">
          <button v-for="d in n.documents" :key="d" type="button" class="doc" @click="checked[d] = !checked[d]">
            <span class="box" :class="{ on: checked[d] }"><van-icon v-if="checked[d]" name="success" /></span>
            <span class="t-sm">{{ d }}</span>
          </button>
        </div>
        <p class="t-xs" style="margin-top: 8px">勾选仅用于自己清点，不会提交</p>
      </section>

      <section v-if="n.contactName || n.contactPhone" class="acard">
        <div class="acard-hd"><h4>驻场老师</h4></div>
        <div class="row" style="gap: 10px">
          <div class="avatar avatar--o avatar--sm">{{ (n.contactName || '驻').slice(0, 1) }}</div>
          <div class="flex1">
            <b class="c-n">{{ n.contactName || '驻场老师' }}</b>
            <span class="t-xs">{{ formatShort(n.pushedAt) }} 推送 · <span class="num">{{ n.contactPhone }}</span></span>
          </div>
          <a v-if="tel" :href="tel" class="call">电话</a>
        </div>
        <div class="note note--warn" style="margin-top: 10px">如需取消面试，请直接联系驻场老师 —— 你不能自行取消报名。</div>
      </section>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.iv { min-height: 100vh; background: var(--surface-2); }
.hero-card { background: linear-gradient(160deg, #2a1b4a, #0d1117); border: 0; color: #fff; }
.h-t { font-size: 19px; font-weight: 700; }
.h-s { font-size: 12.5px; color: rgba(255, 255, 255, .6); margin-top: 3px; }
.h-time { margin-top: 16px; padding-top: 14px; border-top: 1px dashed rgba(255, 255, 255, .18); }
.h-l { font-size: 11px; color: rgba(255, 255, 255, .5); }
.h-v { font-size: 22px; margin-top: 2px; }
.h-u { font-size: 11.5px; color: var(--signal-300); margin-top: 3px; }
.map { margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; height: 80px; border-radius: var(--r-md); border: 1px solid var(--line); color: var(--signal); font-size: 13px; font-weight: 600; text-decoration: none; background: repeating-linear-gradient(135deg, var(--surface-3) 0 10px, var(--surface-2) 10px 20px); }
.doc { display: flex; align-items: center; gap: 8px; background: none; border: 0; padding: 2px 0; width: 100%; text-align: left; }
.doc .box { width: 16px; height: 16px; border: 1.5px solid var(--ink-300); border-radius: 4px; flex: none; display: grid; place-items: center; font-size: 11px; color: #fff; }
.doc .box.on { background: var(--ok); border-color: var(--ok); }
.c-n { display: block; font-size: 13.5px; color: var(--ink-900); }
.call { flex: none; height: 30px; line-height: 28px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-800); text-decoration: none; }
</style>
