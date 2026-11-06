<script setup lang="ts">
import { computed } from 'vue'

/** 表格里的人员单元格：头像字 + 脱敏姓名 + 副标题 */
const props = defineProps<{ name?: string | null; sub?: string | null; accent?: boolean }>()
const initial = computed(() => (props.name && props.name !== '未实名' ? props.name.slice(0, 1) : '?'))
</script>

<template>
  <div class="person">
    <div class="av" :class="{ 'av--o': accent }">{{ initial }}</div>
    <div style="min-width: 0">
      <b>{{ name || '—' }}</b>
      <div v-if="sub" class="t-xs">{{ sub }}</div>
    </div>
  </div>
</template>
