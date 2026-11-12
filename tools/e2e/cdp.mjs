// 通过 Chrome 调试端口开一个标签页：发指令、收集页面问题、等页面安静。shot.mjs / shots.mjs / ui-smoke.mjs 共用。
// 需要 Chrome 以 --remote-debugging-port=9888 启动（端口可用环境变量 CDP_PORT 改）。
const PORT = Number(process.env.CDP_PORT ?? 9888)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** viewport 见 routes.mjs 的 VIEWPORT。events 里累积 JS 异常、console.error 和 ≥ 400 的接口，换页前自己清空。 */
export async function openTab(viewport, { timezone = 'Asia/Shanghai' } = {}) {
  const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(tgt.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const events = []
  const inflight = new Set()
  let lastActivity = Date.now()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Network.requestWillBeSent') { inflight.add(m.params.requestId); lastActivity = Date.now() }
    else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') { inflight.delete(m.params.requestId); lastActivity = Date.now() }
    else if (m.method === 'Runtime.exceptionThrown') {
      events.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0].slice(0, 200))
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      events.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')[0].slice(0, 200))
    } else if (m.method === 'Network.responseReceived') {
      const r = m.params.response
      if (r.url.includes('/api/') && r.status >= 400 && !r.url.includes('/auth/refresh')) events.push(`http ${r.status}: ${r.url.replace(/^https?:\/\/[^/]+/, '')}`)
    }
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', viewport)
  await send('Emulation.setTimezoneOverride', { timezoneId: timezone })
  /** 等页面安静下来：没有进行中的请求并且 600ms 内没有新请求，最多等 10 秒。 */
  const settle = async () => {
    const start = Date.now()
    await sleep(800)
    while (Date.now() - start < 10000 && (inflight.size > 0 || Date.now() - lastActivity < 600)) await sleep(100)
    await sleep(400) // 留给过渡动画
  }
  const close = async () => { await fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`); ws.close() }
  return { send, events, settle, close }
}
