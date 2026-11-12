<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type ResumeArchive } from '@shitu/api-client'
import { IconCheck, IconChevronRight, IconTriangleExclamationPoint, IconX } from '@shitu/ui-icons'
import AppBar from '@/components/AppBar.vue'
import { formatServerTime } from '@/utils/time'

/**
 * S-29 我的简历（C-504）：上半部分是只读的用工档案（实名信息、当前在岗、历史项目、考勤异常），
 * 下半部分本人可编辑（期望工种 / 地点、工作年限、技能标签、微信、紧急联系人、简介）。证件附件本期不做。
 */
const { label } = useDict()

const JOB_TYPES = ['ELECTRONICS', 'GENERAL', 'WAREHOUSE', 'MACHINING', 'QC']
const MAX_REGIONS = 5
const MAX_TAGS = 10
const MAX_INTRO = 500

const archive = ref<ResumeArchive | null>(null)
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
/** 保存被拒的原因：留在底部通栏上，轻提示两秒就没了 */
const saveError = ref('')

const form = reactive({
  wechatId: '',
  emergencyName: '',
  emergencyPhone: '',
  expectJobTypes: [] as string[],
  expectRegions: [] as string[],
  workYears: '',
  skillTags: [] as string[],
  intro: '',
})
const regionDraft = ref('')
const tagDraft = ref('')
/** 各字段的错误提示，显示在字段下方；改了那个字段就清掉 */
const errs = reactive({ region: '', tag: '', years: '', wechat: '', phone: '' })

