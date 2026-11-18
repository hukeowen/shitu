<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type KycView } from '@shitu/api-client'
import { IconBan, IconCheck, IconChevronRight, IconCircleCheck, IconClock, IconShieldCheck, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import AppealPopup from '@/components/AppealPopup.vue'
import DisclaimerPopup from '@/components/DisclaimerPopup.vue'
import { useApplyFlow } from '@/composables/useApplyFlow'
import { useAuthStore } from '@/stores/auth'
import { NAME_RE, diffPositions, idChecksumOk, normalizeId } from '@/utils/idcard'

/**
 * S-21 / S-22 身份验证（C-404，V1.0 按 D-40：姓名 + 身份证两次输入 + 二要素 Mock，出生日期由号码解析）。
 * S-46 合规拦截三态（C-406）：未成年硬阻断 / 一证一号已占用 / 平台失信名单。
 * 实名通过后若从报名进入（?jobId=），自动继续报名。
 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const flow = useApplyFlow()
const jobId = computed(() => (typeof route.query.jobId === 'string' ? route.query.jobId : ''))

type Block = 'underage16' | 'minor18' | 'occupied' | 'blacklist' | 'reviewing' | null
const kyc = ref<KycView | null>(null)
const loading = ref(true)
const loadError = ref('')
const block = ref<Block>(null)
const blockMsg = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    kyc.value = await seekerApi.kyc()
    afterKyc(kyc.value, false)
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

/** 已实名：可报名则继续报名；16–18 周岁实名成功但不能报名 */
function afterKyc(k: KycView, justVerified: boolean) {
  if (k.kycStatus === 'REVIEWING') {
    block.value = 'reviewing'
    return
  }
  if (k.kycStatus !== 'VERIFIED') return
  if (!k.canApply) {
    block.value = 'minor18'
    blockMsg.value = '未满 18 周岁，暂不能报名岗位'
    return
  }
  if (justVerified) showToast({ type: 'success', message: '实名认证通过' })
  if (jobId.value) void flow.apply(jobId.value, { fromKyc: true })
}

// ---------- 表单 ----------
const realName = ref('')
const idCard = ref('')
const idCard2 = ref('')
const submitting = ref(false)
const serverErr = ref<{ field: 'id' | 'id2' | 'form'; msg: string } | null>(null)
const MISMATCH = '两次输入的身份证号码不一致，请重新输入'

const fmtName = (v: string) => v.replace(/\s/g, '').slice(0, 20)
function clearServerErr() {
  serverErr.value = null
}

const nameOk = computed(() => NAME_RE.test(realName.value))
const nameErr = computed(() => (realName.value && realName.value.length >= 2 && !nameOk.value ? '请输入 2–20 个汉字的真实姓名' : ''))
const idFull = computed(() => idCard.value.length === 18)
const idErr = computed(() => (idFull.value && !idChecksumOk(idCard.value) ? '身份证号码不正确，请核对后重新输入' : ''))
const id2Full = computed(() => idCard2.value.length === 18)
const mismatch = computed(() => idFull.value && id2Full.value && idCard.value !== idCard2.value)
const diffs = computed(() => (mismatch.value ? diffPositions(idCard.value, idCard2.value) : []))
const matchOk = computed(() => idFull.value && id2Full.value && !mismatch.value && !idErr.value)
const canSubmit = computed(() => nameOk.value && matchOk.value && !submitting.value)
const idMsg = computed(() => idErr.value || (serverErr.value?.field === 'id' ? serverErr.value.msg : ''))
const id2Msg = computed(() => (mismatch.value || serverErr.value?.field === 'id2' ? MISMATCH : ''))

async function submit() {
  if (submitting.value) return
  if (!nameOk.value) return showToast('请输入 2–20 个汉字的真实姓名')
  if (!idFull.value || idErr.value) return showToast(idErr.value || '请输入 18 位身份证号码')
  if (mismatch.value || !id2Full.value) return showToast(MISMATCH)
  submitting.value = true
  serverErr.value = null
  try {
    const k = await seekerApi.submitKyc(realName.value, idCard.value, idCard2.value)
    kyc.value = k
    void auth.loadProfile().catch(() => undefined)
    afterKyc(k, true)
  } catch (e) {
    onError(e)
  } finally {
    submitting.value = false
  }
}

function onError(e: unknown) {
  if (!isApiError(e)) {
    showToast(errorMessage(e, '提交失败，请稍后重试'))
    return
  }
  const msg = e.message
  switch (e.code) {
    case 'APP_4003':
      serverErr.value = { field: 'id2', msg: MISMATCH }
      return
    case 'APP_4005':
      serverErr.value = { field: 'id', msg: msg || '身份证号码不正确，请核对后重新输入' }
      return
    case 'APP_4009':
      serverErr.value = { field: 'form', msg: msg || '姓名与身份证号码不一致，请核对后重试' }
      return
    case 'APP_4014':
      serverErr.value = { field: 'form', msg: msg || '今日实名认证次数已用完，请明天再试' }
      return
    case 'APP_4006':
      block.value = 'underage16'
      blockMsg.value = msg
      return
    case 'APP_4007':
      block.value = 'occupied'
      blockMsg.value = msg
      return
    case 'APP_4008':
      block.value = 'blacklist'
      blockMsg.value = msg
      return
    case 'APP_4013':
      showToast(msg || '已完成实名认证')
      void load()
      return
    default:
      showToast(errorMessage(e, '提交失败，请稍后重试'))
  }
}

// ---------- 实名申诉（APP_4007 / APP_4008） ----------
const appealOpen = ref(false)
const appealType = ref<'ID_OCCUPIED_APPEAL' | 'BLACKLIST_APPEAL'>('ID_OCCUPIED_APPEAL')
/** 本次已提交 / 已有处理中的申诉 */
const appealDone = ref(false)
function openAppeal(t: 'ID_OCCUPIED_APPEAL' | 'BLACKLIST_APPEAL') {
  appealType.value = t
  appealOpen.value = true
}

/** 情况一：证件绑在本人旧号上 → 退出当前账号，用旧手机号登录（不回显旧号，避免凭身份证号探测他人手机号） */
async function recoverOld() {
  try {
    await showConfirmDialog({
      title: '用旧手机号登录',
      message: '将退出当前账号，请用当初实名时使用的手机号登录。登录后报名、工作记录都在旧账号里，当前新号码不会产生任何记录。',
      confirmButtonText: '去登录',
    })
  } catch {
    return
  }
  try {
    await auth.logout()
  } catch {
    /* 本地登录态已清空 */
  }
  await router.replace({ path: '/login', query: { redirect: jobId.value ? `/jobs/${jobId.value}` : '/me', old: '1' } })
}

const verified = computed(() => kyc.value?.kycStatus === 'VERIFIED' && kyc.value.canApply)
const STEPS = [
  { t: '告知书', cls: 'done', s: '已完成' },
  { t: '实名认证', cls: 'now', s: '进行中' },
  { t: '生成报名', cls: 'todo', s: '未开始' },
]
</script>

<template>
  <div class="kyc">
    <AppBar :title="block ? '合规拦截' : '实名认证'" :fallback="jobId ? `/jobs/${jobId}` : '/me'" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <!-- S-46 形态 A：未成年硬阻断（未满 16 / 16–18 周岁不能报名） -->
    <div v-else-if="block === 'underage16' || block === 'minor18'" class="pad stack">
      <section class="acard">
        <div class="state-block state-block--sm blk-head">
          <IconBan :size="48" :stroke-width="1.5" />
          <div class="state-block-t">暂时无法为你提供{{ block === 'minor18' ? '报名' : '' }}服务</div>
        </div>
        <p class="para">{{ blockMsg }}。依据《劳动法》规定，平台不承接未成年工用工撮合。</p>
        <dl v-if="kyc?.age != null" class="facts">
          <div class="kv"><dt>当前年龄</dt><dd>{{ kyc.age }} 周岁</dd></div>
          <div class="kv"><dt>可再次尝试</dt><dd>满 18 周岁后</dd></div>
        </dl>
        <p class="para">若身份证信息有误，可联系客服人工核验。</p>
        <van-button type="primary" block class="mt" @click="router.replace('/')">回首页</van-button>
        <van-button block class="mt-sm" @click="router.push('/feedback')">联系客服</van-button>
      </section>
    </div>

    <!-- 形态 B：一证一号 -->
    <div v-else-if="block === 'occupied'" class="pad stack">
      <section class="acard">
        <div class="acard-hd"><h4>证件已被其他账号绑定</h4><span class="status-tag status-tag--warning">一证一号</span></div>
        <p class="para">{{ blockMsg }}。为保障你的劳动权益与工资安全，<b class="strong">一个身份证只能绑定一个账号</b>。</p>
        <ul class="cases">
          <li>
            <div class="flex1"><b>这是我本人的旧号</b><span>用旧手机号登录找回</span></div>
            <van-button @click="recoverOld">找回旧号</van-button>
          </li>
          <li>
            <div class="flex1"><b>旧手机号已停用</b><span>提交人工申诉换绑</span></div>
            <van-button type="primary" @click="openAppeal('ID_OCCUPIED_APPEAL')">提交申诉</van-button>
          </li>
          <li>
            <div class="flex1"><b>不是我本人操作</b><span>举报身份冒用</span></div>
            <van-button type="danger" plain @click="openAppeal('ID_OCCUPIED_APPEAL')">举报冒用</van-button>
          </li>
        </ul>
        <van-button block class="mt" @click="block = null">返回修改</van-button>
      </section>
      <section v-if="appealDone" class="tipbar tipbar--ok">
        <IconCircleCheck :size="20" />
        <div class="flex1">
          <div class="tipbar-t">申诉已在处理中</div>
          <div class="tipbar-d">平台将在 5 个工作日内复核。</div>
        </div>
      </section>
      <router-link to="/kyc/appeals" class="link more">查看我的申诉<IconChevronRight :size="16" /></router-link>
    </div>

    <!-- 形态 C：平台失信名单 -->
    <div v-else-if="block === 'blacklist'" class="pad stack">
      <section class="acard">
        <div class="acard-hd"><h4>账号受限</h4><span class="status-tag">受限</span></div>
        <p class="para">{{ blockMsg }}。</p>
        <dl class="facts">
          <div class="kv"><dt>受限类型</dt><dd>平台级失信标记</dd></div>
          <div class="kv col"><dt>申诉通道</dt><dd>如有异议可提交申诉，5 个工作日内复核</dd></div>
        </dl>
        <van-button type="primary" block class="mt" @click="openAppeal('BLACKLIST_APPEAL')">我有异议，提交申诉</van-button>
        <van-button block class="mt-sm" @click="router.replace('/')">回首页</van-button>
      </section>
      <section v-if="appealDone" class="tipbar tipbar--ok">
        <IconCircleCheck :size="20" />
        <div class="flex1">
          <div class="tipbar-t">申诉已在处理中</div>
          <div class="tipbar-d">平台将在 5 个工作日内复核。</div>
        </div>
      </section>
      <router-link to="/kyc/appeals" class="link more">查看我的申诉<IconChevronRight :size="16" /></router-link>
    </div>

    <div v-else-if="block === 'reviewing'" class="state-block">
      <IconClock :size="48" :stroke-width="1.5" />
      <div class="state-block-t">实名资料人工复核中</div>
      <div class="state-block-d">复核通过后即可报名</div>
      <van-button type="primary" @click="router.replace('/')">回首页</van-button>
    </div>

    <!-- 已实名：正在继续报名 -->
    <div v-else-if="verified" class="state-block done">
      <IconCircleCheck :size="48" :stroke-width="1.5" />
      <div class="state-block-t">已完成实名认证</div>
      <div class="state-block-d">{{ kyc?.realNameMasked }} · {{ kyc?.idCardMasked }}</div>
      <van-button v-if="jobId" type="primary" :loading="flow.submitting.value" loading-text="正在生成报名…" @click="flow.apply(jobId, { fromKyc: true })">继续报名</van-button>
      <van-button v-else type="primary" @click="router.replace('/')">回首页</van-button>
    </div>

    <!-- S-21 / S-22 表单 -->
    <template v-else>
      <div class="pad stack">
        <section class="acard">
          <ol class="ksteps">
            <li v-for="(st, i) in STEPS" :key="st.t" :class="st.cls">
              <i><IconCheck v-if="st.cls === 'done'" :size="14" :stroke-width="2.5" /><template v-else>{{ i + 1 }}</template></i>
              <b>{{ st.t }}</b>
              <span>{{ st.s }}</span>
            </li>
          </ol>
          <h2 class="ttl">验证你的真实身份</h2>
          <p class="para">报名前必须完成实名验证。信息将与你的用户 ID 绑定且<b class="strong">提交后不可修改</b>，用于生成报名记录与入职建档。</p>
        </section>

        <section class="acard">
          <van-cell-group :border="false">
            <van-field
              v-model="realName"
              class="ffield"
              :class="{ bad: nameErr }"
              label="真实姓名"
              label-align="top"
              required
              placeholder="与身份证上的姓名一致"
              maxlength="20"
              autocomplete="name"
              :formatter="fmtName"
              :error-message="nameErr"
              :border="false"
              @update:model-value="clearServerErr"
            />
            <van-field
              v-model="idCard"
              class="ffield"
              :class="{ bad: idMsg }"
              label="身份证号码"
              label-align="top"
              required
              placeholder="18 位身份证号码"
              maxlength="18"
              autocomplete="off"
              autocapitalize="characters"
              :formatter="normalizeId"
              :error-message="idMsg"
              :border="false"
              @update:model-value="clearServerErr"
            />
            <!-- 第二遍不许粘贴：粘贴会把第一遍的错原样带过来 -->
            <div class="again" @paste.capture.prevent="showToast('请手动再输入一次身份证号码')">
              <van-field
                v-model="idCard2"
                class="ffield"
                :class="{ bad: id2Msg }"
                label="再次输入身份证号码"
                label-align="top"
                required
                placeholder="请再输入一次，防止输错"
                maxlength="18"
                autocomplete="off"
                autocapitalize="characters"
                :formatter="normalizeId"
                :error-message="id2Msg"
                :border="false"
                @update:model-value="clearServerErr"
              />
              <p v-if="mismatch && diffs.length" class="fhint fhint--err">第 {{ diffs.slice(0, 6).join('、') }}{{ diffs.length > 6 ? ' 等' : '' }} 位不一致，请核对后重新输入</p>
              <p v-else-if="matchOk && !serverErr" class="fhint fhint--ok"><IconCheck :size="14" :stroke-width="2.5" />两次输入一致，校验通过</p>
            </div>
          </van-cell-group>
        </section>

        <section v-if="serverErr?.field === 'form'" class="tipbar tipbar--danger" role="alert">
          <IconTriangleExclamationPoint :size="20" />
          <div class="flex1"><div class="tipbar-d first">{{ serverErr.msg }}</div></div>
        </section>

        <section class="tipbar">
          <IconShieldCheck :size="20" />
          <div class="flex1">
            <div class="tipbar-d first">身份证号加密保存，仅用于报名核验与用工建档，<b class="strong">驻场 / 项目经理端仅可见脱敏信息</b>，老板端不可见任何个人隐私信息。</div>
          </div>
        </section>

        <router-link to="/kyc/appeals" class="link more wrap">身份证被占用或账号受限？查看我的申诉<IconChevronRight :size="16" /></router-link>
        <div class="bottom-bar-gap"></div>
      </div>

      <div class="bottom-bar">
        <van-button type="primary" size="large" block :disabled="!canSubmit" :loading="submitting || flow.submitting.value" loading-text="核验中…" @click="submit">
          {{ jobId ? '确认并提交报名' : '提交实名认证' }}
        </van-button>
      </div>
    </template>

    <DisclaimerPopup v-model:show="flow.disclaimerOpen.value" @agreed="flow.retry" />
    <AppealPopup v-model:show="appealOpen" :type="appealType" @submitted="appealDone = true" @pending="appealDone = true" />
  </div>
</template>

<style scoped>
.kyc { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.blk-head > svg { color: var(--danger-text); }
.blk-head .state-block-t { margin-bottom: var(--space-3); font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.done > svg { color: var(--success-text); }
.para + .para, .facts + .para { margin-top: var(--space-2); }
.facts { margin-top: var(--space-2); }
.facts dd { word-break: normal; overflow-wrap: anywhere; }
/* 长内容：标签在上、内容左对齐在下 */
.kv.col { display: block; }
.kv.col dd { margin-top: 2px; text-align: left; }
.mt { margin-top: var(--space-4); }
.mt-sm { margin-top: var(--space-2); }
.cases { margin-top: var(--space-2); }
.cases li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--divider); }
.cases b { display: block; font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); }
.cases span { font-size: var(--font-size-aux); line-height: 20px; color: var(--text-3); }
.cases .van-button { flex: none; }
.more { display: flex; justify-content: center; min-height: 44px; }
.more.wrap { white-space: normal; text-align: center; }
.ttl { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.ttl + .para { margin-top: var(--space-1); }
.again { margin-top: var(--space-4); }
.tipbar-d.first { margin-top: 0; }
.ksteps { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: var(--space-4); }
.ksteps li { position: relative; display: flex; flex-direction: column; align-items: center; min-width: 0; text-align: center; }
.ksteps li + li::before { content: ""; position: absolute; top: 12px; right: calc(50% + 16px); width: calc(100% - 32px); height: 1px; background: var(--border); }
.ksteps i { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--bg-fill); font-size: var(--font-size-min); font-style: normal; font-weight: var(--font-weight-medium); color: var(--text-3); }
.ksteps b { margin-top: var(--space-2); font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); line-height: 20px; color: var(--text-2); }
.ksteps span { font-size: var(--font-size-min); line-height: 18px; color: var(--text-3); }
.ksteps .done i { background: var(--success-text); color: var(--text-on-primary); }
.ksteps .done span { color: var(--success-text); }
.ksteps .now i { background: var(--primary); color: var(--text-on-primary); }
.ksteps .now b { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.ksteps .now span { color: var(--primary-text); }
</style>
