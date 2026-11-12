<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, seekerApi, useDict, type MyApplication } from '@shitu/api-client'
import { IconCheck, IconCircleExclamationPoint, IconClock, IconExternalLink, IconMapPin, IconPhone, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { telHref } from '@/utils/format'
import { amapLink } from '@/utils/map'
import { APPLICATION_TONE } from '@/utils/status'
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
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

const n = computed(() => app.value?.notice)
const where = computed(() => [app.value?.projectName, app.value?.companyName].filter(Boolean).join(' · '))
const nav = computed(() => (n.value ? amapLink({ address: n.value.address, name: n.value.address }) : null))
const tel = computed(() => telHref(n.value?.contactPhone))
const until = computed(() => untilText(n.value?.interviewAt))
const checked = ref<Record<string, boolean>>({})
</script>

<template>
  <div class="iv">
    <AppBar title="面试确认信息" fallback="/reports" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>
    <div v-else-if="!app" class="state-block">
      <IconCircleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">报名记录不存在</div>
      <van-button type="primary" @click="router.replace('/reports')">返回我的报备</van-button>
    </div>
    <div v-else-if="!n" class="state-block">
      <IconClock :size="48" :stroke-width="1.5" />
      <div class="state-block-t">驻场老师还没有推送面试信息</div>
      <div class="state-block-d">请留意站内消息和短信</div>
      <van-button type="primary" @click="router.replace('/reports')">返回我的报备</van-button>
    </div>

    <div v-else class="pad stack">
      <section class="acard">
        <div class="item-hd">
          <h1>{{ app.jobTitle }}</h1>
          <span class="status-tag" :class="APPLICATION_TONE[app.status]">{{ label('ApplicationStatus', app.status) }}</span>
        </div>
        <p v-if="where" class="item-sub">{{ where }}</p>
        <p class="item-meta">报名单号 <span class="code">{{ app.applicationId }}</span></p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>面试时间</h4></div>
        <p class="when">{{ formatServerTime(n.interviewAt) }}</p>
        <p v-if="until" class="until">距面试还有 {{ until }}</p>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>集合地点</h4></div>
        <p class="addr">{{ n.address }}</p>
        <a v-if="nav" :href="nav" class="map" target="_blank" rel="noopener">
          <IconMapPin :size="20" />用高德地图导航到集合点<IconExternalLink :size="16" />
        </a>
      </section>

      <section v-if="n.routeTips" class="acard">
        <div class="acard-hd"><h4>路线提示</h4></div>
        <p class="para">{{ n.routeTips }}</p>
      </section>

      <section v-if="n.documents?.length" class="acard">
        <div class="acard-hd"><h4>证件清单</h4><span class="status-tag status-tag--warning">必带</span></div>
        <ul class="docs">
          <li v-for="d in n.documents" :key="d">
            <button type="button" role="checkbox" :aria-checked="!!checked[d]" class="doc" @click="checked[d] = !checked[d]">
              <span class="box" :class="{ on: checked[d] }"><IconCheck v-if="checked[d]" :size="14" :stroke-width="2.5" /></span>
              <span class="flex1">{{ d }}</span>
            </button>
          </li>
        </ul>
        <p class="tip">勾选仅用于自己清点，不会提交</p>
      </section>

      <section v-if="n.contactName || n.contactPhone" class="acard">
        <div class="acard-hd"><h4>驻场老师</h4></div>
        <div class="contact">
          <div class="avatar">{{ (n.contactName || '驻').slice(0, 1) }}</div>
          <div class="flex1">
            <b class="c-n">{{ n.contactName || '驻场老师' }}</b>
            <span v-if="n.contactPhone" class="c-m">{{ n.contactPhone }}</span>
            <span class="c-m">{{ formatShort(n.pushedAt) }} 推送</span>
          </div>
          <a v-if="tel" :href="tel" class="call"><IconPhone :size="18" />电话</a>
        </div>
      </section>

      <section class="tipbar tipbar--warn">
        <IconTriangleExclamationPoint :size="20" />
        <div class="flex1">
          <div class="tipbar-t">如需取消面试，请直接联系驻场老师。</div>
          <div class="tipbar-d">你不能自行取消报名。</div>
        </div>
      </section>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.iv { min-height: 100vh; }
.item-hd h1 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.code { font-family: var(--font-mono); color: var(--text-1); }
.when { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.until { margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; font-weight: var(--font-weight-medium); color: var(--primary-text); }
.addr { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); text-wrap: balance; }
.map { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--control-height); margin-top: var(--space-3); padding: 0 var(--space-3); border: 1px solid var(--primary-line); border-radius: var(--radius-control); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); text-decoration: none; }
.map:active { background: var(--primary-bg); }
.docs li + li { border-top: 1px solid var(--divider); }
.doc { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 44px; padding: var(--space-2) 0; border: 0; background: none; font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); text-align: left; }
.box { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid var(--text-3); border-radius: var(--radius-tag); color: var(--text-on-primary); }
.box.on { background: var(--primary); border-color: var(--primary); }
.tip { margin-top: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.contact { display: flex; align-items: center; gap: var(--space-3); }
.c-n { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.c-m { display: block; font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.call { flex: none; display: flex; align-items: center; gap: var(--space-1); min-height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--primary-line); border-radius: var(--radius-control); font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--primary-text); text-decoration: none; }
.call:active { background: var(--primary-bg); }
</style>
