// 状态截图：shots.mjs 只截每页的正常样子，这里补加载中、失败、弹层、被拒提示和 360 宽。
// 用法：node states.mjs <输出目录> [--app seeker] [--only 名字里包含的一段]
//   node states.mjs ../../.atw/tasks/<任务>/screenshots --app seeker
// 文件名：<端>_<页面>_<状态>_<宽>x<高>.png。前提同 shots.mjs（后端、dev server、Chrome 9888、跑过 seed.mjs）。
// 这里只看不写：会落库的接口（发起匹配、报名、投诉）一律用 rules 拦住，不让请求真的发到后端。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTab } from './cdp.mjs'
import { get, seekerSession, readRt, writeRt } from './lib.mjs'
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
const wait = (ms) => `new Promise((r) => setTimeout(r, ${ms}))`
const JOB = `/jobs/${data.ids.matchedJobId}`
const JOB_API = `/seeker/jobs/${data.ids.matchedJobId}`
const refuse = (code, message) => ({ code, message, data: null })
const reply = (body) => ({ code: '0', message: 'ok', data: body })
// 岗位详情的真实数据：在它上面改一个字段，截「不能报名」这类靠接口字段决定的状态
const jobReal = (await get(JOB_API, await seekerSession(data.personas.matched.phone))).data
// 假的匹配结果：4 张卡，第 2 张匹配度不到 80。页面应当只出 3 张、第 2 张不显示匹配度
const fakeCard = (rank, title, matchScore) => ({ rank, jobId: 'J-SHOT-' + rank, title, companyName: '仕兔演示劳务', city: '苏州', address: '昆山市锦溪镇长云路 1 号',
  matchScore, salaryMin: 5000 + rank * 100, salaryMax: 6000 + rank * 100, shiftType: 'DAY', dormProvided: true, dormRoomSize: 4, dormAircon: true, mealProvided: true, quotaRemaining: 10, reason: '' })
const fakeOutcome = reply({ sessionId: 'MS-SHOT', scope: 'OWN_COMPANY', matched: true, engineVersion: 1, quizVersion: 1,
  results: [fakeCard(1, '第一张卡', 91), fakeCard(2, '不到线的卡', 76), fakeCard(3, '第三张卡', 80), fakeCard(4, '第四张卡', 88)] })
const unmatched = (scope) => ({ code: '0', message: 'ok', data: { sessionId: 'MS-SHOT', scope, matched: false, results: [], engineVersion: 1, quizVersion: 1 } })
// 答题：每题点第一个不用选城市的选项，一直点到最后一题也选好
const answerAll = `(async () => { for (let i = 0; i < 12; i++) {
  [...document.querySelectorAll('[role=radio]')].find((b) => !b.innerText.includes('城市')).click(); await ${wait(500)}
  if ([...document.querySelectorAll('button')].some((b) => b.innerText.includes('生成我的求职画像') && !b.disabled)) return } })()`
// 报名成功页读的是问薪暂存里的报名结果（同 routes.mjs 的 enterApplySuccess）
const enterApplySuccess = `sessionStorage.setItem('shitu.match', ${JSON.stringify(JSON.stringify({
  owner: data.personas.acknowledged.userId, quizVersion: null, answers: {}, step: 0, applyResult: data.ids.applyResult }))}); location.assign('/apply/success')`

// ---- 检查：截图前在页面里执行，返回空串算通过，返回文字就是问题说明 ----
const optionsTall = `(() => { const hs = [...document.querySelectorAll('[role=radio]')].map((b) => Math.round(b.getBoundingClientRect().height))
  return hs.length && hs.every((h) => h >= 52) ? '' : '选项高度不到 52：' + (hs.join('、') || '没有选项') })()`
const quizProgress = `/第 \\d+ \\/ \\d+ 题/.test(document.body.innerText) ? '' : '没有「第 n / N 题」进度'`
const selectedMark = `(() => { const on = document.querySelector('[role=radio][aria-checked=true]'), off = document.querySelector('[role=radio][aria-checked=false]')
  if (!on || !off) return '没有选中的选项'
  const a = getComputedStyle(on), b = getComputedStyle(off)
  if (a.borderTopColor === b.borderTopColor || a.backgroundColor === b.backgroundColor) return '选中态的描边或底色和未选中一样'
  return on.querySelector('svg') && !off.querySelector('svg') ? '' : '选中态没有勾' })()`
