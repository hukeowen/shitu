<script setup lang="ts">
import { computed } from 'vue'

/** 表格里的人员单元格：头像字 + 姓名（按接口返回，不在前端二次脱敏）+ 副标题（手机号 / 编号，单行不折行，放不下省略并悬停显示全文） */
const props = defineProps<{ name?: string | null; sub?: string | null; accent?: boolean; mono?: boolean }>()
const initial = computed(() => (props.name && props.name !== '未实名' ? props.name.slice(0, 1) : '?'))
</script>

<template>
  <div class="person">
    <div class="av" :class="{ 'av--o': accent }">{{ initial }}</div>
    <div style="min-width: 0">
      <b :title="name ?? undefined">{{ name || '—' }}</b>
      <div v-if="sub" class="t-xs" :class="{ mono }" :title="sub">{{ sub }}</div>
    </div>
  </div>
</template>
