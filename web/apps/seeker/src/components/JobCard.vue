<script setup lang="ts">
import { computed } from 'vue'
import { useDict, type MatchResultCard } from '@shitu/api-client'
import { dormChips, fmtSalary, fmtScore, scoreClass } from '@/utils/format'

/** S-16 匹配结果岗位卡：匹配度、薪资、吃住、班次、地点、剩余名额、推荐理由 */
const props = defineProps<{ job: MatchResultCard; top?: boolean }>()
const emit = defineEmits<{ open: [jobId: string] }>()
const { label } = useDict()

const chips = computed(() => {
  const j = props.job
  const out = dormChips(j)
  out.push(label('ShiftType', j.shiftType))
  if (j.city) out.push(j.city)
  return out
})
</script>

<template>
  <article class="job" :class="{ top }" role="button" tabindex="0" @click="emit('open', job.jobId)" @keydown.enter="emit('open', job.jobId)">
    <div class="job-top">
      <div class="job-title">
        <b>{{ job.title }}</b>
        <div class="match" :class="scoreClass(job.matchScore)">
          <div class="mv">{{ fmtScore(job.matchScore) }}%</div>
          <div class="ml">MATCH</div>
        </div>
      </div>
      <div class="job-sal">{{ fmtSalary(job.salaryMin, job.salaryMax) }}<small>元 / 月（综合）</small></div>
      <div class="chips">
        <span v-for="c in chips" :key="c" class="chip">{{ c }}</span>
        <span class="chip" :class="{ 'chip-warn': job.quotaRemaining <= 5 }">剩余 {{ job.quotaRemaining }} 个名额</span>
      </div>
      <div v-if="job.reason" class="reason">
        <div class="t-xs rt">推荐理由</div>
        <div class="t-xs rd">{{ job.reason }}</div>
      </div>
    </div>
    <div class="job-ft">
      <span class="co">{{ job.address || job.city }}<template v-if="job.companyName"> · {{ job.companyName }}</template></span>
      <span class="go" :class="{ pri: top }">查看并报名</span>
    </div>
  </article>
</template>

<style scoped>
.job { cursor: pointer; }
.job:active { background: var(--surface-3); }
.job.top { border-color: var(--ok-line); border-width: 1.5px; }
.reason { margin-top: 9px; padding: 8px 10px; background: var(--ok-bg); border-radius: var(--r-sm); }
.reason .rt { color: var(--ok); font-weight: 600; }
.reason .rd { color: var(--ok); margin-top: 2px; line-height: 1.55; }
.chip-warn { color: var(--warn); background: var(--warn-bg); border-color: var(--warn-line); }
.go { flex: none; height: 28px; line-height: 26px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--surface); font-size: 12px; font-weight: 600; color: var(--ink-800); }
.go.pri { background: var(--signal); border-color: var(--signal); color: #fff; }
</style>
