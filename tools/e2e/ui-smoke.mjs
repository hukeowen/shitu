// 浏览器冒烟：用真实会话逐个打开菜单路由，收集 JS 异常、console.error、接口 ≥ 400 与页面上的错误提示。
// 用法：node ui-smoke.mjs（SUITE=console-owner 只跑一组；SHOT_ALL=1 每页都截图，用于界面走查）  （需要：Chrome 已以 --remote-debugging-port=9888 启动；console 5175、ops 5176 的 vite dev 在跑）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTab, sleep } from './cdp.mjs'
import { companyCode, get, seekerSession, tenantSession, readRt, writeRt } from './lib.mjs'
import { APPS, ROUTES, VIEWPORT } from './routes.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(DIR, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

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
    body: JSON.stringify({ phone: ph, code: s.data.devCode, channelCode: await companyCode(await tenantSession('13800000001')) }) })
  const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
  fs.writeFileSync(path.join(DIR, 'seeker.rt'), m[1])
}
if (!process.env.SUITE || process.env.SUITE.includes("seeker")) await freshSeekerCookie()

// 新注册的求职者没有匹配结果、没报过名、没入职，下面这些页面要么打不开，要么只有空状态：
// 用截图数据里的人物（跑过 seed.mjs 才有）再开一遍，地址和进入脚本取 routes.mjs 的登记。没有 baseline-data.json 时跳过并说明。
const SEEDED_ROUTES = ['/jobs/:jobId', '/apply/success', '/reports', '/reports/:applicationId', '/recommendations', '/ledger', '/work',
  '/kyc', '/kyc/appeals', '/contracts/sign', '/contracts', '/contracts/:id', '/resume',
  '/advance', '/advance/records', '/advance/:id', '/payslips', '/payslips/:id', '/messages', '/feedback', '/me']
const dataFile = path.join(SHOTS, 'baseline-data.json')
const seeded = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : null
if (!seeded) console.log('没有 shots/baseline-data.json：岗位详情、报名成功、面试详情、合同详情和有数据的报备 / 推荐 / 台账 / 我的工作 / 实名 / 申诉 / 合同 / 简历 / 预支 / 工资条 / 消息 / 反馈 / 我的这次没有覆盖（先跑 node seed.mjs）\n')
const seededSuites = []
// 同一个人物的页面放进同一组，只用一次会话
const byPersona = Map.groupBy(seeded ? ROUTES.filter((x) => x.app === 'seeker' && SEEDED_ROUTES.includes(x.route)) : [], (r) => r.persona)
for (const [persona, list] of byPersona) {
  const name = 'seeker-' + persona
  if (process.env.SUITE && !process.env.SUITE.split(',').includes(name)) continue
  const phone = seeded.personas[persona].phone
  await seekerSession(phone)
  seededSuites.push({ name, app: 'seeker', cookieFile: `seeker-${phone}.rt`,
    paths: list.map((r) => ({ path: typeof r.to === 'function' ? r.to(seeded.ids) : r.route, enter: r.enter?.(seeded.ids, seeded.personas) })) })
}

// 驻场端带参数的页面（报名详情、预支详情）：驻场账号固定，地址用截图数据里的单据编号拼，接在 staff-site 那组后面
const SEEDED_STAFF_ROUTES = ['/applications/:id', '/advance/:id']
const staffSeeded = seeded ? ROUTES.filter((x) => x.app === 'staff' && SEEDED_STAFF_ROUTES.includes(x.route)).map((r) => r.to(seeded.ids)) : []
if (!seeded) console.log('没有 shots/baseline-data.json：驻场报名详情、预支详情这次没有覆盖\n')

