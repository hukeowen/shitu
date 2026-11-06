import { computed, onBeforeUnmount, ref } from 'vue'

/** 短信重发倒计时：start(retryAfterSeconds) 后 remaining 每秒递减 */
export function useSmsCountdown() {
  const remaining = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function start(seconds: number) {
    stop()
    remaining.value = Math.max(0, Math.round(seconds))
    if (remaining.value <= 0) return
    timer = setInterval(() => {
      remaining.value -= 1
      if (remaining.value <= 0) stop()
    }, 1000)
  }

  onBeforeUnmount(stop)

  return { remaining, counting: computed(() => remaining.value > 0), start, stop }
}
