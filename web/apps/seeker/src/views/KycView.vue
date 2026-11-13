<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { errorMessage, isApiError, seekerApi, type KycView } from '@shitu/api-client'
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
const serverErr = ref<{ field: 'name' | 'id' | 'id2' | 'form'; msg: string } | null>(null)
const MISMATCH = '两次输入的身份证号码不一致，请重新输入'

function onName(e: Event) {
  realName.value = (e.target as HTMLInputElement).value.replace(/\s/g, '').slice(0, 20)
  serverErr.value = null
}
function onId(e: Event, which: 1 | 2) {
  const v = normalizeId((e.target as HTMLInputElement).value)
  if (which === 1) idCard.value = v
  else idCard2.value = v
  ;(e.target as HTMLInputElement).value = v
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

async function submit() {
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
</script>

<template>
  <div class="kyc">
    <AppBar :title="block ? '合规拦截' : '身份验证'" :fallback="jobId ? `/jobs/${jobId}` : '/me'" />

    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <!-- S-46 形态 A：未成年硬阻断（未满 16 / 16–18 周岁不能报名） -->
    <div v-else-if="block === 'underage16' || block === 'minor18'" class="pad">
      <section class="acard blk danger">
        <div class="big-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5m0 3.2v.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /></svg></div>
        <div class="blk-t">暂时无法为你提供{{ block === 'minor18' ? '报名' : '' }}服务</div>
        <p class="t-sm blk-d">{{ blockMsg }}。<br />依据《劳动法》规定，平台不承接未成年工用工撮合。</p>
        <dl v-if="kyc?.age != null" class="blk-kv">
          <div class="kv"><dt>当前年龄</dt><dd>{{ kyc.age }} 周岁</dd></div>
          <div class="kv"><dt>可再次尝试</dt><dd>满 18 周岁后</dd></div>
        </dl>
        <div class="note" style="margin-top: 12px; background: #fff">若身份证信息有误，可联系客服人工核验。</div>
        <div class="row" style="gap: 8px; margin-top: 12px">
          <van-button class="flex1" @click="router.push('/feedback')">联系客服</van-button>
          <van-button class="flex1" type="primary" @click="router.replace('/')">回首页</van-button>
        </div>
      </section>
    </div>

    <!-- 形态 B：一证一号 -->
    <div v-else-if="block === 'occupied'" class="pad">
      <section class="acard blk warn">
        <div class="acard-hd"><h4>证件已被其他账号绑定</h4><span class="tag tag-warn">一证一号</span></div>
        <p class="t-sm" style="line-height: 1.75">{{ blockMsg }}。<br />为保障你的劳动权益与工资安全，<b class="strong">一个身份证只能绑定一个账号</b>。</p>
        <div class="divider" style="margin: 11px 0"></div>
        <div class="stack-sm">
          <div class="row"><span class="tag">情况一</span><span class="t-sm flex1">这是我本人的旧号 → 用旧手机号登录找回</span></div>
          <div class="row"><span class="tag">情况二</span><span class="t-sm flex1">旧手机号已停用 → 提交人工申诉换绑</span></div>
          <div class="row"><span class="tag tag-danger">情况三</span><span class="t-sm flex1">不是我本人操作 → 举报身份冒用</span></div>
        </div>
        <div class="row" style="gap: 8px; margin-top: 12px">
          <van-button size="small" class="flex1" @click="recoverOld">找回旧号</van-button>
          <van-button size="small" class="flex1" type="primary" @click="openAppeal('ID_OCCUPIED_APPEAL')">提交申诉</van-button>
          <van-button size="small" class="flex1" type="danger" plain @click="openAppeal('ID_OCCUPIED_APPEAL')">举报冒用</van-button>
        </div>
        <div v-if="appealDone" class="note note--ok" style="margin-top: 10px">申诉已在处理中，平台将在 5 个工作日内复核。<router-link to="/kyc/appeals" class="lnk">查看我的申诉 ›</router-link></div>
        <router-link v-else to="/kyc/appeals" class="t-xs lnk-row">查看我的申诉 ›</router-link>
        <van-button block style="margin-top: 10px" @click="block = null">返回修改</van-button>
      </section>
    </div>

    <!-- 形态 C：平台失信名单 -->
    <div v-else-if="block === 'blacklist'" class="pad">
      <section class="acard blk ink">
        <div class="acard-hd"><h4>账号受限</h4><span class="tag tag-muted">受限</span></div>
        <p class="t-sm" style="line-height: 1.75">{{ blockMsg }}。</p>
        <dl style="margin-top: 8px">
          <div class="kv"><dt>受限类型</dt><dd>平台级失信标记</dd></div>
          <div class="kv"><dt>申诉通道</dt><dd>如有异议可提交申诉，5 个工作日内复核</dd></div>
        </dl>
        <div class="row" style="gap: 8px; margin-top: 12px">
          <van-button class="flex1" type="primary" @click="openAppeal('BLACKLIST_APPEAL')">我有异议，提交申诉</van-button>
          <van-button class="flex1" @click="router.replace('/')">回首页</van-button>
        </div>
        <div v-if="appealDone" class="note note--ok" style="margin-top: 10px">申诉已在处理中，平台将在 5 个工作日内复核。<router-link to="/kyc/appeals" class="lnk">查看我的申诉 ›</router-link></div>
        <router-link v-else to="/kyc/appeals" class="t-xs lnk-row">查看我的申诉 ›</router-link>
      </section>
    </div>

    <div v-else-if="block === 'reviewing'" class="page-state">
      <van-empty description="实名资料人工复核中，复核通过后即可报名">
        <van-button round size="small" @click="router.replace('/')">回首页</van-button>
      </van-empty>
    </div>

    <!-- 已实名：正在继续报名 -->
    <div v-else-if="verified" class="page-state">
      <section class="acard done-card">
        <van-icon name="passed" class="done-ic" />
        <div class="blk-t" style="color: var(--ok)">已完成实名认证</div>
        <p class="t-sm" style="margin-top: 6px">{{ kyc?.realNameMasked }} · <span class="num">{{ kyc?.idCardMasked }}</span></p>
        <van-button v-if="jobId" type="primary" block class="btn-cta" style="margin-top: 16px" :loading="flow.submitting.value" loading-text="正在生成报名…" @click="flow.apply(jobId, { fromKyc: true })">继续报名</van-button>
        <van-button v-else block class="btn-cta" style="margin-top: 16px" @click="router.replace('/')">回首页</van-button>
      </section>
    </div>

    <!-- S-21 / S-22 表单 -->
    <div v-else class="pad form">
      <div class="steps" style="margin-bottom: 20px">
        <div class="st done"><i>✓</i>告知书</div>
        <div class="ln"></div>
        <div class="st now"><i>2</i>身份验证</div>
        <div class="ln"></div>
        <div class="st"><i>3</i>生成报名</div>
      </div>
      <h2 class="h2">验证你的真实身份</h2>
      <p class="t-sm" style="margin-top: 7px; line-height: 1.7">报名前必须完成实名验证。信息将与你的用户 ID 绑定且<b class="strong">提交后不可修改</b>，用于生成报名记录与入职建档。</p>

      <div style="margin-top: 22px">
        <div class="field">
          <label for="kyc-name">真实姓名</label>
          <input id="kyc-name" class="inp" :class="{ err: nameErr || serverErr?.field === 'name' }" :value="realName" placeholder="与身份证上的姓名一致" maxlength="20" autocomplete="name" @input="onName" />
          <div v-if="nameErr" class="hint err">{{ nameErr }}</div>
        </div>
        <div class="field">
          <label for="kyc-id">身份证号码</label>
          <input id="kyc-id" class="inp mono id" :class="{ err: idErr || serverErr?.field === 'id' }" :value="idCard" placeholder="18 位身份证号码" maxlength="18" autocomplete="off" autocapitalize="characters" spellcheck="false" @input="onId($event, 1)" />
          <div v-if="idErr || serverErr?.field === 'id'" class="hint err">{{ idErr || serverErr?.msg }}</div>
        </div>
        <div class="field">
          <label for="kyc-id2">再次输入身份证号码 <span style="color: var(--signal)">*</span></label>
          <input
            id="kyc-id2"
            class="inp mono id"
            :class="{ err: mismatch || serverErr?.field === 'id2', ok: matchOk && !serverErr }"
            :value="idCard2"
            placeholder="请再输入一次，防止输错"
            maxlength="18"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            @input="onId($event, 2)"
            @paste.prevent="showToast('请手动再输入一次身份证号码')"
          />
          <div v-if="mismatch || serverErr?.field === 'id2'" class="hint err">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /><path d="M12 7.5v5.5m0 2.8v.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
            {{ MISMATCH }}
          </div>
          <div v-else-if="matchOk" class="hint ok">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
            两次输入一致，校验通过
          </div>
        </div>
      </div>

      <section v-if="mismatch && diffs.length" class="acard diff">
        <b>第 {{ diffs.slice(0, 6).join('、') }}{{ diffs.length > 6 ? ' 等' : '' }} 位不一致</b>，请核对后重新输入
      </section>
      <section v-if="serverErr?.field === 'form'" class="note note--danger" style="margin-bottom: 12px">{{ serverErr.msg }}</section>

      <div class="acard privacy">
        <div class="row" style="gap: 9px; align-items: flex-start">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style="color: var(--ink-500); flex: none; margin-top: 1px" aria-hidden="true"><path d="M12 2.5 20 6v6c0 4.4-3.4 7.2-8 8.5C7.4 19.2 4 16.4 4 12V6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
          <p class="t-xs" style="line-height: 1.7">身份证号加密保存，仅用于报名核验与用工建档，<b class="strong">驻场 / 项目经理端仅可见脱敏信息</b>，老板端不可见任何个人隐私信息。</p>
        </div>
      </div>

      <router-link to="/kyc/appeals" class="t-xs lnk-row">身份证被占用或账号受限？查看我的申诉 ›</router-link>
      <van-button type="primary" block class="btn-cta" style="margin-top: 12px" :disabled="!canSubmit" :loading="submitting || flow.submitting.value" loading-text="核验中…" @click="submit">
        {{ jobId ? '确认并提交报名' : '提交实名认证' }}
      </van-button>
      <div class="page-bottom-gap"></div>
    </div>

    <DisclaimerPopup v-model:show="flow.disclaimerOpen.value" @agreed="flow.retry" />
    <AppealPopup v-model:show="appealOpen" :type="appealType" @submitted="appealDone = true" @pending="appealDone = true" />
  </div>
</template>

<style scoped>
.kyc { min-height: 100vh; background: var(--surface-2); }
.h2 { font-family: var(--f-dis); font-size: 24px; font-weight: 700; color: var(--ink-900); }
.id { letter-spacing: .05em; }
.diff { border-color: var(--danger-line); background: var(--danger-bg); color: var(--danger); font-size: 12.5px; line-height: 1.7; margin-bottom: 12px; }
.privacy { background: var(--surface); }
.blk { text-align: left; }
.blk.danger { border-color: var(--danger-line); background: var(--danger-bg); text-align: center; padding: 22px 16px; }
.blk.danger .big-ic { color: var(--danger); }
.blk.danger .blk-t, .blk.danger .blk-d { color: var(--danger); }
.blk.warn { border-color: var(--warn-line); }
.blk.warn h4 { color: var(--warn); }
.blk.ink { border-color: var(--ink-800); }
.blk-t { font-size: 16px; font-weight: 700; color: var(--ink-900); }
.blk-d { margin-top: 8px; line-height: 1.75; }
.blk-kv { margin-top: 12px; text-align: left; }
.blk-kv .kv { border-color: var(--danger-line); }
.done-card { text-align: center; padding: 26px 16px; margin: 0 14px; }
.done-ic { font-size: 46px; color: var(--ok); margin-bottom: 10px; }
.kyc :deep(.flex1.van-button) { flex: 1; }
.lnk { color: var(--ok); font-weight: 600; text-decoration: none; margin-left: 4px; }
.lnk-row { display: block; text-align: center; margin-top: 12px; color: var(--ink-500); text-decoration: none; }
</style>