// 企业后台的登录、入驻申请（不登录；入驻申请要先塞入驻凭证，进入脚本取 routes.mjs 的登记）和入驻进度（截图数据里待审核、被驳回的公司老板）
const consoleApply = ROUTES.find((x) => x.app === 'console' && x.route === '/onboarding/apply')
const consoleAuth = [{ name: 'console-guest', app: 'console', cookieFile: null, paths: ['/login', { path: '/onboarding/apply', enter: consoleApply.enter?.(seeded?.ids, seeded?.personas) }] }]
for (const persona of seeded ? ['pendingOwner', 'rejectedOwner'] : []) {
  const phone = seeded.personas[persona].phone
  if (process.env.SUITE && !process.env.SUITE.split(',').includes('console-' + persona)) continue
  await tenantSession(phone)
  consoleAuth.push({ name: 'console-' + persona, app: 'console', cookieFile: `tenant-${phone}.rt`, paths: ['/onboarding/status'] })
}
if (!seeded) console.log('没有 shots/baseline-data.json：企业后台入驻进度这次没有覆盖\n')

const SUITES = [
  // 中台菜单里工作台写的是常量 HOME_PATH，正则取不到，和无权限页一起补上（工单 21）
  // 题库版本编辑页和查到结果的匹配快照不在菜单里：地址用截图数据里的题库版本号、匹配会话号拼（工单 22）
  // 诚信与处罚查到结果的样子：公司编号不写死，取演示公司老板的 /tenant/company（工单 24）
  { name: 'ops-super', app: 'ops', cookieFile: 'ops.cookies', paths: ['/workbench', ...menuPaths('ops'), '/forbidden?from=/system/admins',
    `/governance/credit?companyId=${(await get('/tenant/company', await tenantSession('13800000001'))).data.companyId}`,
    ...(seeded ? [`/engine/quiz/${seeded.ids.quizVersionId}`, `/engine/match-snapshot?sessionId=${seeded.ids.matchSessionId}`] : [])] },
  { name: 'ops-guest', app: 'ops', cookieFile: null, paths: ['/login'] },
  ...consoleAuth,
  { name: 'console-owner', app: 'console', cookieFile: 'tenant-13800000001.rt', paths: menuPaths('console') },
  // 岗位编辑不在菜单里：新建页直接打开，编辑页用截图数据里的岗位（工单 17）
  { name: 'console-pm', app: 'console', cookieFile: 'tenant-13800000002.rt', paths: [...menuPaths('console'), '/pm/jobs/edit', ...(seeded ? [`/pm/jobs/edit?id=${seeded.ids.matchedJobId}`] : [])] },
  { name: 'console-site', app: 'console', cookieFile: 'tenant-13800000003.rt', paths: menuPaths('console') },
  { name: 'staff-site', app: 'staff', cookieFile: 'tenant-13800000003.rt', paths: [...routePaths('staff'), ...staffSeeded] },
  { name: 'seeker-new', app: 'seeker', cookieFile: 'seeker.rt', paths: routePaths('seeker') },
  ...seededSuites,
].map((s) => ({ ...s, ...APPS[s.app] }))

