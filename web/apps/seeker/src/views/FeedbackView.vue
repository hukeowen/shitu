<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type FeedbackCategory, type FeedbackStatus, type MyFeedback } from '@shitu/api-client'
import { IconCheck, IconInbox, IconInfo, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { formatServerTime } from '@/utils/time'

/**
 * S-39 问题反馈（C-508）：选择问题类型 + 文字描述（可留回访电话）→ 平台工单；下方是我的反馈与平台回复。
 * 工资条的问题走工资条页的「工资申诉」（发给发薪公司），这里是发给平台的。
 */
const { label, options } = useDict()
const FALLBACK: { value: FeedbackCategory; label: string }[] = [
  { value: 'ACCOUNT', label: '账号与登录' },
  { value: 'JOB', label: '岗位与报名' },
  { value: 'PAY', label: '工资与预支' },
  { value: 'CONTRACT', label: '合同与入职' },
  { value: 'SUGGEST', label: '意见建议' },
  { value: 'OTHER', label: '其他' },
]
const cats = computed(() => {
  const d = options('FeedbackCategory') as { value: FeedbackCategory; label: string }[]
  return d.length ? d : FALLBACK
})

const MAX = 1000
const category = ref<FeedbackCategory | ''>('')
const content = ref('')
const contact = ref('')
const submitting = ref(false)
const errs = ref({ category: '', content: '', contact: '' })
const rejected = ref('')

const rows = ref<MyFeedback[]>([])
const loading = ref(true)
const loadError = ref('')
const refreshing = ref(false)

async function load() {
  loadError.value = ''
  try {
    rows.value = await seekerApi.myFeedback()
  } catch (e) {
    loadError.value = errorMessage(e, '反馈记录加载失败')
  } finally {
    loading.value = false
  }
}
void load()
function retry() {
  loading.value = true
  void load()
}
async function onRefresh() {
  await load()
  refreshing.value = false
}

const fmtContact = (v: string) => v.replace(/\D/g, '').slice(0, 11)

function pick(c: FeedbackCategory) {
  category.value = c
  errs.value.category = ''
}

/** 校验没通过：轻提示之外原因留在字段下方，并滚到那个字段 */
function invalid(field: 'category' | 'content' | 'contact', msg: string) {
  errs.value[field] = msg
  showToast(msg)
  void nextTick(() => document.querySelector(`[data-field="${field}"]`)?.scrollIntoView({ block: 'center' }))
}

async function submit() {
  if (submitting.value) return
  errs.value = { category: '', content: '', contact: '' }
  rejected.value = ''
  if (!category.value) return invalid('category', '请选择问题类型')
  const text = content.value.trim()
  if (text.length < 5) return invalid('content', '请至少用 5 个字描述问题')
  if (contact.value && !/^1[3-9]\d{9}$/.test(contact.value)) return invalid('contact', '回访电话格式不正确')
  submitting.value = true
  try {
    await seekerApi.submitFeedback({ category: category.value, content: text, contact: contact.value || undefined })
    showToast({ type: 'success', message: '已提交，平台会尽快处理' })
    category.value = ''
    content.value = ''
    contact.value = ''
    await load()
  } catch (e) {
    rejected.value = errorMessage(e, '提交失败，请稍后重试')
    showToast(rejected.value)
  } finally {
    submitting.value = false
  }
}

/** 和平台端同一套色调：待处理 = 提醒，已回复 = 成功，已关闭 = 中性 */
const TONE: Record<FeedbackStatus, string> = { OPEN: 'status-tag--warning', REPLIED: 'status-tag--success', CLOSED: 'status-tag--neutral' }
</script>

<template>
  <div class="fb">
    <van-nav-bar title="问题反馈" fixed placeholder safe-area-inset-top z-index="50" />

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="pad stack">
        <section class="acard">
          <p class="para">遇到问题、想投诉或有建议，都可以在这里告诉平台</p>

          <div id="fb-cat" class="lbl" data-field="category">问题类型</div>
          <div class="opts" role="group" aria-labelledby="fb-cat">
            <button v-for="c in cats" :key="c.value" type="button" class="chip-tap" :aria-pressed="category === c.value" @click="pick(c.value)">
              <span class="chip opt"><IconCheck v-if="category === c.value" :size="14" :stroke-width="2.25" />{{ c.label }}</span>
            </button>
          </div>
          <p v-if="errs.category" class="fhint fhint--err" role="alert">{{ errs.category }}</p>

          <van-cell-group :border="false" class="grp">
            <van-field
              v-model="content"
              class="ffield"
              :class="{ bad: errs.content }"
              type="textarea"
              label="问题描述"
              label-align="top"
              rows="5"
              :maxlength="MAX"
              show-word-limit
              placeholder="请写清楚发生了什么、涉及哪家公司或哪个岗位、你希望怎么解决"
              data-field="content"
              :error-message="errs.content"
              :border="false"
              @update:model-value="errs.content = ''"
            />
            <van-field
              v-model="contact"
              class="ffield"
              :class="{ bad: errs.contact }"
              type="tel"
              label="回访电话（选填）"
              label-align="top"
              placeholder="11 位手机号"
              :formatter="fmtContact"
              data-field="contact"
              :error-message="errs.contact"
              :border="false"
              @update:model-value="errs.contact = ''"
            />
            <p class="fhint">不填则用注册手机号联系你</p>
          </van-cell-group>
        </section>

        <section class="tipbar">
          <IconInfo :size="20" />
          <div class="flex1"><div class="tipbar-d first">工资条金额有疑问，请到「我的工资」对应月份里提交工资申诉，会直接发给发薪公司处理。</div></div>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>我的反馈</h4><span v-if="rows.length" class="cnt">{{ rows.length }} 条</span></div>
          <div v-if="loading" class="page-state in-card"><van-loading size="28" vertical>加载中…</van-loading></div>
          <div v-else-if="loadError" class="state-block state-block--sm">
            <IconTriangleExclamationPoint :size="32" :stroke-width="1.5" />
            <div class="state-block-t">{{ loadError }}</div>
            <van-button @click="retry">重新加载</van-button>
          </div>
          <div v-else-if="!rows.length" class="state-block state-block--sm">
            <IconInbox :size="32" :stroke-width="1.5" />
            <div class="state-block-t">还没有提交过反馈</div>
          </div>
          <template v-else>
            <div v-for="r in rows" :key="r.id" class="fb-item">
              <div class="item-hd">
                <h3>{{ label('FeedbackCategory', r.category) }}</h3>
                <span class="status-tag" :class="TONE[r.status]">{{ label('FeedbackStatus', r.status) }}</span>
              </div>
              <p class="item-meta">{{ formatServerTime(r.createdAt) }}</p>
              <p class="fb-q">{{ r.content }}</p>
              <div v-if="r.reply" class="fb-r">
                <b>平台回复</b>
                <p>{{ r.reply }}</p>
                <span>{{ formatServerTime(r.handledAt) }}</span>
              </div>
            </div>
          </template>
        </section>
        <div class="bottom-bar-gap" :class="{ 'with-why': rejected }"></div>
      </div>
    </van-pull-refresh>

    <!-- 这一页带底部标签栏，通栏按钮贴在标签栏上方；放在下拉刷新外面 -->
    <div class="bottom-bar above-tabbar">
      <p v-if="rejected" class="bar-why err" role="alert"><IconTriangleExclamationPoint :size="16" />没有提交成功：{{ rejected }}</p>
      <van-button type="primary" size="large" block :loading="submitting" loading-text="提交中…" @click="submit">提交反馈</van-button>
    </div>
  </div>
</template>

<style scoped>
.fb { min-height: 100vh; }
/* 标签栏自己留了手势条的位置，这里只垫到它上方 */
.above-tabbar { bottom: calc(var(--van-tabbar-height) + env(safe-area-inset-bottom)); padding-bottom: var(--space-2); }
.bottom-bar-gap { height: 80px; }
.bottom-bar-gap.with-why { height: 128px; }
.lbl { margin-top: var(--space-4); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); line-height: 20px; color: var(--text-2); }
.opts { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); }
/* 可选的小块：外层 44 高的点击区，选中除了变色还带勾 */
.opt { padding: var(--space-1) var(--space-3); border: 1px solid var(--border); background: var(--bg-card); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.chip-tap[aria-pressed="true"] .opt { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.chip-tap:focus-visible .opt { outline: 2px solid var(--primary); outline-offset: 2px; }
.grp { margin-top: var(--space-3); }
.tipbar-d.first { margin-top: 0; text-wrap: pretty; }
.cnt { font-size: var(--font-size-aux); color: var(--text-3); }
.in-card { padding: var(--space-4) 0 var(--space-2); }
.fb-item { padding: var(--space-3) 0; border-top: 1px solid var(--divider); }
.acard-hd + .fb-item { border-top: 0; padding-top: 0; }
.fb-item:last-of-type { padding-bottom: 0; }
.fb-q { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--bg-fill); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.fb-r { margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--success-soft); }
.fb-r b { font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); color: var(--success-text); }
.fb-r p { margin-top: 2px; font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.fb-r span { display: block; margin-top: 2px; font-size: var(--font-size-aux); color: var(--text-3); }
</style>
