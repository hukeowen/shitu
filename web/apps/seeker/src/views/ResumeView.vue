<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { showToast } from 'vant'
import { errorMessage, seekerApi, useDict, type ResumeArchive } from '@shitu/api-client'
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
function addTo(list: 'expectRegions' | 'skillTags', draft: { value: string }, max: number, maxLen: number, what: string) {
  const v = draft.value.trim()
  if (!v) return
  if (v.length > maxLen) return void showToast(`${what}不超过 ${maxLen} 个字`)
  if (form[list].includes(v)) return void (draft.value = '')
  if (form[list].length >= max) return void showToast(`${what}最多 ${max} 个`)
  form[list] = [...form[list], v]
  draft.value = ''
}
const addRegion = () => addTo('expectRegions', regionDraft, MAX_REGIONS, 20, '期望地点')
const addTag = () => addTo('skillTags', tagDraft, MAX_TAGS, 12, '技能标签')
function removeFrom(list: 'expectRegions' | 'skillTags', v: string) {
  form[list] = form[list].filter((x) => x !== v)
}

async function save() {
  // 输入框里还没点「添加」的内容一并收进来
  addRegion()
  addTag()
  const phone = form.emergencyPhone.trim()
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) return void showToast('紧急联系人手机号格式不正确')
  const wechat = form.wechatId.trim()
  if (wechat && !/^[A-Za-z0-9_-]{5,40}$/.test(wechat)) return void showToast('微信号只能包含字母、数字、下划线和减号')
  const years = form.workYears.trim()
  if (years && !/^\d{1,2}$/.test(years)) return void showToast('工作年限请填 0 到 50 的整数')
  if (years && Number(years) > 50) return void showToast('工作年限请填 0 到 50 的整数')
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
    showToast(errorMessage(e, '保存失败，请稍后重试'))
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
    <div v-else-if="loadError" class="page-state">
      <van-empty image="error" :description="loadError">
        <van-button round type="primary" size="small" @click="load">重新加载</van-button>
      </van-empty>
    </div>

    <div v-else-if="archive" class="pad stack">
      <section class="acard">
        <div class="acard-hd"><h4>用工档案</h4><span class="t-xs">由平台记录，不能修改</span></div>
        <dl class="kvs">
          <div class="kv"><dt>姓名</dt><dd>{{ archive.realName ?? '未实名' }}</dd></div>
          <div class="kv"><dt>性别 / 年龄</dt><dd>{{ verified ? `${genderText} · ${archive.age ?? '—'} 岁` : '实名后显示' }}</dd></div>
          <div class="kv"><dt>当前状态</dt><dd>{{ label('UserStatus', archive.userStatus) }}</dd></div>
          <div class="kv"><dt>注册时间</dt><dd class="num">{{ formatServerTime(archive.registeredAt, false) }}</dd></div>
        </dl>
        <router-link v-if="!verified" to="/kyc" class="t-sm lnk">去完成实名认证 ›</router-link>

        <div class="divider" style="margin: 12px 0"></div>
        <div class="sec-t">当前在岗</div>
        <div v-if="archive.current" class="cur">
          <b>{{ archive.current.projectName || archive.current.jobTitle || archive.current.companyName }}</b>
          <div class="t-sm">{{ archive.current.companyName }}<template v-if="archive.current.jobTitle && archive.current.projectName"> · {{ archive.current.jobTitle }}</template></div>
          <div class="t-xs num">{{ archive.current.startDate }} 入职 · 已 {{ archive.current.days }} 天</div>
        </div>
        <p v-else class="t-sm mute">目前没有在岗的工作</p>

        <template v-if="archive.history.length">
          <div class="sec-t" style="margin-top: 12px">历史项目</div>
          <ul class="hist">
            <li v-for="h in archive.history" :key="h.employmentId">
              <b>{{ h.projectName || h.jobTitle || h.companyName }}</b>
              <span class="t-xs num">{{ h.companyName }} · {{ h.startDate }} 至 {{ h.endDate }} · {{ h.days }} 天</span>
            </li>
          </ul>
        </template>

        <div class="divider" style="margin: 12px 0"></div>
        <div class="stats">
          <div><b class="num">{{ archive.applicationCount }}</b><span>报名次数</span></div>
          <div><b class="num">{{ archive.leaveDays }}</b><span>请假天数</span></div>
          <div><b class="num" :class="{ bad: archive.absentDays > 0 }">{{ archive.absentDays }}</b><span>旷工天数</span></div>
        </div>
        <router-link to="/ledger" class="t-sm lnk">查看完整台账 ›</router-link>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>求职意向</h4><span class="t-xs">选填，可随时修改</span></div>

        <div class="lbl">期望工种</div>
        <div class="chips">
          <button v-for="t in JOB_TYPES" :key="t" type="button" class="chip" :class="{ on: form.expectJobTypes.includes(t) }" @click="toggleType(t)">{{ label('JobType', t) }}</button>
        </div>

        <div class="lbl gap">期望工作地点（最多 {{ MAX_REGIONS }} 个）</div>
        <div v-if="form.expectRegions.length" class="chips picked">
          <span v-for="r in form.expectRegions" :key="r" class="chip on">{{ r }}<button type="button" :aria-label="`删除 ${r}`" @click="removeFrom('expectRegions', r)"><van-icon name="cross" size="11" /></button></span>
        </div>
        <div class="adder">
          <input v-model="regionDraft" class="inp" maxlength="20" placeholder="如 昆山、苏州工业园区" enterkeyhint="done" @keyup.enter="addRegion" />
          <button type="button" class="add" :disabled="!regionDraft.trim()" @click="addRegion">添加</button>
        </div>

        <div class="lbl gap">工作年限（年）</div>
        <input v-model="form.workYears" class="inp" type="tel" inputmode="numeric" maxlength="2" placeholder="如 3；没有工作过填 0" />

        <div class="lbl gap">技能标签（最多 {{ MAX_TAGS }} 个）</div>
        <div v-if="form.skillTags.length" class="chips picked">
          <span v-for="t in form.skillTags" :key="t" class="chip on">{{ t }}<button type="button" :aria-label="`删除 ${t}`" @click="removeFrom('skillTags', t)"><van-icon name="cross" size="11" /></button></span>
        </div>
        <div class="adder">
          <input v-model="tagDraft" class="inp" maxlength="12" placeholder="如 叉车证、焊工证、会看图纸" enterkeyhint="done" @keyup.enter="addTag" />
          <button type="button" class="add" :disabled="!tagDraft.trim()" @click="addTag">添加</button>
        </div>

        <div class="lbl gap">个人简介</div>
        <textarea v-model="form.intro" class="ta" rows="4" :maxlength="MAX_INTRO" placeholder="做过什么工作、擅长什么、对工作有什么要求"></textarea>
        <div class="cnt t-xs">{{ form.intro.length }} / {{ MAX_INTRO }}</div>
      </section>

      <section class="acard">
        <div class="acard-hd"><h4>联系方式</h4><span class="t-xs">选填</span></div>
        <div class="lbl">微信号</div>
        <input v-model="form.wechatId" class="inp" maxlength="40" placeholder="方便驻场老师加你微信" autocapitalize="off" autocomplete="off" />
        <div class="lbl gap">紧急联系人</div>
        <input v-model="form.emergencyName" class="inp" maxlength="20" placeholder="姓名，如 父亲 张建军" />
        <input v-model="form.emergencyPhone" class="inp" style="margin-top: 8px" type="tel" inputmode="numeric" maxlength="11" placeholder="紧急联系人手机号" />
        <p class="t-xs tip">紧急联系人电话加密保存，只在你在岗期间出现工伤等紧急情况时使用。</p>
      </section>

      <van-button block type="primary" class="submit" :loading="saving" loading-text="保存中…" @click="save">保存简历</van-button>
      <div class="page-bottom-gap"></div>
    </div>
  </div>
