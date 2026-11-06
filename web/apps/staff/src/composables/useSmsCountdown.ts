import { computed, onScopeDispose, ref } from 'vue'

/** 获取验证码按钮的重发倒计时（秒数以后端 retryAfterSeconds 为准） */
export function useSmsCountdown() {
  const seconds = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  let endAt = 0

  function stop() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  function start(sec: number) {
    stop()
    // 以截止时间计算，避免切后台后 setInterval 被节流导致倒计时变慢
    endAt = Date.now() + Math.max(1, sec) * 1000
    seconds.value = Math.max(1, sec)
    timer = setInterval(() => {
      seconds.value = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      if (seconds.value <= 0) stop()
    }, 500)
  }

  onScopeDispose(stop)
  return { seconds, counting: computed(() => seconds.value > 0), start }
}
