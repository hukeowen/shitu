// 批量截图：按 routes.mjs 的清单，用对应人物登录后逐页截图。
// 用法：node shots.mjs <目录名> [--app seeker,staff] [--route /pm,/owner/bills]
//   node shots.mjs baseline                 四个端全部页面 → shots/baseline/
//   node shots.mjs current --app seeker     只截求职者端 → shots/current/
// 每页存一张目标视口的图（后台 1440×900，手机 390×844）；页面比一屏长时另存一张 .full.png 整页图。
// 前提：后端 8080、四个 dev server、Chrome 调试端口 9888、跑过 seed.mjs（见 README）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTab } from './cdp.mjs'
import { seekerSession, tenantSession, opsLogin, readRt, writeRt } from './lib.mjs'
import { APPS, MEMBERS, VIEWPORT, deadLinks, missingRoutes, parseArgs, selectRoutes } from './routes.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))

let args
try { args = parseArgs(process.argv.slice(2)) } catch (e) { console.log(e.message); process.exit(1) }
const outName = args._[0]
if (!outName || !/^[\w.-]+$/.test(outName)) {
  console.log('用法：node shots.mjs <目录名> [--app seeker,staff,console,ops] [--route /pm,/owner/bills]')
  process.exit(1)
}
const OUT = path.join(DIR, 'shots', outName)
const dataFile = path.join(DIR, 'shots', 'baseline-data.json')
if (!fs.existsSync(dataFile)) {
  console.log('没有 shots/baseline-data.json：先跑 node seed.mjs 造数据')
  process.exit(1)
}
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
const missing = missingRoutes()
if (missing.length) console.log('路由表里有、截图清单（routes.mjs）里没有的页面：\n  ' + missing.join('\n  ') + '\n')

/** 让人物的会话文件是新的（过期就重新登录），返回存 refresh token 的文件；游客返回 null。 */
async function ensureSession(app, persona) {
  if (persona === 'guest') return null
  if (persona === 'ops') { await opsLogin(); return 'ops.cookies' }
  const phone = MEMBERS[persona] ?? data.personas[persona]?.phone
  if (!phone) throw new Error(`baseline-data.json 里没有人物 ${persona}`)
  if (app === 'seeker') { await seekerSession(phone); return `seeker-${phone}.rt` }
  await tenantSession(phone)
  return `tenant-${phone}.rt`
}
const dead = deadLinks()
if (dead.length) console.log('页面里写死的跳转地址在路由表里找不到（会跳到不存在的页面）：\n  ' + dead.join('\n  ') + '\n')
const todo = selectRoutes(args)
if (!todo.length) { console.log('没有匹配的页面'); process.exit(1) }
const report = []
// 同一个端、同一个人物的页面放在一个浏览器标签里连续截
const groups = Map.groupBy(todo, (r) => `${r.app} ${r.persona}`)
for (const list of groups.values()) {
  const { app, persona } = list[0]
  const conf = APPS[app]
  const viewport = conf.mobile ? VIEWPORT.mobile : VIEWPORT.desktop
  let rtFile
  try { rtFile = await ensureSession(app, persona) } catch (e) {
    for (const r of list) { report.push({ app, route: r.route, persona, file: r.file, issues: ['登录失败：' + e.message] }); console.log(`FAIL   ${r.file}  登录失败：${e.message}`) }
    continue
  }
  const b = await openTab(viewport)
  await b.send('Network.clearBrowserCookies')
  await b.send('Storage.clearDataForOrigin', { origin: conf.base, storageTypes: 'local_storage,session_storage' })
  if (rtFile) await b.send('Network.setCookie', { name: 'shitu_rt', value: readRt(rtFile), url: conf.base + conf.cookiePath, path: conf.cookiePath, httpOnly: true })
  for (const r of list) {
    const target = typeof r.to === 'function' ? r.to(data.ids) : r.route
    const issues = []
    if (target.includes('undefined')) issues.push('baseline-data.json 里缺这个页面要的单据编号')
    b.events.length = 0
    const enter = r.enter?.(data.ids, data.personas)
    await b.send('Page.navigate', { url: conf.base + (enter?.start ?? target) })
    await b.settle()
    if (enter) {
      const res = await b.send('Runtime.evaluate', { expression: enter.script, awaitPromise: true })
      if (res.result?.exceptionDetails) issues.push('进入页面的脚本出错：' + (res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text).split('\n')[0])
      await b.settle()
    }
    const info = (await b.send('Runtime.evaluate', { returnByValue: true, expression:
      `({ path: location.pathname, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), text: document.body.innerText.trim().length })` })).result?.result?.value ?? {}
    const file = path.join(OUT, r.file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const shot = await b.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    const fullFile = file.replace(/\.png$/, '.full.png')
    fs.rmSync(fullFile, { force: true })
    if (info.height > viewport.height + 8) {
      const full = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: viewport.width, height: Math.min(info.height, 6000), scale: 1 } })
      if (full.result?.data) fs.writeFileSync(fullFile, Buffer.from(full.result.data, 'base64'))
    }
    const expected = target.split('?')[0]
    if (info.path !== expected) issues.push(`落在了 ${info.path ?? '（没打开）'}，不是 ${expected}`)
    if (info.text < 10) issues.push('页面几乎空白')
    issues.push(...new Set(b.events))
    report.push({ app, route: r.route, persona, file: r.file, opened: target, issues })
    console.log(`${issues.length ? 'ISSUE' : 'ok   '}  ${r.file.padEnd(44)} ${persona}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`)
  }
  // 浏览器里轮换过的 refresh token 写回文件，否则旧 token 下次用会触发重放吊销
  if (rtFile) {
    const ck = await b.send('Network.getCookies', { urls: [conf.base + conf.cookiePath + '/refresh'] })
    const rt = ck.result.cookies.find((c) => c.name === 'shitu_rt')
    if (rt) writeRt(rtFile, rt.value)
  }
  await b.send('Network.clearBrowserCookies')
  await b.close()
}
const bad = report.filter((r) => r.issues.length)
// 只截一部分页面时，保留 report.json 里其余页面上次的结果
const reportFile = path.join(OUT, 'report.json')
const kept = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')).filter((o) => !report.some((r) => r.file === o.file)) : []
fs.writeFileSync(reportFile, JSON.stringify([...kept, ...report], null, 2))
console.log(`\n== ${outName}: 截了 ${report.length} 页，${bad.length} 页有问题，${dead.length} 个跳转地址找不到，图在 shots/${outName}/，明细见 shots/${outName}/report.json`)
process.exit(bad.length || dead.length ? 1 : 0)
