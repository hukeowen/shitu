<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { errorMessage, tenantApi, useDict, type LaborContractView, type SiteApplication } from '@shitu/api-client'
import QrImage from '@/components/QrImage.vue'
import { CONTRACT_TAG } from '@/utils/actions'
import { copyText } from '@/utils/clipboard'
import { addDays, fmtDay, fmtFull, fmtPhone, parseLocal, startOfDay, ymd } from '@/utils/time'

/**
 * M-06 入职确权（唯一统计节点）+ M-07 线上电子签约。
 * CONFIRM：填入职日期（近 3 天到未来 30 天）/ 工号 / 合同截止 → 生成电子合同，展示签署链接与签署码；
 * RESEND_CONTRACT：先展示当前待签署的签署码，需要时作废旧流程重发。
 */
const props = defineProps<{ application: SiteApplication | null; resend: boolean }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ done: [] }>()
const { label } = useDict()

type Mode = 'current' | 'form' | 'result'
const mode = ref<Mode>('form')
const form = reactive({ startDate: startOfDay(), employeeNo: '', termEnd: null as Date | null })
const result = ref<LaborContractView | null>(null)
const submitting = ref(false)

function defaultTermEnd(start: Date): Date {
  return addDays(new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()), -1)
}

watch(show, (v) => {
  if (!v) return
  const today = startOfDay()
  form.startDate = today
  form.employeeNo = ''
  form.termEnd = defaultTermEnd(today)
  result.value = null
  mode.value = props.resend && props.application?.contract ? 'current' : 'form'
})

const current = computed(() => props.application?.contract ?? null)
const title = computed(() => {
  if (mode.value === 'result') return '电子签约'
  if (mode.value === 'current') return '签署码'
  return props.resend ? '重发电子签约' : '入职确权'
})

// ---------- 日期选择 ----------
type PickKey = 'startDate' | 'termEnd'
const picker = reactive({ show: false, key: 'startDate' as PickKey, vals: [] as string[] })
const p2 = (n: number) => String(n).padStart(2, '0')
const minStart = computed(() => addDays(startOfDay(), -3))
const maxStart = computed(() => addDays(startOfDay(), 30))
const minEnd = computed(() => addDays(form.startDate, 1))
const maxEnd = computed(() => new Date(form.startDate.getFullYear() + 10, 11, 31))
const pickMin = computed(() => (picker.key === 'startDate' ? minStart.value : minEnd.value))
const pickMax = computed(() => (picker.key === 'startDate' ? maxStart.value : maxEnd.value))

function openPicker(key: PickKey) {
  const d = (key === 'startDate' ? form.startDate : form.termEnd) ?? defaultTermEnd(form.startDate)
  picker.key = key
  picker.vals = [String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate())]
  picker.show = true
}
function onPick() {
  const [y, m, d] = picker.vals.map(Number)
  const picked = new Date(y, m - 1, d)
  if (picker.key === 'startDate') {
    const shift = form.termEnd && ymd(form.termEnd) === ymd(defaultTermEnd(form.startDate))
    form.startDate = picked
    // 截止日还是默认值时跟着入职日期走；手动改过的若早于入职日则重置
    if (shift || (form.termEnd && form.termEnd.getTime() <= picked.getTime())) form.termEnd = defaultTermEnd(picked)
  } else {
    form.termEnd = picked
  }
  picker.show = false
}

// ---------- 提交 ----------
async function submit() {
  const app = props.application
  if (!app || submitting.value) return
  const s = form.startDate.getTime()
  if (s < minStart.value.getTime() || s > maxStart.value.getTime()) return void showToast('入职日期可选近 3 天到未来 30 天')
  if (form.termEnd && form.termEnd.getTime() <= s) return void showToast('合同截止日需晚于入职日期')
  if (props.resend) {
    try {
      await showConfirmDialog({
        title: '重发签约',
        message: '重发会作废尚未签署的旧签约流程，并生成新的签署链接（旧链接失效）。确定重发？',
        confirmButtonText: '重发',
      })
    } catch {
      return
    }
  }
  submitting.value = true
  try {
    result.value = await tenantApi.confirmOnboard(app.applicationId, {
      startDate: ymd(form.startDate),
      employeeNo: form.employeeNo.trim() || undefined,
      termEnd: form.termEnd ? ymd(form.termEnd) : undefined,
    })
    mode.value = 'result'
    showSuccessToast(props.resend ? '已重新发起电子签约' : '确权完成，已发起电子签约')
    emit('done')
  } catch (e) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}

