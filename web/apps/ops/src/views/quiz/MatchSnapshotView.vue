<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, opsApi, useDict, type MatchSnapshot } from '@shitu/api-client'
import { IconInbox, IconSearch, IconTriangleExclamationPoint } from '@shitu/ui-icons'
import { isNetwork } from '@/composables/boxSubmit'
import { fmtDateTimeSec, prettyJson } from '@/utils/format'

/** 匹配快照：按 sessionId 回放一次匹配（题库 / 引擎版本、答案、画像、各岗位因子得分） */
const route = useRoute()
const router = useRouter()
const { label } = useDict()

const input = ref(typeof route.query.sessionId === 'string' ? route.query.sessionId : '')
const snap = shallowRef<MatchSnapshot | null>(null)
const loading = ref(false)
/** 查不到（写明原因）和查询失败（断网与否分文案、给「重新加载」）分开 */
const notFound = ref('')
const error = ref('')
const offline = ref(false)
const asked = ref('')

async function lookup(id: string) {
  const sid = id.trim()
  asked.value = sid
  notFound.value = ''
  error.value = ''
  offline.value = false
  // 换了会话就不留上一次的结果
  snap.value = null
  if (!sid) return
  loading.value = true
  try {
    snap.value = await opsApi.matchSnapshot(sid)
  } catch (e) {
    if (isApiError(e) && e.status === 404) notFound.value = `没有会话 ID 为「${sid}」的匹配记录，请核对是否完整（如 MS2026111200002）`
    else {
      error.value = errorMessage(e, '查询失败')
      offline.value = isNetwork(e)
    }
  } finally {
    loading.value = false
  }
}

function submit() {
  const sid = input.value.trim()
  if (sid === route.query.sessionId) void lookup(sid)
  else void router.replace({ query: sid ? { sessionId: sid } : {} })
}
watch(
  () => route.query.sessionId,
  (v) => {
    const sid = typeof v === 'string' ? v : ''
    input.value = sid
    void lookup(sid)
  },
  { immediate: true },
)

const s = computed(() => snap.value?.session)
const results = computed(() => [...(snap.value?.results ?? [])].sort((a, b) => a.rankNo - b.rankNo))
const displayedCount = computed(() => results.value.filter((r) => r.displayed).length)
const scopeText = (v: string) => label('MatchScope', v)
</script>