async function load() {
  loadError.value = ''
  loading.value = true
  try {
    const r = await seekerApi.resume()
    archive.value = r.archive
    Object.assign(form, {
      wechatId: r.form.wechatId ?? '',
      emergencyName: r.form.emergencyName ?? '',
      emergencyPhone: r.form.emergencyPhone ?? '',
      expectJobTypes: [...(r.form.expectJobTypes ?? [])],
      expectRegions: [...(r.form.expectRegions ?? [])],
      workYears: r.form.workYears == null ? '' : String(r.form.workYears),
      skillTags: [...(r.form.skillTags ?? [])],
      intro: r.form.intro ?? '',
    })
  } catch (e) {
    loadError.value = errorMessage(e, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
void load()

function toggleType(t: string) {
  form.expectJobTypes = form.expectJobTypes.includes(t) ? form.expectJobTypes.filter((x) => x !== t) : [...form.expectJobTypes, t]
}
function addTo(list: 'expectRegions' | 'skillTags', draft: { value: string }, max: number, maxLen: number, what: string): string {
  const v = draft.value.trim()
  if (!v) return ''
  if (v.length > maxLen) return `${what}不超过 ${maxLen} 个字`
  if (form[list].includes(v)) return (draft.value = '')
  if (form[list].length >= max) return `${what}最多 ${max} 个`
  form[list] = [...form[list], v]
  return (draft.value = '')
}
function addRegion() {
  errs.region = addTo('expectRegions', regionDraft, MAX_REGIONS, 20, '期望地点')
}
function addTag() {
  errs.tag = addTo('skillTags', tagDraft, MAX_TAGS, 12, '技能标签')
}
function removeFrom(list: 'expectRegions' | 'skillTags', v: string) {
  form[list] = form[list].filter((x) => x !== v)
  if (list === 'expectRegions') errs.region = ''
  else errs.tag = ''
}

async function save() {
  if (saving.value) return
  saveError.value = ''
  // 输入框里还没点「添加」的内容一并收进来；超长或超上限只在字段下方提示，不拦保存
  addRegion()
  addTag()
  const phone = form.emergencyPhone.trim()
  errs.phone = phone && !/^1[3-9]\d{9}$/.test(phone) ? '紧急联系人手机号格式不正确' : ''
  const wechat = form.wechatId.trim()
  errs.wechat = wechat && !/^[A-Za-z0-9_-]{5,40}$/.test(wechat) ? '微信号只能包含字母、数字、下划线和减号' : ''
  const years = form.workYears.trim()
  errs.years = years && (!/^\d{1,2}$/.test(years) || Number(years) > 50) ? '工作年限请填 0 到 50 的整数' : ''
  // 校验没通过：原因写在字段下方，轻提示第一条并滚到那个字段（它可能不在当前这一屏）
  const first = errs.phone || errs.wechat || errs.years
  if (first) {
    showToast(first)
    const key = errs.phone ? 'phone' : errs.wechat ? 'wechat' : 'years'
    void nextTick(() => document.querySelector(`[data-field="${key}"]`)?.scrollIntoView({ block: 'center' }))
    return
  }
  saving.value = true
  try {
    await seekerApi.saveResume({
      wechatId: wechat || undefined,
      emergencyName: form.emergencyName.trim() || undefined,
      emergencyPhone: phone || undefined,
      expectJobTypes: form.expectJobTypes,
      expectRegions: form.expectRegions,
      workYears: years ? Number(years) : undefined,
      skillTags: form.skillTags,
      intro: form.intro.trim() || undefined,
    })
    showToast('简历已保存')
  } catch (e) {
    saveError.value = errorMessage(e, '保存失败，请稍后重试')
    showToast(saveError.value)
  } finally {
    saving.value = false
  }
}

const genderText = computed(() => (archive.value?.gender === 'M' ? '男' : archive.value?.gender === 'F' ? '女' : '—'))
const verified = computed(() => archive.value?.kycStatus === 'VERIFIED')
</script>

<template>
  <div class="rs">
    <AppBar title="我的简历" fallback="/me" />
    <div v-if="loading" class="page-state"><van-loading size="28" vertical>加载中…</van-loading></div>
    <div v-else-if="loadError || !archive" class="state-block">
      <IconTriangleExclamationPoint :size="48" :stroke-width="1.5" />
      <div class="state-block-t">加载失败</div>
      <div v-if="loadError" class="state-block-d">{{ loadError }}</div>
      <van-button type="primary" @click="load">重新加载</van-button>
    </div>

    <template v-else>
      <div class="pad stack">
        <section class="acard">
          <div class="acard-hd"><h4>用工档案</h4><span class="aux">由平台记录，不能修改</span></div>
          <dl>
            <div class="kv"><dt>姓名</dt><dd>{{ archive.realName ?? '未实名' }}</dd></div>
            <div class="kv"><dt>性别 / 年龄</dt><dd>{{ verified ? `${genderText} · ${archive.age ?? '—'} 岁` : '实名后显示' }}</dd></div>
            <div class="kv"><dt>当前状态</dt><dd>{{ label('UserStatus', archive.userStatus) }}</dd></div>
            <div class="kv"><dt>注册时间</dt><dd>{{ formatServerTime(archive.registeredAt, false) }}</dd></div>
          </dl>
          <router-link v-if="!verified" to="/kyc" class="link more">去完成实名认证<IconChevronRight :size="16" /></router-link>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>工作经历</h4></div>
          <p class="sec-t">当前在岗</p>
          <div v-if="archive.current">
            <p class="h-t">{{ archive.current.projectName || archive.current.jobTitle || archive.current.companyName }}</p>
            <p class="item-sub">{{ archive.current.companyName }}<template v-if="archive.current.jobTitle && archive.current.projectName"> · {{ archive.current.jobTitle }}</template></p>
            <p class="item-meta">{{ archive.current.startDate }} 入职 · 已 {{ archive.current.days }} 天</p>
          </div>
          <p v-else class="para">目前没有在岗的工作</p>

          <template v-if="archive.history.length">
            <p class="sec-t gap">历史项目</p>
            <ul class="hist">
              <li v-for="h in archive.history" :key="h.employmentId">
                <p class="h-t">{{ h.projectName || h.jobTitle || h.companyName }}</p>
                <p class="item-meta">{{ h.companyName }} · {{ h.startDate }} 至 {{ h.endDate }} · {{ h.days }} 天</p>
              </li>
            </ul>
          </template>

          <dl class="home-meta g3">
            <div><dt>报名次数</dt><dd>{{ archive.applicationCount }}</dd></div>
            <div><dt>请假天数</dt><dd>{{ archive.leaveDays }}</dd></div>
            <div><dt>旷工天数</dt><dd :class="{ bad: archive.absentDays > 0 }">{{ archive.absentDays }}</dd></div>
          </dl>
          <router-link to="/ledger" class="link more">查看完整台账<IconChevronRight :size="16" /></router-link>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>求职意向</h4><span class="aux">选填，可随时修改</span></div>

          <p class="lbl">期望工种</p>
          <div class="picks">
            <button v-for="t in JOB_TYPES" :key="t" type="button" class="chip-tap" :aria-pressed="form.expectJobTypes.includes(t)" @click="toggleType(t)">
              <span class="chip opt"><IconCheck v-if="form.expectJobTypes.includes(t)" :size="14" :stroke-width="2.5" />{{ label('JobType', t) }}</span>
            </button>
          </div>

          <van-cell-group :border="false" class="grp">
            <van-field
              v-model="regionDraft"
              class="ffield"
              :class="{ bad: errs.region }"
              :label="`期望工作地点（最多 ${MAX_REGIONS} 个）`"
              label-align="top"
              maxlength="20"
              placeholder="如 昆山、苏州工业园区"
              enterkeyhint="done"
              :error-message="errs.region"
              :border="false"
              @update:model-value="errs.region = ''"
              @keyup.enter="addRegion"
            >
              <template #button><button type="button" class="ffield-act" :disabled="!regionDraft.trim()" @click="addRegion">添加</button></template>
            </van-field>
            <div v-if="form.expectRegions.length" class="picks picked">
              <span v-for="r in form.expectRegions" :key="r" class="sel">
                <span class="chip opt on">{{ r }}</span>
                <button type="button" :aria-label="`删除 ${r}`" @click="removeFrom('expectRegions', r)"><IconX :size="14" /></button>
              </span>
            </div>

            <van-field
              v-model="form.workYears"
              class="ffield"
              :class="{ bad: errs.years }"
              label="工作年限（年）"
              label-align="top"
              type="digit"
              maxlength="2"
              placeholder="如 3"
              data-field="years"
              :error-message="errs.years"
              :border="false"
              @update:model-value="errs.years = ''"
            />
            <p class="fhint">没有工作过填 0</p>

            <van-field
              v-model="tagDraft"
              class="ffield"
              :class="{ bad: errs.tag }"
              :label="`技能标签（最多 ${MAX_TAGS} 个）`"
              label-align="top"
              maxlength="12"
              placeholder="如 叉车证、焊工证、会看图纸"
              enterkeyhint="done"
              :error-message="errs.tag"
              :border="false"
              @update:model-value="errs.tag = ''"
              @keyup.enter="addTag"
            >
              <template #button><button type="button" class="ffield-act" :disabled="!tagDraft.trim()" @click="addTag">添加</button></template>
            </van-field>
            <div v-if="form.skillTags.length" class="picks picked">
              <span v-for="t in form.skillTags" :key="t" class="sel">
                <span class="chip opt on">{{ t }}</span>
                <button type="button" :aria-label="`删除 ${t}`" @click="removeFrom('skillTags', t)"><IconX :size="14" /></button>
              </span>
            </div>

            <van-field
              v-model="form.intro"
              class="ffield"
              type="textarea"
              label="个人简介"
              label-align="top"
              rows="4"
              :maxlength="MAX_INTRO"
              show-word-limit
              placeholder="做过什么工作、擅长什么、对工作有什么要求"
              :border="false"
            />
          </van-cell-group>
        </section>

        <section class="acard">
          <div class="acard-hd"><h4>联系方式</h4><span class="aux">选填</span></div>
          <van-cell-group :border="false">
            <van-field
              v-model="form.wechatId"
              class="ffield"
              :class="{ bad: errs.wechat }"
              label="微信号"
              label-align="top"
              maxlength="40"
              placeholder="如 zhangsan_1990"
              autocapitalize="off"
              autocomplete="off"
              data-field="wechat"
              :error-message="errs.wechat"
              :border="false"
              @update:model-value="errs.wechat = ''"
            />
            <p class="fhint">方便驻场老师加你微信</p>
            <van-field v-model="form.emergencyName" class="ffield" label="紧急联系人" label-align="top" maxlength="20" placeholder="姓名，如 父亲 张建军" :border="false" />
            <van-field
              v-model="form.emergencyPhone"
              class="ffield"
              :class="{ bad: errs.phone }"
              label="紧急联系人手机号"
              label-align="top"
              type="tel"
              inputmode="numeric"
              maxlength="11"
              placeholder="11 位手机号"
              data-field="phone"
              :error-message="errs.phone"
              :border="false"
              @update:model-value="errs.phone = ''"
            />
          </van-cell-group>
          <p class="fhint">紧急联系人电话加密保存，只在你在岗期间出现工伤等紧急情况时使用。</p>
        </section>
        <div class="bottom-bar-gap" :class="{ tall: saveError }"></div>
      </div>

      <div class="bottom-bar">
        <p v-if="saveError" class="why" role="alert"><IconTriangleExclamationPoint :size="16" />没有保存成功：{{ saveError }}</p>
        <van-button type="primary" size="large" block :loading="saving" loading-text="保存中…" @click="save">保存简历</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rs { min-height: 100vh; --van-loading-spinner-color: var(--primary); }
.aux { font-size: var(--font-size-aux); color: var(--text-3); }
.more { min-height: 44px; margin-bottom: calc(var(--space-3) * -1); }
.sec-t, .lbl { font-size: var(--font-size-aux); font-weight: var(--font-weight-medium); line-height: 20px; color: var(--text-2); }
.sec-t { margin-bottom: var(--space-1); }
.sec-t.gap { margin-top: var(--space-4); }
.h-t { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); line-height: 22px; color: var(--text-1); overflow-wrap: anywhere; }
.hist li { padding: var(--space-2) 0; border-top: 1px solid var(--divider); }
.hist li:first-child { border-top: 0; padding-top: 0; }
.g3 { grid-template-columns: repeat(3, 1fr); }
.home-meta dt { font-size: var(--font-size-aux); color: var(--text-3); }
.home-meta dd { margin-top: 2px; font-size: var(--font-size-section); font-weight: var(--font-weight-semibold); color: var(--text-1); }
.home-meta dd.bad { color: var(--danger-text); }
/* 可选的小块复用 .chip-tap + .chip（外层 44 高的点击区）；这里只加大字号、描边和选中态，选中除了变色还带勾 */
.picks { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); margin-top: var(--space-1); }
.chip.opt { min-height: 32px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-card); font-size: var(--font-size-body); text-align: left; overflow-wrap: anywhere; }
.chip-tap[aria-pressed="true"] .opt, .opt.on { border-color: var(--primary); background: var(--primary-bg); color: var(--primary-text); font-weight: var(--font-weight-medium); }
.chip-tap:focus-visible .opt { outline: 2px solid var(--primary); outline-offset: 2px; }
/* 已选的地点和技能：只有「×」能删，它的点击区是 44×44，画在小块右边的留白里 */
.picked { gap: 0 var(--space-3); }
.sel { position: relative; display: inline-flex; align-items: center; max-width: 100%; min-height: 44px; }
.sel .opt { display: inline-flex; align-items: center; padding-right: 30px; }
.sel button { position: absolute; top: 0; right: -9px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; background: none; color: var(--primary-text); }
.grp { margin-top: var(--space-3); }
.grp .picked { margin-top: var(--space-1); }
.grp .picked + .ffield { margin-top: var(--space-2); }
.why { display: flex; justify-content: center; gap: var(--space-1); margin-bottom: var(--space-2); font-size: var(--font-size-aux); line-height: 20px; color: var(--danger-text); }
.why svg { flex: none; margin-top: 2px; }
.bottom-bar-gap.tall { height: calc(128px + env(safe-area-inset-bottom)); }
</style>
