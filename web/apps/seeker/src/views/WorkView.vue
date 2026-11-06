<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { DomainTag } from '@shitu/ui-mobile'
import { errorMessage, seekerApi, useDict, type ApplicationStatus, type MyApplication, type MyWork } from '@shitu/api-client'
import AppBar from '@/components/AppBar.vue'
import InterviewNoticeCard from '@/components/InterviewNoticeCard.vue'
import { useJourney } from '@/composables/useJourney'
import { useAuthStore } from '@/stores/auth'
import { amapLink } from '@/utils/map'
import { STATUS_TAG_CLASS, heroClass } from '@/utils/status'
import { formatServerTime, parseServerTime } from '@/utils/time'

/**
 * S-30 / S-31 我的工作（C-505）：唯一展示所属劳务公司的入口。按状态四种形态：
 *   在岗（S-30）/ 待面试·待确权（形态 A）/ 公域求职·私域待匹配（形态 B）/ 已离职（形态 C，最近一段任职）。
 */
const router = useRouter()
const auth = useAuthStore()
const journey = useJourney()
const { label } = useDict()

const profile = computed(() => auth.profile)
const status = computed(() => profile.value?.status)
const work = ref<MyWork | null>(null)
const app = ref<MyApplication | null>(null)
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

const APPLIED: ApplicationStatus[] = ['PENDING_INTERVIEW', 'PENDING_CONFIRM']

