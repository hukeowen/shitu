import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 每 interval 毫秒刷新一次的「当前时间戳」，用于倒计时显示 */
export function useNow(interval = 30_000) {
  const now = ref(Date.now())
  let timer: number | undefined
  onMounted(() => {
    timer = window.setInterval(() => {
      now.value = Date.now()
    }, interval)
  })
  onBeforeUnmount(() => window.clearInterval(timer))
  return now
}