</template>

<style scoped>
.rs { min-height: 100vh; background: var(--surface-2); }
.kvs { margin: 0; }
.sec-t { font-size: 12.5px; font-weight: 600; color: var(--ink-500); margin-bottom: 6px; }
.cur b { font-size: 14.5px; color: var(--ink-900); }
.cur .t-sm { margin-top: 2px; color: var(--ink-700); }
.cur .t-xs { margin-top: 3px; color: var(--ink-500); }
.mute { color: var(--ink-500); }
.hist { list-style: none; margin: 0; padding: 0; }
.hist li { padding: 7px 0; border-top: 1px solid var(--line); }
.hist li:first-child { border-top: 0; padding-top: 0; }
.hist b { display: block; font-size: 13.5px; color: var(--ink-800); }
.hist span { display: block; margin-top: 2px; color: var(--ink-500); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; text-align: center; }
.stats b { display: block; font-size: 20px; color: var(--ink-900); }
.stats b.bad { color: var(--danger); }
.stats span { display: block; margin-top: 2px; font-size: 11.5px; color: var(--ink-500); }
.lnk { display: inline-block; margin-top: 12px; color: var(--signal-700); }
.lbl { font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 8px; }
.lbl.gap { margin-top: 16px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips.picked { margin-bottom: 8px; }
.chip { display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); font-size: 13px; color: var(--ink-700); }
.chip.on { border-color: var(--signal); background: var(--signal-50); color: var(--signal-700); font-weight: 600; }
.chip button { display: grid; place-items: center; width: 22px; height: 22px; margin-right: -8px; border: 0; background: none; color: inherit; padding: 0; }
.adder { display: flex; gap: 8px; }
.adder .inp { flex: 1; min-width: 0; }
.add { flex: none; height: 46px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface); font-size: 14px; color: var(--ink-800); }
.add:disabled { color: var(--ink-400); }
.ta, .inp { width: 100%; box-sizing: border-box; border: 1.5px solid transparent; border-radius: 12px; background: var(--surface-2); padding: 11px 12px; font-size: 14px; line-height: 1.7; color: var(--ink-900); outline: none; font-family: inherit; transition: border-color .15s, background .15s; }
.ta { resize: none; }
.inp { height: 46px; }
.ta:focus, .inp:focus { background: var(--surface); border-color: var(--signal); }
.cnt { text-align: right; margin-top: 4px; color: var(--ink-400); }
.tip { margin-top: 8px; line-height: 1.7; color: var(--ink-500); }
.submit { height: 48px; border-radius: 14px; font-size: 16px; font-weight: 700; }
</style>
