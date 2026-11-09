import { shNowMs } from '@/utils/time'
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 每 intervalMs 刷新一次的「当前时间」，用于倒计时显示（页面隐藏时不刷新） */
export function useNow(intervalMs = 30_000) {
  const now = ref(shNowMs())
  let timer: ReturnType<typeof setInterval> | undefined
  const tick = () => {
    now.value = shNowMs()
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  onMounted(() => {
    timer = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  })
  return now
}
