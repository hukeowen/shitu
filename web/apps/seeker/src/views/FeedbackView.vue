<script setup lang="ts">
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type FeedbackCategory, type FeedbackStatus, type MyFeedback } from '@shitu/api-client'
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
async function onRefresh() {
  await load()
  refreshing.value = false
}

function onContact(e: Event) {
  contact.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11)
}

async function submit() {
  if (submitting.value) return
  if (!category.value) return void showToast('请选择问题类型')
  const text = content.value.trim()
  if (text.length < 5) return void showToast('请至少用 5 个字描述问题')
  if (contact.value && !/^1[3-9]\d{9}$/.test(contact.value)) return void showToast('回访电话格式不正确')
  submitting.value = true
  try {
    await seekerApi.submitFeedback({ category: category.value, content: text, contact: contact.value || undefined })
    showToast({ type: 'success', message: '已提交，平台会尽快处理' })
    category.value = ''
    content.value = ''
    contact.value = ''
    await load()
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}

const TAG: Record<FeedbackStatus, string> = { OPEN: 'tag-warn', REPLIED: 'tag-ok', CLOSED: 'tag-muted' }
</script>

<template>
  <div class="fb">
    <header class="hd">
      <h1>问题反馈</h1>
      <p>遇到问题、想投诉或有建议，都可以在这里告诉平台</p>
    </header>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="pad stack">
        <section class="acard">
          <div class="lbl">问题类型</div>
          <div class="chips">
            <button v-for="c in cats" :key="c.value" type="button" class="chip" :class="{ on: category === c.value }" @click="category = c.value">{{ c.label }}</button>
          </div>

          <div class="lbl" style="margin-top: 16px">问题描述</div>
          <textarea v-model="content" class="ta" rows="5" :maxlength="MAX" placeholder="请写清楚发生了什么、涉及哪家公司或哪个岗位、你希望怎么解决"></textarea>
          <div class="cnt t-xs">{{ content.length }} / {{ MAX }}</div>

          <div class="lbl">回访电话（选填）</div>
          <input class="inp" type="tel" inputmode="numeric" :value="contact" placeholder="不填则用注册手机号联系你" @input="onContact" />

          <van-button block type="primary" class="submit" :loading="submitting" loading-text="提交中…" @click="submit">提交反馈</van-button>
          <p class="t-xs tip">工资条金额有疑问，请到「我的工资」对应月份里提交工资申诉，会直接发给发薪公司处理。</p>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>我的反馈</h4><span v-if="rows.length" class="t-xs">{{ rows.length }} 条</span></div>
          <div v-if="loading" class="state"><van-loading size="22" /></div>
          <div v-else-if="loadError" class="state t-sm">{{ loadError }} <a class="lnk" @click="load">重试</a></div>
          <div v-else-if="!rows.length" class="state t-sm">还没有提交过反馈</div>
          <ul v-else class="list">
            <li v-for="r in rows" :key="r.id">
              <div class="row-b">
                <b class="t14">{{ label('FeedbackCategory', r.category) }}</b>
                <span class="tag" :class="TAG[r.status]"><i class="dot"></i>{{ label('FeedbackStatus', r.status) }}</span>
              </div>
              <div class="t-xs num" style="margin-top: 3px">{{ formatServerTime(r.createdAt) }}</div>
              <div class="quote">{{ r.content }}</div>
              <div v-if="r.reply" class="reply">
                <b>平台回复</b>
                <p>{{ r.reply }}</p>
                <span class="t-xs num">{{ formatServerTime(r.handledAt) }}</span>
              </div>
            </li>
          </ul>
        </section>
        <div class="page-bottom-gap"></div>
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.fb { min-height: 100vh; background: var(--surface-2); }
.hd { padding: calc(18px + env(safe-area-inset-top)) 18px 20px; color: #fff; background: linear-gradient(160deg, #1E2834 0%, #10151C 100%); }
.hd h1 { margin: 0; font-family: var(--f-dis); font-size: 20px; font-weight: 700; }
.hd p { margin: 6px 0 0; font-size: 13px; color: rgba(255, 255, 255, .62); line-height: 1.6; }
.lbl { font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); font-size: 13px; color: var(--ink-700); }
.chip.on { border-color: var(--signal); background: var(--signal-50); color: var(--signal-700); font-weight: 600; }
.ta, .inp { width: 100%; box-sizing: border-box; border: 1.5px solid transparent; border-radius: 12px; background: var(--surface-2); padding: 11px 12px; font-size: 14px; line-height: 1.7; color: var(--ink-900); outline: none; font-family: inherit; transition: border-color .15s, background .15s; }
.ta { resize: none; }
.inp { height: 46px; }
.ta:focus, .inp:focus { background: var(--surface); border-color: var(--signal); }
.cnt { text-align: right; margin: 4px 0 10px; color: var(--ink-400); }
.submit { margin-top: 16px; height: 48px; border-radius: 14px; font-size: 16px; font-weight: 700; }
.tip { margin-top: 10px; line-height: 1.7; color: var(--ink-500); }
.state { padding: 18px 0; text-align: center; color: var(--ink-500); }
.lnk { color: var(--signal-700); }
.list { list-style: none; margin: 0; padding: 0; }
.list li { padding: 12px 0; border-top: 1px solid var(--line); }
.list li:first-child { border-top: 0; padding-top: 4px; }
.t14 { font-size: 14px; }
.quote { margin-top: 8px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.7; color: var(--ink-700); white-space: pre-wrap; word-break: break-word; }
.reply { margin-top: 8px; padding: 9px 11px; border-radius: var(--r-sm); background: var(--ok-bg, #EEF8F2); border-left: 3px solid var(--ok); }
.reply b { font-size: 12.5px; color: var(--ok); }
.reply p { margin: 3px 0 4px; font-size: 13px; line-height: 1.7; color: var(--ink-800); white-space: pre-wrap; word-break: break-word; }
</style>
