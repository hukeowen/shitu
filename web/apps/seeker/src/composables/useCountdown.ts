import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * 截止时间倒计时（24h 专属响应窗口等）。target 为毫秒时间戳，null 表示无倒计时。
 * 到期时回调 onExpire（一般用于刷新状态）。
 */
export function useCountdown(target: Ref<number | null>, onExpire?: () => void) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  const remaining = computed(() => (target.value == null ? 0 : Math.max(0, target.value - now.value)))
  const active = computed(() => target.value != null && remaining.value > 0)

  const text = computed(() => {
    const total = Math.floor(remaining.value / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const p = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
  })
  const hours = computed(() => Math.floor(remaining.value / 3600000))

  function stop() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  watch(
    target,
    (t) => {
      stop()
      now.value = Date.now()
      if (t == null || t <= now.value) return
      timer = setInterval(() => {
        now.value = Date.now()
        if (target.value != null && now.value >= target.value) {
          stop()
          onExpire?.()
        }
      }, 1000)
    },
    { immediate: true },
  )

  onScopeDispose(stop)
  return { remaining, active, text, hours }
}