<template>
  <div>
    <div class="page-hd">
      <div><h2>匹配快照查询</h2><p>每次 AI 问薪匹配都会保存快照：使用的题库 / 引擎版本、答案、画像以及每个候选岗位的因子得分，用于解释推荐结果与投诉复核</p></div>
    </div>

    <div class="card query">
      <div class="query-row">
        <el-input v-model="input" clearable placeholder="匹配会话 ID（sessionId）" class="query-input" @keyup.enter="submit" @clear="submit" />
        <el-button type="primary" :loading="loading" @click="submit">查询</el-button>
        <span class="t-xs">sessionId 来自 C 端匹配结果 / 审计日志</span>
      </div>
    </div>

    <div v-loading="loading" class="card result">
      <div v-if="loading" class="result-wait" />
      <div v-else-if="notFound" class="state-box">
        <IconInbox :size="48" />
        <h4>没有找到这次匹配</h4>
        <p>{{ notFound }}</p>
      </div>
      <div v-else-if="error" class="state-box">
        <IconTriangleExclamationPoint :size="48" />
        <h4>查询失败</h4>
        <p>{{ offline ? '请检查网络后重新加载' : error }}</p>
        <el-button type="primary" @click="lookup(asked)">重新加载</el-button>
      </div>
      <div v-else-if="!snap" class="state-box">
        <IconSearch :size="48" />
        <h4>输入 sessionId 查询匹配快照</h4>
        <p>查到后回放这次匹配用的题库和引擎版本、答案、画像和每个候选岗位的得分</p>
      </div>

      <div v-else-if="s" class="card__bd">
        <section class="blk">
          <h3 class="blk-t">会话</h3>
          <dl class="desc-list">
            <div><dt>sessionId</dt><dd>{{ s.sessionId }}</dd></div>
            <div><dt>用户</dt><dd>{{ s.userId }}</dd></div>
            <div><dt>结果</dt><dd><span class="status-tag" :class="s.status === 'MATCHED' ? 'status-tag--success' : 'status-tag--warning'">{{ s.status === 'MATCHED' ? '已匹配' : '无 ≥80% 岗位' }}</span></dd></div>
            <div><dt>开始时间</dt><dd>{{ fmtDateTimeSec(s.startedAt) }}</dd></div>
            <div><dt>题库版本</dt><dd><router-link :to="`/engine/quiz/${s.quizVersionId}`" class="lnk">v{{ s.quizVersionId }}</router-link></dd></div>
            <div><dt>引擎版本</dt><dd>v{{ s.engineVersionId }}</dd></div>
            <div><dt>匹配范围</dt><dd>{{ scopeText(s.scope) }} <span class="dim">{{ s.scope }}</span></dd></div>
            <div><dt>限定公司</dt><dd>{{ s.scopeCompanyId ?? '—' }}</dd></div>
          </dl>
        </section>

        <section class="blk grid g-2 json">
          <div>
            <h3 class="blk-t">答案 <small>answers</small></h3>
            <pre class="codeblk">{{ prettyJson(s.answers) || '—' }}</pre>
          </div>
          <div>
            <h3 class="blk-t">画像 <small>profile</small></h3>
            <pre class="codeblk">{{ prettyJson(s.profile) || '—' }}</pre>
          </div>
        </section>

        <section class="blk">
          <h3 class="blk-t">候选岗位 <small>{{ results.length }} 个，展示 {{ displayedCount }} 个</small></h3>
          <el-table :data="results" class="ops-table tbl-48" row-key="jobId" :row-class-name="({ row }) => (row.displayed ? '' : 'is-dim')">
            <el-table-column label="排名" width="64">
              <template #default="{ row }"><b class="rank">#{{ row.rankNo }}</b></template>
            </el-table-column>
            <el-table-column label="岗位 ID" min-width="150"><template #default="{ row }">{{ row.jobId }}</template></el-table-column>
            <el-table-column label="匹配度" width="80" align="right">
              <template #default="{ row }"><span class="sc" :class="{ hi: row.matchScore >= 80 }">{{ row.matchScore }}</span></template>
            </el-table-column>
            <el-table-column label="岗位权重" width="90" align="right"><template #default="{ row }"><span class="sc">{{ row.jobWeight }}</span></template></el-table-column>
            <el-table-column label="排序分" width="90" align="right"><template #default="{ row }"><span class="sc">{{ row.sortScore }}</span></template></el-table-column>
            <el-table-column label="展示" width="70">
              <template #default="{ row }"><span class="status-tag" :class="row.displayed ? 'status-tag--success' : ''">{{ row.displayed ? '是' : '否' }}</span></template>
            </el-table-column>
            <el-table-column label="推荐理由" min-width="180"><template #default="{ row }">{{ row.reasonText ?? '—' }}</template></el-table-column>
            <el-table-column label="因子得分" min-width="220">
              <template #default="{ row }"><pre class="factors">{{ prettyJson(row.factorScores) || '—' }}</pre></template>
            </el-table-column>
            <template #empty>
              <div class="state-box"><IconInbox :size="48" /><h4>没有候选岗位</h4><p>硬过滤后为空，没有可打分的岗位</p></div>
            </template>
          </el-table>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.query { padding: var(--space-4); }
.query-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.query-input { width: 340px; }
.result { margin-top: var(--space-gap); }
.result-wait { height: 240px; }
.json { gap: var(--space-4); }
.json .codeblk { max-height: 320px; }
.lnk { color: var(--primary-text); text-decoration: none; }
.lnk:hover { text-decoration: underline; }
.rank { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.sc { font-variant-numeric: tabular-nums; }
.sc.hi { font-weight: var(--font-weight-semibold); color: var(--text-1); }
.factors { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-min); line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--text-2); }
:deep(.is-dim) { color: var(--text-3); }
</style>
