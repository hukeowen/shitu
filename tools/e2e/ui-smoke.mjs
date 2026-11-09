// 浏览器冒烟：用真实会话逐个打开菜单路由，收集 JS 异常、console.error、接口 ≥ 400 与页面上的错误提示。
// 用法：node ui-smoke.mjs   （需要：Chrome 已以 --remote-debugging-port=9888 启动；console 5175、ops 5176 的 vite dev 在跑）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(DIR, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = Number(process.env.CDP_PORT ?? 9888)

const menuPaths = (app) => [...fs.readFileSync(path.join(DIR, `../../web/apps/${app}/src/router/menu.ts`), 'utf8')
  .matchAll(/path: '([^']+)'/g)].map((m) => m[1])

const routePaths = (app) => [...new Set([...fs.readFileSync(path.join(DIR, `../../web/apps/${app}/src/router/index.ts`), 'utf8')
  .matchAll(/path: '([^':]+)'/g)].map((m) => m[1]).filter((p) => p !== '/login'))]

/** 新注册一个求职者，返回 refresh cookie 值（写入临时文件）。 */
async function freshSeekerCookie() {
  const ph = '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  const api = 'http://localhost:8080/api/v1'
  const s = await (await fetch(api + '/seeker/auth/sms-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) })).json()
  const r = await fetch(api + '/seeker/auth/sms-login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: ph, code: s.data.devCode, channelCode: 'qYAtWMU9' }) })
  const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
  fs.writeFileSync(path.join(DIR, 'seeker.rt'), m[1])
}
await freshSeekerCookie()

const SUITES = [
  { name: 'ops-super', base: 'http://127.0.0.1:5176', cookieFile: 'ops.cookies', cookiePath: '/api/v1/ops/auth', paths: menuPaths('ops') },
  { name: 'console-owner', base: 'http://127.0.0.1:5175', cookieFile: 'tenant-13800000001.rt', cookiePath: '/api/v1/tenant/auth', paths: menuPaths('console') },
  { name: 'console-pm', base: 'http://127.0.0.1:5175', cookieFile: 'tenant-13800000002.rt', cookiePath: '/api/v1/tenant/auth', paths: menuPaths('console') },
  { name: 'console-site', base: 'http://127.0.0.1:5175', cookieFile: 'tenant-13800000003.rt', cookiePath: '/api/v1/tenant/auth', paths: menuPaths('console') },
  { name: 'staff-site', base: 'http://127.0.0.1:5184', cookieFile: 'tenant-13800000003.rt', cookiePath: '/api/v1/tenant/auth', paths: routePaths('staff'), mobile: true },
  { name: 'seeker-new', base: 'http://127.0.0.1:5183', cookieFile: 'seeker.rt', cookiePath: '/api/v1/seeker/auth', paths: routePaths('seeker'), mobile: true },
]

function readRt(file) {
  const t = fs.readFileSync(path.join(DIR, file), 'utf8')
  const line = t.split('\n').find((l) => l.includes('shitu_rt'))
  return (line ? line.trim().split('\t').pop() : t).trim()
}
function writeRt(file, val) {
  const p = path.join(DIR, file)
  const t = fs.readFileSync(p, 'utf8')
  const line = t.split('\n').find((l) => l.includes('shitu_rt'))
  fs.writeFileSync(p, line ? line.replace(line.trim().split('\t').pop(), val) + '\n' : val)
}

async function session(mobile) {
  const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(tgt.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') {
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
  await send('Emulation.setDeviceMetricsOverride', mobile ? { width: 375, height: 812, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.TZ_OVERRIDE ?? 'Asia/Shanghai' })
  return { ws, send, events, close: () => fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`) }
}

const report = []
for (const s of SUITES) {
  const b = await session(s.mobile)
  await b.send('Network.setCookie', { name: 'shitu_rt', value: readRt(s.cookieFile), url: s.base + s.cookiePath, path: s.cookiePath, httpOnly: true })
  for (const p of s.paths) {
    if (p.includes(':')) continue
    b.events.length = 0
    await b.send('Page.navigate', { url: s.base + p })
    await sleep(2200)
    const r = await b.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ url: location.pathname, chromeError: location.protocol === "chrome-error:", errs: [...document.querySelectorAll('.el-message--error, .el-alert--error, .error, .van-toast')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 3),
        empty: document.body.innerText.trim().length < 20 })`,
    })
    const v = r.result?.result?.value ?? {}
    const issues = [...new Set(b.events)]
    if (!v.url || !v.url.startsWith('/') || v.chromeError) issues.push('页面没有打开（dev server 未启动？）')
    if (v.url === '/login') issues.push('被踢回登录页（会话无效）')
    if (v.errs?.length) issues.push('页面错误提示: ' + v.errs.join(' | '))
    if (v.empty) issues.push('页面几乎空白')
    const redirected = v.url !== p
    report.push({ suite: s.name, path: p, landed: v.url, issues })
    console.log(`${issues.length ? 'ISSUE' : 'ok   '}  ${s.name.padEnd(13)} ${p.padEnd(26)} ${redirected ? '→ ' + v.url : ''}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`)
    if (issues.length) {
      const shot = await b.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(SHOTS, `${s.name}${p.replaceAll('/', '_')}.png`), Buffer.from(shot.result.data, 'base64'))
    }
  }
  // 把浏览器轮换后的 refresh cookie 写回，避免旧 token 触发重放吊销
  const ck = await b.send('Network.getCookies', { urls: [s.base + s.cookiePath + '/refresh'] })
  const rt = ck.result.cookies.find((c) => c.name === 'shitu_rt')
  if (rt) writeRt(s.cookieFile, rt.value)
  await b.send('Network.clearBrowserCookies')
  await b.close()
}
const bad = report.filter((r) => r.issues.length)
fs.writeFileSync(path.join(DIR, 'ui-smoke.result.json'), JSON.stringify(report, null, 2))
console.log(`\n== ui-smoke: ${report.length - bad.length}/${report.length} 页面无问题`)
process.exit(0)
