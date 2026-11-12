// 状态截图：shots.mjs 只截每页的正常样子，这里补加载中、失败、弹层、被拒提示和 360 宽。
// 用法：node states.mjs <输出目录> [--app seeker] [--only 名字里包含的一段]
//   node states.mjs ../../.atw/tasks/<任务>/screenshots --app seeker
// 文件名：<端>_<页面>_<状态>_<宽>x<高>.png。前提同 shots.mjs（后端、dev server、Chrome 9888、跑过 seed.mjs）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTab } from './cdp.mjs'
import { seekerSession, readRt, writeRt } from './lib.mjs'
import { APPS, VIEWPORT, parseArgs } from './routes.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2).filter((a, i, all) => a !== '--only' && all[i - 1] !== '--only'))
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : ''
if (!args._[0]) { console.log('用法：node states.mjs <输出目录> [--app seeker] [--only 名字里包含的一段]'); process.exit(1) }
const OUT = path.resolve(args._[0])
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'shots', 'baseline-data.json'), 'utf8'))

const NARROW = 360
const click = (text) => `[...document.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(text)})).click()`
// 给 Vant 输入框填值：改 value 后要派发 input 事件，v-model 才会更新
const fill = (placeholder, value) => `(() => { const el = document.querySelector('input[placeholder*=${JSON.stringify(placeholder)}]');
  el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const skipSplash = click('先逛逛')
const ME = '/seeker/me'

// 每项：端、页面、状态、人物、地址；width 不写是 390；rules 是接口拦截（见 cdp.mjs 的 intercept）；
// steps 是打开后依次在页面里执行的脚本；quick = 最后一步之后不等页面安静，马上截（轻提示两秒就消失）
const STATES = [
  { app: 'seeker', screen: 'splash', state: 'normal', persona: 'guest', path: '/', width: NARROW },
  { app: 'seeker', screen: 'splash', state: 'inviter', persona: 'guest', path: `/?ch=${data.companyCode}` },
  { app: 'seeker', screen: 'home-guest', state: 'normal', persona: 'guest', path: '/', steps: [skipSplash], width: NARROW },
  { app: 'seeker', screen: 'home-guest', state: 'inviter', persona: 'guest', path: `/?ch=${data.companyCode}`, steps: [skipSplash] },
  { app: 'seeker', screen: 'guide-popup', state: 'normal', persona: 'guest', path: '/', steps: [skipSplash, click('开始匹配')] },
  { app: 'seeker', screen: 'guide-popup', state: 'normal', persona: 'guest', path: '/', steps: [skipSplash, click('开始匹配')], width: NARROW },
  { app: 'seeker', screen: 'guide-popup', state: 'inviter', persona: 'guest', path: `/?ch=${data.companyCode}`, steps: [skipSplash, click('开始匹配')] },
  { app: 'seeker', screen: 'login', state: 'normal', persona: 'guest', path: '/login', width: NARROW },
  { app: 'seeker', screen: 'login', state: 'inviter', persona: 'guest', path: `/login`, pre: `/?ch=${data.companyCode}` },
  { app: 'seeker', screen: 'login', state: 'rejected', persona: 'guest', path: '/login', steps: [click('登录 / 注册并开始匹配')], quick: true },
  { app: 'seeker', screen: 'login', state: 'submitting', persona: 'guest', path: '/login', rules: [{ url: '/seeker/auth/sms-login', action: 'hang' }],
    steps: [fill('手机号', '13900000000'), fill('验证码', '123456'), `document.querySelector('.van-checkbox').click()`, click('登录 / 注册并开始匹配')], quick: true },
  { app: 'seeker', screen: 'login', state: 'captcha', persona: 'guest', path: '/login',
    rules: [{ url: '/seeker/auth/sms-code', action: 'respond', body: { code: 'AUTH_4004', message: '请先完成图形验证', data: null } }],
    steps: [fill('手机号', '13900000000'), click('获取验证码')] },
  // 先正常打开一次：启动屏只在会话里第一次出现，之后的加载中才是整页的加载图标
  { app: 'seeker', screen: 'home', state: 'loading', persona: 'public', path: '/', pre: '/', rules: [{ url: ME, action: 'hang' }] },
  { app: 'seeker', screen: 'home', state: 'error', persona: 'public', path: '/', rules: [{ url: ME, action: 'fail' }] },
  { app: 'seeker', screen: 'home-public', state: 'normal', persona: 'public', path: '/', width: NARROW },
  { app: 'seeker', screen: 'home-registered', state: 'normal', persona: 'registered', path: '/', width: NARROW },
  { app: 'seeker', screen: 'home-acknowledged', state: 'normal', persona: 'acknowledged', path: '/', width: NARROW },
  { app: 'seeker', screen: 'home-confirmed', state: 'normal', persona: 'confirmed', path: '/', width: NARROW },
  { app: 'seeker', screen: 'home-veteran', state: 'normal', persona: 'veteran', path: '/', width: NARROW },
  { app: 'seeker', screen: 'home-acknowledged', state: 'rejected', persona: 'acknowledged', path: '/', steps: [click('AI 问薪')] },
  { app: 'seeker', screen: 'home-registered', state: 'rejected', persona: 'registered', path: '/', steps: [click('薪资预支')], quick: true },
]

const todo = STATES.filter((s) => (!args.apps.length || args.apps.includes(s.app)) && (!only || `${s.screen}_${s.state}`.includes(only)))
if (!todo.length) { console.log('没有匹配的状态'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
let bad = 0
for (const s of todo) {
  const conf = APPS[s.app]
  const viewport = { ...(conf.mobile ? VIEWPORT.mobile : VIEWPORT.desktop), ...(s.width ? { width: s.width } : {}) }
  const name = `${s.app}_${s.screen}_${s.state}_${viewport.width}x${viewport.height}.png`
  const phone = s.persona === 'guest' ? null : data.personas[s.persona]?.phone
  const rtFile = phone ? `seeker-${phone}.rt` : null
  if (phone) await seekerSession(phone)
  const b = await openTab(viewport)
  await b.send('Network.clearBrowserCookies')
  await b.send('Storage.clearDataForOrigin', { origin: conf.base, storageTypes: 'local_storage,session_storage' })
  if (rtFile) await b.send('Network.setCookie', { name: 'shitu_rt', value: readRt(rtFile), url: conf.base + conf.cookiePath, path: conf.cookiePath, httpOnly: true })
  if (s.pre) { await b.send('Page.navigate', { url: conf.base + s.pre }); await b.settle() }
  if (s.rules) await b.intercept(s.rules)
  await b.send('Page.navigate', { url: conf.base + s.path })
  await b.settle()
  const issues = []
  for (const [i, step] of (s.steps ?? []).entries()) {
    const res = await b.send('Runtime.evaluate', { expression: step, awaitPromise: true })
    if (res.result?.exceptionDetails) issues.push(`第 ${i + 1} 步出错：` + (res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text).split('\n')[0])
    if (s.quick && i === s.steps.length - 1) await new Promise((r) => setTimeout(r, 500))
    else await b.settle()
  }
  const overflow = (await b.send('Runtime.evaluate', { returnByValue: true, expression: 'document.documentElement.scrollWidth - window.innerWidth' })).result?.result?.value
  if (overflow > 0) issues.push(`横向溢出 ${overflow}px`)
  if (s.app === 'seeker') {
    // 求职者端不出现内部术语（D-51）
    const text = (await b.send('Runtime.evaluate', { returnByValue: true, expression: 'document.body.innerText' })).result?.result?.value ?? ''
    const words = ['私域', '公域', '确权', '释放'].filter((w) => text.includes(w))
    if (words.length) issues.push(`出现了内部术语：${words.join('、')}`)
  }
  const shot = await b.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.result.data, 'base64'))
  if (rtFile) {
    const ck = await b.send('Network.getCookies', { urls: [conf.base + conf.cookiePath + '/refresh'] })
    const rt = ck.result.cookies.find((c) => c.name === 'shitu_rt')
    if (rt) writeRt(rtFile, rt.value)
  }
  await b.send('Network.clearBrowserCookies')
  await b.close()
  if (issues.length) bad++
  console.log(`${issues.length ? 'ISSUE' : 'ok   '}  ${name}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`)
}
console.log(`\n== 截了 ${todo.length} 张，${bad} 张有问题，图在 ${OUT}`)
process.exit(bad ? 1 : 0)
