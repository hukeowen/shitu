import { computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useMatchStore } from '@/stores/match'

/**
 * 问薪相关页面公用：把问薪暂存绑定到当前用户；给出锁定态（R-03：报名后面试结果出来前不能重新匹配）。
 */
export function useMatchSession() {
  const auth = useAuthStore()
  const match = useMatchStore()

  watch(
    () => auth.profile?.userId,
    (id) => {
      if (id) match.bind(id)
    },
    { immediate: true },
  )

  const profile = computed(() => auth.profile)
  const locked = computed(() => !!profile.value && !profile.value.canStartMatching)
  /** 报名后的锁定（待面试 / 待确权） */
  const appliedLock = computed(() => profile.value?.status === 'PENDING_INTERVIEW' || profile.value?.status === 'PENDING_CONFIRM')
  const lockText = computed(() =>
    appliedLock.value ? '你已报名岗位，面试结果出来前不能重新匹配' : '当前状态暂不能发起匹配',
  )

  return { auth, match, profile, locked, appliedLock, lockText }
}