async function copy(url?: string) {
  if (!url) return
  showToast((await copyText(url)) ? '签署链接已复制，可粘贴发送给求职者' : '复制失败，请长按链接手动复制')
}

const full = (v?: string) => {
  const d = parseLocal(v)
  return d ? fmtFull(d) : '—'
}
</script>

<template>
  <van-popup v-model:show="show" position="right" :style="{ width: '100%', height: '100%' }" :close-on-popstate="true" teleport="body">
    <div class="cf">
      <van-nav-bar :title="title" left-arrow safe-area-inset-top @click-left="show = false" />
      <div v-if="application" class="body">
        <div class="steps">
          <span class="st done"><i>✓</i>到厂确认</span><span class="ln" />
          <span class="st" :class="mode === 'result' || mode === 'current' ? 'done' : 'now'"><i>{{ mode === 'form' ? 2 : '✓' }}</i>入职确权</span><span class="ln" />
          <span class="st" :class="mode === 'form' ? '' : 'now'"><i>3</i>电子签约</span>
        </div>

        <section class="who">
          <div class="avatar" :class="application.fromPublic ? 'avatar--t' : 'avatar--o'">{{ application.seekerName.slice(0, 1) }}</div>
          <div class="flex1">
            <b>{{ application.seekerName }}<span v-if="application.phone" class="mono ph">{{ fmtPhone(application.phone) }}</span></b>
            <span>{{ application.jobTitle ?? '—' }}<template v-if="application.projectName"> · {{ application.projectName }}</template></span>
          </div>
        </section>

        <!-- 当前待签署合同（RESEND_CONTRACT） -->
        <template v-if="mode === 'current' && current">
          <section class="acard sign">
            <div class="acard-hd">
              <h4>当前签署码</h4>
              <span class="tag" :class="CONTRACT_TAG[current.status] ?? 'tag-muted'">{{ label('ContractStatus', current.status) }}</span>
            </div>
            <div v-if="current.signUrl" class="qr-wrap">
              <QrImage :url="current.signUrl" :size="180" alt="电子合同签署码" />
              <p class="t-xs">请求职者用手机扫码签署，或复制链接发送给求职者</p>
              <div class="mono link">{{ current.signUrl }}</div>
              <van-button size="small" type="primary" plain class="copy" @click="copy(current.signUrl)">复制签署链接</van-button>
            </div>
            <p v-else class="t-sm">签署链接暂不可用，可重发签约生成新的签署链接。</p>
            <dl>
              <div class="kv"><dt>发起时间</dt><dd class="num">{{ full(current.createdAt) }}</dd></div>
              <div class="kv"><dt>合同编号</dt><dd class="num">{{ current.contractId }}</dd></div>
            </dl>
          </section>
          <p class="note warn-note">求职者签署完成后状态自动变为「已入职在岗」。链接仍有效时无需重发；重发会作废旧流程，旧链接失效。</p>
        </template>

        <!-- 确权表单 -->
        <template v-else-if="mode === 'form'">
          <p v-if="!resend" class="note">
            入职确权是<b>唯一数据统计节点</b>：完成后写入归属、锁定匹配范围（仅本公司内部调岗），并开始计费；随后生成电子劳动合同推送求职者签署，签署完成即「已入职在岗」。
            <template v-if="application.fromPublic"><br />该用户报名前为<b>公域</b>，确权后归属写入本公司、标签变为私域。</template>
          </p>
          <p v-else class="note warn-note">重发将作废尚未签署的旧签约流程，并生成新的签署链接（旧链接失效）。</p>
          <van-cell-group inset class="grp">
            <van-field label="入职日期" required is-link readonly :model-value="fmtDay(form.startDate)" @click="openPicker('startDate')" />
            <div class="hint">可选近 3 天到未来 30 天</div>
            <van-field v-model="form.employeeNo" label="工号" maxlength="32" placeholder="选填，如 XC-2026-0913" />
            <van-field label="合同截止" is-link readonly :model-value="form.termEnd ? fmtDay(form.termEnd) : ''" placeholder="默认入职起 1 年" @click="openPicker('termEnd')" />
          </van-cell-group>
        </template>

        <!-- 确权 / 重发结果 -->
        <template v-else-if="result">
          <p class="note ok-note">电子合同已生成并推送给求职者，签署完成后状态自动变为「已入职在岗」。</p>
          <section class="acard sign">
            <div class="acard-hd">
              <h4>待签合同</h4>
              <span class="tag" :class="CONTRACT_TAG[result.status] ?? 'tag-muted'">{{ label('ContractStatus', result.status) }}</span>
            </div>
            <div v-if="result.signUrl" class="qr-wrap">
              <QrImage :url="result.signUrl" :size="180" alt="电子合同签署码" />
              <p class="t-xs">请求职者用手机扫码签署，或复制链接发送给求职者</p>
              <div class="mono link">{{ result.signUrl }}</div>
              <van-button size="small" type="primary" plain class="copy" @click="copy(result.signUrl)">复制签署链接</van-button>
            </div>
            <dl>
              <div class="kv"><dt>合同名称</dt><dd>{{ result.title }}</dd></div>
              <div class="kv"><dt>合同编号</dt><dd class="num">{{ result.contractNo }}</dd></div>
              <div v-if="result.companyName" class="kv"><dt>甲方</dt><dd>{{ result.companyName }}</dd></div>
              <div class="kv"><dt>合同期限</dt><dd class="num">{{ result.termStart }} → {{ result.termEnd ?? '—' }}</dd></div>
              <div class="kv"><dt>生成时间</dt><dd class="num">{{ full(result.createdAt) }}</dd></div>
            </dl>
          </section>
        </template>
      </div>

      <div class="foot">
        <template v-if="mode === 'current'">
          <van-button block class="btn-cta" @click="mode = 'form'">作废并重发签约</van-button>
        </template>
        <van-button v-else-if="mode === 'form'" block type="primary" class="btn-cta" :loading="submitting" loading-text="提交中…" :disabled="!application" @click="submit">
          {{ resend ? '重发签约' : '确认入职并发起电子签约' }}
        </van-button>
        <van-button v-else block type="primary" class="btn-cta" @click="show = false">完成</van-button>
      </div>
    </div>

    <van-popup v-model:show="picker.show" position="bottom" round teleport="body" safe-area-inset-bottom>
      <van-date-picker
        v-model="picker.vals"
        :title="picker.key === 'startDate' ? '入职日期' : '合同截止日'"
        :min-date="pickMin"
        :max-date="pickMax"
        @confirm="onPick"
        @cancel="picker.show = false"
      />
    </van-popup>
  </van-popup>
