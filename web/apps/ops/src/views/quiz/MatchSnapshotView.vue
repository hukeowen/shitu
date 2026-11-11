<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage, isApiError, opsApi, useDict, type MatchSnapshot } from '@shitu/api-client'
import { fmtDateTimeSec, prettyJson } from '@/utils/format'

/** 匹配快照：按 sessionId 回放一次匹配（题库 / 引擎版本、答案、画像、各岗位因子得分） */
const route = useRoute()
const router = useRouter()
const { label } = useDict()

const input = ref(typeof route.query.sessionId === 'string' ? route.query.sessionId : '')
const snap = shallowRef<MatchSnapshot | null>(null)
const loading = ref(false)
const error = ref('')

async function lookup(id: string) {
  const sid = id.trim()
  if (!sid) {
    snap.value = null
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  try {
    snap.value = await opsApi.matchSnapshot(sid)
  } catch (e) {
    snap.value = null
    error.value = isApiError(e) && e.status === 404 ? `未找到匹配会话「${sid}」` : errorMessage(e, '查询失败')
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
      <div class="spacer" />
    </div>

    <div class="card">
      <div class="toolbar">
        <el-input v-model="input" clearable placeholder="匹配会话 ID（sessionId）" class="mono" style="width: 340px" @keyup.enter="submit" @clear="submit" />
        <el-button type="primary" :loading="loading" @click="submit">查询</el-button>
        <span class="t-xs">sessionId 来自 C 端匹配结果 / 审计日志</span>
      </div>

      <div v-if="loading && !snap" v-loading="true" class="box" />
      <el-empty v-else-if="error" :image-size="64" :description="error" />
      <el-empty v-else-if="!snap" :image-size="64" description="输入 sessionId 查询匹配快照" />

      <div v-else-if="s" class="card__bd">
        <div class="sec-title">会话</div>
        <dl class="kv-grid">
          <div class="kv"><dt>sessionId</dt><dd class="mono">{{ s.sessionId }}</dd></div>
          <div class="kv"><dt>用户</dt><dd class="mono">{{ s.userId }}</dd></div>
          <div class="kv"><dt>结果</dt><dd><span class="tag" :class="s.status === 'MATCHED' ? 'tag--ok' : 'tag--warn'">{{ s.status === 'MATCHED' ? '已匹配' : '无 ≥80% 岗位' }}</span></dd></div>
          <div class="kv"><dt>开始时间</dt><dd class="mono">{{ fmtDateTimeSec(s.startedAt) }}</dd></div>
          <div class="kv"><dt>题库版本</dt><dd><router-link :to="`/engine/quiz/${s.quizVersionId}`" class="mono">v{{ s.quizVersionId }}</router-link></dd></div>
          <div class="kv"><dt>引擎版本</dt><dd class="mono">v{{ s.engineVersionId }}</dd></div>
          <div class="kv"><dt>匹配范围</dt><dd>{{ scopeText(s.scope) }} <span class="mono dim">{{ s.scope }}</span></dd></div>
          <div class="kv"><dt>限定公司</dt><dd class="mono">{{ s.scopeCompanyId ?? '—' }}</dd></div>
        </dl>

        <div class="grid g-2 json">
          <div>
            <div class="sec-title">答案 answers</div>
            <pre class="codeblk">{{ prettyJson(s.answers) || '—' }}</pre>
          </div>
          <div>
            <div class="sec-title">画像 profile</div>
            <pre class="codeblk">{{ prettyJson(s.profile) || '—' }}</pre>
          </div>
        </div>

        <div class="sec-title">候选岗位 <small>{{ results.length }} 个，展示 {{ displayedCount }} 个</small></div>
        <el-table :data="results" class="ops-table" row-key="jobId" :row-class-name="({ row }) => (row.displayed ? '' : 'is-dim')">
          <el-table-column label="排名" width="64">
            <template #default="{ row }"><span class="mono strong">#{{ row.rankNo }}</span></template>
          </el-table-column>
          <el-table-column label="岗位 ID" min-width="150">
            <template #default="{ row }"><span class="mono t-sm">{{ row.jobId }}</span></template>
          </el-table-column>
          <el-table-column label="匹配度" width="80" align="right">
            <template #default="{ row }"><span class="mono" :class="{ strong: row.matchScore >= 80 }">{{ row.matchScore }}</span></template>
          </el-table-column>
          <el-table-column label="岗位权重" width="90" align="right">
            <template #default="{ row }"><span class="mono">{{ row.jobWeight }}</span></template>
          </el-table-column>
          <el-table-column label="排序分" width="90" align="right">
            <template #default="{ row }"><span class="mono">{{ row.sortScore }}</span></template>
          </el-table-column>
          <el-table-column label="展示" width="70">
            <template #default="{ row }"><span class="tag" :class="row.displayed ? 'tag--ok' : ''">{{ row.displayed ? '是' : '否' }}</span></template>
          </el-table-column>
          <el-table-column label="推荐理由" min-width="200">
            <template #default="{ row }"><span class="t-sm">{{ row.reasonText ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="因子得分" min-width="220">
            <template #default="{ row }">
              <pre class="factors">{{ prettyJson(row.factorScores) || '—' }}</pre>
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="56" description="没有候选岗位（硬过滤后为空）" /></template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.box { height: 240px; }
.json { margin-top: 4px; }
.json .codeblk { max-height: 320px; }
.factors { margin: 0; font-family: var(--f-mono); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--ink-700); }
:deep(.is-dim) { color: var(--ink-400); }
</style>