// 岗位卡：最多 3 张；匹配度不到 80 不显示；薪资写成「x,xxx–x,xxx 元/月（综合）」
const jobCards = `(() => { const cards = [...document.querySelectorAll('article')]
  if (!cards.length || cards.length > 3) return '岗位卡 ' + cards.length + ' 张'
  for (const c of cards) { const t = c.innerText.replace(/\\s+/g, ' ')
    if (!/\\d{1,3}(,\\d{3})*(–\\d{1,3}(,\\d{3})*)? ?元\\/月（综合）/.test(t)) return '薪资写法不对：' + t.slice(0, 60)
    const m = /匹配度 ?(\\d+)%/.exec(t); if (m && Number(m[1]) < 80) return '显示了不到 80% 的匹配度' }
  return '' })()`
// 薪资数字：18px 以上、600 字重，颜色是薪资色变量
const salaryBig = `(() => { const probe = document.body.appendChild(document.createElement('i')); probe.style.color = 'var(--salary)'
  const want = getComputedStyle(probe).color; probe.remove()
  const els = [...document.querySelectorAll('#app *')].filter((e) => !e.children.length && /^\\d{1,3}(,\\d{3})+(–\\d{1,3}(,\\d{3})+)?$/.test(e.textContent.trim()))
  if (!els.length) return '没找到薪资大字'
  const bad = els.filter((e) => { const cs = getComputedStyle(e); return parseFloat(cs.fontSize) < 18 || Number(cs.fontWeight) < 600 })
  if (bad.length) return '薪资数字不够大或不够粗：' + bad[0].textContent
  const off = els.filter((e) => getComputedStyle(e).color !== want)
  return off.length ? '薪资数字不是薪资色：' + off[0].textContent + ' ' + getComputedStyle(off[0]).color : '' })()`
// 假数据专用：恰好 3 张卡，不到线的那张不带匹配度，到线的带
const fakeCards = `(() => { const cards = [...document.querySelectorAll('article')].map((c) => c.innerText)
  if (cards.length !== 3) return '给了 4 张卡，页面出了 ' + cards.length + ' 张'
  const low = cards.find((t) => t.includes('不到线的卡'))
  if (!low || low.includes('匹配度')) return '76% 的卡显示了匹配度（或这张卡没出来）'
  return cards[0].includes('匹配度 91%') && cards[2].includes('匹配度 80%') ? '' : '到线的卡没显示匹配度' })()`
// 点击区不小于 44×44（高度；宽度由文字决定的小标签只看高）
const tapTall = (selector) => `(() => { const hs = [...document.querySelectorAll(${JSON.stringify(selector)})].map((b) => Math.round(b.getBoundingClientRect().height))
  return hs.length && hs.every((h) => h >= 44) ? '' : '点击区不到 44 高（${selector}）：' + (hs.join('、') || '没找到') })()`
const notBusy = `document.querySelector('.bottom-bar .van-button--loading') ? '被拒之后底部按钮还在转「提交中」' : ''`
const applyOff = `(() => { const b = [...document.querySelectorAll('.bottom-bar button')].find((x) => x.innerText.includes('报名面试'))
  return b && b.disabled && document.querySelector('.bottom-bar').innerText.includes('名额已满') ? '' : '不能报名时按钮没置灰或没写原因' })()`
// 底部固定通栏：按钮高 48、通栏；滚到底时不挡住正文
const bottomBar = (text) => `(async () => { const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(text)}))
  if (!btn) return '没有「${text}」按钮'
  let bar = btn; while (bar && getComputedStyle(bar).position !== 'fixed') bar = bar.parentElement
  if (!bar) return '「${text}」不在底部固定栏里'
  const r = btn.getBoundingClientRect()
  if (Math.round(r.height) < 48) return '通栏按钮高 ' + r.height
  window.scrollTo(0, document.documentElement.scrollHeight); await ${wait(200)}
  const top = bar.getBoundingClientRect().top
  const texts = [...document.querySelectorAll('#app *')].filter((e) => !bar.contains(e) && e.getClientRects().length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  const low = Math.max(...texts.map((e) => e.getBoundingClientRect().bottom))
  window.scrollTo(0, 0); await ${wait(200)}
  return low > top + 1 ? '滚到底时正文被底部栏挡住 ' + Math.round(low - top) + 'px' : '' })()`