</template>

<style scoped>
.cf { height: 100%; display: flex; flex-direction: column; background: var(--surface-2); }
.body { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 0 14px 16px; }
.steps { display: flex; align-items: center; padding: 14px 2px 4px; }
.steps .st { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--ink-400); white-space: nowrap; }
.steps .st i { width: 18px; height: 18px; border-radius: 50%; background: var(--surface-3); color: var(--ink-500); display: grid; place-items: center; font-style: normal; font-size: 10px; font-weight: 700; }
.steps .st.done i { background: var(--ok); color: #fff; }
.steps .st.now { color: var(--ink-900); font-weight: 600; }
.steps .st.now i { background: var(--signal); color: #fff; }
.steps .ln { flex: 1; height: 1px; background: var(--line-2); margin: 0 6px; min-width: 8px; }
.who { display: flex; align-items: center; gap: 10px; padding: 12px 2px; }
.who b { display: block; font-size: 15px; font-weight: 700; color: var(--ink-900); }
.who .ph { display: inline; font-size: 12px; font-weight: 500; color: var(--ink-500); margin-left: 8px; }
.who span { display: block; font-size: 12px; color: var(--ink-500); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp { margin: 12px 0 0; }
.hint { padding: 0 16px 10px; margin-top: -4px; font-size: 11.5px; color: var(--ink-400); background: var(--surface); }
.warn-note { border-left-color: var(--warn); background: var(--warn-bg); }
.ok-note { border-left-color: var(--ok); background: var(--ok-bg); }
.sign { margin-top: 12px; }
.qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0 12px; border-bottom: 1px dashed var(--line); margin-bottom: 4px; }
.link { font-size: 11.5px; color: var(--ink-600); word-break: break-all; text-align: center; padding: 0 6px; }
.copy { border-radius: var(--r-sm); }
.foot { flex: none; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
</style>