const report = []
for (const s of SUITES.filter((x) => !process.env.SUITE || process.env.SUITE.split(",").includes(x.name))) {
  const b = await openTab(s.mobile ? VIEWPORT.mobile : VIEWPORT.desktop, { timezone: process.env.TZ_OVERRIDE })
  await b.send('Network.clearBrowserCookies')
  if (s.cookieFile) await b.send('Network.setCookie', { name: 'shitu_rt', value: readRt(s.cookieFile), url: s.base + s.cookiePath, path: s.cookiePath, httpOnly: true })
  for (const item of s.paths) {
    // 字符串是直接打开的地址；{ path, enter } 是要先打开 enter.start、在页面里执行 enter.script 才进得去的页面
    const { path: p, enter } = typeof item === 'string' ? { path: item } : item
    if (p.includes(':')) continue
    b.events.length = 0
    await b.send('Page.navigate', { url: s.base + (enter?.start ?? p) })
    await sleep(2200)
    if (enter) {
      await b.send('Runtime.evaluate', { expression: enter.script, awaitPromise: true })
      await sleep(2200)
    }
    const r = await b.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ url: location.pathname, chromeError: location.protocol === "chrome-error:", errs: [...document.querySelectorAll('.el-message--error, .el-alert--error, .error, .van-toast')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 3),
        empty: document.body.innerText.trim().length < 20,
        layout: (() => {
          const out = []
          // 表格操作列按钮折行
          const wrapped = [...document.querySelectorAll('.el-table__body td.el-table-fixed-column--right .cell, .el-table__body td:last-child .cell')].some((c) => {
            const tops = [...c.querySelectorAll('.el-button')].map((b) => b.getBoundingClientRect().top)
            return tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 8
          })
          if (wrapped) out.push('表格操作列按钮折行')
          // 企业后台的状态一律用共享状态标签，不再有改版前的状态点（人员管理页在工单 18 换掉了最后一处）
          if (document.querySelector('.st-pill') && location.port === '5175') out.push('还在用旧状态点 .st-pill')
          // 页面横向溢出
          if (document.documentElement.scrollWidth > window.innerWidth + 2) out.push('页面横向溢出 ' + (document.documentElement.scrollWidth - window.innerWidth) + 'px')
          // 按钮 / 标签文字被裁切
          const clipped = [...document.querySelectorAll('.el-button, .van-button, .tag, .el-tag')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 2).map((e) => e.innerText.trim().slice(0, 12))
          if (clipped.length) out.push('文字被裁切: ' + [...new Set(clipped)].slice(0, 4).join(' / '))
          // 栅格内按钮没对齐
          const mis = [...document.querySelectorAll('.grid')].some((g) => { const xs = [...g.children].filter((c) => c.classList.contains('el-button')).map((c) => Math.round(c.getBoundingClientRect().left)); return new Set(xs).size > Math.max(1, Math.round(Math.sqrt(xs.length))) + 1 })
          if (mis) out.push('栅格按钮未对齐')
          return out
        })() })`,
    })
    const v = r.result?.result?.value ?? {}
    const issues = [...new Set(b.events)]
    if (!v.url || !v.url.startsWith('/') || v.chromeError) issues.push('页面没有打开（dev server 未启动？）')
    if (v.url === '/login' && p !== '/login') issues.push('被踢回登录页（会话无效）')
    if (v.errs?.length) issues.push('页面错误提示: ' + v.errs.join(' | '))
    if (v.empty) issues.push('页面几乎空白')
    for (const w of v.layout ?? []) issues.push('排版: ' + w)
    const redirected = v.url !== p.split('?')[0]
    report.push({ suite: s.name, path: p, landed: v.url, issues })
    console.log(`${issues.length ? 'ISSUE' : 'ok   '}  ${s.name.padEnd(13)} ${p.padEnd(26)} ${redirected ? '→ ' + v.url : ''}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`)
    if (issues.length || process.env.SHOT_ALL) {
      const shot = await b.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(SHOTS, `${s.name}${p.replaceAll('/', '_')}.png`), Buffer.from(shot.result.data, 'base64'))
    }
  }
  // 把浏览器轮换后的 refresh cookie 写回，避免旧 token 触发重放吊销
  const ck = await b.send('Network.getCookies', { urls: [s.base + s.cookiePath + '/refresh'] })
  const rt = ck.result.cookies.find((c) => c.name === 'shitu_rt')
  if (rt && s.cookieFile) writeRt(s.cookieFile, rt.value)
  await b.send('Network.clearBrowserCookies')
  await b.close()
}
const bad = report.filter((r) => r.issues.length)
fs.writeFileSync(path.join(DIR, 'ui-smoke.result.json'), JSON.stringify(report, null, 2))
console.log(`\n== ui-smoke: ${report.length - bad.length}/${report.length} 页面无问题`)
process.exit(0)
