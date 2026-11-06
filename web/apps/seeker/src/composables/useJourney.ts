import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useJourneyStore } from '@/stores/journey'

/** 绑定入职数据到当前用户（换号登录时丢弃旧数据） */
export function useJourney() {
  const auth = useAuthStore()
  const journey = useJourneyStore()
  watch(() => auth.profile?.userId, (id) => journey.bind(id), { immediate: true })
  return journey
}
