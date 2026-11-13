// 预览环境全量巡检：在服务器本机运行，按角色逐页打开四个端的所有页面，
// 记录脚本报错、接口失败、页面上的异常文字、横向溢出，并截图；PC 端还会点开每页的详情 / 新增等弹层。
//   OPS_PASSWORD=xxx node audit.mjs <输出目录> [只跑的 suite 名前缀]
// 产出：<输出目录>/report.json 和每页一张 png。需要 google-chrome、mysql 客户端、redis-cli。
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'

const [out, only] = process.argv.slice(2)
const ORIGIN = 'http://127.0.0.1:8888'
const API = ORIGIN + '/api/v1'
const ENV = Object.fromEntries(fs.readFileSync('/etc/shitu/shitu.env', 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const redis = (...a) => execFileSync('redis-cli', ['-a', ENV.REDIS_PASSWORD, '--no-auth-warning', ...a], { encoding: 'utf8' }).trim()
const sql = (q) => execFileSync('mysql', ['-N', '-B', '-h', ENV.DB_HOST.split(':')[0], '-u', ENV.DB_USER, ENV.DB_NAME, '-e', q],
  { encoding: 'utf8', env: { ...process.env, MYSQL_PWD: ENV.DB_PASSWORD } }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
const dec = (s) => {
  const all = Buffer.from(s.slice(3), 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENV.SHITU_ENC_KEY, 'base64'), all.subarray(0, 12))
  d.setAuthTag(all.subarray(all.length - 16))
  return Buffer.concat([d.update(all.subarray(12, all.length - 16)), d.final()]).toString('utf8')
}
const newIp = () => `36.${1 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
const rt = (r) => (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)?.[1]

async function login(domain, phone) {
  const ip = newIp()
  const post = (url, body) => fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) })
  if (domain === 'ops') {
    const cap = await (await fetch(API + '/ops/auth/captcha', { headers: { 'X-Forwarded-For': ip } })).json()
    const key = redis('--scan', '--pattern', `*cap:${cap.data.captchaId}`).split('\n')[0]
    const r = await post('/ops/auth/login', { username: 'admin', password: process.env.OPS_PASSWORD, captchaId: cap.data.captchaId, captchaCode: redis('GET', key).replace(/^"|"$/g, '') })
    return rt(r)
  }
  for (const pat of ['*sms:iv:*', '*rl:sms:day:*']) for (const k of redis('--scan', '--pattern', pat).split('\n').filter(Boolean)) redis('DEL', k)
  let s = await (await post(`/${domain}/auth/sms-code`, { phone })).json()
  if (s.code === 'AUTH_4004') {
    const cap = await (await fetch(API + `/${domain}/auth/captcha`, { headers: { 'X-Forwarded-For': ip } })).json()
    const key = redis('--scan', '--pattern', `*cap:${cap.data.captchaId}`).split('\n')[0]
    s = await (await post(`/${domain}/auth/sms-code`, { phone, captchaId: cap.data.captchaId, captchaCode: redis('GET', key).replace(/^"|"$/g, '') })).json()
  }
  if (!s.data?.devCode) throw new Error(`sms-code ${phone}: ${JSON.stringify(s)}`)
  return rt(await post(`/${domain}/auth/sms-login`, { phone, code: s.data.devCode }))
}

// ---------- 从库里挑出各种状态的求职者和带参数页面要用的编号 ----------
const one = (q) => { try { return sql(q)[0] ?? [] } catch (e) { console.log('SQL FAIL ' + q + ' ' + String(e.message).slice(0, 120)); return [] } }
const seeker = (where, join = '') => { const r = one(`SELECT u.user_id, u.phone_enc FROM user u ${join} WHERE ${where} ORDER BY u.user_id LIMIT 1`); return r[0] ? { id: r[0], phone: dec(r[1]) } : null }
const sEmp = seeker("u.user_status='EMPLOYED'", 'JOIN payslip p ON p.user_id=u.user_id JOIN advance_request a ON a.user_id=u.user_id')
const sInt = seeker("u.user_status='PENDING_INTERVIEW'")
const sCfm = seeker("u.user_status='PENDING_CONFIRM'")
const sPri = seeker("u.user_status='PRIVATE_PENDING'")
const sPub = seeker("u.user_status='PUBLIC_SEEKING'")
const sSign = seeker("c.status='PENDING_SIGN'", 'JOIN contract c ON c.user_id=u.user_id')
const v = (q) => one(q)[0]
const siteCompany = v("SELECT company_id FROM company ORDER BY company_id LIMIT 1")

const seekerCommon = ['/', '/messages', '/me', '/reports', '/recommendations', '/resume', '/ledger', '/feedback', '/kyc', '/kyc/appeals', '/match', '/match/result']
const suites = [
  { name: 'seeker-anon', app: '', mobile: true, paths: ['/', '/login', '/match', '/no-such-page', `/r/${v('SELECT code FROM channel_code LIMIT 1') ?? 'X'}`] },
  sEmp && { name: 'seeker-employed', app: '', domain: 'seeker', phone: sEmp.phone, mobile: true, paths: [...seekerCommon, '/work', '/advance', '/advance/records',
    `/advance/${v(`SELECT advance_id FROM advance_request WHERE user_id='${sEmp.id}' LIMIT 1`)}`, '/payslips', `/payslips/${v(`SELECT payslip_id FROM payslip WHERE user_id='${sEmp.id}' LIMIT 1`)}`,
    '/contracts', `/contracts/${v(`SELECT contract_id FROM contract WHERE user_id='${sEmp.id}' LIMIT 1`)}`, `/reports/${v(`SELECT application_id FROM application WHERE user_id='${sEmp.id}' LIMIT 1`)}`] },
  sInt && { name: 'seeker-interview', app: '', domain: 'seeker', phone: sInt.phone, mobile: true, paths: [...seekerCommon, '/apply/success', '/work', '/advance', '/payslips', '/contracts',
    `/reports/${v(`SELECT application_id FROM application WHERE user_id='${sInt.id}' LIMIT 1`)}`, `/jobs/${v(`SELECT job_id FROM application WHERE user_id='${sInt.id}' LIMIT 1`)}`] },
  sCfm && { name: 'seeker-confirm', app: '', domain: 'seeker', phone: sCfm.phone, mobile: true, paths: ['/', '/reports', `/reports/${v(`SELECT application_id FROM application WHERE user_id='${sCfm.id}' LIMIT 1`)}`, '/messages', '/me'] },
  sPri && { name: 'seeker-private', app: '', domain: 'seeker', phone: sPri.phone, mobile: true, paths: ['/', '/match', '/match/quiz', '/match/result', '/reports', '/recommendations', '/messages', '/me'] },
  sPub && { name: 'seeker-public', app: '', domain: 'seeker', phone: sPub.phone, mobile: true, paths: ['/', '/match', '/match/quiz', '/match/result', '/reports', '/recommendations', '/messages', '/me', '/work', '/advance'] },
  sSign && { name: 'seeker-sign', app: '', domain: 'seeker', phone: sSign.phone, mobile: true, paths: ['/', '/contracts', '/contracts/sign', `/contracts/${v(`SELECT contract_id FROM contract WHERE user_id='${sSign.id}' AND status='PENDING_SIGN' LIMIT 1`)}`] },
  { name: 'staff-anon', app: '/staff', mobile: true, paths: ['/login', '/'] },
  { name: 'staff-site', app: '/staff', domain: 'tenant', phone: '13800000003', mobile: true, paths: ['/', '/notice', '/my-code', '/todo', '/todo/interview', '/todo/confirm', '/todo/onboard', '/todo/arrived',
    `/applications/${v(`SELECT application_id FROM application WHERE company_id='${siteCompany}' AND status='PENDING_INTERVIEW' LIMIT 1`)}`,
    `/applications/${v(`SELECT application_id FROM application WHERE company_id='${siteCompany}' AND status='EMPLOYED' LIMIT 1`)}`,
    '/messages', '/reminders', '/private-pending', '/advance', `/advance/${v(`SELECT advance_id FROM advance_request WHERE company_id='${siteCompany}' ORDER BY advance_id DESC LIMIT 1`)}`, '/employees', '/incidents', '/me', '/no-such-page'] },
  { name: 'staff-pm', app: '/staff', domain: 'tenant', phone: '13800000002', mobile: true, paths: ['/', '/todo', '/advance', '/employees', '/me'] },
  { name: 'console-anon', app: '/admin', paths: ['/login', '/', '/no-such-page'] },
  { name: 'console-owner', app: '/admin', domain: 'tenant', phone: '13800000001', click: true, paths: ['/', '/owner/overview', '/owner/channel-report', '/owner/bills', '/circulation/ledger', '/circulation/people',
    '/settings/projects', '/settings/channels', '/settings/org', '/pm/board', '/pm/jobs', '/pm/jobs/edit', '/pm/kb', '/pm/staff', '/pm/resign', '/pm/roster', '/pm/incidents', '/pm/advance',
    '/payroll/batches', '/payroll/appeals', '/payroll/recon', '/site/home', '/site/todo', '/site/follow', '/site/onboard', '/broker/pool', '/broker/report', '/broker/rematch', '/no-such-page'] },
  { name: 'console-pm', app: '/admin', domain: 'tenant', phone: '13800000002', click: true, paths: ['/', '/pm/board', '/pm/jobs', '/pm/jobs/edit', `/pm/jobs/edit?id=${v(`SELECT job_id FROM job WHERE company_id='${siteCompany}' LIMIT 1`)}`,
    '/pm/kb', '/pm/staff', '/pm/resign', '/pm/roster', '/pm/incidents', '/pm/advance', '/payroll/batches', '/payroll/appeals', '/payroll/recon', '/site/todo', '/site/follow', '/site/onboard', '/owner/bills', '/settings/org'] },
  { name: 'console-site', app: '/admin', domain: 'tenant', phone: '13800000003', click: true, paths: ['/', '/site/home', '/site/todo', '/site/follow', '/site/onboard', '/pm/staff', '/pm/advance', '/pm/incidents', '/owner/overview'] },
  { name: 'console-broker', app: '/admin', domain: 'tenant', phone: '13800000004', click: true, paths: ['/', '/broker/pool', '/broker/report', '/broker/rematch', '/site/todo', '/owner/overview'] },
  { name: 'console-owner2', app: '/admin', domain: 'tenant', phone: '13800000011', click: true, paths: ['/', '/owner/overview', '/owner/bills', '/circulation/ledger', '/circulation/people', '/owner/channel-report', '/pm/board'] },
  { name: 'console-owner3', app: '/admin', domain: 'tenant', phone: '13800000021', paths: ['/', '/owner/overview', '/owner/bills', '/circulation/ledger', '/pm/jobs', '/pm/staff'] },
  { name: 'console-pending', app: '/admin', domain: 'tenant', phone: '13800000031', paths: ['/', '/onboarding/status', '/onboarding/apply', '/owner/overview'] },
  { name: 'ops-anon', app: '/ops', paths: ['/login', '/', '/forbidden'] },
  { name: 'ops-admin', app: '/ops', domain: 'ops', click: true, paths: ['/', '/ops/workbench', '/ops/overview', '/ops/attribution', '/engine/quiz', `/engine/quiz/${v("SELECT version_id FROM quiz_version WHERE status='DRAFT' LIMIT 1") ?? 1}`,
    `/engine/quiz/${v("SELECT version_id FROM quiz_version WHERE status='ACTIVE' LIMIT 1") ?? 1}`, '/engine/match-snapshot', '/engine/params', '/companies/list', '/companies/stock',
    '/governance/job-audit', '/governance/throttle', '/governance/compliance', '/governance/complaints', '/governance/feedback', '/governance/credit',
    '/settlement/rules', '/settlement/bills', '/settlement/audit', '/system/admins', '/system/templates', '/system/holidays', '/system/params', '/no-such-page'] },
].filter(Boolean).filter((s) => !only || s.name.startsWith(only))

// ---------- 浏览器 ----------
fs.mkdirSync(out, { recursive: true })
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9334', '--user-data-dir=/tmp/audit-profile-' + Date.now(), 'about:blank'], { stdio: 'ignore' })
const report = []
try {
  let tgt
  for (let i = 0; i < 30 && !tgt; i++) { await sleep(500); tgt = await fetch('http://127.0.0.1:9334/json/new?about:blank', { method: 'PUT' }).then((r) => r.json()).catch(() => null) }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  let cur = null // 当前页面的问题收集器
  let inflight = 0, lastNet = Date.now()
  const apiReq = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    const p = m.params
    if (m.method === 'Network.requestWillBeSent') { inflight++; lastNet = Date.now(); if (p.request.url.includes('/api/')) apiReq.set(p.requestId, p.request.method + ' ' + p.request.url.replace(ORIGIN, '')) }
    if (m.method === 'Network.loadingFailed') { inflight = Math.max(0, inflight - 1); lastNet = Date.now() }
    if (m.method === 'Network.loadingFinished') {
      inflight = Math.max(0, inflight - 1); lastNet = Date.now()
      const u = apiReq.get(p.requestId)
      if (u && cur) { const c = cur; send('Network.getResponseBody', { requestId: p.requestId }).then((b) => { const mm = /"code":"([^"]+)"/.exec(b.result?.body?.slice(0, 200) ?? ''); if (mm && mm[1] !== '0') c.biz.push(`${u} → ${mm[1]} ${/"message":"([^"]*)"/.exec(b.result.body)?.[1] ?? ''}`) }) }
    }
    if (!cur) return
    if (m.method === 'Network.responseReceived' && p.response.status >= 400) cur.http.push(`${p.response.status} ${p.response.url.replace(ORIGIN, '')}`)
    if (m.method === 'Runtime.exceptionThrown') cur.js.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300))
    if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) cur.console.push(p.type + ': ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
  })
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
  const idle = async (max = 9000) => { const t0 = Date.now(); await sleep(700); while (Date.now() - t0 < max && (inflight > 0 || Date.now() - lastNet < 700)) await sleep(150); await sleep(350) }
  const shot = async (file, full) => {
    let clip
    if (full) { const h = await ev('Math.min(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), 4200)'); const w = await ev('window.innerWidth'); clip = { x: 0, y: 0, width: w, height: h, scale: 1 } }
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full, ...(clip ? { clip } : {}) })
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'))
  }
  const inspect = () => ev(`(() => {
    const t = document.body.innerText || ''
    const bad = [...new Set((t.match(/undefined|NaN|\\[object Object\\]|Invalid Date|null(?![a-zA-Z])/g) || []))]
    const over = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 2 && !e.closest('.el-table, .el-scrollbar, [class*=scroll], .van-tabs__nav') }).slice(0, 3).map((e) => e.className || e.tagName)
    const clipped = [...document.querySelectorAll('.el-table .cell, .tag, .stat-v, .el-button > span')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').slice(0, 6).map((e) => (e.innerText || '').trim().slice(0, 16))
    const hscroll = [...document.querySelectorAll('.el-table')].filter((t) => { const w = t.querySelector('.el-table__body-wrapper .el-scrollbar__wrap'); return w && w.scrollWidth > w.clientWidth + 2 }).map((t) => { const w = t.querySelector('.el-table__body-wrapper .el-scrollbar__wrap'); return w.scrollWidth - w.clientWidth })
    return { hscroll, url: location.pathname + location.search, title: document.title, textLen: t.trim().length, bad, over, clipped,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 2, empty: [...document.querySelectorAll('.el-empty, .van-empty, .empty')].length }
  })()`)

  await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable')
  for (const s of suites) {
    if (s.mobile) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    else await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await send('Network.clearBrowserCookies')
    await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
    if (s.domain) {
      const value = await login(s.domain, s.phone)
      if (!value) { report.push({ suite: s.name, path: '(login)', js: ['登录失败'] }); console.log('LOGIN FAIL ' + s.name); continue }
      await send('Network.setCookie', { name: 'shitu_rt', value, domain: '127.0.0.1', path: `/api/v1/${s.domain}/auth`, httpOnly: true })
    }
    for (const p of s.paths) {
      const rec = { suite: s.name, path: p, js: [], console: [], http: [], biz: [], dialogs: [] }
      cur = rec
      await send('Page.navigate', { url: ORIGIN + s.app + p }); await idle()
      Object.assign(rec, await inspect())
      const base = `${out}/${s.name}${p.replace(/[/?=&]/g, '_')}`
      await shot(base + '.png', true)
      // 手机端：固定底栏在整页截图里会画在页面中段，另截一张滚到底的视口图，用来看底部留白够不够
      if (s.mobile && (await ev('document.documentElement.scrollHeight > window.innerHeight + 40'))) {
        await ev('window.scrollTo(0, document.documentElement.scrollHeight)'); await sleep(400)
        await shot(base + '__bottom.png', false)
      }
      if (s.click) {
        const labels = await ev(`[...new Set([...document.querySelectorAll('.content button, .content a.lnk, .content .el-link')].filter((b) => b.offsetParent && !b.disabled).map((b) => b.innerText.trim()).filter((t) => /^(详情|查看|明细|查看明细|新增|新建|添加|编辑|修改|处理|审核|回复|导入|登记|调整|配置|记录|日志|预览|.*详情|新增.*|新建.*|添加.*|导入.*|查看.*)$/.test(t)))].slice(0, 5)`) ?? []
        for (const lb of labels) {
          const before = await ev('location.pathname + location.search')
          await ev(`(() => { const b = [...document.querySelectorAll('.content button, .content a.lnk, .content .el-link')].find((b) => b.offsetParent && b.innerText.trim() === ${JSON.stringify(lb)}); b && b.click() })()`)
          await idle(6000)
          const after = await ev('location.pathname + location.search')
          const layer = await ev(`(() => { const l = [...document.querySelectorAll('.el-dialog, .el-drawer, .el-message-box')].filter((e) => e.offsetParent || e.getClientRects().length); const e = l[l.length - 1]; if (!e) return null; const t = e.innerText || ''; return { kind: e.className.split(' ')[0], textLen: t.trim().length, bad: [...new Set(t.match(/undefined|NaN|\\[object Object\\]|Invalid Date|null(?![a-zA-Z])/g) || [])] } })()`)
          const tag = lb.replace(/[^一-龥a-zA-Z0-9]/g, '')
          if (layer || after !== before) { await shot(`${base}__${tag}.png`, after !== before); rec.dialogs.push({ label: lb, ...(layer ?? { nav: after }) }) } else rec.dialogs.push({ label: lb, nothing: true })
          if (after !== before) { await send('Page.navigate', { url: ORIGIN + s.app + p }); await idle() } else {
            for (let k = 0; k < 2; k++) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(350) }
            const still = await ev(`[...document.querySelectorAll('.el-overlay')].some((e) => e.offsetParent || getComputedStyle(e).display !== 'none')`)
            if (still) { await send('Page.navigate', { url: ORIGIN + s.app + p }); await idle() }
          }
        }
      }
      cur = null
      report.push(rec)
      const flags = [rec.js.length && 'JS', rec.http.length && 'HTTP', rec.biz.length && 'BIZ', rec.bad?.length && 'TEXT', rec.hOverflow && 'OVERFLOW', rec.clipped?.length && 'CLIP', rec.hscroll?.length && 'HSCROLL' + rec.hscroll.join('/'), rec.url !== s.app + p && '→' + rec.url].filter(Boolean)
      console.log(`${s.name} ${p} ${flags.join(' ') || 'ok'}`)
      fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
    }
  }
  ws.close()
} finally {
  chrome.kill()
}