async function load() {
  loadError.value = ''
  try {
    const p = await auth.loadProfile()
    const applied = p.status === 'PENDING_INTERVIEW' || p.status === 'PENDING_CONFIRM'
    const [w, apps] = await Promise.all([
      seekerApi.work(),
      applied ? seekerApi.myApplications() : Promise.resolve([] as MyApplication[]),
      p.status === 'PENDING_CONFIRM' ? journey.loadPending().catch(() => null) : Promise.resolve(null),
      p.domainTag === 'PRIVATE' && !applied ? journey.loadRecs().catch(() => []) : Promise.resolve([]),
    ])
    work.value = w ?? null
    app.value = apps.find((a) => a.status === p.status) ?? apps.find((a) => APPLIED.includes(a.status)) ?? null
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()
async function onRefresh() {
  await load()
  refreshing.value = false
}

/** 当前在岗 = 档案状态在岗且任职未结束 */
const employed = computed(() => status.value === 'EMPLOYED' && !!work.value && !work.value.endDate)
const applied = computed(() => status.value === 'PENDING_INTERVIEW' || status.value === 'PENDING_CONFIRM')
/** 最近一段已结束的任职 */
const past = computed(() => (work.value?.endDate ? work.value : null))

const nav = computed(() => {
  const w = work.value
  const addr = [w?.city, w?.address].filter(Boolean).join(' ')
  return addr ? amapLink({ address: addr, name: w?.projectName || addr }) : null
})
const workAddress = computed(() => [work.value?.city, work.value?.address].filter(Boolean).join(' · '))

/** 已离职：在职天数 = 入职到离职（含首尾） */
function spanDays(w: MyWork): number {
  const a = parseServerTime(w.startDate)
  const b = parseServerTime(w.endDate)
  if (a == null || b == null) return w.dutyDays
  return Math.max(1, Math.round((b - a) / 86400_000) + 1)
}
function dot(s: string | undefined) {
  return formatServerTime(s, false).replace(/-/g, '.')
}

const formBSteps = computed(() => {
  const s = status.value
  const idx = s === 'PRIVATE_PENDING' || s === 'PUBLIC_SEEKING' ? 1 : 0
  return ['注册', s === 'PRIVATE_PENDING' ? label('UserStatus', 'PRIVATE_PENDING') : '待匹配', '报名', '入职'].map((t, i) => ({
    t,
    cls: i < idx ? 'done' : i === idx ? 'now' : '',
  }))
})
</script>

<template>
  <div class="work">
    <AppBar title="我的工作" fallback="/me" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !profile" class="page-state">
      <van-empty image="error" :description="loadError || '加载失败'">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <van-pull-refresh v-else v-model="refreshing" @refresh="onRefresh">
      <!-- S-30 在岗 -->
      <template v-if="employed && work">
        <header class="hero whero" :class="heroClass(profile.domainTag)">
          <div class="hero-state" style="margin-top: 0">
            <span class="tag tag--lg" :class="STATUS_TAG_CLASS[profile.status]"><i class="dot"></i>{{ label('UserStatus', profile.status) }}</span>
            <DomainTag :domain="profile.domainTag" />
          </div>
          <div class="hero-meta">
            <div>所属劳务公司<b>{{ work.companyName || '—' }}</b></div>
            <div>当前项目<b>{{ work.projectName || '—' }}</b></div>
            <div>在岗岗位<b>{{ work.jobTitle || '—' }}</b></div>
            <div>在岗天数<b class="num">第 {{ work.dutyDays }} 天</b></div>
          </div>
        </header>

        <div class="pad stack">
          <section class="acard">
            <div class="acard-hd"><h4>岗位信息</h4></div>
            <dl>
              <div class="kv"><dt>工号</dt><dd class="mono">{{ work.employeeNo || '—' }}</dd></div>
              <div class="kv"><dt>入职日期</dt><dd class="num">{{ formatServerTime(work.startDate, false) }}</dd></div>
              <div class="kv"><dt>在岗天数</dt><dd class="num">{{ work.dutyDays }} 天</dd></div>
              <div class="kv"><dt>在岗岗位</dt><dd>{{ work.jobTitle || '—' }}</dd></div>
              <div class="kv">
                <dt>工作地点</dt>
                <dd>
                  {{ workAddress || '—' }}
                  <a v-if="nav" :href="nav" class="nav-link" target="_blank" rel="noopener">高德地图 ›</a>
                </dd>
              </div>
            </dl>
          </section>

          <section class="acard list">
            <router-link to="/contracts" class="lrow">
              <div class="lt"><b>我的合同</b><span>查看劳动合同与签署记录</span></div>
              <van-icon name="arrow" class="chev" />
            </router-link>
            <router-link to="/reports" class="lrow">
              <div class="lt"><b>我的报备</b><span>报名 / 面试 / 入职记录</span></div>
              <van-icon name="arrow" class="chev" />
            </router-link>
          </section>

          <section class="acard">
            <div class="acard-hd"><h4>考勤汇总</h4><span class="tag">V1.5 打卡</span></div>
            <p class="t-sm" style="line-height: 1.7">考勤打卡、工资条、薪资预支将陆续开放。请假或缺勤由驻场老师登记。</p>
          </section>

          <div class="note note--warn">
            如需离职，请联系驻场老师办理。离职确认后：当前归属清空 → 变为<span class="tag tag-public inl">{{ label('DomainTag', 'PUBLIC') }}</span> → 匹配范围恢复全平台。
          </div>
          <div class="page-bottom-gap"></div>
        </div>
      </template>

      <div v-else class="pad stack">
        <!-- 形态 A · 待面试 / 待确权 -->
        <section v-if="applied" class="acard fa">
          <div class="acard-hd">
            <h4 class="fa-h">{{ status === 'PENDING_CONFIRM' ? '面试已通过 · 等待入职' : '已报名 · 等待面试' }}</h4>
            <span class="tag" :class="STATUS_TAG_CLASS[profile.status]">{{ label('UserStatus', profile.status) }}</span>
          </div>
          <template v-if="app">
            <dl>
              <div class="kv"><dt>应聘岗位</dt><dd>{{ app.jobTitle || '—' }}</dd></div>
              <div class="kv"><dt>应聘公司</dt><dd>{{ app.companyName || profile.boundCompanyName || '—' }}</dd></div>
              <div v-if="app.projectName" class="kv"><dt>项目</dt><dd>{{ app.projectName }}</dd></div>
            </dl>
            <template v-if="status === 'PENDING_INTERVIEW'">
              <div class="divider" style="margin: 10px 0"></div>
              <InterviewNoticeCard v-if="app.notice" :notice="app.notice" />
              <p v-else class="t-sm" style="line-height: 1.7">驻场老师将尽快联系你，并推送面试时间、集合地点和所需证件。</p>
              <van-button block size="small" class="mt10" @click="router.push(app.notice ? `/reports/${app.applicationId}` : '/reports')">
                {{ app.notice ? '查看面试须知' : '查看我的报备' }}
              </van-button>
            </template>
          </template>
          <p v-else class="t-sm">报名信息加载中或已变更，请到「我的报备」查看。</p>

          <template v-if="status === 'PENDING_CONFIRM'">
            <div class="divider" style="margin: 10px 0"></div>
            <template v-if="journey.pending">
              <p class="t-sm" style="line-height: 1.7">劳务公司已发起电子签约，签署劳动合同后即正式入职在岗。</p>
              <van-button type="primary" block class="btn-cta mt10" @click="router.push('/contracts/sign')">去签署劳动合同</van-button>
            </template>
            <p v-else class="t-sm" style="line-height: 1.7">驻场老师正在办理入职确权，完成后会推送电子合同供你签署。</p>
          </template>
        </section>

        <!-- 形态 B · 公域求职 / 私域待匹配 -->
        <section v-else class="acard fb">
          <div class="acard-hd">
            <h4 class="fb-h">{{ profile.status === 'PRIVATE_PENDING' ? '私域待匹配' : '求职中' }}</h4>
            <span class="tag" :class="STATUS_TAG_CLASS[profile.status]">{{ label('UserStatus', profile.status) }}</span>
          </div>
          <div class="steps" style="margin-bottom: 12px">
            <template v-for="(s, i) in formBSteps" :key="s.t">
              <div class="st" :class="s.cls"><i>{{ s.cls === 'done' ? '✓' : i + 1 }}</i>{{ s.t }}</div>
              <div v-if="i < formBSteps.length - 1" class="ln"></div>
            </template>
          </div>
          <p class="t-sm" style="line-height: 1.7">
            你当前尚未入职任何项目。完成 AI 问薪匹配后，可从推荐岗位中选择 1 个报名。
            <template v-if="profile.status === 'PRIVATE_PENDING' && profile.boundCompanyName"><br />归属公司：<b class="strong">{{ profile.boundCompanyName }}</b></template>
          </p>
          <van-button v-if="profile.canStartMatching" type="primary" block class="btn-cta mt10" @click="router.push('/match')">{{ past ? '重新求职 · 去 AI 问薪' : '前往 AI 问薪匹配' }}</van-button>
          <router-link v-if="journey.pendingRecs.length" to="/recommendations" class="rec-link">
            专属顾问为你推荐了 {{ journey.pendingRecs.length }} 个岗位 ›
          </router-link>
        </section>

        <!-- 形态 C · 已离职 -->
        <section v-if="past" class="acard">
          <div class="acard-hd"><h4>历史任职</h4><span class="tag">已离职</span></div>
          <div class="hist">
            <div class="row-b" style="align-items: flex-start">
              <span class="t-sm strong">{{ [past.companyName, past.projectName].filter(Boolean).join(' · ') || '—' }}</span>
              <span class="t-xs num nowrap">{{ dot(past.startDate) }} – {{ dot(past.endDate) }}</span>
            </div>
            <div class="t-xs" style="margin-top: 3px">{{ past.jobTitle || '' }}<template v-if="past.employeeNo"> · 工号 {{ past.employeeNo }}</template></div>
            <div class="g3">
              <div><div class="num gv">{{ spanDays(past) }}</div><div class="t-xs">在职天数</div></div>
              <div><div class="num gv">{{ formatServerTime(past.startDate, false).slice(5) }}</div><div class="t-xs">入职</div></div>
              <div><div class="num gv">{{ formatServerTime(past.endDate, false).slice(5) }}</div><div class="t-xs">离职</div></div>
            </div>
          </div>
          <div v-if="!applied" class="note" style="margin-top: 12px">
            离职后你已转为<span class="tag inl" :class="profile.domainTag === 'PUBLIC' ? 'tag-public' : 'tag-private'">{{ label('DomainTag', profile.domainTag) }}</span>，{{ profile.domainTag === 'PUBLIC' ? '可匹配全平台所有劳务公司岗位。' : '可重新匹配岗位。' }}
          </div>
          <router-link to="/contracts" class="rec-link">查看历史合同 ›</router-link>
        </section>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.work { min-height: 100vh; background: var(--surface-2); }
.whero { padding-top: 16px; padding-bottom: 22px; }
.whero :deep(.tag-domain) { flex: none; }
.list { padding: 0; overflow: hidden; }
.list .lrow { text-decoration: none; color: inherit; }
.nav-link { display: inline-block; margin-left: 6px; font-size: 12px; color: var(--signal); font-weight: 600; text-decoration: none; white-space: nowrap; }
.inl { height: 17px; margin: 0 3px; }
.fa { border-color: var(--temp-line); }
.fa-h { color: var(--temp) !important; }
.fb { border-color: var(--public-line); }
.fb-h { color: var(--public) !important; }
.mt10 { margin-top: 10px; }
.rec-link { display: block; margin-top: 10px; text-align: center; font-size: 12.5px; color: var(--signal); font-weight: 600; text-decoration: none; }
.hist { background: var(--surface-2); border-radius: var(--r-md); padding: 12px; }
.g3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
.gv { font-size: 17px; color: var(--ink-900); }
.nowrap { white-space: nowrap; flex: none; }
</style>
