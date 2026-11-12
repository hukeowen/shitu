// 预览环境截图：在服务器本机运行，用无头 Chrome 打开页面并截图，用来检查界面改动。
//   OPS_PASSWORD=xxx node shots.mjs <输出目录> <suite> <路径...>
//   suite：owner / pm / site（公司后台 /admin）或 ops（运营中台 /ops）
// 需要：google-chrome、预览环境在 127.0.0.1:8888。
import fs from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'

const [out, suite, ...paths] = process.argv.slice(2)
const ORIGIN = 'http://127.0.0.1:8888'
const API = ORIGIN + '/api/v1'
const ENV = Object.fromEntries(fs.readFileSync('/etc/shitu/shitu.env', 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const redis = (...a) => execFileSync('redis-cli', ['-a', ENV.REDIS_PASSWORD, '--no-auth-warning', ...a], { encoding: 'utf8' }).trim()
const ip = `36.${1 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
const post = (url, body) => fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) })
const rt = (r) => (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)?.[1]

async function refreshCookie() {
  // anon-admin / anon-ops：不登录，截登录页等公开页面
  if (suite.startsWith('anon')) return { value: 'none', path: '/none', base: suite === 'anon-ops' ? '/ops' : '/admin' }
  if (suite === 'ops') {
    const cap = await (await fetch(API + '/ops/auth/captcha', { headers: { 'X-Forwarded-For': ip } })).json()
    const key = redis('--scan', '--pattern', `*cap:${cap.data.captchaId}`).split('\n')[0]
    const r = await post('/ops/auth/login', { username: 'admin', password: process.env.OPS_PASSWORD, captchaId: cap.data.captchaId, captchaCode: redis('GET', key).replace(/^"|"$/g, '') })
    return { value: rt(r), path: '/api/v1/ops/auth', base: '/ops' }
  }
  const phone = { owner: '13800000001', pm: '13800000002', site: '13800000003' }[suite]
  for (const k of redis('--scan', '--pattern', '*sms:iv:*').split('\n').filter(Boolean)) redis('DEL', k)
  for (const k of redis('--scan', '--pattern', '*rl:sms:day:*').split('\n').filter(Boolean)) redis('DEL', k)
  const s = await (await post('/tenant/auth/sms-code', { phone })).json()
  const r = await post('/tenant/auth/sms-login', { phone, code: s.data.devCode })
  return { value: rt(r), path: '/api/v1/tenant/auth', base: '/admin' }
}

const ck = await refreshCookie()
if (!ck.value) throw new Error('登录失败，拿不到会话')
fs.mkdirSync(out, { recursive: true })
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', '--user-data-dir=/tmp/shots-profile-' + Date.now(), 'about:blank'], { stdio: 'ignore' })
try {
  let tgt
  for (let i = 0; i < 30 && !tgt; i++) {
    await sleep(500)
    tgt = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' }).then((r) => r.json()).catch(() => null)
  }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Network.setCookie', { name: 'shitu_rt', value: ck.value, domain: '127.0.0.1', path: ck.path, httpOnly: true })
  for (const p of paths) {
    await send('Page.navigate', { url: ORIGIN + ck.base + p })
    await sleep(3200)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${out}/${suite}${p.replaceAll('/', '_')}.png`
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    console.log(file)
  }
  ws.close()
} finally {
  chrome.kill()
}
