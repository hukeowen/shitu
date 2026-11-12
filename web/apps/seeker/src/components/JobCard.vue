<script setup lang="ts">
import { computed } from 'vue'
import { useDict, type MatchResultCard } from '@shitu/api-client'
import { IconBuildingComplex, IconMapPin, IconUsers } from '@shitu/ui-icons'
import { dormChips, fmtSalary, fmtScore, scoreVisible } from '@/utils/format'

/** S-16 匹配结果岗位卡：匹配度（≥80% 才显示）、薪资、吃住、班次、地点、剩余名额、推荐理由 */
const props = defineProps<{ job: MatchResultCard; top?: boolean }>()
const emit = defineEmits<{ open: [jobId: string] }>()
const { label } = useDict()

const chips = computed(() => [...dormChips(props.job), label('ShiftType', props.job.shiftType)])
</script>

<template>
  <article class="acard jc" @click="emit('open', job.jobId)">
    <div class="jc-hd">
      <h3>{{ job.title }}</h3>
      <span v-if="scoreVisible(job.matchScore)" class="status-tag status-tag--info">匹配度 {{ fmtScore(job.matchScore) }}%</span>
    </div>
    <!-- 岗位薪资录入的就是月综合薪资，所以每张卡都带「（综合）」 -->
    <p class="salary"><b>{{ fmtSalary(job.salaryMin, job.salaryMax) }}</b><span>元/月（综合）</span></p>
    <ul class="chips">
      <li v-for="c in chips" :key="c" class="chip">{{ c }}</li>
    </ul>
    <ul class="facts">
      <li v-if="job.city"><IconMapPin :size="18" />{{ job.city }}</li>
      <li :class="{ low: job.quotaRemaining <= 5 }"><IconUsers :size="18" />剩余 {{ job.quotaRemaining }} 个名额</li>
    </ul>
    <div v-if="job.reason" class="reason">
      <b>推荐理由</b>
      <p>{{ job.reason }}</p>
    </div>
    <p class="firm">
      <IconBuildingComplex :size="16" />
      <span>{{ job.address || job.city }}<template v-if="job.companyName"> · {{ job.companyName }}</template></span>
    </p>
    <van-button block :type="top ? 'primary' : 'default'" :class="{ second: !top }" @click.stop="emit('open', job.jobId)">查看并报名</van-button>
  </article>
</template>

<style scoped>
.jc { cursor: pointer; }
.jc-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.jc-hd h3 { min-width: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); line-height: 26px; color: var(--text-1); }
.jc-hd .status-tag { flex: none; margin-top: 2px; }
.facts { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-5); margin-top: var(--space-3); font-size: var(--font-size-body); color: var(--text-1); }
.facts li { display: flex; align-items: center; gap: var(--space-1); }
.facts svg { flex: none; color: var(--text-3); }
.facts .low, .facts .low svg { color: var(--warning-text); }
.reason { margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--primary-bg); font-size: var(--font-size-body); line-height: 22px; color: var(--text-1); }
.reason b { display: block; font-size: var(--font-size-aux); font-weight: var(--font-weight-semibold); color: var(--primary-text); }
.firm { display: flex; align-items: flex-start; gap: var(--space-2); margin: var(--space-3) 0; padding-top: var(--space-3); border-top: 1px solid var(--divider); font-size: var(--font-size-aux); line-height: 20px; color: var(--text-2); }
.firm svg { flex: none; margin-top: 2px; color: var(--text-3); }
.firm span { min-width: 0; }
.second { border-color: var(--primary-line); color: var(--primary-text); }
</style>