// 每项：端、页面、状态、人物、地址；width 不写是 390；rules 是接口拦截（见 cdp.mjs 的 intercept）；
// steps 是打开后依次在页面里执行的脚本；quick = 最后一步之后不等页面安静，马上截（轻提示两秒就消失）；
// checks 是截图前的检查（见上）
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

  // 工单 07：问薪开场
  { app: 'seeker', screen: 'match-intro', state: 'normal', persona: 'registered', path: '/match', checks: [bottomBar('开始回答')] },
  { app: 'seeker', screen: 'match-intro', state: 'normal', persona: 'registered', path: '/match', width: NARROW },
  { app: 'seeker', screen: 'match-intro', state: 'public', persona: 'public', path: '/match' },
  { app: 'seeker', screen: 'match-intro', state: 'locked', persona: 'acknowledged', path: '/match' },
  { app: 'seeker', screen: 'match-intro', state: 'loading', persona: 'registered', path: '/match', rules: [{ url: '/seeker/quiz', action: 'hang' }] },
  { app: 'seeker', screen: 'match-intro', state: 'error', persona: 'registered', path: '/match', rules: [{ url: '/seeker/quiz', action: 'fail' }] },
  // 答题
  { app: 'seeker', screen: 'match-quiz', state: 'normal', persona: 'registered', path: '/match/quiz', checks: [quizProgress, optionsTall, bottomBar('下一题')] },
  { app: 'seeker', screen: 'match-quiz', state: 'normal', persona: 'registered', path: '/match/quiz', width: NARROW, checks: [optionsTall] },
  { app: 'seeker', screen: 'match-quiz', state: 'selected', persona: 'registered', path: '/match/quiz',
    steps: [`document.querySelector('[role=radio]').click()`, click('上一题')], checks: [selectedMark, optionsTall] },
  { app: 'seeker', screen: 'match-quiz', state: 'last', persona: 'registered', path: '/match/quiz', steps: [answerAll], checks: [bottomBar('生成我的求职画像')] },
  { app: 'seeker', screen: 'match-quiz', state: 'city', persona: 'registered', path: '/match/quiz',
    steps: [`(async () => { for (let i = 0; i < 12; i++) { const need = [...document.querySelectorAll('[role=radio]')].find((b) => b.innerText.includes('城市'))
      if (need) return need.click(); document.querySelector('[role=radio]').click(); await ${wait(500)} } })()`] },
  { app: 'seeker', screen: 'match-quiz', state: 'loading', persona: 'registered', path: '/match/quiz', rules: [{ url: '/seeker/quiz', action: 'hang' }] },
  { app: 'seeker', screen: 'match-quiz', state: 'error', persona: 'registered', path: '/match/quiz', rules: [{ url: '/seeker/quiz', action: 'fail' }] },
  { app: 'seeker', screen: 'match-quiz', state: 'empty', persona: 'registered', path: '/match/quiz',
    rules: [{ url: '/seeker/quiz', action: 'respond', body: { code: '0', message: 'ok', data: { versionId: 1, name: '', questions: [] } } }] },
  { app: 'seeker', screen: 'match-quiz', state: 'locked', persona: 'acknowledged', path: '/match/quiz' },
  { app: 'seeker', screen: 'match-quiz', state: 'submitting', persona: 'registered', path: '/match/quiz', rules: [{ url: '/seeker/match', action: 'hang' }],
    steps: [answerAll, click('生成我的求职画像'), wait(1500)], quick: true },
  { app: 'seeker', screen: 'match-quiz', state: 'rejected', persona: 'registered', path: '/match/quiz',
    rules: [{ url: '/seeker/match', action: 'respond', body: refuse('LC_4003', '你已报名岗位，面试结果出来前不能重新匹配') }],
    steps: [answerAll, click('生成我的求职画像')] },
  // 匹配结果
  { app: 'seeker', screen: 'match-result', state: 'normal', persona: 'matched', path: '/match/result', checks: [jobCards, salaryBig] },
  { app: 'seeker', screen: 'match-result', state: 'normal', persona: 'matched', path: '/match/result', width: NARROW, checks: [jobCards] },
  { app: 'seeker', screen: 'match-result', state: 'four-cards', persona: 'matched', path: '/match/result',
    rules: [{ url: '/seeker/match/latest', action: 'respond', body: fakeOutcome }], checks: [fakeCards, jobCards, salaryBig] },
  { app: 'seeker', screen: 'match-result', state: 'public', persona: 'public', path: '/match/result' },
  { app: 'seeker', screen: 'match-result', state: 'locked', persona: 'acknowledged', path: '/match/result' },
  { app: 'seeker', screen: 'match-result', state: 'empty', persona: 'registered', path: '/match/result' },
  { app: 'seeker', screen: 'match-result', state: 'loading', persona: 'matched', path: '/match/result', rules: [{ url: '/seeker/match/latest', action: 'hang' }] },
  { app: 'seeker', screen: 'match-result', state: 'error', persona: 'matched', path: '/match/result', rules: [{ url: '/seeker/match/latest', action: 'fail' }] },
  { app: 'seeker', screen: 'match-result', state: 'unmatched', persona: 'registered', path: '/match/result',
    rules: [{ url: '/seeker/match/latest', action: 'respond', body: unmatched('OWN_COMPANY') }] },
  { app: 'seeker', screen: 'match-result', state: 'unmatched-public', persona: 'public', path: '/match/result',
    rules: [{ url: '/seeker/match/latest', action: 'respond', body: unmatched('ALL_PLATFORM') }] },
  // 岗位详情和它的三个弹层
  { app: 'seeker', screen: 'job-detail', state: 'normal', persona: 'matched', path: JOB, checks: [bottomBar('报名面试'), salaryBig] },
  { app: 'seeker', screen: 'job-detail', state: 'normal', persona: 'matched', path: JOB, width: NARROW, checks: [bottomBar('报名面试')] },
  { app: 'seeker', screen: 'job-detail', state: 'loading', persona: 'matched', path: JOB, rules: [{ url: JOB_API, action: 'hang' }] },
  { app: 'seeker', screen: 'job-detail', state: 'error', persona: 'matched', path: JOB, rules: [{ url: JOB_API, action: 'fail' }] },
  { app: 'seeker', screen: 'job-detail', state: 'submitting', persona: 'matched', path: JOB, rules: [{ url: '/seeker/applications', action: 'hang' }],
    steps: [click('报名面试')], quick: true },
  { app: 'seeker', screen: 'job-detail', state: 'rejected', persona: 'matched', path: JOB,
    rules: [{ url: '/seeker/applications', action: 'respond', body: refuse('APP_4011', '未满 18 周岁，暂不能报名') }], steps: [click('报名面试')], checks: [notBusy] },
  { app: 'seeker', screen: 'job-detail', state: 'cannot-apply', persona: 'matched', path: JOB,
    rules: [{ url: JOB_API, action: 'respond', body: reply({ ...jobReal, canApply: false, cannotApplyReason: '该岗位名额已满，请重新匹配' }) }], checks: [applyOff, bottomBar('报名面试')] },
  { app: 'seeker', screen: 'job-detail', state: 'not-found', persona: 'matched', path: JOB, rules: [{ url: JOB_API, action: 'respond', body: reply(null) }] },
  { app: 'seeker', screen: 'job-disclaimer', state: 'normal', persona: 'matched', path: JOB,
    rules: [{ url: '/seeker/applications', action: 'respond', body: refuse('APP_4012', '请先阅读并同意求职告知书') }], steps: [click('报名面试')], checks: [tapTall('[role=checkbox]')] },
  { app: 'seeker', screen: 'job-disclaimer', state: 'loading', persona: 'matched', path: JOB,
    rules: [{ url: '/seeker/applications', action: 'respond', body: refuse('APP_4012', '请先阅读并同意求职告知书') }, { url: '/seeker/disclaimer', action: 'hang' }],
    steps: [click('报名面试')], quick: true },
  { app: 'seeker', screen: 'job-disclaimer', state: 'normal', persona: 'matched', path: JOB, width: NARROW,
    rules: [{ url: '/seeker/applications', action: 'respond', body: refuse('APP_4012', '请先阅读并同意求职告知书') }], steps: [click('报名面试')] },
  { app: 'seeker', screen: 'job-disclaimer', state: 'error', persona: 'matched', path: JOB,
    rules: [{ url: '/seeker/applications', action: 'respond', body: refuse('APP_4012', '请先阅读并同意求职告知书') }, { url: '/seeker/disclaimer', action: 'fail' }],
    steps: [click('报名面试')] },
  { app: 'seeker', screen: 'job-ask', state: 'normal', persona: 'matched', path: JOB, steps: [click('问问这个岗位')], checks: [tapTall('.van-popup .chip-tap')] },
  // 问答弹层自己不拉数据，「加载」和「提交中」是同一个画面：等回答时气泡里转圈、发送按钮转圈
  { app: 'seeker', screen: 'job-ask', state: 'submitting', persona: 'matched', path: JOB, rules: [{ url: '/ask', action: 'hang' }],
    steps: [click('问问这个岗位'), click('包吃住吗')], quick: true },
  { app: 'seeker', screen: 'job-ask', state: 'normal', persona: 'matched', path: JOB, width: NARROW, steps: [click('问问这个岗位')] },
  { app: 'seeker', screen: 'job-ask', state: 'answered', persona: 'matched', path: JOB,
    rules: [{ url: '/ask', action: 'respond', body: { code: '0', message: 'ok', data: { answered: true, answer: '包吃包住，宿舍 8 人间，有空调。', matchedQuestion: '包吃住吗？' } } }],
    steps: [click('问问这个岗位'), click('包吃住吗')] },
  { app: 'seeker', screen: 'job-ask', state: 'error', persona: 'matched', path: JOB, rules: [{ url: '/ask', action: 'fail' }],
    steps: [click('问问这个岗位'), click('包吃住吗')] },
  { app: 'seeker', screen: 'job-complaint', state: 'normal', persona: 'matched', path: JOB, steps: [click('投诉该岗位')] },
  { app: 'seeker', screen: 'job-complaint', state: 'selected', persona: 'matched', path: JOB, width: NARROW,
    steps: [click('投诉该岗位'), click('岗位信息不实')], checks: [selectedMark, optionsTall] },
  { app: 'seeker', screen: 'job-complaint', state: 'submitting', persona: 'matched', path: JOB, rules: [{ url: '/seeker/complaints', action: 'hang' }],
    steps: [click('投诉该岗位'), click('岗位信息不实'), click('提交投诉')], quick: true },
  { app: 'seeker', screen: 'job-complaint', state: 'rejected', persona: 'matched', path: JOB,
    rules: [{ url: '/seeker/complaints', action: 'respond', body: refuse('APP_4004', '只能投诉你匹配到或报名过的岗位') }],
    steps: [click('投诉该岗位'), click('岗位信息不实'), click('提交投诉')], quick: true },
  // 报名成功
  { app: 'seeker', screen: 'apply-success', state: 'normal', persona: 'acknowledged', path: '/reports', steps: [enterApplySuccess], checks: [bottomBar('查看我的报备')] },
  { app: 'seeker', screen: 'apply-success', state: 'normal', persona: 'acknowledged', path: '/reports', steps: [enterApplySuccess], width: NARROW },
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
  for (const check of s.checks ?? []) {
    const res = await b.send('Runtime.evaluate', { expression: check, awaitPromise: true, returnByValue: true })
    const said = res.result?.exceptionDetails ? '检查脚本出错：' + (res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text).split('\n')[0] : res.result?.result?.value
    if (said) issues.push(said)
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
