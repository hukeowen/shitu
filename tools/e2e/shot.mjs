// 截图：node shot.mjs <name> <url> [mobile]   （Chrome 已以 --remote-debugging-port=9888 启动）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , name, url, mobile] = process.argv
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')
fs.mkdirSync(DIR, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tgt = await (await fetch('http://127.0.0.1:9888/json/new?about:blank', { method: 'PUT' })).json()
const ws = new WebSocket(tgt.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
await send('Network.clearBrowserCookies')
await send('Emulation.setDeviceMetricsOverride', mobile ? { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }
  : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(3000)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(DIR, name + '.png'), Buffer.from(shot.result.data, 'base64'))
if (errs.length) console.log('errors:', errs)
await fetch(`http://127.0.0.1:9888/json/close/${tgt.id}`)
ws.close()
await sleep(200)
process.exit(0)
