// 状态截图：shots.mjs 只截每页的正常样子，这里补加载中、失败、弹层、被拒提示和 360 宽。
// 用法：node states.mjs <输出目录> [--app seeker] [--only 名字里包含的一段]
//   node states.mjs ../../.atw/tasks/<任务>/screenshots --app seeker
// 文件名：<端>_<页面>_<状态>_<宽>x<高>.png。前提同 shots.mjs（后端、dev server、Chrome 9888、跑过 seed.mjs）。
// 这里只看不写：会落库的接口（发起匹配、报名、投诉、答复顾问推荐、实名、申诉、保存简历、发起预支、工资申诉、标记消息已读、提交反馈、退出登录）一律用 rules 拦住，不让请求真的发到后端。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTab } from './cdp.mjs'
import { get, seekerSession, tenantSession, readRt, writeRt } from './lib.mjs'
import { APPS, MEMBERS, VIEWPORT, parseArgs } from './routes.mjs'

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
// 底部固定通栏：按钮高 48、通栏；带标签栏时贴在标签栏上方不压住它；滚到底时不挡住正文。查完滚回原来的位置，截图还是截原来那一屏
const bottomBar = (text) => `(async () => { const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(text)}))
  if (!btn) return '没有「${text}」按钮'
  let bar = btn; while (bar && getComputedStyle(bar).position !== 'fixed') bar = bar.parentElement
  if (!bar) return '「${text}」不在底部固定栏里'
  const r = btn.getBoundingClientRect()
  if (Math.round(r.height) < 48) return '通栏按钮高 ' + r.height
  const tabbar = [...document.querySelectorAll('.van-tabbar')].find((t) => t.getClientRects().length)
  if (tabbar && bar.getBoundingClientRect().bottom > tabbar.getBoundingClientRect().top + 1) return '底部栏压住了标签栏 ' + Math.round(bar.getBoundingClientRect().bottom - tabbar.getBoundingClientRect().top) + 'px'
  const y0 = window.scrollY
  window.scrollTo(0, document.documentElement.scrollHeight); await ${wait(200)}
  const top = bar.getBoundingClientRect().top
  const texts = [...document.querySelectorAll('#app *')].filter((e) => !bar.contains(e) && !e.closest('.van-tabbar') && e.getClientRects().length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  const low = Math.max(...texts.map((e) => e.getBoundingClientRect().bottom))
  window.scrollTo(0, y0); await ${wait(200)}
  return low > top + 1 ? '滚到底时正文被底部栏挡住 ' + Math.round(low - top) + 'px' : '' })()`

// ---- 工单 08：报备、面试、推荐、台账、我的工作 ----
const APPS_API = '/seeker/applications'
const DECIDE_API = '/decision'
const fakeNotice = { interviewAt: '2026-12-30T09:30:00', address: '昆山市锦溪镇长云路 1 号东门招聘中心', routeTips: '地铁 11 号线花桥站 2 号口出，换乘 C2 路到长云路站，下车往东走 200 米',
  documents: ['身份证原件', '一寸照片 2 张', '本人银行卡'], contactName: '王磊', contactPhone: '13800000003', pushedAt: '2026-11-12T16:57:56' }
const fakeApp = (n, status, extra = {}) => ({ applicationId: 'BM-SHOT-' + n, jobId: 'J-SHOT-' + n, jobTitle: '成品仓储分拣员 ' + n, companyName: '仕兔演示劳务', projectName: '立讯精密昆山二期',
  city: '苏州', address: '昆山市锦溪镇长云路 1 号东门招聘中心', status, createdAt: `2026-11-0${n}T10:00:00`, ...extra })
// 七种报名状态各一张：真实数据里每个人最多一两张，看不全标签色调，也看不到「待签约入职」这个叫法
const fakeApps = reply([fakeApp(1, 'PENDING_INTERVIEW', { notice: fakeNotice }), fakeApp(2, 'PENDING_CONFIRM'), fakeApp(3, 'EMPLOYED'),
  fakeApp(4, 'CANCELLED', { endedAt: '2026-11-05T10:00:00', endReason: 'CANCEL_APPLICATION' }), fakeApp(5, 'INTERVIEW_FAILED', { endedAt: '2026-11-06T10:00:00' }),
  fakeApp(6, 'NO_SHOW', { endedAt: '2026-11-07T10:00:00' }), fakeApp(7, 'TIMEOUT', { endedAt: '2026-11-08T10:00:00' })])
const fakeRec = (id, decision, note) => ({ id, jobId: 'J-SHOT-' + id, jobTitle: '推荐岗位 ' + id, companyName: '仕兔演示劳务', note, decision, createdAt: '2026-11-12T09:00:00' })
const fakeRecs = reply([fakeRec(1, 'PENDING', '离你住的地方近，包吃住，长白班'), fakeRec(2, 'PENDING', ''), fakeRec(3, 'ACCEPTED', '这个岗位下周一就能进厂'), fakeRec(4, 'DECLINED', '')])
// 台账：报名记录带各种结束原因（含后端字典里叫「确权超时」「人工释放」的两种），面试记录带通过 / 未通过 / 待面试
const fakeLedger = reply({
  applications: [
    { applicationId: 'BM-SHOT-1', jobTitle: '成品仓储分拣员', companyName: '仕兔演示劳务', status: 'PENDING_INTERVIEW', createdAt: '2026-11-12T10:00:00', interviewAt: '2026-12-30T09:30:00', interviewAddress: '昆山市锦溪镇长云路 1 号东门招聘中心' },
    { applicationId: 'BM-SHOT-2', jobTitle: '电子组装普工', companyName: '仕兔演示劳务', status: 'EMPLOYED', createdAt: '2026-10-01T10:00:00', interviewAt: '2026-10-02T09:30:00', arrivedAt: '2026-10-02T09:10:00', interviewResult: 'PASS' },
    { applicationId: 'BM-SHOT-3', jobTitle: '质检员', companyName: '仕兔演示劳务', status: 'TIMEOUT', createdAt: '2026-09-01T10:00:00', interviewAt: '2026-09-02T09:30:00', arrivedAt: '2026-09-02T09:20:00', interviewResult: 'FAIL', endedAt: '2026-09-03T10:00:00', endReason: 'CONFIRM_TIMEOUT' },
    { applicationId: 'BM-SHOT-4', jobTitle: '叉车司机', companyName: '仕兔演示劳务', status: 'CANCELLED', createdAt: '2026-08-01T10:00:00', endedAt: '2026-08-02T10:00:00', endReason: 'RELEASE_MANUAL' },
    { applicationId: 'BM-SHOT-5', jobTitle: '包装工', companyName: '仕兔演示劳务', status: 'CANCELLED', createdAt: '2026-07-01T10:00:00', endedAt: '2026-07-02T10:00:00', endReason: 'BROKER_SLA_TIMEOUT' },
  ],
  employments: [
    { employmentId: 'E-SHOT-1', companyName: '仕兔演示劳务', projectName: '立讯精密昆山二期', jobTitle: '电子组装普工', startDate: '2026-10-03', days: 41 },
    { employmentId: 'E-SHOT-2', companyName: '仕兔演示劳务', projectName: '纬创昆山一期', jobTitle: '包装工', startDate: '2026-03-01', endDate: '2026-06-30', endReason: 'RESIGNED', days: 122 },
  ],
  payslips: [] })
const pastWork = reply({ employmentId: 'E-SHOT-2', companyName: '仕兔演示劳务', projectName: '纬创昆山一期', city: '苏州', address: '昆山市综保区第一大道 168 号', jobTitle: '包装工',
  startDate: '2026-03-01', endDate: '2026-06-30', dutyDays: 110, employeeNo: 'KS-0077' })
// 读一个设计变量算出来的颜色，和元素的实际颜色比
const tokenColor = (name) => `(() => { const p = document.body.appendChild(document.createElement('i')); p.style.color = 'var(${name})'; const c = getComputedStyle(p).color; p.remove(); return c })()`
// 分段标签：选中项是主色文字加 2px 主色下划线
const tabUnderline = `(() => { const on = document.querySelector('.van-tab--active'), line = document.querySelector('.van-tabs__line')
  if (!on || !line) return '没有分段标签或没有选中项'
  if (getComputedStyle(on).color !== ${tokenColor('--primary-text')}) return '选中的标签不是主色文字：' + getComputedStyle(on).color
  const cs = getComputedStyle(line)
  if (Math.round(parseFloat(cs.height)) !== 2) return '选中下划线不是 2px：' + cs.height
  if (cs.backgroundColor !== ${tokenColor('--primary')}) return '选中下划线不是主色：' + cs.backgroundColor
  const text = document.createRange(); text.selectNodeContents(on.querySelector('.van-tab__text') ?? on)
  const t = text.getBoundingClientRect(), l = line.getBoundingClientRect()
  if (l.width > t.width + 1) return '下划线（' + Math.round(l.width) + '）比标签文字（' + Math.round(t.width) + '）宽'
  return l.left < 16 ? '下划线左端越出页边距：' + Math.round(l.left) : '' })()`
// 文字链的点击区：宽高都不小于 44
const tapArea = (selector) => `(() => { const rs = [...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.getBoundingClientRect())
  if (!rs.length) return '没找到 ${selector}'
  const bad = rs.find((r) => Math.round(r.width) < 44 || Math.round(r.height) < 44)
  return bad ? '点击区不到 44×44（${selector}）：' + Math.round(bad.width) + '×' + Math.round(bad.height) : '' })()`
// 集合地点：标签在上、地址左对齐在下，不把路名拆到两行的两头
const addrStacked = `(() => { const row = [...document.querySelectorAll('#app .kv')].find((k) => k.querySelector('dt')?.innerText.trim() === '集合地点')
  if (!row) return '没有集合地点这一行'
  const dt = row.querySelector('dt').getBoundingClientRect(), dd = row.querySelector('dd')
  if (dd.getBoundingClientRect().top < dt.bottom - 1) return '集合地点的地址还和标签挤在同一行'
  return getComputedStyle(dd).textAlign === 'left' || getComputedStyle(dd).textAlign === 'start' ? '' : '集合地点的地址不是左对齐' })()`
// 列表卡片：每张都有共享状态标签，页面里没有旧标签类
const cardTags = `(() => { if (document.querySelector('#app .tag')) return '还在用旧标签类 .tag'
  const cards = [...document.querySelectorAll('#app article')]
  if (!cards.length) return '没有卡片'
  const bare = cards.filter((c) => !c.querySelector('.status-tag'))
  return bare.length ? '有卡片没用共享状态标签：' + bare[0].innerText.slice(0, 20) : '' })()`
const cardCount = (n) => `(() => { const c = document.querySelectorAll('#app article').length; return c === ${n} ? '' : '应该有 ${n} 张卡，页面出了 ' + c + ' 张' })()`
// 详情页分块：每个标题各占一张白卡片
const blocks = (...titles) => `(() => { const secs = [...document.querySelectorAll('#app section.acard')]
  const own = ${JSON.stringify(titles)}.map((t) => secs.find((s) => s.querySelector('h4')?.innerText.trim() === t))
  const miss = ${JSON.stringify(titles)}.filter((t, i) => !own[i])
  if (miss.length) return '缺少分块：' + miss.join('、')
  return new Set(own).size === own.length ? '' : '有几块挤在同一张卡片里' })()`
const has = (text) => `document.querySelector('#app').innerText.includes(${JSON.stringify(text)}) ? '' : '页面上没有「${text}」'`
const hasNot = (text) => `document.querySelector('#app').innerText.includes(${JSON.stringify(text)}) ? '页面上不该有「${text}」' : ''`
const idle = `document.querySelector('#app .van-button--loading') ? '被拒之后按钮还在转' : ''`
const spinning = (text) => `(() => { const b = [...document.querySelectorAll('#app .van-button--loading')]; return b.length === 1 && b[0].innerText.includes(${JSON.stringify(text)}) ? '' : '提交中应当只有「${text}」在转，实际 ' + b.length + ' 个' })()`
// 时间线、步骤条：每个节点都带状态文字（已完成 / 进行中 / 已结束 / 未开始），不只靠颜色
const nodesLabeled = `(() => { const nodes = [...document.querySelectorAll('#app .tl li, #app .wsteps li')]
  if (!nodes.some((e) => e.matches('.done, .now'))) return '没有完成或进行中的节点'
  const bad = nodes.filter((e) => !/已完成|进行中|已结束|未开始/.test(e.innerText))
  return bad.length ? '节点只靠颜色区分：' + bad[0].innerText.slice(0, 20) : '' })()`
const spinnerPrimary = `(() => { const s = document.querySelector('#app .van-loading__spinner'); if (!s) return '没有加载图标'
  return getComputedStyle(s).color === ${tokenColor('--primary')} ? '' : '加载图标不是主色：' + getComputedStyle(s).color })()`
// 一屏只有一个主色实心按钮
const onePrimary = `(() => { const n = [...document.querySelectorAll('#app .van-button--primary:not(.van-button--plain)')].filter((b) => b.getClientRects().length).length
  return n === 1 ? '' : '主色实心按钮有 ' + n + ' 个' })()`
const disabledBtn = (text) => `(() => { const b = [...document.querySelectorAll('#app button')].find((x) => x.innerText.includes(${JSON.stringify(text)})); return b && b.disabled ? '' : '「${text}」没有置灰' })()`
const clickTab = (text) => `[...document.querySelectorAll('.van-tab')].find((b) => b.innerText.includes(${JSON.stringify(text)})).click()`

// ---- 工单 09：实名、申诉、合同、简历 ----
const KYC_API = '/seeker/kyc'
const KYC_APPEALS_API = '/seeker/kyc/appeals'
const CONTRACTS_API = '/seeker/contracts'
const PENDING_API = '/seeker/contracts/pending'
const RESUME_API = '/seeker/resume'
// 还没实名的人：截图数据里的人物都实名过了，表单用这条假回应打开；提交（POST）另外拦
const kycNone = { url: KYC_API, method: 'GET', action: 'respond', body: reply({ kycStatus: 'NONE', canApply: false }) }
const kycPost = (action, body) => ({ url: KYC_API, method: 'POST', action, body })
const GOOD_ID = '110105199003070017', BAD_ID = '110105199003070010', OTHER_ID = '110105199003070025'
const fillKyc = (id, id2 = id) => [fill('与身份证上的姓名一致', '张伟民'), fill('18 位身份证号码', id), fill('请再输入一次', id2)]
// 错误提示：在字段下方、危险文字色
const fieldError = (text) => `(() => { const e = [...document.querySelectorAll('.van-field__error-message')].find((x) => x.innerText.includes(${JSON.stringify(text)}))
  if (!e) return '字段下方没有「${text}」'
  if (getComputedStyle(e).color !== ${tokenColor('--danger-text')}) return '错误提示不是危险文字色：' + getComputedStyle(e).color
  const body = e.closest('.van-field').querySelector('.van-field__body')
  return e.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 1 ? '' : '错误提示不在字段下方' })()`
// 表单：字段都在 Vant 单元格组里，输入框的字不小于 16px
const formGroups = `(() => { const fs = [...document.querySelectorAll('#app .van-field')]
  if (!fs.length) return '没有表单字段'
  if (fs.some((f) => !f.closest('.van-cell-group'))) return '有字段不在单元格组里'
  if (document.querySelector('#app input.inp, #app textarea.ta')) return '还在用旧的手写输入框'
  const small = fs.map((f) => f.querySelector('.van-field__control')).find((c) => parseFloat(getComputedStyle(c).fontSize) < 16)
  return small ? '输入框的字小于 16px' : '' })()`
// 正文不小于 15px：段落、键值、列表行、提示条和说明条（弹层挂在 body 上，所以不限定在 #app 里）
const bodyText = `(() => { const bad = [...document.querySelectorAll('.para, .kv dt, .kv dd, .item-sub, .tl-t, .tipbar-t, .tipbar-d, .note, .tips li, .bar-why')].find((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 15)
  return bad ? '正文小于 15px（' + getComputedStyle(bad).fontSize + '）：' + bad.innerText.slice(0, 20) : '' })()`
// 提交中不能重复点：先数 XHR 发了几条（countXhr 放在点提交之前），点两次提交，只能发出一条，按钮处于加载中
const countXhr = `(() => { window.__sent = 0; const send = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function (...a) { window.__sent++; return send.apply(this, a) } })()`
const findBtn = (text, scope = '#app') => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.innerText.includes(${JSON.stringify(text)}))`
const clickTwice = (text, scope) => `(async () => { ${findBtn(text, scope)}.click(); await ${wait(300)}; const again = document.querySelector(${JSON.stringify((scope ?? '#app') + ' .van-button--loading')}) ?? ${findBtn(text, scope)}; again?.click() })()`
const sentOnce = `window.__sent === 1 ? '' : '提交中又点了一次，请求发了 ' + window.__sent + ' 条'`
// 轻提示消失之后再截：它会压住正文，被拒的原因要在页面上留得住
const toastGone = (text) => `(async () => { await ${wait(400)}; if (!document.querySelector('.van-toast')?.innerText.includes(${JSON.stringify(text)})) throw new Error('被拒之后没有轻提示写明原因')
  await ${wait(2600)}; if ([...document.querySelectorAll('.van-toast')].some((t) => t.getClientRects().length)) throw new Error('轻提示还没消失') })()`
const stays = (selector, text) => `document.querySelector(${JSON.stringify(selector)})?.innerText.includes(${JSON.stringify(text)}) ? '' : '被拒的原因没有留在页面上（${selector}）'`
// 键值行里的长内容：标签在上、内容左对齐在下
const stacked = (label) => `(() => { const row = [...document.querySelectorAll('#app .kv')].find((k) => k.querySelector('dt')?.innerText.trim() === ${JSON.stringify(label)})
  if (!row) return '没有「${label}」这一行'
  const dt = row.querySelector('dt').getBoundingClientRect(), dd = row.querySelector('dd')
  if (dd.getBoundingClientRect().top < dt.bottom - 1) return '「${label}」的内容还和标签挤在同一行'
  return ['left', 'start'].includes(getComputedStyle(dd).textAlign) ? '' : '「${label}」的内容不是左对齐' })()`
const allRequired = `(() => { const fs = [...document.querySelectorAll('#app .van-field')]; const n = fs.filter((f) => f.querySelector('[class*="--required"]') || /--required/.test(f.className)).length
  return n === fs.length ? '' : '必填标记不统一：' + fs.length + ' 个字段只有 ' + n + ' 个带星号' })()`
const inView = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return '没找到 ${selector}'
  const r = e.getBoundingClientRect(), bar = document.querySelector('.bottom-bar')?.getBoundingClientRect().top ?? innerHeight
  return r.top >= 44 && r.bottom <= bar ? '' : '出错的字段不在当前这一屏里' })()`
const toBottom = `window.scrollTo(0, document.documentElement.scrollHeight)`
const fillAppeal = `(() => { const el = document.querySelector('.van-popup textarea'); el.value = '旧手机号已停用，申请换绑'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const noLegacy = `document.querySelector('#app .tag, #app .note--warn, #app .note--info, #app .mono, #app .num') ? '还在用旧的标签、提示或等宽数字类' : ''`
const fakeAppeal = (id, reviewType, status, extra = {}) => ({ id, reviewType, status, remark: '这是我本人身份证，旧手机号 138****1234 已停用，无法登录原账号，申请换绑到当前手机号。', createdAt: `2026-11-0${id}T10:00:00`, ...extra })
const fakeAppeals = reply([fakeAppeal(3, 'ID_OCCUPIED_APPEAL', 'PENDING'),
  fakeAppeal(2, 'BLACKLIST_APPEAL', 'REJECTED', { reviewerRemark: '经核查，失信标记与入职记录一致，维持原处理。', reviewedAt: '2026-11-06T15:00:00' }),
  fakeAppeal(1, 'ID_OCCUPIED_APPEAL', 'APPROVED', { reviewerRemark: '已核实为本人，旧账号已解绑。', reviewedAt: '2026-11-03T15:00:00' })])
const fakeContract = (n, status, extra = {}) => ({ contractId: 'LC-SHOT-' + n, contractNo: 'LC2026111200' + n, title: '劳动合同（劳务派遣）', companyName: '仕兔演示劳务',
  jobTitle: '成品仓储分拣员', projectName: '立讯精密昆山二期', termStart: '2025-11-12', termEnd: '2026-11-11', status, createdAt: '2025-11-12T09:00:00', signedAt: '2025-11-12T10:30:00', ...extra })
const pendingContract = { ...fakeContract(1, 'PENDING_SIGN', { termStart: '2026-11-12', termEnd: '2027-11-11', createdAt: '2026-11-12T09:00:00' }), signedAt: undefined }
// 五种合同状态各一张；待签署只会有一份，所以整页只有一个主色按钮
const fakeContracts = reply([{ ...pendingContract, signUrl: 'https://esign.example.com/sign/SHOT' },
  fakeContract(2, 'EFFECTIVE', { termStart: '2026-05-01', termEnd: '2027-04-30', createdAt: '2026-05-01T09:00:00', signedAt: '2026-05-01T10:30:00' }),
  fakeContract(3, 'TERMINATED'), fakeContract(4, 'EXPIRED', { termStart: '2024-05-01', termEnd: '2025-04-30', createdAt: '2024-05-01T09:00:00', signedAt: '2024-05-01T10:30:00' }),
  fakeContract(5, 'DISSOLVED', { termStart: '2023-05-01', termEnd: '2024-04-30', createdAt: '2023-05-01T09:00:00', signedAt: '2023-05-01T10:30:00' })])
const CONTRACT = `/contracts/${data.ids.contractId}`
const resumePut = (action, body) => ({ url: RESUME_API, method: 'PUT', action, body })

// ---- 工单 10：预支、工资条 ----
const QUOTA_API = '/seeker/advance/quota'
const ADV_API = '/seeker/advance'
const DEBT_API = '/seeker/advance/debt-log'
const SLIPS_API = '/seeker/payslips'
const ADV = `/advance/${data.ids.seekerAdvanceId}`
const SLIP = `/payslips/${data.ids.payslipId}`
const SLIP_API = `/seeker/payslips/${data.ids.payslipId}`
const SLIP_APPEALS_API = SLIP_API + '/appeals'
// 额度：真实数据里的老员工本月机会用完了、还有一笔在审批，「可以发起」和「次数用满」用假数据（字段和后端 AdvancePolicy 返回的一样）
const fakeQuota = (extra = {}) => reply({ eligible: true, reasons: [], dutyDays: 51, progressInCycle: 2, daysPerChance: 7, grantedThisMonth: 3, usedThisMonth: 1, remainingThisMonth: 2, monthlyLimit: 4, amount: 500, debt: 500, ...extra })
const fakeAdv = (n, status, extra = {}) => ({ advanceId: 'YZ-SHOT-' + n, userId: 'U-SHOT', projectId: 'P-SHOT', amount: 500, bizMonth: '2026-11', status, repaidAmount: 0,
  createdAt: `2026-11-0${n}T10:00:00`, allowedActions: [], projectName: '立讯精密昆山二期', ...extra })
// 同一时间只会有一笔在审批，所以五种状态里审批中的只放一张
const fakeAdvs = [fakeAdv(5, 'SITE_APPROVED'), fakeAdv(4, 'PAID', { paidAt: '2026-11-04T15:00:00' }),
  fakeAdv(3, 'PARTIALLY_REPAID', { bizMonth: '2026-10', createdAt: '2026-10-08T10:00:00', paidAt: '2026-10-08T15:00:00', repaidAmount: 200 }),
  fakeAdv(2, 'REPAID', { bizMonth: '2026-09', createdAt: '2026-09-08T10:00:00', paidAt: '2026-09-08T15:00:00', repaidAmount: 500 }), fakeAdv(1, 'REJECTED', { bizMonth: '2026-09', createdAt: '2026-09-01T10:00:00' })]
// 欠款流水：拨款带预支单号，工资抵扣带工资条号（后端两张表的写法）
const fakeDebtLog = reply([{ changeType: 'DEDUCT', amount: 200, balanceAfter: 800, payslipId: 'GZ-SHOT-1', createdAt: '2026-11-10T09:00:00' },
  { changeType: 'PAYOUT', amount: 500, balanceAfter: 1000, advanceId: 'YZ-SHOT-4', createdAt: '2026-11-04T15:00:00' },
  { changeType: 'PAYOUT', amount: 500, balanceAfter: 500, advanceId: 'YZ-SHOT-3', createdAt: '2026-10-08T15:00:00' }])
const advHome = (quota, list = [fakeAdv(4, 'PAID', { paidAt: '2026-11-04T15:00:00' })]) => [{ url: QUOTA_API, action: 'respond', body: quota }, { url: ADV_API, method: 'GET', action: 'respond', body: reply(list) }]
const advPost = (action, body) => ({ url: ADV_API, method: 'POST', action, body })
const advRecords = (list, log) => [{ url: QUOTA_API, action: 'respond', body: fakeQuota({ debt: 800 }) }, { url: DEBT_API, action: 'respond', body: log }, { url: ADV_API, method: 'GET', action: 'respond', body: reply(list) }]
const fakeDetail = (advance, approvals, ledger = []) => [{ url: ADV_API + '/' + advance.advanceId, action: 'respond', body: reply({ advance, approvals, ledger }) }]
const approve = (step, at, opinion) => ({ step, decision: 'APPROVE', at, ...(opinion ? { opinion } : {}) })
const partlyRepaid = fakeDetail(fakeAdvs[2], [approve('SITE', '2026-10-08T11:00:00', '出勤正常'), approve('PM', '2026-10-08T14:00:00', '同意'), approve('PAYOUT', '2026-10-08T15:00:00')],
  [{ changeType: 'PAYOUT', amount: 500, balanceAfter: 500, advanceId: 'YZ-SHOT-3', createdAt: '2026-10-08T15:00:00' },
    { changeType: 'DEDUCT', amount: 200, balanceAfter: 300, advanceId: 'YZ-SHOT-3', payslipId: 'GZ-SHOT-1', createdAt: '2026-11-10T09:00:00' }])
const rejectedAdv = fakeDetail(fakeAdvs[4], [{ step: 'SITE', decision: 'REJECT', opinion: '本周有 2 天旷工，考勤核实后再申请', at: '2026-09-01T16:00:00' }])
const fakeSlip = (n, payMonth, extra = {}) => ({ payslipId: 'GZ-SHOT-' + n, payMonth, companyName: '仕兔演示劳务', grossPay: 6200, socialInsurance: 420, incomeTax: 36.5, otherDeduct: 80, advanceDeduct: 0, netPay: 5663.5, ...extra })
const fakeSlips = [fakeSlip(1, '2026-10', { advanceDeduct: 500, netPay: 5163.5 }), fakeSlip(2, '2026-09'), fakeSlip(3, '2026-08', { grossPay: 4200, otherDeduct: 0, netPay: 3743.5 })]
const fakePayAppeal = (id, itemCode, status, extra = {}) => ({ id, payslipId: 'GZ-SHOT-1', itemCode, content: '本月出勤 26 天，应发应为 6200 元，工资条少算了 3 天加班。', status, createdAt: `2026-11-0${id}T10:00:00`, ...extra })
const fakePayAppeals = reply([fakePayAppeal(2, 'OTHER_DEDUCT', 'REJECTED', { reply: '其他扣款为工衣押金，离职时退还。', handledAt: '2026-11-03T10:00:00' }),
  fakePayAppeal(1, 'GROSS', 'RESOLVED', { reply: '已核实，少算的 3 天加班费在下月工资补发。', handledAt: '2026-11-02T10:00:00' })])
// 工资条明细：读工资条、读申诉、提交申诉是三个地址 / 方法。申诉地址更长，排在前面
const slipRules = (slip, appeals, post) => [...(post ? [{ url: SLIPS_API + '/' + slip.payslipId + '/appeals', method: 'POST', ...post }] : []),
  { url: SLIPS_API + '/' + slip.payslipId + '/appeals', method: 'GET', action: 'respond', body: appeals }, { url: SLIPS_API + '/' + slip.payslipId, action: 'respond', body: reply(slip) }]
// 真实工资条上有一条处理中的申诉（按钮置灰）；弹层用「没有申诉」的假回应打开，提交（POST）一律拦住
const appealOpenRules = (post) => [{ url: SLIP_APPEALS_API, method: 'POST', ...post }, { url: SLIP_APPEALS_API, method: 'GET', action: 'respond', body: reply([]) }]
const openAppeal = click('对这张工资条提出申诉')
const fillPayAppeal = (text) => `(() => { const el = document.querySelector('.van-popup textarea'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const sheetSubmit = `${findBtn('提交申诉', '.van-popup')}.click()`
// 金额：一级文字色、600 字重、数字等宽、靠右贴边；页面上不出现薪资色；零散的金额数字都套了金额样式
const moneyStyle = `(() => { const ink = ${tokenColor('--text-1')}, salary = ${tokenColor('--salary')}
  const ms = [...document.querySelectorAll('#app .money, #app .sum-amt')].filter((e) => e.getClientRects().length)
  if (!ms.length) return '页面上没有金额'
  for (const e of ms) { const cs = getComputedStyle(e), t = e.textContent.trim()
    if (cs.color !== ink) return '金额不是一级文字色：' + t + ' ' + cs.color
    if (Number(cs.fontWeight) < 600) return '金额没有加粗：' + t
    if (!cs.fontVariantNumeric.includes('tabular-nums')) return '金额数字不等宽：' + t
    const p = e.parentElement, pr = p.getBoundingClientRect().right - parseFloat(getComputedStyle(p).paddingRight)
    if (!['right', 'end'].includes(cs.textAlign) || pr - e.getBoundingClientRect().right > 1) return '金额没有右对齐：' + t }
  // 句子里的金额（「结余 ¥800.00」「应发 6,200.00」）：逐个文字节点找两位小数的数，所在元素得是金额类；按钮上的字不算
  const walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { const el = n.parentElement
    if (!/\\d[\\d,]*\\.\\d{2}/.test(n.textContent) || !el.getClientRects().length || el.closest('button, .van-button')) continue
    if (!el.closest('.money, .sum-amt, .money-in')) return '有金额没用金额样式：' + n.textContent.trim().slice(0, 24) }
  for (const e of document.querySelectorAll('#app .money-in')) { const cs = getComputedStyle(e)
    if (cs.color !== ink || Number(cs.fontWeight) < 600 || !cs.fontVariantNumeric.includes('tabular-nums')) return '句中金额不是一级文字色加粗等宽：' + e.textContent.trim() }
  if (/[−-]¥?0\\.00/.test(document.querySelector('#app').innerText)) return '零显示成了负零'
  const hot = [...document.querySelectorAll('#app *')].find((e) => e.getClientRects().length && getComputedStyle(e).color === salary)
  return hot ? '金额用了薪资色：' + hot.textContent.trim().slice(0, 20) : '' })()`
// 实发最醒目：实发是汇总卡的大数字，比页面上别的金额都大
const netLoudest = (net) => `(() => { const big = document.querySelector('#app .sum-amt')
  if (!big || big.textContent.trim() !== ${JSON.stringify(net)}) return '汇总卡的大数字不是实发 ${net}：' + (big?.textContent.trim() ?? '没有')
  const size = parseFloat(getComputedStyle(big).fontSize)
  const rival = [...document.querySelectorAll('#app .money')].find((e) => parseFloat(getComputedStyle(e).fontSize) >= size)
  return rival ? '有别的金额和实发一样大：' + rival.textContent.trim() : '' })()`
// 准入条件：n 项，每项都写「已满足 / 未满足」并带图标，其中 unmet 项未满足
const admission = (n, unmet) => `(() => { const rows = [...document.querySelectorAll('#app .rules li')]
  if (rows.length !== ${n}) return '准入条件应该有 ${n} 项，页面出了 ' + rows.length + ' 项'
  const bare = rows.find((r) => !/已满足|未满足/.test(r.innerText) || !r.querySelector('svg'))
  if (bare) return '准入条件有一项没写是否满足：' + bare.innerText.slice(0, 20)
  const no = rows.filter((r) => r.innerText.includes('未满足')).length
  return no === ${unmet} ? '' : '应该有 ${unmet} 项未满足，页面标了 ' + no + ' 项' })()`
const enabledBtn = (text) => `(() => { const b = ${findBtn(text)}; return b && !b.disabled ? '' : '「${text}」应该能点' })()`
const noBarWhy = `document.querySelector('#app .bottom-bar .bar-why') ? '能发起时按钮上方不该有原因：' + document.querySelector('#app .bottom-bar .bar-why').innerText : ''`
// 本月额度四格：每格都有文字状态
const slotTexts = (...want) => `(() => { const got = [...document.querySelectorAll('#app .slots .slot b')].map((b) => b.innerText.trim()).join('、'); return got === ${JSON.stringify(want.join('、'))} ? '' : '本月额度四格应该是 ${want.join('、')}，页面是 ' + got })()`
// 审批流转：每个节点都带文字状态
const advNodes = `(() => { const nodes = [...document.querySelectorAll('#app .tl li')]
  if (nodes.length < 2) return '审批流转不是时间线'
  const bad = nodes.find((e) => !/已完成|进行中|已驳回|已结束|未开始/.test(e.innerText))
  return bad ? '节点只靠颜色区分：' + bad.innerText.slice(0, 20) : '' })()`
const popupIdle = `document.querySelector('.van-popup .van-button--loading') ? '被拒之后「提交申诉」还在转' : ''`
const lrowCount = (n) => `(() => { const c = document.querySelectorAll('#app .lrow').length; return c === ${n} ? '' : '应该有 ${n} 行，页面出了 ' + c + ' 行' })()`

// ---- 工单 11：消息、反馈、我的 ----
const MSG_API = '/seeker/messages'
const MSG_READ_API = '/seeker/messages/read'
const MSG_UNREAD_API = '/seeker/messages/unread-count'
const FB_API = '/seeker/feedback'
const LOGOUT_API = '/seeker/auth/logout'
const fakeMsg = (id, templateCode, title, content, extra = {}) => ({ id, templateCode, title, content, priority: 0, read: false, createdAt: `2026-11-${String(id).padStart(2, '0')}T09:30:00`, ...extra })
// 未读带链接、未读不带链接（点了就地展开）、已读、最高优先级各一条；模板码和文案取后端真实发的那几种
const fakeMsgs = [fakeMsg(12, 'INJURY_ALERT', '工伤上报提醒', '驻场已为你登记工伤，请保留好就医票据，项目经理会在 1 个工作日内联系你。', { priority: 2 }),
  fakeMsg(11, 'INTERVIEW_INFO_PUSHED', '面试信息', '你报名的「成品仓储分拣员」面试时间 11月13日 09:30，地点 昆山市锦溪镇长云路 1 号东门招聘中心。请带好：身份证、一寸照片 2 张。', { link: '/reports' }),
  fakeMsg(10, 'ADVANCE_RESULT', '预支审批结果', '你的 500.00 元预支申请已拨款，将在发薪时从工资中抵扣。发薪日系统会自动抵扣，抵扣明细可以在「我的工资」对应月份的工资条里看到，有疑问可以在工资条页面提出申诉。'),
  fakeMsg(9, 'FEEDBACK_REPLIED', '问题反馈已回复', '你的反馈已回复：已请驻场老师把定位发到你的消息里，也可以直接拨打面试通知里的电话。', { link: '/feedback', read: true })]
// 标记已读（POST）一律拦住；地址更长的排前面
const msgRules = (post, list) => [{ url: MSG_READ_API, method: 'POST', ...post }, ...(list ? [{ url: MSG_UNREAD_API, action: 'respond', body: reply(list.filter((m) => !m.read).length) },
  { url: MSG_API, method: 'GET', action: 'respond', body: reply({ records: list, total: list.length, page: 1, pageSize: 20 }) }] : [])]
// 未读消息的标题前有给读屏用的「未读：」，比对标题时去掉
const msgRow = (title) => `[...document.querySelectorAll('#app .msg')].find((r) => r.querySelector('h3')?.innerText.trim().replace(/^未读：\\s*/, '') === ${JSON.stringify(title)})`
// 未读：左边主色圆点、标题 500 字重；已读：没有圆点、标题 400
const unreadMarks = (unread, read) => `(() => { const primary = ${tokenColor('--primary')}
  for (const t of ${JSON.stringify(unread)}) { const r = ${msgRow('__T__').replace('"__T__"', 't')}; if (!r) return '没有「' + t + '」这条消息'
    const dot = r.querySelector('.msg-dot'), h = r.querySelector('h3')
    if (!dot || getComputedStyle(dot).backgroundColor !== primary) return '未读的「' + t + '」没有主色圆点'
    if (dot.getBoundingClientRect().right > h.getBoundingClientRect().left) return '圆点不在标题左边'
    if (getComputedStyle(h).fontWeight !== '500') return '未读的「' + t + '」标题不是 500 字重：' + getComputedStyle(h).fontWeight }
  for (const t of ${JSON.stringify(read)}) { const r = ${msgRow('__T__').replace('"__T__"', 't')}; if (!r) return '没有「' + t + '」这条消息'
    const dot = r.querySelector('.msg-dot')
    if (dot && getComputedStyle(dot).backgroundColor === primary) return '已读的「' + t + '」还带着圆点'
    if (getComputedStyle(r.querySelector('h3')).fontWeight !== '400') return '已读的「' + t + '」标题不是 400 字重' }
  return '' })()`
// 每条消息：标题、时间、最多两行的摘要，摘要不小于 15px
const msgRows = (n) => `(() => { const rows = [...document.querySelectorAll('#app .msg')]
  if (rows.length !== ${n}) return '应该有 ${n} 条消息，页面出了 ' + rows.length + ' 条'
  for (const r of rows) { const c = r.querySelector('.msg-c'), cs = c && getComputedStyle(c)
    if (!r.querySelector('h3') || !r.querySelector('time') || !c) return '消息缺标题、时间或摘要：' + r.innerText.slice(0, 20)
    if (parseFloat(cs.fontSize) < 15) return '摘要小于 15px'
    if (!c.classList.contains('open') && c.getBoundingClientRect().height > parseFloat(cs.lineHeight) * 2 + 1) return '摘要超过两行：' + c.innerText.slice(0, 20) }
  return document.querySelector('#app .msgs svg:not([class*="lucide"])') ? '还有手写的内联图标' : '' })()`
// 每条消息的可点部分是标题里的按钮（铺满整行），按钮里不放 h3、p 这类块级内容
const msgButtons = `(() => { const rows = [...document.querySelectorAll('#app .msg')]
  if (!rows.length) return '没有消息'
  if (document.querySelector('#app button h1, #app button h2, #app button h3, #app button h4, #app button p, #app button div')) return '按钮里放了标题、段落或 div'
  const bare = rows.find((r) => !r.querySelector('h3 button')); return bare ? '有消息没有可按键操作的按钮：' + bare.innerText.slice(0, 10) : '' })()`
const readAllOff = disabledBtn('全部已读')
const readAllBtn = `(() => { const b = document.querySelector('#app .van-nav-bar__right button'); return b && b.innerText.includes('全部已读') ? '' : '顶栏右边没有「全部已读」' })()`
const fillArea = (value, scope = '#app') => `(() => { const el = document.querySelector(${JSON.stringify(scope + ' textarea')}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const fbPost = (action, body) => ({ url: FB_API, method: 'POST', action, body })
const fbList = (action, body) => ({ url: FB_API, method: 'GET', action, body })
const fakeFb = (id, category, status, extra = {}) => ({ id, category, content: '面试地址在地图上搜不到，能不能发个定位？', status, createdAt: `2026-11-0${id}T10:00:00`, ...extra })
const fakeFbs = reply([fakeFb(3, 'SUGGEST', 'OPEN', { content: '希望能在首页直接看到面试倒计时。' }),
  fakeFb(2, 'JOB', 'REPLIED', { reply: '已请驻场老师把定位发到你的消息里，也可以直接拨打面试通知里的电话。', handledAt: '2026-11-02T15:00:00' }),
  fakeFb(1, 'PAY', 'CLOSED', { content: '工资条里的其他扣款是什么？', handledAt: '2026-11-01T15:00:00' })])
const FB_TEXT = '面试地址在地图上搜不到，能不能发个定位？'
const CONTACT_PH = '如 13912345678'
// 选问题类型前后，每个选项的位置和宽度都不变（选中多出的勾不能把整片挤得重新折行）
const chipPos = `JSON.stringify([...document.querySelectorAll('#app .chip-tap')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)] }))`
const keepChipPos = `window.__chipPos = ${chipPos}`
const chipStable = `window.__chipPos === ${chipPos} ? '' : '选中问题类型后选项重新排了：' + window.__chipPos + ' → ' + ${chipPos}`
const pickCat = `[...document.querySelectorAll('#app .chip-tap')].find((b) => b.innerText.includes('岗位与报名')).click()`
// 个人中心：顶部资料卡（头像、姓名、打码的手机号、身份标签），下面是带图标和右箭头的分组单元格
const profileCard = `(() => { const c = document.querySelector('#app .me-card'); if (!c) return '没有顶部资料卡'
  if (getComputedStyle(c).backgroundColor !== ${tokenColor('--bg-card')}) return '资料卡不是白卡片'
  if (!c.querySelector('.avatar')) return '资料卡没有头像'
  if (!/\\d{3}\\*{4}\\d{4}/.test(c.innerText)) return '资料卡没有打码的手机号'
  if (!c.querySelector('.status-tag')) return '资料卡没有身份标签'
  return document.querySelector('#app .hero, #app .tag') ? '还在用深色状态头或旧标签' : '' })()`
const cellGroups = (n) => `(() => { const rows = [...document.querySelectorAll('#app .me-group .lrow')]
  if (rows.length !== ${n}) return '入口应该有 ${n} 行，页面出了 ' + rows.length + ' 行'
  if (document.querySelectorAll('#app .me-group').length < 2) return '入口没有分组'
  const bare = rows.find((r) => r.querySelectorAll('svg').length < 2 || !r.querySelector('.chev'))
  return bare ? '有入口缺图标或右箭头：' + bare.innerText.slice(0, 10) : '' })()`
// 「退出登录」是描边按钮：白底、有边框、不是主色实心
const logoutOutlined = `(() => { const b = ${findBtn('退出登录')}; if (!b) return '没有「退出登录」'
  const cs = getComputedStyle(b)
  if (cs.backgroundColor !== ${tokenColor('--bg-card')}) return '「退出登录」不是白底：' + cs.backgroundColor
  if (parseFloat(cs.borderTopWidth) < 1 || cs.borderTopColor === cs.backgroundColor) return '「退出登录」没有描边'
  return Math.round(b.getBoundingClientRect().height) >= 44 ? '' : '「退出登录」不到 44 高' })()`
// 资料没加载到（加载中、失败）：合同、工作、预支三行的副标题是「—」，不写「暂无合同」「尚未入职」这类结论
const descBlank = `(() => { const rows = [...document.querySelectorAll('#app .me-group .lrow')].filter((r) => /我的合同|我的工作|预支记录/.test(r.querySelector('b')?.innerText))
  if (rows.length !== 3) return '没找到合同、工作、预支三行'
  const bad = rows.find((r) => r.querySelector('.lt span').innerText.trim() !== '—'); return bad ? '资料没加载到时副标题下了结论：' + bad.innerText.replace(/\s+/g, ' ') : '' })()`
const confirmLogout = `${findBtn('退出', '.van-dialog')}.click()`

// 每项：端、页面、状态、人物、地址；width 不写是 390；rules 是接口拦截（见 cdp.mjs 的 intercept）；
// lateRules 是页面打开并安静下来之后才生效的拦截（排在 rules 前面），用来截「先正常打开、再点按钮时接口挂住」；
// steps 是打开后依次在页面里执行的脚本；quick = 最后一步之后不等页面安静，马上截（轻提示两秒就消失）；
// checks 是截图前的检查（见上）
// ---- 工单 12：驻场外壳、登录、工作台、待办、提醒、报名详情 ----
// 驻场端的写操作（知悉推送、到厂、面试结果、爽约、取消、确权、流转经纪人、标记已读、登录、退出，以及工单 13 的请假 / 旷工等 PUT、PATCH、DELETE）
// 一律拦住：除 GET 以外的方法都挂住；refresh 放行，否则进不了页面
const STAFF_SAFE = [{ url: '/tenant/auth/refresh', action: 'continue' }, { url: '/tenant/', method: '!GET', action: 'hang' }]
const sr = (...rules) => [...rules, ...STAFF_SAFE]
const WB_API = '/tenant/site/workbench', PP_API = '/tenant/site/private-pending', TAPPS_API = '/tenant/applications', TME_API = '/tenant/me'
const DETAIL = `/applications/${data.ids.siteApplicationId}`
const emptyPage = reply({ records: [], total: 0, page: 1, pageSize: 20 })
// 待办卡片的顺序：姓名、归属标签、剩余时间 → 岗位和面试时间 → 手机号 → 「拨打」和当前阶段的主按钮
const todoCards = (min = 1) => `(() => { const cards = [...document.querySelectorAll('#app article.app')]
  if (cards.length < ${min}) return '待办卡片不到 ${min} 张，实际 ' + cards.length
  for (const c of cards) {
    const name = c.querySelector('.item-hd h3'), tag = c.querySelector('.item-hd .status-tag'), left = c.querySelector('.item-hd .left')
    if (!name || !tag) return '卡片第一行没有姓名或归属标签'
    if (!/status-tag--(private|public|pending)/.test(tag.className)) return '归属标签不是三种归属色之一：' + tag.className
    const li = [...c.querySelectorAll('.facts li')]
    if (li.length < 2) return '卡片没有岗位和面试时间两行'
    const phone = li.find((l) => /\\d{3} ?\\d{4} ?\\d{4}/.test(l.innerText))
    const acts = c.querySelector('.acts')
    if (!acts) return '卡片没有操作按钮'
    const btns = [...acts.querySelectorAll('button, a.van-button')]
    if (!btns[0]?.innerText.includes('拨打')) return '第一个按钮不是「拨打」'
    if (!acts.querySelector('.van-button--primary')) return '没有当前阶段的主按钮'
    const cut = btns.find((b) => { const t = b.querySelector('.van-button__text'); return t && t.scrollWidth > t.clientWidth + 1 })
    if (cut) return '按钮文字被截断：' + cut.innerText
    const short = btns.map((b) => b.innerText.trim()).find((t) => ['知悉并推送', '入职确权', '查看签署码', '未通过'].includes(t))
    if (short) return '主按钮用了缩写「' + short + '」'
    const y = (e) => e.getBoundingClientRect().top
    if (left && Math.abs(y(left) - y(name)) > 24) return '剩余时间不在姓名那一行'
    if (!(y(name) < y(li[0]) && (!phone || y(li[1]) < y(phone)) && y(phone ?? li[1]) < y(acts))) return '卡片各行的顺序不对'
  }
  return '' })()`
const fourMetrics = `document.querySelectorAll('#app .metrics-card .metric').length === 4 ? '' : '指标不是 4 个'`
const whiteBg = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); const p = document.body.appendChild(document.createElement('i')); p.style.background = 'var(--bg-card)'; const c = getComputedStyle(p).backgroundColor; p.remove()
  return e && getComputedStyle(e).backgroundColor === c ? '' : '${sel} 不是白底' })()`
const pageBg = `(() => { const p = document.body.appendChild(document.createElement('i')); p.style.background = 'var(--bg-page)'; const c = getComputedStyle(p).backgroundColor; p.remove()
  return getComputedStyle(document.body).backgroundColor === c ? '' : '页面底不是浅灰' })()`
const tabbarIcons = `(() => { const t = document.querySelector('.van-tabbar'); if (!t) return '没有标签栏'
  return t.querySelectorAll('.van-tabbar-item svg').length === 4 && !t.querySelector('.van-icon') ? '' : '标签栏不是 4 个共享图标' })()`
// Vant 组件自带的返回箭头、下拉箭头、搜索框（.van-search）的放大镜、单元格右箭头保留；别的输入框左图标不放过，其余 van-icon 算业务图标
const staffLegacy = `document.querySelector('#app .tag, #app .num, #app .mono, #app .avatar--o, #app .hero, #app .van-icon:not(.van-icon-arrow-left):not(.van-icon-arrow-down):not(.van-badge__wrapper):not(.van-search .van-field__left-icon .van-icon):not(.van-cell__right-icon), #app .van-empty') ? '还在用旧标签、等宽数字类、深色头、Vant 图标或 van-empty' : ''`
const staffText = `(() => { const bad = [...document.querySelectorAll('#app .facts li, #app .tipbar-t, #app .tipbar-d, #app .note, #app .kv dt, #app .kv dd, #app .why, #app .bar-why, #app .state-block-d')].find((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 15)
  return bad ? '正文小于 15px：' + bad.innerText.slice(0, 20) : '' })()`
const alarm = `(() => { const a = document.querySelector('#app .alarm'); if (!a) return '没有超时提示条'
  if (!/\\d+ 人即将超时，最短还剩 (\\d+ 小时 \\d+ 分|\\d+ 分钟)/.test(a.innerText)) return '提示条没写几人即将超时、最短还剩多久（带单位）：' + a.innerText.slice(0, 40)
  // 「即将超时」是 4 小时内到期的窗口，最短还剩不能超过 4 小时，否则提示条自相矛盾
  const left = /最短还剩 (?:(\\d+) 小时 (\\d+) 分|(\\d+) 分钟)/.exec(a.innerText), mins = left[3] ? +left[3] : +left[1] * 60 + +left[2]
  if (mins > 240) return '提示条说即将超时，最短还剩却超过 4 小时：' + left[0]
  const go = a.querySelector('a'); if (!go?.innerText.includes('立即跟进')) return '提示条没有「立即跟进」'
  const t = a.querySelector('.tipbar-t'), d = a.querySelector('.tipbar-d')
  if (t.getClientRects().length > 1 || t.getBoundingClientRect().height > 30) return '提示条标题被挤成了两行'
  return go.getBoundingClientRect().top >= d.getBoundingClientRect().bottom - 1 ? '' : '「立即跟进」没放在提示条底部' })()`

// 元素整个在可视区内（顶栏 44 下、标签栏 / 底部栏上）
const onScreen = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return '没找到 ${sel}'
  const r = e.getBoundingClientRect(), bar = document.querySelector('.van-tabbar, .bottom-bar')?.getBoundingClientRect().top ?? innerHeight
  return r.top >= 44 && r.bottom <= bar ? '' : '${sel} 不在这一屏里' })()`
const scrollTo = (sel) => `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`
// 区块里的空状态说明不贴卡片边，末行不只剩一个字
const emptyPadded = `(() => { const d = document.querySelector('#app .todo-sec .state-block-d'), c = d?.closest('.acard'); if (!d) return '没有空状态说明'
  const range = document.createRange(); range.selectNodeContents(d); const lines = [...range.getClientRects()]
  const gap = Math.min(lines[0].left - c.getBoundingClientRect().left, c.getBoundingClientRect().right - Math.max(...lines.map((l) => l.right)))
  if (gap < 12) return '空状态说明离卡片边只有 ' + gap.toFixed(0) + 'px'
  const last = lines.at(-1); return lines.length > 1 && last.width < 20 ? '空状态说明末行只剩一个字' : '' })()`
// 登录页手机号：标签在上一行，下面「+86 | 输入框」是一个带四边边框的控件，在同一行
const loginPhone = `(() => { const lbl = document.querySelector('#app .fld-lbl'), box = document.querySelector('#app .fld--cc'); if (!lbl || !box) return '手机号没有单独的标签或合成控件'
  const cc = box.querySelector('.cc').getBoundingClientRect(), inp = box.querySelector('input').getBoundingClientRect(), b = box.getBoundingClientRect()
  if (lbl.getBoundingClientRect().bottom > b.top) return '手机号标签没在控件上面一行'
  if (Math.abs((cc.top + cc.bottom) / 2 - (inp.top + inp.bottom) / 2) > 4) return '「+86」和输入框不在同一行'
  const st = getComputedStyle(box); return ['Top', 'Right', 'Bottom', 'Left'].every((k) => parseFloat(st['border' + k + 'Width']) >= 1) ? '' : '手机号控件缺边框' })()`
// 弹层：选好的面试时间整段显示（不截成「09:」）；底部通栏在内容区下面，不盖住内容
const ackTimeWhole = `(() => { const v = document.querySelector('.ack .pick-val'); if (!v) return '面试时间不是文字显示'
  const cell = v.closest('.van-cell'), arrow = cell.querySelector('.van-cell__right-icon'), limit = arrow ? arrow.getBoundingClientRect().left : cell.getBoundingClientRect().right
  return /\\d{2}:\\d{2}$/.test(v.innerText) && v.scrollWidth <= v.clientWidth + 1 && v.getBoundingClientRect().right <= limit + 1 ? '' : '面试时间被截断：' + v.innerText })()`
const footClear = (scope) => `(() => { const body = document.querySelector('${scope} .body'), foot = document.querySelector('${scope} .foot')
  return body.getBoundingClientRect().bottom <= foot.getBoundingClientRect().top + 1 ? '' : '底部通栏盖住了内容' })()`
// 弹层内容左右边距 16
const popInset = (scope, sel) => `(() => { const e = document.querySelector('${scope} ${sel}'); if (!e) return '没找到 ${sel}'
  const r = e.getBoundingClientRect(); return Math.round(r.left) === 16 && Math.round(innerWidth - r.right) === 16 ? '' : '${sel} 左右边距是 ' + Math.round(r.left) + ' / ' + Math.round(innerWidth - r.right) })()`
const noToast = `[...document.querySelectorAll('.van-toast')].some((t) => t.getClientRects().length) ? '轻提示盖住了页面上的原因' : ''`
const fakeWb = (extra = {}) => reply({ pendingAck: 2, pendingInterview: 4, pendingConfirm: 2, windowsDueIn4h: 0, privatePending: 18, arrivedToday: 0, ...extra })
// 超时提示条：windowsDueIn4h 说 3 人 4 小时内到期，私域待匹配接口就得真有 3 条 4 小时内到期的窗口（其余用真实数据），
// 否则「最短还剩」取的是演示库里十几小时后的截止时间，提示条自相矛盾。截止时间是北京时间、不带时区，登记时间 = 截止 − 24 小时
const shIso = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19)
const ppReal = (await get(PP_API, await tenantSession(MEMBERS.site))).data
// 3 条完整的私域待匹配行（字段同 api-client 的 PrivatePendingRow），不依赖演示库现有条数；后面接演示库的真实行
const ppSoon = (n, min) => ({ userId: 'U-SHOT-' + n, seekerName: ['赵**', '钱**', '孙**'][n - 1], phone: '1390000000' + n,
  registeredAt: shIso(Date.now() + min * 60e3 - 24 * 3600e3), deadline: shIso(Date.now() + min * 60e3), channelCode: 'SHOT0' + n, channelMemberName: '王磊', inBrokerPool: false })
const ppDueSoon = reply([ppSoon(1, 110), ppSoon(2, 160), ppSoon(3, 210), ...ppReal])
const alarmRules = () => sr({ url: WB_API, action: 'respond', body: fakeWb({ windowsDueIn4h: 3 }) }, { url: PP_API, action: 'respond', body: ppDueSoon })
const dialogBtn = (text) => `[...document.querySelectorAll('.van-dialog button')].find((b) => b.innerText.includes(${JSON.stringify(text)})).click()`
// 弹窗确认按钮连点两次：第二次点的是正在转圈的那个按钮（转圈时文字不显示），没在转就再点一次确认
const dialogTwice = (text) => `(async () => { ${dialogBtn(text)}; await ${wait(300)}
  const again = document.querySelector('.van-dialog .van-button--loading') ?? [...document.querySelectorAll('.van-dialog button')].find((b) => b.innerText.includes(${JSON.stringify(text)})); again?.click() })()`
const staffMe = (status, extra = {}) => ({ url: TME_API, action: 'respond', body: reply({ memberId: 'M-SHOT', name: '王磊', phoneMasked: '138****0003', roles: ['SITE'], permissions: ['SITE_WORKBENCH'], operational: false,
  company: { companyId: 'C10001', name: '昆山仕兔演示劳务派遣有限公司', shortName: '仕兔演示劳务', status, ...extra } }) })

// 驻场的两个全屏弹层（知悉推送 .ack、确权签约 .cf）和原因弹窗（.reason-dlg）都挂在 body 上，检查不限定在 #app 里
const ACK_BTN = '确认知悉并推送', CF_BTN = '确认入职并发起电子签约'
const fillAddr = `(() => { const el = document.querySelector('.ack textarea'); if (!el.value.trim()) { el.value = '昆山开发区前进东路 88 号 2 号门'; el.dispatchEvent(new Event('input', { bubbles: true })) } })()`
const popSpin = (scope, text) => `(() => { const b = [...document.querySelectorAll('${scope} .van-button--loading')]; return b.length === 1 && b[0].innerText.includes(${JSON.stringify(text)}) ? '' : '提交中应当只有「${text}」在转，实际 ' + b.length + ' 个' })()`
// 被拒之后：原因留在弹层里，提交按钮不转、置灰
const popRejected = (scope, why, text) => `(() => { const w = document.querySelector('${scope} .bar-why, ${scope} .why'); if (!w?.getClientRects().length || !w.innerText.includes(${JSON.stringify(why)})) return '被拒的原因没有留在弹层里（${scope}）'
  if (document.querySelector('${scope} .van-button--loading')) return '被拒之后按钮还在转'
  const b = [...document.querySelectorAll('${scope} button')].find((x) => x.innerText.includes(${JSON.stringify(text)})); return b?.disabled ? '' : '被拒之后「${text}」没有置灰' })()`
// 弹层底部的主按钮在这一屏里、不被手势条挡住
const footInView = (scope) => `(() => { const b = document.querySelector('${scope} .foot .van-button'); if (!b) return '弹层没有底部按钮'
  const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top > innerHeight / 2 ? '' : '弹层底部按钮不在屏幕下方' })()`
// 弹层正文不小于 15px（说明、提示、键值；字段下的一行说明是辅助文字，不算）；可点的材料标签点击区不小于 44 高
const popText = (scope) => `(() => { const bad = [...document.querySelectorAll('${scope} .note, ${scope} .tip, ${scope} .msg, ${scope} .kv dt, ${scope} .kv dd, ${scope} .bar-why, ${scope} .why')].find((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 15)
  return bad ? '弹层正文小于 15px（' + getComputedStyle(bad).fontSize + '）：' + bad.innerText.slice(0, 20) : '' })()`
const popTaps = (scope) => `(() => { const small = [...document.querySelectorAll('${scope} button')].filter((b) => b.getClientRects().length && !b.closest('.van-nav-bar') && b.getBoundingClientRect().height < 44)
  return small.length ? '点击区不到 44 高：' + small[0].innerText.slice(0, 10) : '' })()`
const popLegacy = (scope) => `document.querySelector('${scope} .mono, ${scope} .num, ${scope} .van-icon:not(.van-nav-bar__arrow):not(.van-icon-arrow):not(.van-icon-arrow-left)') ? '弹层里还在用等宽数字类或 Vant 图标' : ''`
// 材料标签选中前后宽度不变（点一下量、再点回去）
const ackChipStable = `(async () => { const t = [...document.querySelectorAll('.ack .chip-tap')].find((x) => x.getAttribute('aria-pressed') === 'false'); if (!t) return '没有没选中的材料标签'
  const w0 = t.getBoundingClientRect().width; t.click(); await ${wait(200)}; const w1 = t.getBoundingClientRect().width; t.click(); await ${wait(200)}
  return Math.abs(w1 - w0) < 0.5 ? '' : '材料标签选中后宽度变了：' + w0.toFixed(1) + ' → ' + w1.toFixed(1) })()`
const openCancel = [click('更多'), click('取消报名'), `${click('用户误操作报名')}`]


// ---- 工单 13：预支初审、在岗人员、工伤、专属码与海报、消息、我的 ----
const TADV_API = '/tenant/advances', EMP_API = '/tenant/employments?', ABS_API = '/absences', INC_API = '/tenant/incidents', CODE_API = '/tenant/channel-codes/mine'
const TMSG_API = '/tenant/messages?', TREAD_API = '/tenant/messages/read', TUNREAD_API = '/tenant/messages/unread-count'
const ADV_DETAIL = `/advance/${data.ids.staffAdvanceId}`
const advGet = (action, body) => ({ url: TADV_API, method: 'GET', action, body })
const advReview = (action, body) => ({ url: '/site-review', method: 'POST', action, body })
const ADV_REASON = '该预支申请已被处理，请刷新后重试'
const pickReject = [click('驳回'), `[...document.querySelectorAll('.reason-dlg .chip-tap')][0].click()`]
// 审核详情的底部通栏：「驳回」在左、危险色描边（白底、危险色字和边框）；「初审通过」在右、主色实心
const reviewBar = `(() => { const btns = [...document.querySelectorAll('.bottom-bar .van-button')]; if (btns.length !== 2) return '底部通栏应当是驳回 / 通过两个按钮，实际 ' + btns.length + ' 个'
  const [l, r] = btns, lc = getComputedStyle(l), rc = getComputedStyle(r)
  if (!l.innerText.includes('驳回') || !r.innerText.includes('通过')) return '按钮顺序不对：' + l.innerText + ' / ' + r.innerText
  if (lc.backgroundColor !== ${tokenColor('--bg-card')} || lc.color !== ${tokenColor('--danger-text')} || lc.borderTopColor !== ${tokenColor('--danger-text')}) return '「驳回」不是危险色描边：' + lc.backgroundColor + ' ' + lc.color + ' ' + lc.borderTopColor
  if (rc.backgroundColor !== ${tokenColor('--primary')}) return '「通过」不是主色实心：' + rc.backgroundColor
  const a = l.getBoundingClientRect(), b = r.getBoundingClientRect()
  if (Math.abs(a.top - b.top) > 1 || a.right > b.left) return '两个按钮不在同一行或左右颠倒'
  return Math.round(a.height) >= 48 && Math.round(b.height) >= 48 ? '' : '通栏按钮不到 48 高' })()`
// 列表卡片：驳回在前、主按钮在后，第一行是姓名加状态标签
const advCards = `(() => { const cards = [...document.querySelectorAll('#app article.adv-card')]; if (!cards.length) return '没有预支卡片'
  for (const c of cards) { if (!c.querySelector('.item-hd h3') || !c.querySelector('.item-hd .status-tag')) return '卡片第一行没有姓名和状态标签'
    const bs = [...c.querySelectorAll('.acts .van-button')]; if (bs.length === 2 && !(bs[0].innerText.includes('驳回') && bs[1].classList.contains('van-button--primary') && !bs[1].classList.contains('van-button--plain'))) return '卡片按钮不是「驳回」在前、主按钮在后' }
  return '' })()`
const advFake = (status) => ({ advanceId: 'YZ-SHOT-1', userId: 'U-SHOT', seekerName: '刘**', projectId: 'P-SHOT', projectName: '立讯精密昆山二期', amount: 500, bizMonth: '2026-11', status, repaidAmount: 0, createdAt: '2026-11-12T16:57:57', allowedActions: [] })
// 二维码码点只有纯黑、纯白两种像素
const qrPure = (sel) => `(async () => { const img = document.querySelector(${JSON.stringify(sel)}); if (!img) return '没有二维码图片'
  await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data; let grey = 0, dark = 0
  for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (d[i] !== d[i + 1] || d[i] !== d[i + 2] || (v !== 0 && v !== 255)) grey++; else if (v === 0) dark++ }
  if (grey) return '二维码里有 ' + grey + ' 个不是纯黑白的像素'
  return dark > d.length / 4 * 0.2 ? '' : '二维码里黑色码点太少' })()`
// 海报：在页面里调 composePoster 合成，挂到 window.__poster，再盖一层全屏图片截下来
const composeShot = `(async () => { const m = await import('/src/utils/poster.ts'); const qr = document.querySelector('#app img.qr').src
  window.__poster = await m.composePoster({ qrDataUrl: qr, name: '王磊', company: '仕兔演示劳务' })
  const o = document.body.appendChild(document.createElement('img')); o.id = 'poster-shot'; o.src = window.__poster
  o.style.cssText = 'position:fixed;inset:0;z-index:9999;width:100%;height:100%;object-fit:contain;background:var(--bg-page)'; await o.decode() })()`
// 海报的二维码区域：码点纯黑白；外圈 48px（加上码自带的 1 模块白边，至少 4 个模块）全白，没有品牌元素压住；
// 按页面上的专属链接重新编码，逐个模块对照海报上的码点（本机没有扫码库，用这个代替解码）；品牌标是主色
const posterCheck = `(async () => { const { POSTER } = await import('/src/utils/poster.ts'); const img = new Image(); img.src = window.__poster; await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
  const px = (X, Y) => x.getImageData(X, Y, 1, 1).data
  const QX = POSTER.qr.x, QY = POSTER.qr.y, QS = POSTER.qr.size, PAD = 48
  const q = x.getImageData(QX, QY, QS, QS).data; let grey = 0
  for (let i = 0; i < q.length; i += 4) { if (q[i] !== q[i + 1] || q[i] !== q[i + 2] || (q[i] !== 0 && q[i] !== 255)) grey++ }
  if (grey) return '海报二维码区域有 ' + grey + ' 个不是纯黑白的像素'
  const ring = x.getImageData(QX - PAD, QY - PAD, QS + PAD * 2, QS + PAD * 2), W = QS + PAD * 2; let dirty = 0
  for (let yy = 0; yy < W; yy++) for (let xx = 0; xx < W; xx++) { if (xx >= PAD && xx < PAD + QS && yy >= PAD && yy < PAD + QS) continue; const i = (yy * W + xx) * 4; if (ring.data[i] !== 255 || ring.data[i + 1] !== 255 || ring.data[i + 2] !== 255) dirty++ }
  if (dirty) return '二维码外圈 ' + PAD + 'px 静区里有 ' + dirty + ' 个不是白色的像素'
  const QR = (await import('/node_modules/.vite/deps/qrcode.js')).default
  const url = document.querySelector('#app .url span').innerText.trim(), mod = QR.create(url, { errorCorrectionLevel: 'M' }).modules, n = mod.size, cell = QS / (n + 2)
  let wrong = 0
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) { const v = px(Math.floor(QX + (col + 1.5) * cell), Math.floor(QY + (r + 1.5) * cell))[0] === 0; if (v !== !!mod.data[r * n + col]) wrong++ }
  if (wrong) return '海报上的码点和专属链接 ' + url + ' 对不上：' + wrong + ' 个模块不同'
  const brand = px(POSTER.brand.x + POSTER.brand.size / 6, POSTER.brand.y + POSTER.brand.size * 5 / 6), want = ${tokenColor('--primary')}
  return want === 'rgb(' + brand[0] + ', ' + brand[1] + ', ' + brand[2] + ')' ? '' : '海报品牌标不是主色：' + brand.slice(0, 3).join(',') })()`
const codeReal = (await get(CODE_API, await tenantSession(MEMBERS.site))).data
// 消息：未读的左边是主色圆点、标题 500 字重；已读的圆点透明、标题常规
const msgDot = `(() => { const u = document.querySelector('#app .msg.unread'); if (!u) return '没有未读消息'
  if (getComputedStyle(u.querySelector('.msg-dot')).backgroundColor !== ${tokenColor('--primary')}) return '未读圆点不是主色'
  return getComputedStyle(u.querySelector('h3')).fontWeight === '500' ? '' : '未读标题不是 500 字重' })()`
const fakeTmsg = (id, read, extra = {}) => ({ id, templateCode: 'FOLLOW_UP_REMINDER', title: '24h 跟进提醒', content: '尾号 7439 的用户（私域待匹配）剩余 17 小时 59 分钟，超时将被释放至公域。', link: '/todo', priority: 0, read, createdAt: '2026-11-13T03:24:24', ...extra })
const allReadMsgs = reply({ records: [fakeTmsg(3, true), fakeTmsg(2, true, { title: '新报名', content: '吴** 报名了成品仓储分拣员，请在 24 小时内知悉并推送面试信息。', link: '/applications/BM-SHOT' }), fakeTmsg(1, true, { title: '系统通知', link: null })], total: 3, page: 1, pageSize: 20 })
const empFirst = `document.querySelector('#app article.item').click()`
// 驻场金额：同 moneyStyle，只有句中金额（.money-in）的页面也算有金额
const staffMoney = moneyStyle.replace("if (!ms.length) return '页面上没有金额'", "if (!ms.length && !document.querySelector('#app .money-in')) return '页面上没有金额'")
// 被拒的原因：危险文字色、左对齐（列表卡片、详情通栏、原因弹窗三处一样）
const whyDanger = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e?.getClientRects().length) return '没找到被拒原因 ${sel}'
  const cs = getComputedStyle(e); if (cs.color !== ${tokenColor('--danger-text')}) return '被拒原因不是危险文字色（${sel}）：' + cs.color
  return ['left', 'start'].includes(cs.textAlign) && !['center'].includes(cs.justifyContent) ? '' : '被拒原因不是左对齐（${sel}）' })()`
// 可选的标签：点一个没选中的，选中后带勾，所有选项的位置和宽度都不变
const chipPicked = (sel) => `(async () => { const all = () => [...document.querySelectorAll(${JSON.stringify(sel)})], pos = () => JSON.stringify(all().map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)] }))
  const t = all().find((b) => !['true'].includes(b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked'))); if (!t) return '没有没选中的选项'
  const before = pos(); t.click(); await ${wait(200)}
  const svg = [...t.querySelectorAll('svg')].find((x) => getComputedStyle(x).visibility === 'visible' && x.getClientRects().length)
  if (!svg) return '选中后没有勾：' + t.innerText.trim()
  return before === pos() ? '' : '选中后选项宽度或位置变了：' + before + ' → ' + pos() })()`
// 审批记录：每个节点的圆点（含未到的空心圆）和白底对比度 ≥ 3
const tlDots = `(() => { const lum = (c) => { const [r, g, b] = c.match(/\\d+/g).slice(0, 3).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  for (const li of document.querySelectorAll('#app .tl li')) { const c = getComputedStyle(li, '::before').borderTopColor, k = 1.05 / (lum(c) + 0.05)
    if (k < 3) return '时间线圆点对比度只有 ' + k.toFixed(2) + '：' + li.innerText.split('\\n')[0] }
  return '' })()`
// 消息：每行时间的右边对齐（没有箭头的行也留出箭头的位置）
const timeAligned = `(() => { const rs = [...document.querySelectorAll('#app .msg time')].map((t) => Math.round(t.getBoundingClientRect().right))
  return rs.length > 1 && new Set(rs).size === 1 ? '' : '各行时间的右边没对齐：' + rs.join('、') })()`
// 键盘聚焦卡片时有主色描边：脚本里 focus() 不触发 :focus-visible，改查样式表里这个元素的 :focus-visible 规则
const focusRing = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return '没找到 ${sel}'
  const rules = [...document.styleSheets].flatMap((ss) => { try { return [...ss.cssRules] } catch { return [] } }).filter((r) => r.selectorText?.includes(':focus-visible'))
  const hit = rules.find((r) => r.selectorText.split(',').some((one) => { const base = one.trim().replace(/:focus-visible.*$/, ''); try { return base && e.matches(base) } catch { return false } })
    && /var\\(--primary\\)/.test(r.style.outline || r.style.outlineColor) && !/none/.test(r.style.outline || r.style.outlineStyle))
  return hit ? '' : '${sel} 没有键盘聚焦时的主色描边（:focus-visible）' })()`
// 「我的」：退出登录在标签栏上方，看得见
const logoutVisible = `(() => { const b = ${findBtn('退出登录')}, t = document.querySelector('.van-tabbar'); const r = b.getBoundingClientRect()
  return r.top >= 44 && r.bottom <= t.getBoundingClientRect().top ? '' : '「退出登录」被标签栏挡住或不在这一屏' })()`
const toLogout = `${findBtn('退出登录')}.scrollIntoView({ block: 'center' })`
// 加载中保留外壳：白顶栏和标签栏都在
const shellKept = `document.querySelector('#app .van-nav-bar') && document.querySelector('.van-tabbar') ? '' : '加载中顶栏或标签栏没了'`
const absGet = (action) => ({ url: ABS_API + '?', method: 'GET', action })
const absSpin = `(() => { const s = document.querySelector('.abs .van-loading__spinner'); if (!s) return '缺勤记录没有加载图标'
  return getComputedStyle(s).color === ${tokenColor('--primary')} ? '' : '加载图标不是主色' })()`
// 请假弹层：标题栏和月份切换不用 Vant 图标、没有旧标签（单选框自带的勾、单元格箭头是组件自带的，保留）
const absLegacy = `document.querySelector('.abs .tag, .abs .num, .abs .mono, .abs .hd .van-icon, .abs .rec-hd .van-icon') ? '请假弹层里还在用旧标签、等宽数字类或 Vant 图标' : ''`
// 退出登录：确认后连点第二次；第二次若又弹确认框也点「退出」，否则 sentOnce 永远不会红
const logoutTwice = `(async () => { await ${wait(300)}; ${findBtn('退出登录')}.click(); await ${wait(300)}
  ;[...document.querySelectorAll('.van-dialog button')].find((b) => b.innerText.trim() === '退出' && b.getClientRects().length)?.click() })()`
// 退出接口挂住时 axios 15 秒就超时：点退出、确认、再连点一次放在同一步里做完，不等页面安静；最后把按钮滚到这一屏中间再截
const logoutFlow = `(async () => { ${findBtn('退出登录')}.click(); await ${wait(400)}; ${dialogBtn('退出')}; await ${logoutTwice}
  await ${wait(200)}; ${findBtn('退出登录')}.scrollIntoView({ block: 'center' }) })()`

// ---- 工单 14：企业后台外壳、登录、入驻 ----
// 企业后台用公司成员（MEMBERS）或截图数据里的待审核 / 被驳回老板；写请求同驻场一律拦住（sr）
// 改动前的侧栏菜单（分组前加 #），改版后分组和可见项必须一字不差
const C_MENUS = {
  owner: '#驻场|待办清单|24h 响应监控|#薪资发放|工资表导入|工资申诉|预支抵扣对账|#人才流转|流转账本|流转人员台账|#项目经理|岗位管理|知识库管理|工伤上报|薪酬预支审批|#劳务公司老板|数据总览|渠道转化报表|费用账单|#公司设置|项目与甲方|渠道二维码|组织与权限',
  pm: '#驻场|驻场工作台|待办清单|24h 响应监控|确权与签约|#人才经纪人|流转池|AI 分析报告|二次匹配 / 释放|#薪资发放|工资表导入|工资申诉|预支抵扣对账|#项目经理|数据看板|岗位管理|知识库管理|人员管理|离职审核|花名册导入|工伤上报|薪酬预支审批|#劳务公司老板|渠道转化报表|#公司设置|项目与甲方|渠道二维码|组织与权限',
  site: '#驻场|驻场工作台|待办清单|24h 响应监控|确权与签约|#人才经纪人|流转池|AI 分析报告|二次匹配 / 释放|#项目经理|数据看板|人员管理|离职审核|工伤上报|薪酬预支审批|#公司设置|项目与甲方|渠道二维码',
  broker: '#人才经纪人|流转池|AI 分析报告|二次匹配 / 释放|#项目经理|岗位管理|#公司设置|项目与甲方|渠道二维码',
}
const bgToken = (name) => `(() => { const p = document.body.appendChild(document.createElement('i')); p.style.background = 'var(${name})'; const c = getComputedStyle(p).backgroundColor; p.remove(); return c })()`
// 侧栏：白底、右边 1px 边框、宽约 220；分组标题 12px 三级文字；菜单项高 36、图标加文字；选中项浅蓝底蓝字，只有一个；菜单和改版前一致
const cSide = (who) => `(() => { const side = document.querySelector('.side'); if (!side) return '没有侧栏'
  const cs = getComputedStyle(side)
  if (cs.backgroundColor !== ${bgToken('--bg-card')}) return '侧栏不是白底：' + cs.backgroundColor
  if (cs.borderRightWidth !== '1px' || cs.borderRightColor !== ${tokenColor('--border')}) return '侧栏右边不是 1px 边框色细线：' + cs.borderRightWidth + ' ' + cs.borderRightColor
  const w = side.getBoundingClientRect().width; if (w < 212 || w > 228) return '侧栏宽 ' + w + '，应约 220'
  const menu = [...side.querySelectorAll('.nav > *')].map((e) => (e.classList.contains('grp') ? '#' : '') + e.innerText.trim()).join('|')
  if (menu !== ${JSON.stringify(C_MENUS[who])}) return '菜单分组或可见项和改版前不一致：' + menu
  const grp = [...side.querySelectorAll('.nav .grp')].find((g) => parseFloat(getComputedStyle(g).fontSize) !== 12 || getComputedStyle(g).color !== ${tokenColor('--text-3')})
  if (grp) return '分组标题不是 12px 三级文字：' + grp.innerText
  const items = [...side.querySelectorAll('.nav .item')]
  const tall = items.find((e) => Math.abs(e.getBoundingClientRect().height - 36) > 1); if (tall) return '菜单项高不是 36：' + tall.innerText + ' ' + tall.getBoundingClientRect().height
  const bare = items.find((e) => !e.querySelector('svg')); if (bare) return '菜单项没有图标：' + bare.innerText
  const on = items.filter((e) => e.classList.contains('is-active')); if (on.length !== 1) return '选中的菜单项有 ' + on.length + ' 个'
  if (getComputedStyle(on[0]).backgroundColor !== ${bgToken('--primary-bg')} || getComputedStyle(on[0]).color !== ${tokenColor('--primary-text')}) return '选中项不是浅蓝底蓝字'
  const off = items.find((e) => !e.classList.contains('is-active') && (getComputedStyle(e).backgroundColor === ${bgToken('--primary-bg')} || getComputedStyle(e).color !== ${tokenColor('--text-2')}))
  return off ? '未选中项的颜色不对：' + off.innerText : '' })()`
// 顶栏：白底；面包屑「分组 / 页面」；消息按钮带共享图标和名称；公司状态、角色用共享状态标签（正常 = 成功色，角色 = 信息色）
const cTop = (crumb, companyTone = 'success') => `(() => { const top = document.querySelector('.top'); if (!top) return '没有顶栏'
  if (getComputedStyle(top).backgroundColor !== ${bgToken('--bg-card')}) return '顶栏不是白底'
  const c = top.querySelector('nav.crumb'); if (!c) return '顶栏没有面包屑'
  if (c.innerText.replace(/\\s+/g, '') !== ${JSON.stringify(crumb)}) return '面包屑不是「${crumb}」：' + c.innerText
  if (!top.querySelector('button[aria-label="消息"] svg')) return '顶栏没有带图标的消息按钮'
  if (top.querySelector('.tag, .st-pill')) return '顶栏还在用旧标签'
  if (!top.querySelector('.status-tag.status-tag--' + ${JSON.stringify(companyTone)})) return '公司状态不是 ${companyTone} 色调的共享状态标签'
  return top.querySelector('.status-tag.status-tag--info') ? '' : '角色不是信息色的共享状态标签' })()`
// 主色只在主按钮、选中项、链接上：外壳里其余元素不用主色实心底
const cPrimaryOnly = `(() => { const want = ${bgToken('--primary')}
  const hit = [...document.querySelectorAll('.side, .side *, .top, .top *')].find((e) => getComputedStyle(e).backgroundColor === want && !e.closest('.el-button--primary'))
  return hit ? '外壳里主色用在了按钮和选中态以外：' + (hit.className || hit.tagName) : '' })()`
// 1280 宽：侧栏不压内容区，内容区不出视口，表格不出内容区，「操作」列在表格的可视范围里
const cFit = `(() => { const side = document.querySelector('.side').getBoundingClientRect(), main = document.querySelector('.main').getBoundingClientRect()
  if (side.right > main.left + 1) return '侧栏和内容区重叠 ' + Math.round(side.right - main.left) + 'px'
  if (main.right > innerWidth + 1) return '内容区超出视口 ' + Math.round(main.right - innerWidth) + 'px'
  const tables = [...document.querySelectorAll('#app .el-table')].filter((t) => t.getClientRects().length)
  if (!tables.some((t) => [...t.querySelectorAll('.el-table__header th')].some((th) => th.innerText.trim() === '操作'))) return '页面上没有带「操作」列的表格'
  for (const t of tables) { const r = t.getBoundingClientRect()
    if (r.right > main.right + 1) return '表格超出内容区 ' + Math.round(r.right - main.right) + 'px'
    const ops = [...t.querySelectorAll('.el-table__header th')].filter((th) => th.innerText.trim() === '操作' && th.getClientRects().length)
    const out = ops.find((th) => { const c = th.getBoundingClientRect(); return c.right > r.right + 1 || c.left < r.left - 1 })
    if (out) return '「操作」列被挤出表格可视区' }
  return '' })()`
// 外壳留给内容的宽度：1280 宽时侧栏 220、内边距 24，内容区不少于 1012（页面自己的表格列宽合计超过它时，那是页面的事，归各页改版工单）
const cRoom = `(() => { const c = document.querySelector('.content'), cs = getComputedStyle(c), w = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  return w >= innerWidth - 220 - 48 - 1 ? '' : '外壳留给内容的宽度只有 ' + w + 'px' })()`
// 不出现渐变、模糊、深色大底和装饰动画
const cNoDecor = `(() => { const all = [document.body, ...document.querySelectorAll('#app *')].filter((e) => e.getClientRects().length)
  const g = all.find((e) => /gradient/.test(getComputedStyle(e).backgroundImage)); if (g) return '有渐变：' + (g.className || g.tagName)
  const blur = all.find((e) => /blur/.test(getComputedStyle(e).filter + getComputedStyle(e).backdropFilter)); if (blur) return '有模糊装饰：' + (blur.className || blur.tagName)
  const dark = all.find((e) => { const r = e.getBoundingClientRect(); if (r.width * r.height < 20000) return false
    const m = getComputedStyle(e).backgroundColor.match(/[\\d.]+/g); if (!m || (m[3] !== undefined && +m[3] < 0.5)) return false
    return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2] < 128 })
  if (dark) return '有深色大底：' + (dark.className || dark.tagName)
  const anim = all.find((e) => getComputedStyle(e).animationName !== 'none' && !e.closest('.el-loading-mask, .is-loading')); return anim ? '有装饰动画：' + (anim.className || anim.tagName) : '' })()`
// 登录卡片：页面底色上一张白卡片，宽约 400、水平居中；里面从上到下是品牌标、标题、表单、通栏主按钮
const cLoginCard = `(() => { if (getComputedStyle(document.body).backgroundColor !== ${bgToken('--bg-page')}) return '页面底不是浅灰'
  const card = document.querySelector('#app .login-card'); if (!card) return '没有登录卡片'
  if (getComputedStyle(card).backgroundColor !== ${bgToken('--bg-card')}) return '登录卡片不是白底'
  const r = card.getBoundingClientRect(); if (r.width < 380 || r.width > 420) return '登录卡片宽 ' + r.width + '，应约 400'
  if (Math.abs(r.left + r.width / 2 - innerWidth / 2) > 2) return '登录卡片没有水平居中'
  const brand = card.querySelector('svg'), h = card.querySelector('h1'), form = card.querySelector('form'), btn = card.querySelector('.el-button--primary')
  if (!brand || !h || !form || !btn) return '卡片里缺品牌标、标题、表单或主按钮'
  const y = (e) => e.getBoundingClientRect().top
  if (!(y(brand) < y(h) && y(h) < y(form) && y(form) < y(btn))) return '卡片里的顺序不是品牌标、标题、表单、主按钮'
  return Math.abs(btn.getBoundingClientRect().width - form.getBoundingClientRect().width) > 1 ? '主按钮不是通栏' : '' })()`
// 入驻外壳：左侧白底文字说明（入驻流程、需要准备的材料），右侧白卡片表单
const cOnboardShell = `(() => { const aside = document.querySelector('#app .auth-aside'), card = document.querySelector('#app .auth-card'); if (!aside || !card) return '没有左侧说明或右侧表单卡片'
  if (getComputedStyle(aside).backgroundColor !== ${bgToken('--bg-card')}) return '左侧说明不是白底'
  if (getComputedStyle(card).backgroundColor !== ${bgToken('--bg-card')}) return '表单卡片不是白底'
  if (aside.getBoundingClientRect().right > card.getBoundingClientRect().left) return '说明不在表单左边'
  return ['入驻流程', '需要准备的材料', '营业执照'].filter((t) => !aside.innerText.includes(t)).map((t) => '左侧说明没有「' + t + '」').join('；') })()`
// 结果页结构：48 的线性图标、16px / 600 的标题、一行说明
const cResult = `(() => { const box = document.querySelector('#app .result'); if (!box) return '没有结果区'
  const icon = box.querySelector('svg'), h = box.querySelector('h2'), p = box.querySelector('p')
  if (!icon || Math.round(icon.getBoundingClientRect().width) !== 48) return '结果图标不是 48'
  const cs = h && getComputedStyle(h); if (!cs || parseFloat(cs.fontSize) !== 16 || Number(cs.fontWeight) !== 600) return '结果标题不是 16px / 600'
  return p ? '' : '结果区没有说明' })()`
const scrollStart = (sel) => `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'start' })`
const elPrimary = `(() => { const n = [...document.querySelectorAll('#app .el-button--primary:not(.is-link):not(.is-plain):not(.is-text)')].filter((b) => b.getClientRects().length).length
  return n === 1 ? '' : '主色实心按钮有 ' + n + ' 个' })()`
const elClickTwice = (text, scope = '#app') => `(async () => { ${findBtn(text, scope)}.click(); await ${wait(300)}; const again = document.querySelector(${JSON.stringify(scope + ' .el-button.is-loading')}) ?? ${findBtn(text, scope)}; again?.click() })()`
const elSpinning = (text, scope = '#app') => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope + ' .el-button.is-loading')})]; return b.length === 1 && b[0].innerText.includes(${JSON.stringify(text)}) ? '' : '提交中应当只有「${text}」在转，实际 ' + b.length + ' 个' })()`
const elIdle = `document.querySelector('#app .el-button.is-loading, .msg-drawer .el-button.is-loading') ? '被拒之后按钮还在转' : ''`
// Element 的消息提示：先确认写了原因，等它消失后再截
const elToastGone = (text) => `(async () => { await ${wait(400)}; if (![...document.querySelectorAll('.el-message')].some((t) => t.innerText.includes(${JSON.stringify(text)}))) throw new Error('被拒之后没有消息提示写明原因')
  await ${wait(3800)}; if ([...document.querySelectorAll('.el-message')].some((t) => t.getClientRects().length)) throw new Error('消息提示还没消失') })()`
// 字段下方的错误提示：危险文字色；校验不过时第一个出错的字段在可视区里
const elFieldError = (text) => `(() => { const e = [...document.querySelectorAll('#app .el-form-item__error')].find((x) => x.innerText.includes(${JSON.stringify(text)}))
  if (!e) return '字段下方没有「${text}」'
  if (getComputedStyle(e).color !== ${tokenColor('--danger-text')}) return '错误提示不是危险文字色：' + getComputedStyle(e).color
  const first = document.querySelector('#app .el-form-item.is-error').getBoundingClientRect()
  return first.top >= 0 && first.bottom <= innerHeight ? '' : '第一个出错的字段不在可视区里' })()`
const cLegacy = `document.querySelector('#app .tag, #app .st-pill, #app .note, #app .eyebrow, #app .num') ? '还在用旧标签、状态点、旧提示条、眉标或等宽数字类' : ''`
// ---- 工单 15 驻场工作台 ----
// 指标卡 4–5 张：标题 13px 二级文字、26px / 600 大数字、12px 三级文字说明、右上角图标
const wbKpis = `(() => { const ks = [...document.querySelectorAll('#app .kpis .kpi')]; if (ks.length < 4 || ks.length > 5) return '指标卡不是 4–5 张：' + ks.length
  for (const k of ks) { const l = k.querySelector('.stat-l'), v = k.querySelector('.stat-v'), d = k.querySelector('.stat-d'), i = k.querySelector('svg')
    if (!l || !v || !d || !i) return '指标卡缺标题、数字、说明或图标：' + k.innerText.slice(0, 10)
    if (parseFloat(getComputedStyle(l).fontSize) !== 13 || getComputedStyle(l).color !== ${tokenColor('--text-2')}) return '指标标题不是 13px 二级文字'
    if (parseFloat(getComputedStyle(v).fontSize) !== 26 || Number(getComputedStyle(v).fontWeight) !== 600) return '指标数字不是 26px / 600'
    if (parseFloat(getComputedStyle(d).fontSize) !== 12 || getComputedStyle(d).color !== ${tokenColor('--text-3')}) return '指标说明不是 12px 三级文字'
    const kr = k.getBoundingClientRect(), ir = i.getBoundingClientRect(); if (kr.right - ir.right > 24 || ir.top - kr.top > 24) return '指标图标不在右上角' }
  return '' })()`
// 左列表宽约 400，按响应剩余升序（窗口进度条越满越靠前，没有窗口的排最后）
const wbSorted = `(() => { const q = document.querySelector('#app .queue'); if (!q) return '没有左列表'; const w = q.getBoundingClientRect().width; if (w < 390 || w > 410) return '左列表宽 ' + w + '，应约 400'
  const used = [...q.querySelectorAll('.q-item .q-bar i')].map((i) => parseFloat(i.style.width) || 0); if (used.length < 2) return '左列表不到 2 条，看不出排序'
  return used.every((u, k) => k === 0 || used[k - 1] >= u) ? '' : '左列表没有按响应剩余排序：' + used.join(',') })()`
// 左列表没有多余留白：最后一条下面紧跟页脚，页脚就是面板底（原型里列表撑到和右详情一样高、下面空一大块）
const wbNoGap = `(() => { const q = document.querySelector('#app .queue'); if (!q) return '没有左列表'
  const body = q.querySelector('.q-list') ?? q.querySelector('.state'), ft = q.querySelector('.q-ft'), end = (ft ?? body).getBoundingClientRect().bottom
  if (ft && ft.getBoundingClientRect().top - body.getBoundingClientRect().bottom > 1) return '列表和页脚之间空了 ' + Math.round(ft.getBoundingClientRect().top - body.getBoundingClientRect().bottom) + 'px'
  const gap = q.getBoundingClientRect().bottom - end; return gap > 2 ? '左列表下面空了 ' + Math.round(gap) + 'px' : '' })()`
// 右详情从上到下：头部（姓名、标签、剩余时间）→ 进度条 → 报名信息 / 匹配记录 / 处理记录 → 底部操作区；完成和进行中的步骤带文字
const wbDetail = `(() => { const d = document.querySelector('#app .detail'); if (!d) return '没有右详情'
  const hd = d.querySelector('.d-hd'), st = d.querySelector('.el-steps'), acts = d.querySelector('.d-acts')
  if (!hd?.querySelector('h3') || !hd.querySelector('.status-tag--private, .status-tag--public') || !hd.querySelector('.d-left')) return '详情头部缺姓名、归属标签或剩余时间'
  if (!st || st.querySelectorAll('.el-step').length < 5) return '详情没有进度条'
  const bad = [...st.querySelectorAll('.el-step')].find((x) => (x.querySelector('.is-success, .is-process')) && !x.querySelector('.el-step__description')?.innerText.trim()); if (bad) return '完成或进行中的步骤没有文字：' + bad.innerText.trim()
  const titles = [...d.querySelectorAll('.d-blk h4')].map((h) => h.innerText.trim()); for (const t of ['报名信息', '匹配记录', '处理记录']) if (!titles.includes(t)) return '详情没有「' + t + '」'
  if (!acts?.querySelector('button')) return '详情没有操作按钮'
  const y = (e) => e.getBoundingClientRect().top; return y(hd) < y(st) && y(st) < y(d.querySelector('.d-blk')) && y(d.querySelector('.d-blk')) < y(acts) ? '' : '详情各块的顺序不对' })()`
// 操作区：按钮和改版前一样按 allowedActions 出（主操作平铺、未通过 / 爽约 / 取消收进「更多」），一个主色实心按钮以内
const wbOps = `(() => { const acts = document.querySelector('#app .d-acts'); const t = [...acts.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean)
  const known = ['知悉推送', '修改面试信息', '到厂确认', '面试通过', '确权签约', '重发签约', '更多']; const odd = t.find((x) => !known.includes(x)); if (odd) return '操作区出现了改版前没有的按钮：' + odd
  return acts.querySelectorAll('.el-button--primary:not(.is-plain):not(.is-link)').length <= 1 ? '' : '操作区不止一个主色实心按钮' })()`
// 1280 宽：左右两栏都在内容区里，不重叠
// 指标卡标题折成两行时，各卡的大数字仍在同一条线上
const wbKpiAligned = `(() => { const cut = [...document.querySelectorAll('#app .kpis .stat-l, #app .kpis .stat-d')].find((e) => e.scrollWidth > e.clientWidth + 1); if (cut) return '指标卡文字被截断：' + cut.innerText
  const ys = [...document.querySelectorAll('#app .kpis .stat-v')].map((v) => Math.round(v.getBoundingClientRect().top)); return Math.max(...ys) - Math.min(...ys) <= 1 ? '' : '指标卡的大数字没对齐：' + ys.join(',') })()`
// 改版前今日待办表头的「N 紧急」（最紧急 8 条里剩余不到 6 小时的）还在，数和列表里剩余不到 6 小时的条数一致
const wbUrgent = `(() => { const n = [...document.querySelectorAll('#app .q-item .time b')].filter((b) => { const m = b.innerText.match(/^(?:(\\d+) 天 )?(?:(\\d+) 小时)?\\s*(?:(\\d+) 分)?/); return !b.innerText.includes('天') && (b.innerText.startsWith('超时') || !b.innerText.includes('小时') || Number(m[2]) < 6) }).length
  const tag = document.querySelector('#app .q-hd .status-tag--danger'); if (!n) return tag ? '没有不到 6 小时的，却显示了紧急' : ''
  return tag?.innerText.trim() === n + ' 紧急' ? '' : '今日待办表头应显示「' + n + ' 紧急」，实际「' + (tag?.innerText.trim() ?? '没有') + '」' })()`
// 被拒原因：提醒文字色写「暂时不能…：原因」，留在页面上（规范 Page States「列表里某一条的操作被后端业务拒绝」）
const whyStays = (selector, text) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.includes(${JSON.stringify(text)})); if (!e) return '被拒的原因没有留在页面上（${selector}）'
  return getComputedStyle(e).color === ${tokenColor('--warning-text')} ? '' : '被拒原因不是提醒文字色' })()`
// 被拒只置灰被拒的那个操作：整页操作按钮里只有一个灰的，就是它；「更多」照常可点
const onlyOff = (scope, act) => `(() => { const off = [...document.querySelectorAll(${JSON.stringify(scope + ' .el-button')})].filter((b) => b.disabled).map((b) => b.innerText.trim())
  return off.length === 1 && off[0] === ${JSON.stringify(act)} ? '' : '被拒后应只置灰「${act}」，实际置灰：' + (off.join('、') || '没有') })()`
// 确认框被拒：框不关，原因写在框里、确认按钮置灰
const boxWhy = (submit, text) => `(() => { const box = document.querySelector('.el-message-box'); if (!box) return '被拒后确认框关掉了'
  const why = box.querySelector('.msgbox-why'); if (!why?.innerText.includes(${JSON.stringify(text)})) return '确认框里没有写被拒原因'
  if (getComputedStyle(why).color !== ${tokenColor('--warning-text')}) return '确认框里的被拒原因不是提醒文字色'
  return ${findBtn(submit, '.el-message-box')}.disabled ? '' : '被拒后确认框的「${submit}」没有置灰' })()`
// 操作区一排只有一个主按钮，其余是默认按钮（没有浅色主按钮）
const wbOneMain = `(() => { const bs = [...document.querySelectorAll('#app .d-acts .el-button')]; if (bs.some((b) => b.classList.contains('is-plain'))) return '操作区有浅色主按钮（规范里没有这种按钮）'
  return bs.filter((b) => b.classList.contains('el-button--primary')).length <= 1 ? '' : '操作区不止一个主按钮' })()`
// 操作区不盖住详情内容：操作区在详情滚动区下面，且在可视区里
const wbActsClear = `(() => { const body = document.querySelector('#app .d-body'), acts = document.querySelector('#app .d-acts'); if (!body || !acts) return '详情没有滚动区或操作区'
  const b = body.getBoundingClientRect(), a = acts.getBoundingClientRect(); if (a.top < b.bottom - 1) return '操作区盖住了详情内容 ' + Math.round(b.bottom - a.top) + 'px'
  return a.bottom <= innerHeight + 1 ? '' : '操作区在可视区外，要滚动页面才看得到' })()`
// 没拿到数据时不显示数字：指标数字是「—」、页签不带计数
const noNums = `(() => { const v = [...document.querySelectorAll('#app .stat-v')].map((e) => e.innerText.trim()).filter((t) => t !== '—'); if (v.length) return '没拿到数据却显示了数字：' + v.join('、')
  const n = [...document.querySelectorAll('#app .filter-tabs .n')].map((e) => e.innerText.trim()).filter(Boolean); return n.length ? '没拿到数据，页签却有计数：' + n.join('、') : '' })()`
// 空状态前后自洽：页签计数和指标都是 0（或没有）
const allZero = `(() => { const n = [...document.querySelectorAll('#app .filter-tabs .n, #app .stat-v')].map((e) => e.innerText.trim()).filter((t) => t && t !== '0' && t !== '—'); return n.length ? '列表是空的，计数却不是 0：' + n.join('、') : '' })()`
// 只有异常卡的数字用危险色：没有提醒色数字，危险色的数不为 0
const statTone = `(() => { if (document.querySelector('#app .stat--warn')) return '指标数字用了提醒色'; const z = [...document.querySelectorAll('#app .stat--danger .stat-v')].find((v) => Number(v.innerText.trim()) === 0); return z ? '数字为 0 也用了危险色' : '' })()`
// 表格行高约 48
// 看不见的表格（没选中的标签页）不算
const rowsTall = `(() => { const r = [...document.querySelectorAll('#app .el-table__body tr')].find((tr) => tr.getClientRects().length && tr.getBoundingClientRect().height < 44); return r ? '表格行高只有 ' + Math.round(r.getBoundingClientRect().height) + 'px：' + r.innerText.slice(0, 12) : '' })()`
// 断网的轻提示出来之后再截图
const toastShown = `(async () => { for (let i = 0; i < 40 && !document.querySelector('.el-message--error'); i++) await ${wait(100)}; await ${wait(400)} })()`
const wbFit = `(() => { const main = document.querySelector('.main').getBoundingClientRect(), q = document.querySelector('#app .queue').getBoundingClientRect(), d = document.querySelector('#app .detail').getBoundingClientRect()
  if (q.right > d.left) return '左列表和右详情重叠'; return d.right <= main.right + 1 ? '' : '右详情超出内容区 ' + Math.round(d.right - main.right) + 'px' })()`
const wbPick = (k) => `[...document.querySelectorAll('#app .q-item')].at(${k}).click()`
// 点了哪个人右边就是哪个人，选中项主色浅底
const wbPicked = (k) => `(() => { const it = [...document.querySelectorAll('#app .q-item')].at(${k}); const name = it.querySelector('.who-n').innerText.trim()
  if (document.querySelector('#app .d-hd h3')?.innerText.trim() !== name) return '点了「' + name + '」，右边不是他'
  if (getComputedStyle(it).backgroundColor !== ${bgToken('--primary-bg')}) return '选中项不是主色浅底'
  return document.querySelectorAll('#app .q-item.on').length === 1 ? '' : '选中项不止一个' })()`
const wbTab = (text) => `[...document.querySelectorAll('#app .q-tabs button')].find((b) => b.innerText.includes(${JSON.stringify(text)})).click()`
// 筛「待确权」后列表里只剩面试通过的人，条数和标签上的数一致
const wbFiltered = (text, re = '确权|签约') => `(() => { const tab = [...document.querySelectorAll('#app .q-tabs button')].find((b) => b.innerText.includes(${JSON.stringify(text)})); const n = Number(tab.querySelector('.n').innerText)
  const items = [...document.querySelectorAll('#app .q-item')]; if (!items.length) return '筛选后列表是空的'
  if (items.length !== Math.min(n, 8)) return '筛选后 ' + items.length + ' 条，标签上写 ' + n
  const off = items.find((i) => !new RegExp(${JSON.stringify(re)}).test(i.querySelector('.meta').innerText)); return off ? '筛「${text}」后还有别的阶段：' + off.innerText.slice(0, 20) : '' })()`
// Element 确认框的确认按钮连点两次（第二次点的是正在转圈的那个）
const boxClickTwice = (text) => `(async () => { ${findBtn(text, '.el-message-box')}.click(); await ${wait(300)}; const again = document.querySelector('.el-message-box .el-button.is-loading') ?? ${findBtn(text, '.el-message-box')}; again?.click() })()`
// ---- 工单 15 表格页 ----
// 操作列：在表格可视区里（1280 宽也不用横向滚动才看得到），文字按钮、平铺不超过 3 个、不折行不截断
const opsCol = `(() => { const t = [...document.querySelectorAll('#app .el-table')].find((x) => [...x.querySelectorAll('.el-table__header th')].some((th) => th.innerText.trim() === '操作')); if (!t) return '没有带「操作」列的表格'
  const r = t.getBoundingClientRect(), th = [...t.querySelectorAll('.el-table__header th')].find((h) => h.innerText.trim() === '操作').getBoundingClientRect()
  if (th.left < r.left - 1 || th.right > r.right + 1 || th.right > innerWidth) return '「操作」列不在可视区里'
  const cells = [...t.querySelectorAll('.el-table__body td.ops-col .cell')]; if (!cells.length) return '操作列没有按钮'
  for (const c of cells) { const bs = [...c.querySelectorAll('.el-button')]; if (!bs.length) continue; const tops = bs.map((b) => b.getBoundingClientRect().top)
    if (Math.max(...tops) - Math.min(...tops) > 8) return '操作列按钮折行'
    if (bs.some((b) => !b.classList.contains('is-link'))) return '操作列不是文字按钮'
    if (bs.filter((b) => b.innerText.trim() !== '更多').length > 3) return '操作列平铺的按钮超过 3 个'
    if (c.scrollWidth > c.clientWidth + 1) return '操作列按钮被截断（内容 ' + c.scrollWidth + 'px，格子 ' + c.clientWidth + 'px）' }
  return '' })()`
// 1280 宽表格不横向滚动（被固定的操作列压住的列也算看不见），每一格的内容不被截掉
const tblFit = `(() => { for (const t of document.querySelectorAll('#app .el-table')) { const w = t.querySelector('.el-table__body-wrapper .el-scrollbar__wrap'); if (w && w.scrollWidth > w.clientWidth) return '表格要横向滚动 ' + (w.scrollWidth - w.clientWidth) + 'px'
    // 逐个文字节点看有没有越过格子内边距；行尾的全角收尾标点（「）」「。」等）Chrome 会挤掉半个字宽，那半个字不算截断
    const cut = (x) => { const r = x.getBoundingClientRect(), pad = parseFloat(getComputedStyle(x).paddingRight), tw = document.createTreeWalker(x, NodeFilter.SHOW_TEXT); let n
      while ((n = tw.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const rg = document.createRange(); rg.selectNodeContents(n)
        const slack = /[）」』】》〉，。、；：！？]$/.test(t) ? parseFloat(getComputedStyle(n.parentElement).fontSize) / 2 : 0
        if ([...rg.getClientRects()].some((q) => q.width && q.right > r.right - pad + 0.5 + slack)) return true }
      return false }
    const c = [...t.querySelectorAll('.el-table__body td:not(.is-hidden) > .cell')].find((x) => x.scrollWidth > x.clientWidth || cut(x)); if (c) return '表格格子内容被截掉：' + c.innerText.replace(/\\s+/g, ' ').slice(0, 20) + '（内容 ' + c.scrollWidth + 'px，格子 ' + c.clientWidth + 'px）' }
  return '' })()`
// 被拒之后：表格上方写明谁、为什么，这一行的按钮全部置灰，别的行不受影响
// 被拒之后：表格上方用提醒文字色写明谁、为什么，整张表只有被拒的那个按钮置灰
const rowOff = (why, act) => [whyStays('#app .tbl-tip', why), onlyOff('#app td.ops-col', act)]
const fillAckAddr = `(() => { const el = document.querySelector('.el-dialog input[placeholder="详细地址"]'); if (el && !el.value.trim()) { el.value = '昆山开发区前进东路 88 号 2 号门'; el.dispatchEvent(new Event('input', { bubbles: true })) } })()`
const firstAct = (text) => `${findBtn(text, '#app .el-table__body')}.click()`
// 一张表格页的状态：正常（1440、1280）、加载、空、失败、提交中、被拒；op 是拿来截提交中和被拒的那个操作
const zeroWb = fakeWb({ pendingAck: 0, pendingInterview: 0, pendingConfirm: 0, windowsDueIn4h: 0, privatePending: 0, arrivedToday: 0 })
const siteTable = (screen, path, emptyText, op) => {
  const open = op.dialog ? [firstAct(op.act), wait(500), fillAckAddr] : [firstAct(op.act), wait(400)]
  const scope = op.dialog ? '.el-dialog' : '.el-message-box'
  const twice = op.dialog ? elClickTwice(op.submit, scope) : boxClickTwice(op.submit)
  const refused = refuse('APPLICATION_4091', '报名状态已变化，请刷新后再操作')
  return [
    { app: 'console', screen, state: 'normal', persona: 'site', path, rules: sr(), checks: [cSide('site'), opsCol, statTone, rowsTall, cLegacy, noThrottleWord] },
    { app: 'console', screen, state: 'normal', persona: 'site', path, width: 1280, height: 800, rules: sr(), checks: [cSide('site'), cFit, opsCol, tblFit] },
    { app: 'console', screen, state: 'loading', persona: 'site', path, rules: sr({ url: TAPPS_API, action: 'hang' }), quick: true, steps: [wait(600)],
      checks: [`document.querySelector('#app .el-table .el-loading-mask') ? '' : '加载中表格上没有加载遮罩'`, hasNot(emptyText), noNums, hasNot('本月还没有人')] },
    { app: 'console', screen, state: 'empty', persona: 'site', path, rules: sr({ url: WB_API, action: 'respond', body: zeroWb }, { url: TAPPS_API, action: 'respond', body: emptyPage }), checks: [has(emptyText), allZero, cLegacy] },
    { app: 'console', screen, state: 'error', persona: 'site', path, rules: sr({ url: TAPPS_API, action: 'fail' }), checks: [has('重新加载'), hasNot(emptyText), noNums, hasNot('本月还没有人'), hasNot('暂无')] },
    { app: 'console', screen, state: 'submitting', persona: 'site', path, rules: sr(), quick: true, steps: [...open, countXhr, twice], checks: [elSpinning(op.submit, scope), sentOnce] },
    { app: 'console', screen, state: 'rejected', persona: 'site', path, rules: sr({ url: op.api, method: 'POST', action: 'respond', body: refused }),
      steps: [...open, `${findBtn(op.submit, scope)}.click()`, elToastGone('报名状态已变化，请刷新后再操作')],
      checks: [...rowOff(op.why, op.act), ...(op.dialog ? [stays('.el-dialog .blocked-why', op.why + '：报名状态已变化'), `${findBtn(op.submit, '.el-dialog')}.disabled ? '' : '被拒之后弹窗里的「${op.submit}」没有置灰'`] : [boxWhy(op.submit, op.why + '：报名状态已变化')]), elIdle] },
  ]
}
// ---- 工单 16：流转与财务（流转池、流转账本、流转人员、费用账单、数据总览、渠道报表）----
// 演示库里账单、账本、流转人员都是空的：正常状态用后端真实形状的假数据（MonthlyBillService.Bill / DayLine / LedgerLine、CirculationPeopleService.PersonLine；
// LocalDate 是「2026-11-20」、LocalDateTime 是「2026-11-01T09:00:00」、BigDecimal 是数字，空字段不出现）
const BILLS_API = '/tenant/bills?', BILL_API = '/tenant/bills/', LEDGER_API = '/tenant/ledger?', PEOPLE_API = '/tenant/ledger/people'
const OVERVIEW_API = '/tenant/reports/overview', CHANNELS_API = '/tenant/reports/channels', CASES_API = '/tenant/broker/cases'
const fakeBill = (month, status, fee, pay, rec, extra = {}) => ({ billId: 'BILL-SHOT-' + month, companyId: 'C10001', billMonth: month, serviceFee: fee, transferPayable: pay,
  transferReceivable: rec, payable: Math.round((fee + pay) * 100) / 100, status, ...extra })
// 10 月账单已下发、还在异议期（截止 11-20），9 月、8 月已结算
const shotBills = [
  fakeBill('2026-10', 'ISSUED', 1860, 620, 248, { issuedAt: '2026-11-01T09:00:00', disputeDeadline: '2026-11-20', settleDeadline: '2026-11-15' }),
  fakeBill('2026-09', 'SETTLED', 1530, 480, 192, { issuedAt: '2026-10-01T09:00:00', disputeDeadline: '2026-10-15', settleDeadline: '2026-10-15', settledAt: '2026-10-12T15:20:00' }),
  fakeBill('2026-08', 'SETTLED', 1200, 0, 96, { issuedAt: '2026-09-01T09:00:00', disputeDeadline: '2026-09-08', settleDeadline: '2026-09-15', settledAt: '2026-09-10T11:05:00' }),
]
const fakeBills = reply({ records: shotBills, total: 3, page: 1, pageSize: 12 })
const fakeBillDetail = reply({ bill: shotBills[0],
  days: Array.from({ length: 31 }, (_, i) => { const free = i < 3; const emp = 52 + (i % 5); const inc = free ? 0 : emp - 50
    return { bizDate: `2026-10-${String(i + 1).padStart(2, '0')}`, inFreePeriod: free, employedCount: emp, stockBase: 50, incrementCount: inc, serviceFee: inc * 12, transferPayable: 20, transferReceivable: 8 } }),
  disputes: [{ id: 7, billId: 'BILL-SHOT-2026-10', content: '10 月 12 日在岗人数应为 53 人，账单按 54 人计费', status: 'REJECTED', raisedBy: 'M202611120001',
    reply: '经核对考勤，10 月 12 日新入职 1 人当日在岗，计费无误', createdAt: '2026-11-02T10:12:00', repliedAt: '2026-11-03T16:40:00' }] })
const fakeCircLedger = reply([
  { direction: 'PAYABLE', userId: 'U2026100900031', counterpartCompanyId: 'C10002', days: 31, amount: 310, counterpartCompanyName: '鑫诚劳务' },
  { direction: 'PAYABLE', userId: 'U2026101500044', counterpartCompanyId: 'C10002', days: 18, amount: 180, counterpartCompanyName: '鑫诚劳务' },
  { direction: 'PAYABLE', userId: 'U2026101800052', counterpartCompanyId: 'PLATFORM', days: 13, amount: 130, counterpartCompanyName: '平台' },
  { direction: 'RECEIVABLE', userId: 'U2026091200017', days: 31, amount: 248 },
])
const fakePeople = reply([
  { direction: 'RECEIVABLE', userId: 'U2026091200017', firstDate: '2026-09-20', lastDate: '2026-11-12', days: 54, dailyAmount: 8, monthAmount: 96, totalAmount: 432, active: true },
  { direction: 'PAYABLE', userId: 'U2026100900031', name: '赵**', counterpartCompanyId: 'C10002', counterpartCompanyName: '鑫诚劳务', jobTitle: '电子组装普工', firstDate: '2026-10-01', lastDate: '2026-11-12', days: 43, dailyAmount: 10, monthAmount: 120, totalAmount: 430, active: true },
  { direction: 'PAYABLE', userId: 'U2026101800052', name: '钱**', counterpartCompanyId: 'PLATFORM', counterpartCompanyName: '平台', jobTitle: '成品仓储分拣员', firstDate: '2026-10-19', lastDate: '2026-11-12', days: 25, dailyAmount: 10, monthAmount: 120, totalAmount: 250, active: true },
  { direction: 'PAYABLE', userId: 'U2026101500044', name: '孙**', counterpartCompanyId: 'C10002', counterpartCompanyName: '鑫诚劳务', jobTitle: '质检员', firstDate: '2026-10-14', lastDate: '2026-10-31', days: 18, dailyAmount: 10, monthAmount: 0, totalAmount: 180, active: false },
])
const zeroOverview = reply({ totalHired: 0, employed: 0, hiredThisMonth: 0, resignedThisMonth: 0, privatePool: 0, transferIn: 0, transferOut: 0, projects: [] })
const chartTokens = `[${[1, 2, 3, 4, 5, 6].map((i) => bgToken('--chart-' + i)).join(', ')}]`
// 图形只用图表分类色
const chartColors = (sel) => `(() => { const ok = ${chartTokens}, els = [...document.querySelectorAll(${JSON.stringify(sel)})]; if (!els.length) return '没有图形（${sel}）'
  const off = els.find((e) => !ok.includes(getComputedStyle(e).backgroundColor)); return off ? '图形没用图表配色：' + getComputedStyle(off).backgroundColor : '' })()`
// 金额：套 .money（句中的套 .money-in，表格合计行也套），颜色是一级文字（合计可以用主色），不靠红绿区分；表格里的金额右对齐
const cMoney = (scope = '#app') => `(() => { const ok = [${tokenColor('--text-1')}, ${tokenColor('--primary-text')}]
  const els = [...document.querySelectorAll(${JSON.stringify(scope + ' *')})].filter((e) => e.getClientRects().length && [...e.childNodes].some((n) => n.nodeType === 3 && /¥\\d/.test(n.textContent)))
  if (!els.length) return '页面上没有金额'
  for (const e of els) { const t = e.textContent.trim(), td = e.closest('td')
    if (td && !td.classList.contains('is-right')) return '表格里的金额没右对齐：' + t
    if (!e.closest('.money, .money-in')) return '金额没套金额类：' + t
    if (!ok.includes(getComputedStyle(e).color)) return '金额不是一级文字色（靠颜色区分收支）：' + t + ' ' + getComputedStyle(e).color }
  return '' })()`
// 收入带「+」、支出带「−」：页面上两种都有
const cSigns = (scope = '#app') => `(() => { const t = document.querySelector(${JSON.stringify(scope)}).innerText; return t.includes('+¥') && t.includes('−¥') ? '' : '收入和支出没有用 +/− 区分（+¥ ' + t.includes('+¥') + '，−¥ ' + t.includes('−¥') + '）' })()`
// 指标卡：3–5 张，标题 13px 二级文字、26px / 600 大数字、12px 三级文字说明、右上角图标
const kpiCards = `(() => { const ks = [...document.querySelectorAll('#app .kpis > .stat')]; if (ks.length < 3 || ks.length > 5) return '指标卡不是一排 3–5 张：' + ks.length
  if (new Set(ks.map((k) => Math.round(k.getBoundingClientRect().top))).size > 1) return '指标卡不在一排'
  for (const k of ks) { const l = k.querySelector('.stat-l'), v = k.querySelector('.stat-v'), d = k.querySelector('.stat-d'), i = k.querySelector('svg')
    if (!l || !v || !d || !i) return '指标卡缺标题、数字、说明或图标：' + k.innerText.slice(0, 10)
    if (parseFloat(getComputedStyle(l).fontSize) !== 13 || getComputedStyle(l).color !== ${tokenColor('--text-2')}) return '指标标题不是 13px 二级文字'
    if (parseFloat(getComputedStyle(v).fontSize) !== 26 || Number(getComputedStyle(v).fontWeight) !== 600) return '指标数字不是 26px / 600：' + v.innerText
    if (parseFloat(getComputedStyle(d).fontSize) !== 12 || getComputedStyle(d).color !== ${tokenColor('--text-3')}) return '指标说明不是 12px 三级文字'
    const kr = k.getBoundingClientRect(), ir = i.getBoundingClientRect(); if (kr.right - ir.right > 24 || ir.top - kr.top > 24) return '指标图标不在右上角'
    if (v.scrollWidth > v.clientWidth + 1) return '指标数字被截断：' + v.innerText }
  return '' })()`
// 详情抽屉（第 5 类）：宽 560–720，分块，块标题 16px / 600，字段是两列的描述列表，不用旧类
const drawerBlocks = (sel, titles) => `(() => { const d = document.querySelector(${JSON.stringify(sel)}); if (!d) return '没有抽屉'; const w = d.getBoundingClientRect().width; if (w < 560 || w > 720) return '抽屉宽 ' + w + '，应在 560–720'
  const h = [...d.querySelectorAll('.blk-t')].map((x) => x.firstChild.textContent.trim()); const miss = ${JSON.stringify(titles)}.filter((t) => !h.includes(t)); if (miss.length) return '抽屉缺区块：' + miss.join('、')
  if ([...d.querySelectorAll('.blk-t')].some((x) => parseFloat(getComputedStyle(x).fontSize) !== 16 || Number(getComputedStyle(x).fontWeight) !== 600)) return '块标题不是 16px / 600'
  const dl = d.querySelector('.desc-list'); if (!dl || getComputedStyle(dl).gridTemplateColumns.split(' ').length !== 2) return '字段不是两列的描述列表'
  return d.querySelector('.tag, .note, .eyebrow, .num, .mono') ? '抽屉里还在用旧标签、旧提示条、眉标或旧数字类' : '' })()`
const cLegacy16 = `document.querySelector('#app .tag, #app .st-pill, #app .note, #app .eyebrow, #app .num, #app .mono') ? '还在用旧标签、状态点、旧提示条、眉标或旧数字类' : ''`
const loadMask = `document.querySelector('#app .el-loading-mask') ? '' : '加载中没有加载遮罩'`
const oneRetry = `(() => { const n = [...document.querySelectorAll('#app button')].filter((b) => b.innerText.includes('重新加载')).length; return n === 1 ? '' : '失败时应只有一个「重新加载」，实际 ' + n + ' 个' })()`
const fillBox = (text) => `(() => { const el = document.querySelector('.el-message-box textarea'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const openDispute = [`${findBtn('提出异议', '#app .el-table__body')}.click()`, wait(400), fillBox('10 月 12 日在岗人数应为 53 人，账单按 54 人计费')]
const openCase = (text = 'AI 报告') => [`${findBtn(text, '#app .el-table__body')}.click()`, wait(600)]
// 推荐页签：选第一个招聘中的岗位
const pickJob = [...openCase('推荐岗位'), `document.querySelector('.case-drawer .el-select__wrapper').click()`, wait(400),
  `[...document.querySelectorAll('.el-select-dropdown__item')].find((x) => x.getClientRects().length && !x.classList.contains('is-disabled')).click()`, wait(300)]
const genBtn = `[...document.querySelectorAll('.case-drawer button')].find((b) => /生成报告|重新生成/.test(b.innerText))`
const drawerIdle = `document.querySelector('.case-drawer .el-button.is-loading') ? '被拒之后抽屉里的按钮还在转' : ''`
const toRelease = [...openCase(), `document.querySelector('.case-drawer #tab-release').click()`, wait(300), `document.querySelector('.case-drawer .el-radio').click()`, wait(200),
  `${findBtn('确认释放', '.case-drawer')}.click()`, wait(400)]
// 财务三页、看板、报表：正常（1440、1280）、加载、空、失败
const noNumsBut = (keep) => `(() => { const v = [...document.querySelectorAll('#app .stat')].filter((s) => !s.innerText.includes(${JSON.stringify(keep)})).map((s) => s.querySelector('.stat-v').innerText.trim()).filter((t) => t !== '—')
  return v.length ? '没拿到数据却显示了数字：' + v.join('、') : '' })()`
// 1280 宽：侧栏和内容区不重叠、表格不超出内容区（没有操作列的页面用；有操作列的另挂 cFit）
const cFitAny = `(() => { const side = document.querySelector('.side').getBoundingClientRect(), main = document.querySelector('.main').getBoundingClientRect()
  if (side.right > main.left + 1) return '侧栏和内容区重叠 ' + Math.round(side.right - main.left) + 'px'
  if (main.right > innerWidth + 1) return '内容区超出视口 ' + Math.round(main.right - innerWidth) + 'px'
  const t = [...document.querySelectorAll('#app .el-table')].find((x) => x.getClientRects().length && x.getBoundingClientRect().right > main.right + 1); return t ? '表格超出内容区' : '' })()`
// 空状态前后自洽：指标和页签计数都是 0（金额是 ¥0.00）；keep 是不跟这份数据走的卡（如诚信分）
const zeroBut = (keep = '') => `(() => { const n = [...document.querySelectorAll('#app .filter-tabs .n'), ...[...document.querySelectorAll('#app .stat')].filter((s) => !${JSON.stringify(keep)} || !s.innerText.includes(${JSON.stringify(keep)})).map((s) => s.querySelector('.stat-v'))]
    .map((e) => e.innerText.trim()).filter((t) => t && !['0', '—', '¥0.00', '¥0.00 / 天'].includes(t)); return n.length ? '列表是空的，计数却不是 0：' + n.join('、') : '' })()`
// 金额的方向：负数（冲减）也写对（在页面里直接取 utils/format.ts 的 fmtSigned）
const signedCases = `(async () => { const { fmtSigned } = await import('/src/utils/format.ts')
  const cases = [[248, 'in', '+¥248.00'], [620, 'out', '−¥620.00'], [-8, 'in', '−¥8.00'], [-20, 'out', '+¥20.00'], [0, 'out', '¥0.00']]
  const bad = cases.find(([n, d, want]) => fmtSigned(n, d) !== want); return bad ? 'fmtSigned(' + bad[0] + ', ' + bad[1] + ') 应为 ' + bad[2] + '，实际 ' + fmtSigned(bad[0], bad[1]) : '' })()`
// 底部合计和行的符号一致
const footSign = (want) => `(() => { const t = document.querySelector('#app .card__ft')?.innerText ?? ''; return t.includes('本月合计') && t.includes(${JSON.stringify(want)}) ? '' : '底部合计和行的符号不一致：' + t.replace(/\s+/g, ' ') })()`
// 选中的账单行不用主色浅底（和信息色标签融成一片）
const selTone = `(() => { const r = document.querySelector('#app .row-sel'); if (!r) return '没有选中的账单行'; const bg = ${bgToken('--primary-bg')}
  return [r, ...r.querySelectorAll('td')].some((e) => getComputedStyle(e).backgroundColor === bg) ? '选中行铺了主色浅底' : '' })()`
// 渠道报表的迷你漏斗：每条前面写阶段名，不只靠颜色
const funnelText = `(() => { const ls = [...document.querySelectorAll('#app .mini')].map((m) => [...m.querySelectorAll('.mini-l')].map((x) => x.innerText.trim()).join('/'))
  if (!ls.length) return '没有迷你漏斗'; return ls.every((t) => t === '访问/注册/报名/入职') ? '' : '迷你漏斗没写阶段名：' + ls[0] })()`
// 格子里的文字不折行（如 1280 宽下的手机号）
const noWrap = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => { const cs = getComputedStyle(x); return x.getBoundingClientRect().height > (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) * 1.5 })
  return e ? '文字折行了：' + e.innerText : '' })()`
const ownerPage = (screen, path, api, { fake, empty, emptyText, checks = [], wide = [], nums = noNums, errNot = ['暂无'], keep = '', fit = cFitAny }) => [
  { app: 'console', screen, state: 'normal', persona: 'owner', path, rules: sr(...(fake ?? [])), checks: [cSide('owner'), kpiCards, tblFit, statTone, cLegacy16, noThrottleWord, ...checks] },
  { app: 'console', screen, state: 'normal', persona: 'owner', path, width: 1280, height: 800, rules: sr(...(fake ?? [])), checks: [cSide('owner'), fit, kpiCards, tblFit, ...wide] },
  { app: 'console', screen, state: 'loading', persona: 'owner', path, rules: sr({ url: api, action: 'hang' }), quick: true, steps: [wait(600)], checks: [loadMask, nums, hasNot(emptyText), hasNot('暂无')] },
  { app: 'console', screen, state: 'empty', persona: 'owner', path, rules: sr({ url: api, action: 'respond', body: empty }), checks: [has(emptyText), zeroBut(keep), cLegacy16] },
  { app: 'console', screen, state: 'error', persona: 'owner', path, rules: sr({ url: api, action: 'fail' }), checks: [oneRetry, nums, hasNot(emptyText), ...errNot.map(hasNot)] },
]
// ---- 工单 17：项目看板（第 1 类）、岗位管理（第 2 类 + 第 5 类抽屉）、岗位编辑（第 6 类）、知识库（第 2 类 + 第 10 类横条）----
const BOARD_API = '/tenant/reports/board', JOBS_API = '/tenant/jobs', JOB_STATS_API = '/tenant/jobs/stats', KB_API = '/tenant/kb', KB_PENDING_API = '/tenant/kb/pending', PROJECTS_API = '/tenant/projects'
// 看板「本月人员变动」：没拿到数据（加载、失败、没有负责项目）时三格都是「—」
const monthBlank = `(() => { const v = [...document.querySelectorAll('#app .m-v')].map((e) => e.innerText.trim()); if (v.length !== 3) return '「本月人员变动」应该有 3 格，实际 ' + v.length
  const n = v.filter((t) => t !== '—'); return n.length ? '没拿到数据，本月人员变动却显示了数字：' + n.join('、') : '' })()`
// 净增带 +/− 号，颜色是一级文字（不靠红绿区分增减）
const netSigned = `(() => { const c = [...document.querySelectorAll('#app .m-cell')].find((x) => x.innerText.includes('本月净增')); if (!c) return '没有「本月净增」'
  const v = c.querySelector('.m-v'), t = v.innerText.trim(); if (!/^([+−]\\d+|0)$/.test(t)) return '本月净增没有写正负号：' + t
  return getComputedStyle(v).color === ${tokenColor('--text-1')} ? '' : '本月净增靠颜色区分增减：' + getComputedStyle(v).color })()`
// 长表单（第 6 类）：卡片分区、每区块标题加两列字段、必填项带红星、底部固定「取消 / 保存」操作条
const JOB_REQUIRED = ['岗位名称', '所属项目', '工种', '岗位职责', '月综合薪资下限（元）', '月综合薪资上限（元）', '班次', '面试地址', '招聘总名额']
const jobForm = `(() => { const cards = [...document.querySelectorAll('#app .job-form .cards > section.card')]; if (cards.length < 5) return '表单没有按卡片分区：' + cards.length + ' 张'
  const bare = cards.find((c) => !c.querySelector('.card__hd h3')); if (bare) return '有分区没有区块标题'
  const one = cards.find((c) => { const bd = c.querySelector('.card__bd'); return !bd || getComputedStyle(bd).display !== 'grid' || getComputedStyle(bd).gridTemplateColumns.split(' ').length !== 2 }); if (one) return '有分区的字段不是两列：' + one.querySelector('h3').innerText
  const red = ${tokenColor('--el-color-danger')}
  for (const name of ${JSON.stringify(JOB_REQUIRED)}) { const it = [...document.querySelectorAll('#app .job-form .el-form-item')].find((x) => x.querySelector('.el-form-item__label')?.innerText.trim() === name); if (!it) return '没有「' + name + '」'
    const st = getComputedStyle(it.querySelector('.el-form-item__label'), '::before'); if (!it.classList.contains('is-required') || !st.content.includes('*')) return '必填项「' + name + '」没有红星'
    if (st.color !== red) return '「' + name + '」的星不是红色：' + st.color }
  return '' })()`
const jobBar = `(() => { const bar = document.querySelector('#app .save-bar'); if (!bar) return '没有底部操作条'; const r = bar.getBoundingClientRect()
  if (Math.abs(r.bottom - innerHeight) > 1) return '操作条没有固定在底部（下沿 ' + Math.round(r.bottom) + '，视口 ' + innerHeight + '）'
  const bs = [...bar.querySelectorAll('.el-button')]; if (bs.length !== 2 || !bs[0].innerText.includes('取消') || !bs[1].classList.contains('el-button--primary')) return '操作条不是「取消」加主色「保存」'
  if (bs[0].getBoundingClientRect().left > bs[1].getBoundingClientRect().left) return '「取消」不在「保存」左边'
  const cut = bs.find((b) => { const q = b.getBoundingClientRect(); return q.top < r.top || q.bottom > r.bottom + 1 || q.bottom > innerHeight + 1 }); if (cut) return '操作条里的「' + cut.innerText.trim() + '」被截掉了（操作条高 ' + Math.round(r.height) + '）'
  const main = document.querySelector('.main').getBoundingClientRect(); return r.left >= main.left - 1 && r.right <= main.right + 1 ? '' : '操作条超出内容区' })()`
// 抽屉里的薪资：白底上 ≥18px / 600 的薪资色（规范 Color Roles）
const drawerSalary = `(() => { const e = document.querySelector('.job-drawer .salary'); if (!e) return '抽屉里没有薪资'; const cs = getComputedStyle(e)
  if (parseFloat(cs.fontSize) < 18 || Number(cs.fontWeight) < 600) return '薪资不够大或不够粗：' + cs.fontSize + ' ' + cs.fontWeight
  return cs.color === ${tokenColor('--salary')} ? '' : '薪资不是薪资色：' + cs.color })()`
// 操作列文字按钮的点击区至少 24 高
const opsTap = `(() => { const b = [...document.querySelectorAll('#app td.ops-col .el-button')].find((x) => x.getClientRects().length && x.getBoundingClientRect().height < 24); return b ? '操作列「' + b.innerText.trim() + '」点击区只有 ' + Math.round(b.getBoundingClientRect().height) + 'px 高' : '' })()`
// 岗位表薪资列右对齐；驳回原因整段显示（不截断、不省略）
const salaryRight = `(() => { const tds = [...document.querySelectorAll('#app .el-table__body td.salary-col')]; if (!tds.length) return '没有薪资列'; return tds.every((td) => td.classList.contains('is-right')) ? '' : '薪资列没有右对齐' })()`
const remarkFull = `(() => { const e = [...document.querySelectorAll('#app .remark')]; if (!e.length) return '没有驳回原因'
  const cut = e.find((x) => x.scrollHeight > x.clientHeight + 1 || x.scrollWidth > x.clientWidth + 1 || getComputedStyle(x).webkitLineClamp !== 'none'); return cut ? '驳回原因被截断：' + cut.innerText : '' })()`
// 筛选栏右侧是「查询 / 重置」
const queryReset = `(() => { const bs = [...document.querySelectorAll('#app .toolbar > .el-button')].map((b) => b.innerText.trim()); return bs.slice(-2).join('/') === '查询/重置' ? '' : '筛选栏右侧不是「查询 / 重置」：' + bs.join('/') })()`
const hasPager = `document.querySelector('#app .tbl-card .el-pagination') ? '' : '表格下面没有分页'`
// 看板「待我处理」的标签一样宽，标题左边对齐
const todoAligned = `(() => { const ts = [...document.querySelectorAll('#app .lrow .lt')].map((x) => Math.round(x.getBoundingClientRect().left)); if (ts.length < 2) return '待我处理不到 2 行'; return new Set(ts).size === 1 ? '' : '待我处理的标题左右错开：' + ts.join(',') })()`
// 编辑页加载：遮罩不盖页面头，转圈在视口里
const editSpinner = `(() => { const m = document.querySelector('#app .el-loading-mask'), hd = document.querySelector('#app .page-hd'); if (!m) return '没有加载遮罩'
  if (m.getBoundingClientRect().top < hd.getBoundingClientRect().bottom - 1) return '加载遮罩盖住了页面头'
  const sp = m.querySelector('.el-loading-spinner svg, .el-loading-spinner .circular').getBoundingClientRect(); return sp.top >= 0 && sp.bottom <= innerHeight ? '' : '加载的转圈不在视口里（' + Math.round(sp.top) + '）' })()`
const drawerUnit = `(() => { const t = document.querySelector('.job-drawer .salary')?.innerText.replace(/\s+/g, ''); return t?.endsWith('元/月（综合）') ? '' : '抽屉薪资没写「元/月（综合）」：' + t })()`
const openJobRow = (text) => [`${findBtn(text, '#app .el-table__body')}.click()`, wait(500)]
const openJobTitle = [`document.querySelector('#app .el-table__body .title').click()`, wait(700)]
const KB_WHY = '暂时不能删除：条目已被他人修改'
const C_LOGIN_API = '/tenant/auth/sms-login', C_SMS_API = '/tenant/auth/sms-code', C_CAPTCHA_API = '/tenant/auth/captcha'
const C_APPLY_API = '/tenant/onboarding/apply', C_UPLOAD_API = '/tenant/onboarding/files', C_RESUBMIT_API = '/tenant/company/application'
const C_MSG_API = '/tenant/messages?', C_UNREAD_API = '/tenant/messages/unread-count', C_READ_API = '/tenant/messages/read'
const fillPhone = fill('11 位手机号', '13800000002'), fillCode = fill('6 位数字验证码', '123456')
// 入驻申请页要内存里的入驻凭证：同 routes.mjs 的 enterOnboardingApply，塞一个假的
const enterApply = `(async () => { const g = document.querySelector('#app').__vue_app__.config.globalProperties
  g.$pinia._s.get('onboarding').set('screenshot-only', '138****0019'); await g.$router.push('/onboarding/apply') })()`
// 表单填好并「上传」一张执照（上传接口用 respond 回一个后端形状的文件）
const fillApply = `(async () => { const set = (ph, v) => { const el = document.querySelector('#app input[placeholder*="' + ph + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  set('与营业执照一致', '昆山鑫诚劳务派遣有限公司'); set('18 位', '91320583MA1XC00019'); set('负责对接平台的联系人', '陈晓明')
  const input = document.querySelector('#app .uploader input[type=file]'), dt = new DataTransfer()
  dt.items.add(new File(['x'], '营业执照.png', { type: 'image/png' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  await ${wait(800)} })()`
const fakeUpload = reply({ key: 'onboarding/2026/11/shot-license.png', name: '营业执照.png', size: 1 })
const C_PENDING = data.personas.pendingOwner.phone
const pendingMe = (await get(TME_API, await tenantSession(C_PENDING))).data
const pmMe = (await get(TME_API, await tenantSession(MEMBERS.pm))).data
// 驳回状态的岗位（编辑时不弹确认框、直接保存），从 PM 的岗位列表里取，不写死编号
const rejectedJobId = (await get(JOBS_API + '?status=REJECTED&page=1&pageSize=1', await tenantSession(MEMBERS.pm))).data.records[0]?.jobId
const MATCHED_EDIT = `/pm/jobs/edit?id=${data.ids.matchedJobId}`
// 假的成员信息。规则按「地址里包含」匹配，'/tenant/me' 也会命中 '/tenant/messages/…'（未读数会被换成成员对象），所以先放行消息的读取
const cMe = (me, company) => [{ url: '/tenant/messages', method: 'GET', action: 'continue' }, { url: TME_API, action: 'respond', body: reply({ ...me, company: { ...me.company, ...company } }) }]
const openBell = `document.querySelector('.top button[aria-label="消息"]').click()`
const msgsEmpty = reply({ records: [], total: 0, page: 1, pageSize: 20 })
// 消息抽屉：每条是标题、时间、两行摘要；未读的左边主色圆点、标题 500
const cDrawer = `(() => { const d = document.querySelector('.msg-drawer'); if (!d) return '没有消息抽屉'
  const items = [...d.querySelectorAll('.msg')]; if (!items.length) return '抽屉里没有消息'
  const un = items.find((m) => m.classList.contains('unread')); if (!un) return '没有未读消息'
  const dot = un.querySelector('.dot'); if (!dot || getComputedStyle(dot).backgroundColor !== ${bgToken('--primary')}) return '未读没有主色圆点'
  if (Number(getComputedStyle(un.querySelector('.mt')).fontWeight) !== 500) return '未读标题不是 500 字重'
  const mc = un.querySelector('.mc'); if (getComputedStyle(mc).webkitLineClamp !== '2') return '摘要不是两行截断'
  return '' })()`
// 顶栏消息角标：只显示数字（超过 99 显示 99+），不压住旁边的「退出」
const cBadge = `(() => { const b = [...document.querySelectorAll('.top .el-badge__content')].find((e) => e.getClientRects().length); if (!b) return '没有未读角标'
  if (!/^\\d{1,2}$|^99\\+$/.test(b.innerText.trim())) return '角标不是数字：' + b.innerText
  const out = ${findBtn('退出', '.top')}.getBoundingClientRect(), r = b.getBoundingClientRect()
  return r.right > out.left ? '角标压住了「退出」' : '' })()`
// D-58：公司后台不出现「限流」字样
const noThrottleWord = `document.querySelector('#app').innerText.includes('限流') ? '后台出现了「限流」字样' : ''`
// 消息抽屉：宽 560–720，标题是区块标题样式
const drawerShape = `(() => { const d = document.querySelector('.msg-drawer'), w = d.getBoundingClientRect().width; if (w < 560 || w > 720) return '消息抽屉宽 ' + w + '，应在 560–720'
  const t = getComputedStyle(d.querySelector('.el-drawer__title'))
  return parseFloat(t.fontSize) === 16 && Number(t.fontWeight) === 600 && t.color === ${tokenColor('--text-1')} ? '' : '抽屉标题不是 16px / 600 一级文字' })()`
// 字段下的错误提示和下面的字段、按钮之间至少 16（同一列里往下找最近的一个）
const fieldGap = `(() => { const errs = [...document.querySelectorAll('#app .el-form-item__error')].filter((e) => e.getClientRects().length); if (!errs.length) return '没有字段错误提示'
  const below = [...document.querySelectorAll('#app .el-form-item, #app .el-button, #app .form-err')].filter((e) => e.getClientRects().length)
  for (const e of errs) { const r = e.getBoundingClientRect(), own = e.closest('.el-form-item')
    const gaps = below.filter((x) => !own.contains(x) && !x.contains(own)).map((x) => x.getBoundingClientRect())
      .filter((x) => x.top >= r.top && x.left < r.right && x.right > r.left).map((x) => x.top - r.bottom)
    const g = Math.min(...gaps); if (g < 15) return '「' + e.innerText + '」和下面的内容只隔 ' + Math.round(g) + 'px' }
  return '' })()`
// 未到的步骤文字不用占位色：和三级文字色一样
const waitStepText = `(() => { const t = document.querySelector('#app .el-step__title.is-wait'); if (!t) return '没有未到的步骤'
  return getComputedStyle(t).color === ${tokenColor('--text-3')} ? '' : '未到的步骤文字颜色太浅：' + getComputedStyle(t).color })()`
// 结果区：一个主按钮加一个文字链接
const resultActs = `(() => { const a = document.querySelector('#app .result .acts'); if (!a) return '结果区没有按钮'
  const p = a.querySelectorAll('.el-button--primary:not(.is-link)').length, l = a.querySelectorAll('.el-button.is-link').length
  return p === 1 && l === 1 ? '' : '结果区应当是一个主按钮加一个文字链接，实际主按钮 ' + p + ' 个、链接 ' + l + ' 个' })()`
const readAllOffEl = `(() => { const b = ${findBtn('全部已读', '.msg-drawer')}; return b && b.disabled ? '' : '「全部已读」没有置灰' })()`

// ---- 工单 18：人员管理（第 2 类 + 请假旷工、离职、调岗弹窗）、离职审核（第 8 类）、花名册导入（第 16 类）、工伤上报（第 2 类）----
const RESIGN_API = '/tenant/resign-requests', ROSTER_BATCHES_API = '/tenant/roster/batches', ROSTER_IMPORT_API = '/tenant/roster/import'
// 审核按钮和别的审核页（驻场预支审核的 reviewBar）一致：「驳回」在左、白底危险色字和描边；通过类（如「确认离职」）在右、主色实心
const reviewOpsFor = (okText) => `(() => { const rows = [...document.querySelectorAll('#app .el-table__body tr')].filter((tr) => tr.querySelector('td.ops-col .el-button')); if (!rows.length) return '没有带审核按钮的行'
  let seen = 0
  for (const tr of rows) { const bs = [...tr.querySelectorAll('td.ops-col .el-button')], rj = bs.find((b) => b.innerText.includes('驳回')), ok = bs.find((b) => b.innerText.includes(${JSON.stringify(okText)})); if (!rj || !ok) continue
    seen++; const a = rj.getBoundingClientRect(), b = ok.getBoundingClientRect(); if (Math.abs(a.top - b.top) > 1 || a.right > b.left) return '「驳回」不在「${okText}」左边'
    const lc = getComputedStyle(rj), rc = getComputedStyle(ok)
    if (lc.backgroundColor !== ${bgToken('--bg-card')} || lc.color !== ${tokenColor('--danger-text')} || lc.borderTopColor !== ${tokenColor('--danger-text')}) return '「驳回」不是危险色描边：' + lc.backgroundColor + ' ' + lc.color + ' ' + lc.borderTopColor
    if (rc.backgroundColor !== ${bgToken('--primary')} || ok.classList.contains('is-plain') || ok.classList.contains('is-link')) return '「${okText}」不是主色实心：' + rc.backgroundColor }
  return seen ? '' : '没有同时有「驳回」和「${okText}」的行' })()`
const reviewOps = reviewOpsFor('确认离职')
// 导入页（第 16 类）：步骤说明 → 虚线上传区（写明模板和格式）→ 结果汇总（成功 n 条、失败 n 条）→ 逐行结果表
const importLayout = `(() => { const q = (s) => document.querySelector('#app ' + s), st = q('.steps'), up = q('.el-upload-dragger'), sum = q('.result .sum'), tb = q('.row-tbl')
  if (!st || !up) return '没有步骤说明或上传区'; if (getComputedStyle(up).borderTopStyle !== 'dashed') return '上传区不是虚线边框'
  if (!up.innerText.includes('模板') || !up.innerText.includes('.xlsx')) return '上传区没写模板下载方式和格式要求'
  const y = (e) => e.getBoundingClientRect().top; if (!(y(st) < y(up))) return '步骤说明不在上传区上面'
  if (sum && tb && !(y(up) < y(sum) && y(sum) < y(tb))) return '顺序不是上传区 → 结果汇总 → 逐行结果表'
  if (sum && !(/成功\\s*\\d+\\s*条/.test(sum.innerText) && /失败\\s*\\d+\\s*条/.test(sum.innerText))) return '结果汇总没写「成功 n 条、失败 n 条」'
  return '' })()`
// 逐行结果表：失败行用 --danger-soft 浅底（tr 和 td 一起看）并写明原因，成功行不铺底
const rosterRows = `(() => { const t = document.querySelector('#app .row-tbl'); if (!t) return '没有逐行结果表'
  const trs = [...t.querySelectorAll('.el-table__body tr')], bad = trs.filter((tr) => tr.innerText.includes('失败')), good = trs.filter((tr) => !tr.innerText.includes('失败'))
  if (!bad.length || !good.length) return '逐行结果表应同时有成功行和失败行：' + good.length + ' / ' + bad.length
  const soft = ${bgToken('--danger-soft')}, onSoft = (tr) => [tr, ...tr.querySelectorAll('td')].some((e) => getComputedStyle(e).backgroundColor === soft)
  const nb = bad.find((tr) => !onSoft(tr)); if (nb) return '失败行没用危险浅底：' + nb.innerText.replace(/\\s+/g, ' ')
  if (good.some(onSoft)) return '成功行也铺了危险浅底'
  const nr = bad.find((tr) => { const c = tr.querySelectorAll('td')[2]?.innerText.trim(); return !c || c === '—' }); return nr ? '失败行没写原因：' + nr.innerText.replace(/\\s+/g, ' ') : '' })()`
const pickFile = (name) => `(() => { const i = document.querySelector('#app .el-upload__input'), dt = new DataTransfer()
  dt.items.add(new File(['x'], ${JSON.stringify(name)}, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })) })()`
const pickXlsx = pickFile('十一月花名册.xlsx')
const startImport = [pickXlsx, wait(300), `${findBtn('开始导入')}.click()`, wait(400)]
const ROSTER_ROWS = Array.from({ length: 9 }, (_, i) => (i === 3 ? { rowNo: i + 2, success: false, error: '手机号格式不正确：1380000123' }
  : i === 6 ? { rowNo: i + 2, success: false, error: '项目「立讯精密昆山三期」不存在，请填项目编号或完整名称' } : { rowNo: i + 2, success: true, userId: 'U20261113000' + i }))
const fakeRoster = reply({ batchId: 'RB-SHOT-1113', total: 9, success: 7, failed: 2, inFreePeriod: true, rows: ROSTER_ROWS })
const fakeAbs = reply([
  { id: 92, employmentId: 'EM2026111200001', absenceDate: '2026-11-10', absenceType: 'ABSENT', markedBy: 'M202611120003', createdAt: '2026-11-10T18:20:00' },
  { id: 91, employmentId: 'EM2026111200001', absenceDate: '2026-11-05', absenceType: 'LEAVE', markedBy: 'M202611120003', remark: '病假', createdAt: '2026-11-05T08:10:00' },
])
const absGetR = (action, body) => ({ url: ABS_API, method: 'GET', action, body })
const dlgLegacy = `document.querySelector('.el-dialog .tag, .el-dialog .note, .el-dialog .mono, .el-dialog .num, .el-dialog .eyebrow') ? '弹窗里还在用旧标签、旧提示条、眉标或旧数字类' : ''`
const dlgIdle = `document.querySelector('.el-dialog .el-button.is-loading, .el-message-box .el-button.is-loading') ? '被拒之后弹窗里的按钮还在转' : ''`
const dlgOff = (text) => `[...document.querySelectorAll('.el-dialog__footer button, .el-dialog .mark-row button')].find((b) => b.innerText.includes(${JSON.stringify(text)}))?.disabled ? '' : '被拒之后弹窗里的「${text}」没有置灰'`
const fillDlg = (sel, value) => `(() => { const el = document.querySelector(${JSON.stringify('.el-dialog ' + sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const pickOpt = (i, not = '') => [`document.querySelectorAll('.el-dialog .el-select__wrapper')[${i}].click()`, wait(500),
  `[...document.querySelectorAll('.el-select-dropdown__item')].find((x) => x.getClientRects().length && !x.classList.contains('is-disabled') && (!${JSON.stringify(not)} || !x.innerText.includes(${JSON.stringify(not)}))).click()`, wait(300)]
const openStaff = (text) => [`${findBtn(text, '#app .el-table__body')}.click()`, wait(600)]
const tabsBlank = `document.querySelector('#app .filter-tabs .n') ? '没拿到数据却显示了页签计数' : ''`
const tblMask = `document.querySelector('#app .el-table .el-loading-mask') ? '' : '加载中表格上没有加载遮罩'`
// 「状态」列一律是共享状态标签（不再有改版前的状态点）
const statusTags = `(() => { const t = document.querySelector('#app .el-table'), i = [...t.querySelectorAll('.el-table__header th')].findIndex((th) => th.innerText.trim() === '状态'); if (i < 0) return '表格没有「状态」列'
  const rs = [...t.querySelectorAll('.el-table__body tr')]; if (!rs.length) return '表格没有行'
  const r = rs.find((tr) => !tr.children[i]?.querySelector('.status-tag')); return r ? '这一行的状态不是共享状态标签：' + r.innerText.replace(/\\s+/g, ' ').slice(0, 16) : '' })()`
const RESIGN_WHY = '离职申请已被处理，请刷新后再操作'
// 确认框标题和弹窗标题同级：16px / 600
const boxTitle = `(() => { const t = [...document.querySelectorAll('.el-message-box__title')].find((x) => x.getClientRects().length); if (!t) return '没有确认框'
  const cs = getComputedStyle(t); return parseFloat(cs.fontSize) === 16 && Number(cs.fontWeight) === 600 ? '' : '确认框标题不是 16px / 600：' + cs.fontSize + ' ' + cs.fontWeight })()`
// 确认框里的「驳回」和表格里的一致：白底、危险色字和描边
const boxReject = `(() => { const b = ${findBtn('驳回', '.el-message-box')}; if (!b) return '确认框里没有「驳回」'; const cs = getComputedStyle(b)
  return cs.backgroundColor === ${bgToken('--bg-card')} && cs.color === ${tokenColor('--danger-text')} && cs.borderTopColor === ${tokenColor('--danger-text')} ? '' : '确认框里的「驳回」不是危险色描边：' + cs.backgroundColor + ' ' + cs.color + ' ' + cs.borderTopColor })()`
// 选中的菜单项在侧栏可视区里（1280×800 下菜单比侧栏高）
const sideActive = `(() => { const nav = document.querySelector('.side .nav'), a = nav?.querySelector('.item.is-active'); if (!a) return '侧栏没有选中项'
  const n = nav.getBoundingClientRect(), r = a.getBoundingClientRect(); return r.top >= n.top - 1 && r.bottom <= n.bottom + 1 ? '' : '选中的菜单项不在侧栏可视区里（' + Math.round(r.top) + ' / ' + Math.round(n.bottom) + '）' })()`
// 弹窗里的标签、字段值和已选项不折行
// 按文字实际排出的行数算（Element 的标签定高 32，折行后元素高度不变，只看高度查不出来）
const dlgNoWrap = `(() => { for (const e of document.querySelectorAll('.el-dialog .el-form-item__label, .el-dialog .desc-list dd, .el-dialog .el-select__selected-item')) {
    if (!e.getClientRects().length || !e.innerText.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(e)
    const tops = new Set([...rg.getClientRects()].filter((q) => q.width).map((q) => Math.round(q.top))); if (tops.size > 1) return '文字折行了：' + e.innerText.trim() }
  return '' })()`
// 文件名只出现一次
const nameOnce = (name) => `(() => { const n = document.querySelector('#app').innerText.split(${JSON.stringify(name)}).length - 1; return n === 1 ? '' : '「${name}」出现了 ' + n + ' 次' })()`
const fakeRosterOk = reply({ batchId: 'RB-SHOT-1114', total: 3, success: 3, failed: 0, inFreePeriod: true, rows: [2, 3, 4].map((rowNo) => ({ rowNo, success: true, userId: 'U2026111300' + rowNo })) })
const resignRefused = refuse('RESIGN_4091', RESIGN_WHY)
// ---- 工单 19：预支审批（第 8 类，同离职审核的表格操作列）、工资表导入（第 16 类，同花名册导入）、工资申诉（第 8 类，处理弹窗）、预支抵扣对账（第 9 类）----
const PB_API = '/tenant/payroll/batches', PIMPORT_API = '/tenant/payroll/import', APPEAL_API = '/tenant/payroll/appeals', RECON_API = '/tenant/payroll/recon'
// 假数据的项目编号取演示库里真实的预支单，项目名才对得上
const advLive = (await get(TADV_API, await tenantSession(MEMBERS.pm))).data
const ADV_PROJECT = advLive[0]?.projectId ?? 'P20261112001'
// 后端 AdvanceRow 的形状（LocalDateTime 是「2026-11-13T09:10:00」、金额是数字）
const fakeTAdv = (n, name, status, allowedActions, extra = {}) => ({ advanceId: 'YZ2026111300' + n, userId: 'U202611120000' + n, seekerName: name, projectId: ADV_PROJECT, amount: 500, bizMonth: '2026-11',
  status, repaidAmount: 0, createdAt: `2026-11-13T09:${n}0:00`, allowedActions, projectName: '立讯精密昆山二期', ...extra })
const fakeTAdvs = reply([
  fakeTAdv(1, '陈**', 'SITE_APPROVED', ['PM_APPROVE', 'PM_REJECT']),
  fakeTAdv(2, '周**', 'PM_APPROVED', ['PAYOUT']),
  fakeTAdv(3, '吴**', 'SUBMITTED', []),
  fakeTAdv(4, '郑**', 'PARTIALLY_REPAID', [], { repaidAmount: 200, paidAt: '2026-11-03T15:20:00' }),
  fakeTAdv(5, '王**', 'REPAID', [], { repaidAmount: 500, paidAt: '2026-10-20T10:05:00' }),
  fakeTAdv(6, '冯**', 'REJECTED', []),
])
const ADV_WHY = '预支状态已变化，请刷新后再操作'
const advRefused = refuse('ADVANCE_4091', ADV_WHY)
// 填写原因用弹窗：点「驳回」弹出带多行输入框的确认框
const boxInput = `[...document.querySelectorAll('.el-message-box textarea')].some((t) => t.getClientRects().length) ? '' : '驳回没有弹出填写原因的输入框'`
// 处理弹窗（工资申诉）：底部「不受理」在左、危险色描边，「受理并回复」在右、主色实心，弹窗里有填写处理说明的输入框
const dlgReview = `(() => { const ft = document.querySelector('.el-dialog__footer'); if (!ft) return '没有处理弹窗'
  const bs = [...ft.querySelectorAll('.el-button')], rj = bs.find((b) => b.innerText.includes('不受理')), ok = bs.find((b) => b.innerText.includes('受理并回复')); if (!rj || !ok) return '弹窗底部没有「不受理 / 受理并回复」'
  const a = rj.getBoundingClientRect(), b = ok.getBoundingClientRect(); if (a.right > b.left) return '「不受理」不在「受理并回复」左边'
  const lc = getComputedStyle(rj), rc = getComputedStyle(ok)
  if (lc.backgroundColor !== ${bgToken('--bg-card')} || lc.color !== ${tokenColor('--danger-text')} || lc.borderTopColor !== ${tokenColor('--danger-text')}) return '「不受理」不是危险色描边：' + lc.backgroundColor + ' ' + lc.color + ' ' + lc.borderTopColor
  if (rc.backgroundColor !== ${bgToken('--primary')} || ok.classList.contains('is-plain')) return '「受理并回复」不是主色实心：' + rc.backgroundColor
  return document.querySelector('.el-dialog textarea') ? '' : '弹窗里没有填写处理说明的输入框' })()`
const fillReply = `(() => { const el = document.querySelector('.el-dialog textarea'); el.value = '核对考勤后确认无误，其他扣款为工牌补办费 20 元'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
const APPEAL_WHY = '申诉已处理，请刷新后再操作'
// 金额等宽、右对齐：每个金额都是等宽数字；表格里的金额贴着格子右边（扣掉内边距），一列金额的个位对齐
const moneyAligned = (scope = '#app') => `(() => { const els = [...document.querySelectorAll(${JSON.stringify(scope + ' .money')})].filter((e) => e.getClientRects().length); if (!els.length) return '页面上没有金额'
  const off = els.find((e) => !getComputedStyle(e).fontVariantNumeric.includes('tabular-nums')); if (off) return '金额不是等宽数字：' + off.innerText
  const tds = els.filter((e) => e.closest('td')); if (!tds.length) return '表格里没有金额'
  for (const e of tds) { const c = e.closest('.cell'), r = c.getBoundingClientRect(), right = r.right - parseFloat(getComputedStyle(c).paddingRight)
    if (Math.abs(e.getBoundingClientRect().right - right) > 1) return '表格里的金额没贴右边：' + e.innerText + '（差 ' + Math.round(right - e.getBoundingClientRect().right) + 'px）' }
  return '' })()`
// 后端 AdvanceRecon 的形状：10 月抵扣了 3 个人，其中 1 人已离职、抵扣后还欠
const fakeRecon = reply({ month: '2026-10', months: ['2026-10', '2026-09'],
  summary: { deductTotal: 1300, deductCount: 3, payoutTotal: 1500, payoutCount: 3, outstandingTotal: 1700, outstandingCount: 3, outstandingLeftCount: 1 },
  deductions: [
    { payslipId: 'GZ2026111200011', userId: 'U2026111200021', seekerName: '陈**', employeeNo: 'KS-0111', projectName: '立讯精密昆山二期', grossPay: 5200, netPay: 4243.5, advanceDeduct: 500, debtAfter: 0 },
    { payslipId: 'GZ2026111200012', userId: 'U2026111200022', seekerName: '周**', employeeNo: 'KS-0112', projectName: '立讯精密昆山二期', grossPay: 4580, netPay: 3623.5, advanceDeduct: 500, debtAfter: 500 },
    { payslipId: 'GZ2026111200013', userId: 'U2026111200023', seekerName: '孙**', projectName: '立讯精密昆山二期', endDate: '2026-10-25', grossPay: 1860, netPay: 1103.5, advanceDeduct: 300, debtAfter: 700 },
  ],
  outstanding: [
    { userId: 'U2026111200023', seekerName: '孙**', projectName: '立讯精密昆山二期', endDate: '2026-10-25', debt: 700, lastChangeAt: '2026-11-05T10:12:00' },
    { userId: 'U2026111200022', seekerName: '周**', employeeNo: 'KS-0112', projectName: '立讯精密昆山二期', debt: 500, lastChangeAt: '2026-11-05T10:12:00' },
    { userId: 'U2026111200014', seekerName: '李**', employeeNo: 'KS-0101', projectName: '立讯精密昆山二期', debt: 500, lastChangeAt: '2026-11-12T16:57:57' },
  ] })
const emptyRecon = reply({ month: '2026-10', months: ['2026-10'], summary: { deductTotal: 0, deductCount: 0, payoutTotal: 0, payoutCount: 0, outstandingTotal: 0, outstandingCount: 0, outstandingLeftCount: 0 }, deductions: [], outstanding: [] })
// 空状态自洽：指标都是 0（金额 ¥0.00，人数「0 人」）
const reconZero = `(() => { const n = [...document.querySelectorAll('#app .stat-v')].map((e) => e.innerText.replace(/\\s*人$/, '').trim()).filter((t) => !['0', '¥0.00'].includes(t)); return n.length ? '没有数据，指标却不是 0：' + n.join('、') : '' })()`
// 后端 PayrollBatchResult 的形状：9 行，第 4、7 行失败
const PAY_ROWS = Array.from({ length: 9 }, (_, i) => (i === 3 ? { rowNo: i + 2, success: false, error: '未找到该月在本公司任职的员工', phoneMasked: '139****1203' }
  : i === 6 ? { rowNo: i + 2, success: false, error: '该员工 2026-10 已导入过工资（防重复抵扣）', phoneMasked: '139****8771', employeeNo: 'KS-0102' }
  : { rowNo: i + 2, success: true, payslipId: 'GZ20261113000' + i, advanceDeduct: i === 1 ? 500 : 0, netPay: 4100 + i * 37.5, phoneMasked: '139****' + (5100 + i), employeeNo: 'KS-01' + (10 + i) }))
const fakePayroll = reply({ batchId: 'PB-SHOT-1113', payMonth: '2026-10', headcount: 7, grossTotal: 33600, advanceDeductTotal: 500, netTotal: 29720.5, rows: PAY_ROWS })
const fakePayrollOk = reply({ batchId: 'PB-SHOT-1114', payMonth: '2026-10', headcount: 2, grossTotal: 9400, advanceDeductTotal: 0, netTotal: 8487, rows: [2, 3].map((rowNo) => ({ rowNo, success: true, payslipId: 'GZ2026111300' + rowNo, advanceDeduct: 0, netPay: 4243.5, phoneMasked: '139****510' + rowNo })) })
const pickPay = pickFile('十月工资表.xlsx')
const startPay = [pickPay, wait(300), `${findBtn('开始导入')}.click()`, wait(400)]
// 页面头有「下载模板」（不点，不真的下载）
const tplBtn = `${findBtn('下载模板', '#app .page-hd')} ? '' : '页面头没有「下载模板」'`
// 汇总里的金额（含实发合计）都是一级文字色，不用颜色区分
const sumPlain = `(() => { const c = ${tokenColor('--text-1')}, e = [...document.querySelectorAll('#app .result .sum .money')].find((x) => getComputedStyle(x).color !== c); return e ? '汇总金额不是一级文字色：' + e.innerText : '' })()`
// 审批链一行放下（不折行，「→ 还清」不掉到第二行）
const chainOneLine = `(() => { const cs = [...document.querySelectorAll('#app .chain')]; if (!cs.length) return '没有审批链'
  const bad = cs.find((c) => new Set([...c.querySelectorAll('.cn')].map((x) => Math.round(x.getBoundingClientRect().top))).size > 1); return bad ? '审批链折行了：' + bad.innerText.replace(/\\s+/g, '') : '' })()`
const refreshBusy = `${findBtn('刷新', '#app .page-hd')}?.classList.contains('is-loading') ? '' : '加载中「刷新」没有转圈，能连点'`
const pickMonth = (m) => [`document.querySelector('#app .page-hd .el-select__wrapper').click()`, wait(400),
  `[...document.querySelectorAll('.el-select-dropdown__item')].find((x) => x.getClientRects().length && x.innerText.trim() === ${JSON.stringify(m)}).click()`]
const monthKept = (m) => `document.querySelector('#app .page-hd .el-select__selected-item:not(.is-hidden)')?.innerText.trim() === ${JSON.stringify(m)} ? '' : '月份选择框没保留已选的「${m}」：' + document.querySelector('#app .page-hd .el-select')?.innerText.trim()`
// 切月份时不出现「新月份标题 + 旧数字」：标题不带月份、数字是「—」、不下结论
const switchBlank = `(() => { const t = [...document.querySelectorAll('#app .stat-l, #app .card__hd h3')].map((e) => e.innerText).find((x) => /\\d{4}-\\d{2}/.test(x)); if (t) return '没拿到这个月的数据，标题却写了月份：' + t
  return document.querySelector('#app').innerText.includes('需线下追收') ? '没拿到数据却显示了「需线下追收」' : '' })()`
// ---- 工单 20：设置（第 11 类）----
const PROJ_API = '/tenant/projects', CONTRACT_API = '/tenant/client-contracts', CHANNEL_API = '/tenant/channel-codes', MEMBER_API = '/tenant/members'
// 设置页排法：页面头（标题 + 右边「新增」主按钮）→ 标签页（如有）→ 白卡片里的表格
const setLayout = (addText, tabs = false) => `(() => { const hd = document.querySelector('#app .page-hd'); if (!hd?.querySelector('h2')) return '没有页面头'
  const add = ${findBtn(addText, '#app .page-hd')}; if (!add || !add.classList.contains('el-button--primary') || add.classList.contains('is-plain') || add.classList.contains('is-link')) return '页面头右边没有「${addText}」主按钮'
  const t = [...document.querySelectorAll('#app .el-table')].find((x) => x.getClientRects().length); if (!t) return '没有表格'
  const card = t.closest('.card'); if (!card || getComputedStyle(card).backgroundColor !== ${bgToken('--bg-card')}) return '表格不在白卡片里'
  const y = (e) => e.getBoundingClientRect().top
  if (${tabs}) { const tb = document.querySelector('#app .el-tabs__header'); if (!tb) return '没有标签页'; if (!(y(hd) < y(tb) && y(tb) < y(t))) return '顺序不是页面头 → 标签页 → 表格' }
  return y(hd) < y(t) ? '' : '表格不在页面头下面' })()`
// 编辑用弹窗，宽 480–640（最上面那个弹窗）
const dlgWidth = `(() => { const d = [...document.querySelectorAll('.el-dialog')].filter((x) => x.getClientRects().length).at(-1); if (!d) return '没有弹窗'
  const w = Math.round(d.getBoundingClientRect().width); return w >= 480 && w <= 640 ? '' : '弹窗宽 ' + w + '，应在 480–640' })()`
// 页面上的专属码：码点纯黑白；按页面上的链接重新编码、逐个模块对照（本机没有扫码库，用这个代替解码）；白底框，码四周白边不少于 2 个模块
const qrScreen = `(async () => { const QR = (await import('/node_modules/.vite/deps/qrcode.js')).default
  const box = document.querySelector('#app .mine .qr'), img = box?.querySelector('img'); if (!img) return '没有专属码图片'
  const url = document.querySelector('#app .mine .url')?.innerText.trim(); if (!url) return '页面上没有专属链接'
  await img.decode(); const W = img.naturalWidth, c = document.createElement('canvas'); c.width = W; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, W, c.height).data; let grey = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i] !== d[i + 2] || (d[i] !== 0 && d[i] !== 255)) grey++
  if (grey) return '专属码里有 ' + grey + ' 个不是纯黑白的像素'
  const mod = QR.create(url, { errorCorrectionLevel: 'M' }).modules, n = mod.size, cell = W / (n + 2); let wrong = 0
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) { const i = (Math.floor((r + 1.5) * cell) * W + Math.floor((col + 1.5) * cell)) * 4; if ((d[i] === 0) !== !!mod.data[r * n + col]) wrong++ }
  if (wrong) return '专属码的码点和链接 ' + url + ' 对不上：' + wrong + ' 个模块不同'
  if (getComputedStyle(box).backgroundColor !== 'rgb(255, 255, 255)') return '二维码底框不是白色：' + getComputedStyle(box).backgroundColor
  const ir = img.getBoundingClientRect(), shown = ir.width / (n + 2), pad = ir.left - box.getBoundingClientRect().left - parseFloat(getComputedStyle(box).borderLeftWidth)
  const quiet = (pad + shown) / shown; return quiet >= 2 ? '' : '二维码白边只有 ' + quiet.toFixed(1) + ' 个模块' })()`
// 表格里启用中的渠道码：每一张都只有纯黑、纯白两种像素
const qrRowsPure = `(async () => { const imgs = [...document.querySelectorAll('#app td .qr:not(.dim) img')]; if (!imgs.length) return '表格里没有启用中的二维码'
  for (const img of imgs) { await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i] !== d[i + 2] || (d[i] !== 0 && d[i] !== 255)) return '表格里的二维码有不是纯黑白的像素' }
  return '' })()`
// 下载的二维码图片：在页面里调 utils/qr.ts 合成（不触发下载）；码区纯黑白、码点和链接一致，外圈静区全白且（连同码自带的 1 模块白边）不少于 4 个模块
const qrPng = `(async () => { const m = await import('/src/utils/qr.ts'), QR = (await import('/node_modules/.vite/deps/qrcode.js')).default
  const url = document.querySelector('#app .mine .url').innerText.trim(), src = await m.qrPosterDataUrl({ url, title: '郭伟的专属码', subtitle: '仕兔演示劳务' })
  const img = new Image(); img.src = src; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
  const { size: S, pad: P } = m.QR_POSTER, q = x.getImageData(P, P, S, S).data; let grey = 0
  for (let i = 0; i < q.length; i += 4) if (q[i] !== q[i + 1] || q[i] !== q[i + 2] || (q[i] !== 0 && q[i] !== 255)) grey++
  if (grey) return '下载图的二维码区域有 ' + grey + ' 个不是纯黑白的像素'
  const W = S + P * 2, ring = x.getImageData(0, 0, W, W).data; let dirty = 0
  for (let yy = 0; yy < W; yy++) for (let xx = 0; xx < W; xx++) { if (xx >= P && xx < P + S && yy >= P && yy < P + S) continue; const i = (yy * W + xx) * 4; if (ring[i] !== 255 || ring[i + 1] !== 255 || ring[i + 2] !== 255) dirty++ }
  if (dirty) return '下载图二维码外圈 ' + P + 'px 静区里有 ' + dirty + ' 个不是白色的像素'
  const mod = QR.create(url, { errorCorrectionLevel: 'M' }).modules, n = mod.size, cell = S / (n + 2)
  if ((P + cell) / cell < 4) return '下载图静区不到 4 个模块：' + ((P + cell) / cell).toFixed(1)
  let wrong = 0; for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) { const i = (Math.floor((r + 1.5) * cell) * S + Math.floor((col + 1.5) * cell)) * 4; if ((q[i] === 0) !== !!mod.data[r * n + col]) wrong++ }
  return wrong ? '下载图的码点和链接对不上：' + wrong + ' 个模块不同' : '' })()`
// 两个独立区块（专属码、渠道码列表）各自带加载遮罩 / 各给一个「重新加载」
const eachMask = (sels) => `(() => { const miss = ${JSON.stringify(sels)}.filter((s) => !document.querySelector('#app ' + s + ' .el-loading-mask')); return miss.length ? '这些区块加载中没有自己的遮罩：' + miss.join('、') : '' })()`
const eachRetry = (sels) => `(() => { const miss = ${JSON.stringify(sels)}.filter((s) => [...document.querySelectorAll('#app ' + s + ' button')].filter((b) => b.innerText.includes('重新加载')).length !== 1); return miss.length ? '这些区块失败时没有各给一个「重新加载」：' + miss.join('、') : '' })()`
// 权限矩阵：有 / 没有用共享图标（不是 ✓ ✕ 字符），没有的不用危险色
const matrixIcons = `(() => { const t = document.querySelector('#app .matrix'); if (!t) return '没有权限矩阵'; if (/[✓✕]/.test(t.innerText)) return '权限矩阵还在用 ✓ ✕ 字符'
  const yes = t.querySelectorAll('.yes svg').length, no = [...t.querySelectorAll('.no')]; if (!yes || !no.length) return '权限矩阵没有图标'
  return no.some((e) => getComputedStyle(e).color === ${tokenColor('--danger-text')}) ? '「没有该权限」用了危险色' : '' })()`
const pickDateRange = [`document.querySelector('.el-dialog .el-range-editor').click()`, wait(400),
  `document.querySelector('.el-date-range-picker td.today, .el-date-range-picker td.available').click()`, wait(200),
  `[...document.querySelectorAll('.el-date-range-picker .is-right td.available')].at(-1).click()`, wait(300)]
const pickContractFile = `(async () => { const i = document.querySelector('.el-dialog input[type=file]'), dt = new DataTransfer()
  dt.items.add(new File(['x'], '合作合同.pdf', { type: 'application/pdf' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); await ${wait(800)} })()`
const fakeContractFile = reply({ key: 'contract/2026/11/shot-contract.pdf', name: '合作合同.pdf', size: 1 })
const fillContract = [`${findBtn('上传合同', '#app .page-hd')}.click()`, wait(600), ...pickOpt(0), ...pickDateRange, pickContractFile]
const contractRules = (...more) => sr({ url: '/tenant/files', method: 'POST', action: 'respond', body: fakeContractFile }, ...more)
const openRow = (text) => [`${findBtn(text, '#app .el-table__body')}.click()`, wait(500)]
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

  // 工单 08：我的报备
  { app: 'seeker', screen: 'reports', state: 'normal', persona: 'acknowledged', path: '/reports', checks: [tabUnderline, cardTags, tapTall('#app article a, #app article button'), tapArea('#app article .nav-link, #app article .cmp-link'), addrStacked] },
  { app: 'seeker', screen: 'reports', state: 'normal', persona: 'acknowledged', path: '/reports', width: NARROW, checks: [tabUnderline, cardTags] },
  { app: 'seeker', screen: 'reports', state: 'all-status', persona: 'acknowledged', path: '/reports', rules: [{ url: APPS_API, action: 'respond', body: fakeApps }],
    checks: [cardCount(7), cardTags, has('待签约入职'), has('取消报名'), tabUnderline] },
  { app: 'seeker', screen: 'reports', state: 'tab-cancelled', persona: 'acknowledged', path: '/reports', rules: [{ url: APPS_API, action: 'respond', body: fakeApps }],
    steps: [clickTab('已取消')], checks: [cardCount(3), cardTags, tabUnderline] },
  { app: 'seeker', screen: 'reports', state: 'tab-empty', persona: 'acknowledged', path: '/reports', steps: [clickTab('已入职')], checks: [has('没有「已入职」的报名'), tabUnderline] },
  { app: 'seeker', screen: 'reports', state: 'empty', persona: 'registered', path: '/reports', checks: [has('还没有报名记录'), onePrimary] },
  { app: 'seeker', screen: 'reports', state: 'loading', persona: 'acknowledged', path: '/reports', rules: [{ url: APPS_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'reports', state: 'error', persona: 'acknowledged', path: '/reports', rules: [{ url: APPS_API, action: 'fail' }], checks: [has('重新加载')] },
  { app: 'seeker', screen: 'reports', state: 'complaint', persona: 'acknowledged', path: '/reports', steps: [click('投诉该岗位')] },
  { app: 'seeker', screen: 'reports', state: 'complaint-submitting', persona: 'acknowledged', path: '/reports', rules: [{ url: '/seeker/complaints', action: 'hang' }],
    steps: [click('投诉该岗位'), click('岗位信息不实'), click('提交投诉')], quick: true,
    checks: [`document.querySelector('.van-popup .van-button--loading') ? '' : '提交中「提交投诉」没有转圈'`] },
  { app: 'seeker', screen: 'reports', state: 'complaint-rejected', persona: 'acknowledged', path: '/reports',
    rules: [{ url: '/seeker/complaints', action: 'respond', body: refuse('APP_4004', '只能投诉你匹配到或报名过的岗位') }],
    steps: [click('投诉该岗位'), click('岗位信息不实'), click('提交投诉')], quick: true,
    checks: [`document.querySelector('.van-popup .van-button--loading') ? '被拒之后「提交投诉」还在转' : ''`, `document.body.innerText.includes('只能投诉你匹配到或报名过的岗位') ? '' : '被拒之后没有写明原因'`] },
  // 面试详情：真实数据没有路线提示，四块齐全的样子用假数据
  { app: 'seeker', screen: 'interview', state: 'normal', persona: 'acknowledged', path: `/reports/${data.ids.seekerApplicationId}`,
    checks: [blocks('面试时间', '集合地点', '证件清单'), tapTall('#app [role=checkbox], #app a')] },
  { app: 'seeker', screen: 'interview', state: 'full', persona: 'acknowledged', path: '/reports/BM-SHOT-1', rules: [{ url: APPS_API, action: 'respond', body: fakeApps }],
    checks: [blocks('面试时间', '集合地点', '路线提示', '证件清单'), tapTall('#app [role=checkbox], #app a')] },
  { app: 'seeker', screen: 'interview', state: 'full', persona: 'acknowledged', path: '/reports/BM-SHOT-1', width: NARROW, rules: [{ url: APPS_API, action: 'respond', body: fakeApps }],
    checks: [blocks('面试时间', '集合地点', '路线提示', '证件清单')] },
  { app: 'seeker', screen: 'interview', state: 'checked', persona: 'acknowledged', path: '/reports/BM-SHOT-1', rules: [{ url: APPS_API, action: 'respond', body: fakeApps }],
    steps: [`document.querySelector('#app [role=checkbox]').click()`],
    checks: [`document.querySelector('#app [role=checkbox][aria-checked=true] svg') && !document.querySelector('#app [role=checkbox][aria-checked=false] svg') ? '' : '勾选后没有出现勾'`] },
  { app: 'seeker', screen: 'interview', state: 'no-notice', persona: 'acknowledged', path: '/reports/BM-SHOT-2', rules: [{ url: APPS_API, action: 'respond', body: fakeApps }], checks: [has('还没有推送面试信息')] },
  { app: 'seeker', screen: 'interview', state: 'not-found', persona: 'acknowledged', path: '/reports/BM-NONE', checks: [has('报名记录不存在'), has('返回我的报备')] },
  { app: 'seeker', screen: 'interview', state: 'loading', persona: 'acknowledged', path: `/reports/${data.ids.seekerApplicationId}`, rules: [{ url: APPS_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'interview', state: 'error', persona: 'acknowledged', path: `/reports/${data.ids.seekerApplicationId}`, rules: [{ url: APPS_API, action: 'fail' }], checks: [has('重新加载')] },
  // 顾问推荐：答复接口一律拦住，不落库
  { app: 'seeker', screen: 'recommendations', state: 'normal', persona: 'recommended', path: '/recommendations', checks: [cardTags, onePrimary, tapTall('#app article button')] },
  { app: 'seeker', screen: 'recommendations', state: 'normal', persona: 'recommended', path: '/recommendations', width: NARROW, checks: [cardTags] },
  { app: 'seeker', screen: 'recommendations', state: 'mixed', persona: 'recommended', path: '/recommendations', rules: [{ url: '/seeker/recommendations', action: 'respond', body: fakeRecs }],
    checks: [cardCount(4), cardTags, onePrimary, tapTall('#app article button')] },
  { app: 'seeker', screen: 'recommendations', state: 'empty', persona: 'recommended', path: '/recommendations', rules: [{ url: '/seeker/recommendations', action: 'respond', body: reply([]) }],
    checks: [has('专属顾问正在为你挑选岗位')] },
  { app: 'seeker', screen: 'recommendations', state: 'loading', persona: 'recommended', path: '/recommendations', rules: [{ url: '/seeker/recommendations', action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'recommendations', state: 'error', persona: 'recommended', path: '/recommendations', rules: [{ url: '/seeker/recommendations', action: 'fail' }], checks: [has('重新加载')] },
  { app: 'seeker', screen: 'recommendations', state: 'submitting', persona: 'recommended', path: '/recommendations', rules: [{ url: DECIDE_API, action: 'hang' }],
    steps: [click('去报名')], quick: true, checks: [spinning('提交中'), disabledBtn('不考虑')] },
  // 被拒：轻提示在步骤里确认（两秒就消失，会压住下面的字），等它消失后再截按钮置灰和卡片上的原因
  { app: 'seeker', screen: 'recommendations', state: 'rejected', persona: 'recommended', path: '/recommendations',
    rules: [{ url: DECIDE_API, action: 'respond', body: refuse('LC_4003', '你已报名岗位，面试结果出来前不能报名其他岗位') }],
    steps: [click('去报名'), `(async () => { await ${wait(400)}; if (!document.querySelector('.van-toast')?.innerText.includes('不能报名其他岗位')) throw new Error('被拒之后没有轻提示写明原因')
      await ${wait(2600)}; if ([...document.querySelectorAll('.van-toast')].some((t) => t.getClientRects().length)) throw new Error('轻提示还没消失') })()`],
    checks: [idle, disabledBtn('去报名'), has('暂时不能报名：你已报名岗位，面试结果出来前不能报名其他岗位')] },
  { app: 'seeker', screen: 'recommendations', state: 'decline-confirm', persona: 'recommended', path: '/recommendations', rules: [{ url: DECIDE_API, action: 'hang' }], steps: [click('不考虑')] },
  { app: 'seeker', screen: 'recommendations', state: 'locked', persona: 'acknowledged', path: '/recommendations', rules: [{ url: '/seeker/recommendations', action: 'respond', body: fakeRecs }],
    checks: [disabledBtn('去报名'), has('面试结果出来前不能报名其他岗位')] },
  // 我的台账：四个分段，报名和入职记录带时间线
  { app: 'seeker', screen: 'ledger', state: 'normal', persona: 'veteran', path: '/ledger?tab=work', checks: [tabUnderline, cardTags, nodesLabeled] },
  { app: 'seeker', screen: 'ledger', state: 'normal', persona: 'veteran', path: '/ledger?tab=work', width: NARROW, checks: [tabUnderline, cardTags] },
  { app: 'seeker', screen: 'ledger', state: 'pay', persona: 'veteran', path: '/ledger?tab=pay', checks: [tabUnderline, has('实发'), has('应发')] },
  { app: 'seeker', screen: 'ledger', state: 'apply', persona: 'veteran', path: '/ledger', rules: [{ url: '/seeker/ledger', action: 'respond', body: fakeLedger }],
    checks: [cardCount(5), cardTags, nodesLabeled, tabUnderline, has('办理入职超时'), hasNot('CONFIRM_TIMEOUT'), hasNot('RELEASE_MANUAL'), hasNot('BROKER_SLA_TIMEOUT')] },
  { app: 'seeker', screen: 'ledger', state: 'interview', persona: 'veteran', path: '/ledger?tab=interview', rules: [{ url: '/seeker/ledger', action: 'respond', body: fakeLedger }],
    checks: [cardCount(3), cardTags] },
  { app: 'seeker', screen: 'ledger', state: 'work', persona: 'veteran', path: '/ledger?tab=work', rules: [{ url: '/seeker/ledger', action: 'respond', body: fakeLedger }],
    checks: [cardCount(2), cardTags, nodesLabeled] },
  { app: 'seeker', screen: 'ledger', state: 'empty', persona: 'veteran', path: '/ledger', checks: [has('还没有报名记录'), onePrimary, tabUnderline] },
  { app: 'seeker', screen: 'ledger', state: 'loading', persona: 'veteran', path: '/ledger', rules: [{ url: '/seeker/ledger', action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'ledger', state: 'error', persona: 'veteran', path: '/ledger', rules: [{ url: '/seeker/ledger', action: 'fail' }], checks: [has('重新加载')] },
  // 我的工作：在岗 / 已报名（待面试、待签约入职）/ 还没报名（自由求职、专属服务）/ 已离职
  { app: 'seeker', screen: 'work', state: 'employed', persona: 'veteran', path: '/work', checks: [has('岗位信息'), tapTall('#app .pad a'), tapArea('#app .nav-link')] },
  { app: 'seeker', screen: 'work', state: 'employed', persona: 'veteran', path: '/work', width: NARROW },
  { app: 'seeker', screen: 'work', state: 'interview', persona: 'acknowledged', path: '/work', checks: [has('等待面试'), tapTall('#app .pad a, #app .pad button'), tapArea('#app .nav-link'), addrStacked] },
  { app: 'seeker', screen: 'work', state: 'signing', persona: 'confirmed', path: '/work', checks: [bottomBar('去签署劳动合同'), onePrimary] },
  { app: 'seeker', screen: 'work', state: 'seeking', persona: 'public', path: '/work', checks: [nodesLabeled, bottomBar('AI 问薪'), onePrimary] },
  { app: 'seeker', screen: 'work', state: 'seeking-private', persona: 'registered', path: '/work', checks: [nodesLabeled, bottomBar('AI 问薪')] },
  { app: 'seeker', screen: 'work', state: 'seeking-private', persona: 'registered', path: '/work', width: NARROW, checks: [nodesLabeled] },
  { app: 'seeker', screen: 'work', state: 'resigned', persona: 'public', path: '/work', rules: [{ url: '/seeker/work', action: 'respond', body: pastWork }],
    checks: [has('历史任职'), has('已离职'), bottomBar('AI 问薪'), tapTall('#app .pad a')] },
  { app: 'seeker', screen: 'work', state: 'resigned', persona: 'public', path: '/work', width: NARROW, rules: [{ url: '/seeker/work', action: 'respond', body: pastWork }],
    checks: [`(() => { const e = [...document.querySelectorAll('#app span')].find((x) => x.innerText.includes('KS-0077')); return e && e.getClientRects().length === 1 ? '' : '工号被折成两行' })()`] },
  { app: 'seeker', screen: 'work', state: 'loading', persona: 'veteran', path: '/work', rules: [{ url: '/seeker/work', action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'work', state: 'error', persona: 'veteran', path: '/work', rules: [{ url: '/seeker/work', action: 'fail' }], checks: [has('重新加载')] },
  // 工单 09：实名验证。提交、申诉一律拦住，不落库
  { app: 'seeker', screen: 'kyc', state: 'normal', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('hang')],
    checks: [formGroups, bottomBar('提交实名认证'), onePrimary, disabledBtn('提交实名认证'), has('进行中'), has('已完成'), bodyText, noLegacy, allRequired] },
  { app: 'seeker', screen: 'kyc', state: 'normal', persona: 'registered', path: '/kyc', width: NARROW, rules: [kycNone, kycPost('hang')], checks: [formGroups, bottomBar('提交实名认证')] },
  { app: 'seeker', screen: 'kyc', state: 'field-error', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('hang')], steps: [...fillKyc(BAD_ID, OTHER_ID), fill('与身份证上的姓名一致', 'ab1')],
    checks: [fieldError('请输入 2–20 个汉字的真实姓名'), fieldError('身份证号码不正确'), fieldError('两次输入的身份证号码不一致'), disabledBtn('提交实名认证'), bottomBar('提交实名认证')] },
  { app: 'seeker', screen: 'kyc', state: 'filled', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('hang')], steps: fillKyc(GOOD_ID), checks: [has('两次输入一致，校验通过'), bottomBar('提交实名认证')] },
  { app: 'seeker', screen: 'kyc', state: 'submitting', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('hang')], steps: [...fillKyc(GOOD_ID), countXhr, clickTwice('提交实名认证')], quick: true,
    checks: [spinning('核验中'), sentOnce] },
  { app: 'seeker', screen: 'kyc', state: 'rejected', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('respond', refuse('APP_4009', '姓名与身份证号码不一致，请核对后重试'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证')], checks: [idle, has('姓名与身份证号码不一致，请核对后重试'), bottomBar('提交实名认证')] },
  { app: 'seeker', screen: 'kyc', state: 'rejected-field', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('respond', refuse('APP_4005', '身份证号码不正确，请核对后重新输入'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证')], checks: [idle, fieldError('身份证号码不正确，请核对后重新输入')] },
  { app: 'seeker', screen: 'kyc', state: 'occupied', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('respond', refuse('APP_4007', '该身份证已被其他账号实名绑定'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证')], checks: [has('证件已被其他账号绑定'), onePrimary, tapTall('#app .acard button, #app a.link'), bodyText, noLegacy] },
  { app: 'seeker', screen: 'kyc', state: 'occupied', persona: 'registered', path: '/kyc', width: NARROW, rules: [kycNone, kycPost('respond', refuse('APP_4007', '该身份证已被其他账号实名绑定'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证')] },
  { app: 'seeker', screen: 'kyc', state: 'blacklist', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('respond', refuse('APP_4008', '你的账号因平台失信记录暂时受限'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证')], checks: [has('账号受限'), onePrimary, noLegacy, stacked('申诉通道')] },
  { app: 'seeker', screen: 'kyc', state: 'underage', persona: 'registered', path: '/kyc', rules: [kycNone, kycPost('respond', refuse('APP_4006', '未满 16 周岁，不能使用平台服务'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证')], checks: [has('暂时无法为你提供服务'), onePrimary, noLegacy] },
  { app: 'seeker', screen: 'kyc', state: 'reviewing', persona: 'registered', path: '/kyc', rules: [{ url: KYC_API, action: 'respond', body: reply({ kycStatus: 'REVIEWING', canApply: false }) }], checks: [has('实名资料人工复核中')] },
  { app: 'seeker', screen: 'kyc', state: 'verified', persona: 'veteran', path: '/kyc', checks: [has('已完成实名认证'), onePrimary] },
  { app: 'seeker', screen: 'kyc', state: 'loading', persona: 'registered', path: '/kyc', rules: [{ url: KYC_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'kyc', state: 'error', persona: 'registered', path: '/kyc', rules: [{ url: KYC_API, action: 'fail' }], checks: [has('重新加载')] },
  // 申诉弹层（从「一证一号」进）：申诉接口排在前面，地址里也带 /seeker/kyc
  { app: 'seeker', screen: 'kyc-appeal', state: 'normal', persona: 'registered', path: '/kyc', rules: [{ url: KYC_APPEALS_API, action: 'hang' }, kycNone, kycPost('respond', refuse('APP_4007', '该身份证已被其他账号实名绑定'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证'), click('提交申诉')], checks: [`document.querySelector('.van-popup .van-cell-group .van-field textarea') ? '' : '申诉理由不在单元格组里'`, tapArea('.van-popup .sheet-x'), bodyText] },
  { app: 'seeker', screen: 'kyc-appeal', state: 'normal', persona: 'registered', path: '/kyc', width: NARROW, rules: [{ url: KYC_APPEALS_API, action: 'hang' }, kycNone, kycPost('respond', refuse('APP_4007', '该身份证已被其他账号实名绑定'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证'), click('提交申诉')] },
  { app: 'seeker', screen: 'kyc-appeal', state: 'submitting', persona: 'registered', path: '/kyc', rules: [{ url: KYC_APPEALS_API, action: 'hang' }, kycNone, kycPost('respond', refuse('APP_4007', '该身份证已被其他账号实名绑定'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证'), click('提交申诉'), fillAppeal, countXhr, clickTwice('提交申诉', '.van-popup')], quick: true,
    checks: [`document.querySelector('.van-popup .van-button--loading') ? '' : '提交中「提交申诉」没有转圈'`, sentOnce] },
  { app: 'seeker', screen: 'kyc-appeal', state: 'rejected', persona: 'registered', path: '/kyc',
    rules: [{ url: KYC_APPEALS_API, action: 'respond', body: refuse('SYS_4000', '没有可申诉的拦截记录') }, kycNone, kycPost('respond', refuse('APP_4007', '该身份证已被其他账号实名绑定'))],
    steps: [...fillKyc(GOOD_ID), click('提交实名认证'), click('提交申诉'), fillAppeal, `${findBtn('提交申诉', '.van-popup')}.click()`, toastGone('没有可申诉的拦截记录')],
    checks: [`document.querySelector('.van-popup .van-button--loading') ? '被拒之后「提交申诉」还在转' : ''`, stays('.van-popup .tipbar--danger', '没有可申诉的拦截记录'), bodyText] },
  // 我的申诉
  { app: 'seeker', screen: 'kyc-appeals', state: 'normal', persona: 'appealing', path: '/kyc/appeals', checks: [cardTags, noLegacy] },
  { app: 'seeker', screen: 'kyc-appeals', state: 'normal', persona: 'appealing', path: '/kyc/appeals', width: NARROW, checks: [cardTags] },
  { app: 'seeker', screen: 'kyc-appeals', state: 'all-status', persona: 'appealing', path: '/kyc/appeals', rules: [{ url: KYC_APPEALS_API, action: 'respond', body: fakeAppeals }],
    checks: [cardCount(3), cardTags, has('复核意见：'), has('申诉未通过'), tapTall('#app a.link')] },
  { app: 'seeker', screen: 'kyc-appeals', state: 'empty', persona: 'veteran', path: '/kyc/appeals', checks: [has('暂无申诉记录'), onePrimary] },
  { app: 'seeker', screen: 'kyc-appeals', state: 'loading', persona: 'appealing', path: '/kyc/appeals', rules: [{ url: KYC_APPEALS_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'kyc-appeals', state: 'error', persona: 'appealing', path: '/kyc/appeals', rules: [{ url: KYC_APPEALS_API, action: 'fail' }], checks: [has('重新加载')] },
  // 待签合同：只截到「去签署」为止，不进电子签
  { app: 'seeker', screen: 'contract-sign', state: 'normal', persona: 'confirmed', path: '/contracts/sign', checks: [bottomBar('去签署'), onePrimary, blocks('合同摘要'), bodyText, noLegacy] },
  { app: 'seeker', screen: 'contract-sign', state: 'normal', persona: 'confirmed', path: '/contracts/sign', width: NARROW, checks: [bottomBar('去签署')] },
  { app: 'seeker', screen: 'contract-sign', state: 'empty', persona: 'registered', path: '/contracts/sign', checks: [has('当前没有待签署的合同'), onePrimary, `${findBtn('我的合同')} ? '' : '空状态的「我的合同」不是按钮'`] },
  { app: 'seeker', screen: 'contract-sign', state: 'loading', persona: 'confirmed', path: '/contracts/sign', rules: [{ url: PENDING_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'contract-sign', state: 'error', persona: 'confirmed', path: '/contracts/sign', rules: [{ url: PENDING_API, action: 'fail' }], checks: [has('重新加载')] },
  { app: 'seeker', screen: 'contract-sign', state: 'submitting', persona: 'confirmed', path: '/contracts/sign', lateRules: [{ url: PENDING_API, action: 'hang' }], steps: [toBottom, countXhr, clickTwice('我已完成签署')], quick: true,
    checks: [spinning('正在查询'), sentOnce] },
  { app: 'seeker', screen: 'contract-sign', state: 'rejected', persona: 'confirmed', path: '/contracts/sign', steps: [toBottom, click('我已完成签署'), toastGone('还未检测到签署结果')],
    checks: [idle, stays('#app .miss', '还未检测到签署结果，签署完成后可能需要几秒钟同步')] },
  // 滚到底：「刷新状态」整颗按钮都在底部通栏上方
  { app: 'seeker', screen: 'contract-sign', state: 'bottom', persona: 'confirmed', path: '/contracts/sign', steps: [toBottom],
    checks: [`(() => { const b = ${findBtn('我已完成签署')}.getBoundingClientRect(), bar = document.querySelector('.bottom-bar').getBoundingClientRect(); return b.bottom <= bar.top ? '' : '滚到底时「刷新状态」被底部通栏挡住 ' + Math.round(b.bottom - bar.top) + 'px' })()`] },
  { app: 'seeker', screen: 'contract-sign', state: 'bottom', persona: 'confirmed', path: '/contracts/sign', width: NARROW, steps: [toBottom] },
  { app: 'seeker', screen: 'contract-sign', state: 'no-link', persona: 'confirmed', path: '/contracts/sign', rules: [{ url: PENDING_API, action: 'respond', body: reply(pendingContract) }],
    checks: [disabledBtn('去签署'), has('签署链接暂不可用，请联系驻场老师重新发送'), bottomBar('去签署')] },
  // 我的合同
  // 花名册导入的老员工没有电子合同，有合同的是当天签约入职的人
  { app: 'seeker', screen: 'contracts', state: 'normal', persona: 'employedToday', path: '/contracts', checks: [cardTags, tapTall('#app article button'), bodyText, noLegacy,
    `(() => { const b = document.querySelector('#app article .van-button').getBoundingClientRect(), c = document.querySelector('#app article').getBoundingClientRect(); return c.right - b.right < 20 && b.left - c.left > 100 ? '' : '卡片底部的操作没有靠右' })()`] },
  { app: 'seeker', screen: 'contracts', state: 'normal', persona: 'employedToday', path: '/contracts', width: NARROW, checks: [cardTags] },
  { app: 'seeker', screen: 'contracts', state: 'all-status', persona: 'veteran', path: '/contracts', rules: [{ url: CONTRACTS_API, action: 'respond', body: fakeContracts }],
    checks: [cardCount(5), cardTags, onePrimary, has('待签署'), has('已解除')] },
  { app: 'seeker', screen: 'contracts', state: 'empty', persona: 'registered', path: '/contracts', checks: [has('还没有劳动合同')] },
  { app: 'seeker', screen: 'contracts', state: 'loading', persona: 'veteran', path: '/contracts', rules: [{ url: CONTRACTS_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'contracts', state: 'error', persona: 'veteran', path: '/contracts', rules: [{ url: CONTRACTS_API, action: 'fail' }], checks: [has('重新加载')] },
  // 合同详情：签署记录是时间线，节点带文字
  { app: 'seeker', screen: 'contract-detail', state: 'normal', persona: 'employedToday', path: CONTRACT, checks: [blocks('岗位信息', '签约主体', '签署记录'), nodesLabeled, bodyText, noLegacy,
    `document.querySelectorAll('#app .tl li').length >= 3 ? '' : '签署记录不是时间线（或不到 3 个节点）'`] },
  { app: 'seeker', screen: 'contract-detail', state: 'normal', persona: 'employedToday', path: CONTRACT, width: NARROW, checks: [blocks('岗位信息', '签约主体', '签署记录')] },
  { app: 'seeker', screen: 'contract-detail', state: 'terminated', persona: 'veteran', path: '/contracts/LC-SHOT-3', rules: [{ url: CONTRACTS_API, action: 'respond', body: fakeContracts }],
    checks: [nodesLabeled, has('合同已终止'), has('已结束'), `document.querySelectorAll('#app .tl li').length === 4 ? '' : '已终止的合同应当有 4 个节点'`] },
  { app: 'seeker', screen: 'contract-detail', state: 'not-found', persona: 'veteran', path: '/contracts/LC-NONE', checks: [has('合同不存在'), has('返回我的合同'), hasNot('重新加载')] },
  { app: 'seeker', screen: 'contract-detail', state: 'loading', persona: 'employedToday', path: CONTRACT, rules: [{ url: CONTRACTS_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'contract-detail', state: 'error', persona: 'employedToday', path: CONTRACT, rules: [{ url: CONTRACTS_API, action: 'fail' }], checks: [has('重新加载'), hasNot('合同不存在')] },
  // 我的简历：保存（PUT）一律拦住
  { app: 'seeker', screen: 'resume', state: 'normal', persona: 'veteran', path: '/resume', rules: [resumePut('hang')],
    checks: [blocks('用工档案', '工作经历', '求职意向', '联系方式'), formGroups, bottomBar('保存简历'), onePrimary, tapTall('#app .chip-tap, #app a.link'), bodyText, noLegacy] },
  { app: 'seeker', screen: 'resume', state: 'normal', persona: 'veteran', path: '/resume', width: NARROW, rules: [resumePut('hang')], checks: [formGroups, bottomBar('保存简历')] },
  { app: 'seeker', screen: 'resume', state: 'empty', persona: 'registered', path: '/resume', rules: [resumePut('hang')], checks: [has('目前没有在岗的工作'), bottomBar('保存简历')] },
  { app: 'seeker', screen: 'resume', state: 'picked', persona: 'registered', path: '/resume', rules: [resumePut('hang')],
    steps: [click('普工'), fill('昆山', '昆山'), `[...document.querySelectorAll('.ffield-act')][0].click()`, fill('叉车证', '叉车证'), `[...document.querySelectorAll('.ffield-act')][1].click()`],
    checks: [`document.querySelector('#app .chip-tap[aria-pressed=true] svg') ? '' : '选中的工种没有勾'`, `document.querySelectorAll('#app .picked .sel').length === 2 ? '' : '添加的地点和技能标签没出来'`,
      tapTall('#app .chip-tap'), tapArea('#app .sel button'),
      // 点小块本身不删，只有「×」删
      `(() => { document.querySelector('#app .sel .chip').click(); return document.querySelectorAll('#app .picked .sel').length === 2 ? '' : '点已选的小块就被删掉了' })()`] },
  { app: 'seeker', screen: 'resume', state: 'picked-removed', persona: 'registered', path: '/resume', rules: [resumePut('hang')],
    steps: [fill('昆山', '昆山'), `[...document.querySelectorAll('.ffield-act')][0].click()`, `document.querySelector('#app .sel button').click()`],
    checks: [`document.querySelectorAll('#app .picked .sel').length === 0 ? '' : '点「×」没有删掉'`] },
  // 已经加满 5 个地点，输入框里还留着没点「添加」的第 6 个：只在字段下方提示，照样保存（请求发得出去）
  { app: 'seeker', screen: 'resume', state: 'draft-over-limit', persona: 'registered', path: '/resume', rules: [resumePut('hang')],
    steps: [`(async () => { for (const c of ['昆山', '苏州', '太仓', '常熟', '吴江']) { ${fill('昆山', '__C__').replace('"__C__"', 'c')}; await ${wait(100)}; document.querySelector('.ffield-act').click(); await ${wait(100)} } })()`,
      fill('昆山', '张家港'), countXhr, click('保存简历')], quick: true, checks: [fieldError('期望地点最多 5 个'), sentOnce, spinning('保存中')] },
  // 表单下半截：滚到底，看输入框、字数和底部通栏
  { app: 'seeker', screen: 'resume', state: 'form', persona: 'registered', path: '/resume', rules: [resumePut('hang')],
    steps: [click('普工'), fill('昆山', '昆山'), `[...document.querySelectorAll('.ffield-act')][0].click()`, fill('叉车证', '叉车证'), `[...document.querySelectorAll('.ffield-act')][1].click()`, `document.querySelector('.picked').scrollIntoView()`] },
  { app: 'seeker', screen: 'resume', state: 'form', persona: 'registered', path: '/resume', width: NARROW, rules: [resumePut('hang')], steps: [`window.scrollTo(0, document.documentElement.scrollHeight)`] },
  { app: 'seeker', screen: 'resume', state: 'field-error', persona: 'registered', path: '/resume', rules: [resumePut('hang')],
    steps: [fill('zhangsan', 'a b'), fill('11 位手机号', '123'), fill('如 3', '77'), click('保存简历'), toastGone('紧急联系人手机号格式不正确')],
    checks: [fieldError('微信号只能包含字母、数字、下划线和减号'), fieldError('紧急联系人手机号格式不正确'), fieldError('工作年限请填 0 到 50 的整数'), idle, inView('#app [data-field="phone"]')] },
  // 只有工作年限错：轻提示之后滚到这个字段（它在第一屏之外）
  { app: 'seeker', screen: 'resume', state: 'field-error-scroll', persona: 'registered', path: '/resume', rules: [resumePut('hang')], steps: [fill('如 3', '77'), click('保存简历'), toastGone('工作年限请填 0 到 50 的整数')],
    checks: [fieldError('工作年限请填 0 到 50 的整数'), inView('#app [data-field="years"]'), has('没有工作过填 0')] },
  { app: 'seeker', screen: 'resume', state: 'field-error-toast', persona: 'registered', path: '/resume', rules: [resumePut('hang')], steps: [fill('11 位手机号', '123'), click('保存简历')], quick: true,
    checks: [`document.querySelector('.van-toast')?.innerText.includes('紧急联系人手机号格式不正确') ? '' : '校验没通过时没有轻提示'`] },
  { app: 'seeker', screen: 'resume', state: 'submitting', persona: 'veteran', path: '/resume', rules: [resumePut('hang')], steps: [countXhr, clickTwice('保存简历')], quick: true, checks: [spinning('保存中'), sentOnce] },
  { app: 'seeker', screen: 'resume', state: 'rejected', persona: 'veteran', path: '/resume', rules: [resumePut('respond', refuse('SYS_4000', '个人简介包含不允许的内容'))], steps: [click('保存简历'), toastGone('个人简介包含不允许的内容')],
    checks: [idle, stays('#app .bottom-bar .why', '个人简介包含不允许的内容'), bottomBar('保存简历')] },
  { app: 'seeker', screen: 'resume', state: 'loading', persona: 'veteran', path: '/resume', rules: [{ url: RESUME_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'resume', state: 'error', persona: 'veteran', path: '/resume', rules: [{ url: RESUME_API, action: 'fail' }], checks: [has('重新加载')] },
  // 工单 10：预支首页。发起预支（POST）一律拦住，不落库
  { app: 'seeker', screen: 'advance', state: 'normal', persona: 'veteran', path: '/advance', rules: [advPost('hang')],
    checks: [admission(5, 1), disabledBtn('申请预支'), stays('#app .bottom-bar .bar-why', '本月暂无可用机会'), bottomBar('申请预支'), onePrimary, moneyStyle, bodyText, noLegacy, has('审批中'), has('累计在岗'), slotTexts('已用', '审批中', '未解锁', '未解锁')] },
  { app: 'seeker', screen: 'advance', state: 'normal', persona: 'veteran', path: '/advance', width: NARROW, rules: [advPost('hang')], checks: [admission(5, 1), bottomBar('申请预支')] },
  { app: 'seeker', screen: 'advance', state: 'bottom', persona: 'veteran', path: '/advance', rules: [advPost('hang')], steps: [toBottom] },
  { app: 'seeker', screen: 'advance', state: 'eligible', persona: 'veteran', path: '/advance', rules: [advPost('hang'), ...advHome(fakeQuota())],
    checks: [admission(5, 0), enabledBtn('申请预支'), noBarWhy, bottomBar('申请预支'), onePrimary, moneyStyle, slotTexts('已用', '可用', '可用', '未解锁'), has('再在岗 5 天获得下一次')] },
  { app: 'seeker', screen: 'advance', state: 'eligible', persona: 'veteran', path: '/advance', width: NARROW, rules: [advPost('hang'), ...advHome(fakeQuota())], checks: [bottomBar('申请预支')] },
  { app: 'seeker', screen: 'advance', state: 'capped', persona: 'veteran', path: '/advance',
    rules: [advPost('hang'), ...advHome(fakeQuota({ eligible: false, reasons: ['本月已预支 4 次，已达上限'], grantedThisMonth: 4, usedThisMonth: 4, remainingThisMonth: 0 }))],
    checks: [admission(5, 2), disabledBtn('申请预支'), stays('#app .bottom-bar .bar-why', '本月已预支 4 次，已达上限'), has('本月次数已用完，下月恢复'), slotTexts('已用', '已用', '已用', '已用'), bottomBar('申请预支')] },
  // 还没入职的人：三项不满足
  { app: 'seeker', screen: 'advance', state: 'not-employed', persona: 'registered', path: '/advance', rules: [advPost('hang')],
    checks: [admission(5, 3), disabledBtn('申请预支'), stays('#app .bottom-bar .bar-why', '仅「已入职在岗」状态可以申请预支'), bottomBar('申请预支')] },
  { app: 'seeker', screen: 'advance', state: 'loading', persona: 'veteran', path: '/advance', rules: [{ url: QUOTA_API, action: 'hang' }], checks: [spinnerPrimary, hasNot('申请预支')] },
  { app: 'seeker', screen: 'advance', state: 'error', persona: 'veteran', path: '/advance', rules: [{ url: QUOTA_API, action: 'fail' }], checks: [has('重新加载'), hasNot('申请预支')] },
  { app: 'seeker', screen: 'advance', state: 'confirm', persona: 'veteran', path: '/advance', rules: [advPost('hang'), ...advHome(fakeQuota())], steps: [click('申请预支')],
    checks: [`document.querySelector('.van-dialog')?.innerText.includes('确认预支 ¥500.00') ? '' : '点「申请预支」没有弹出确认'`] },
  // 提交中：确认之后再点一次底部按钮；要是又弹出确认框就再确认一次。只能发出一条请求
  { app: 'seeker', screen: 'advance', state: 'submitting', persona: 'veteran', path: '/advance', rules: [advPost('hang'), ...advHome(fakeQuota())],
    steps: [click('申请预支'), countXhr, `(async () => { ${findBtn('确认申请', '.van-dialog')}.click(); await ${wait(500)}; document.querySelector('#app .bottom-bar .van-button').click(); await ${wait(500)}
      const again = [...document.querySelectorAll('.van-dialog')].find((d) => d.getClientRects().length); if (again) [...again.querySelectorAll('button')].find((b) => b.innerText.includes('确认申请')).click() })()`], quick: true,
    checks: [spinning('提交中'), sentOnce] },
  { app: 'seeker', screen: 'advance', state: 'rejected', persona: 'veteran', path: '/advance', rules: [advPost('respond', refuse('ADV_4001', '你有一笔预支正在审批中')), ...advHome(fakeQuota())],
    steps: [click('申请预支'), `(async () => { ${findBtn('确认申请', '.van-dialog')}.click(); await ${toastGone('你有一笔预支正在审批中')} })()`],
    checks: [idle, stays('#app .bottom-bar .bar-why', '没有提交成功：你有一笔预支正在审批中'), bottomBar('申请预支')] },
  // 预支记录
  { app: 'seeker', screen: 'advance-records', state: 'normal', persona: 'veteran', path: '/advance/records', checks: [tabUnderline, cardTags, moneyStyle, bodyText, noLegacy, has('当前欠款'), has('审批中')] },
  { app: 'seeker', screen: 'advance-records', state: 'normal', persona: 'veteran', path: '/advance/records', width: NARROW, checks: [tabUnderline, cardTags] },
  { app: 'seeker', screen: 'advance-records', state: 'all-status', persona: 'veteran', path: '/advance/records', rules: advRecords(fakeAdvs, fakeDebtLog),
    checks: [cardCount(5), cardTags, moneyStyle, has('审批中'), has('已拨款'), has('部分抵扣'), has('已驳回'), has('已还清'), tabUnderline] },
  { app: 'seeker', screen: 'advance-records', state: 'log', persona: 'veteran', path: '/advance/records', rules: advRecords(fakeAdvs, fakeDebtLog), steps: [clickTab('欠款流水')],
    checks: [lrowCount(3), moneyStyle, has('+¥500.00'), has('−¥200.00'), has('结余 ¥800.00'), has('工资条 GZ-SHOT-1'), tabUnderline] },
  { app: 'seeker', screen: 'advance-records', state: 'log', persona: 'veteran', path: '/advance/records', width: NARROW, rules: advRecords(fakeAdvs, fakeDebtLog), steps: [clickTab('欠款流水')] },
  { app: 'seeker', screen: 'advance-records', state: 'empty', persona: 'registered', path: '/advance/records', checks: [has('还没有预支记录'), onePrimary, tabUnderline] },
  { app: 'seeker', screen: 'advance-records', state: 'log-empty', persona: 'registered', path: '/advance/records', steps: [clickTab('欠款流水')], checks: [has('暂无欠款流水')] },
  { app: 'seeker', screen: 'advance-records', state: 'loading', persona: 'veteran', path: '/advance/records', rules: [{ url: ADV_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'advance-records', state: 'error', persona: 'veteran', path: '/advance/records', rules: [{ url: ADV_API, action: 'fail' }], checks: [has('重新加载')] },
  // 审批进度
  { app: 'seeker', screen: 'advance-progress', state: 'normal', persona: 'veteran', path: ADV, checks: [blocks('预支金额', '审批流转', '还款计划'), advNodes, moneyStyle, bodyText, noLegacy, has('进行中'), has('未开始')] },
  { app: 'seeker', screen: 'advance-progress', state: 'normal', persona: 'veteran', path: ADV, width: NARROW, checks: [advNodes] },
  { app: 'seeker', screen: 'advance-progress', state: 'just-submitted', persona: 'veteran', path: ADV + '?new=1', checks: [has('申请已提交')] },
  { app: 'seeker', screen: 'advance-progress', state: 'repaying', persona: 'veteran', path: '/advance/YZ-SHOT-3', rules: partlyRepaid,
    checks: [advNodes, moneyStyle, has('+¥500.00'), has('−¥200.00'), has('已还 40%'), has('审批意见：出勤正常'), has('本笔剩余 ¥300.00'), tapArea('#app .led a'), bodyText] },
  { app: 'seeker', screen: 'advance-progress', state: 'repaying', persona: 'veteran', path: '/advance/YZ-SHOT-3', width: NARROW, rules: partlyRepaid, steps: [toBottom] },
  { app: 'seeker', screen: 'advance-progress', state: 'rejected', persona: 'veteran', path: '/advance/YZ-SHOT-1', rules: rejectedAdv,
    checks: [advNodes, has('驻场初审驳回'), has('已驳回'), has('已结束'), has('驳回意见：本周有 2 天旷工'), hasNot('还款计划'), bottomBar('返回预支首页'), onePrimary] },
  { app: 'seeker', screen: 'advance-progress', state: 'not-found', persona: 'veteran', path: '/advance/YZ-NONE', checks: [has('预支申请不存在'), has('返回预支首页'), hasNot('重新加载')] },
  { app: 'seeker', screen: 'advance-progress', state: 'loading', persona: 'veteran', path: ADV, rules: [{ url: ADV_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'advance-progress', state: 'error', persona: 'veteran', path: ADV, rules: [{ url: ADV_API, action: 'fail' }], checks: [has('重新加载'), hasNot('预支申请不存在')] },
  // 我的工资
  { app: 'seeker', screen: 'payslips', state: 'normal', persona: 'veteran', path: '/payslips', checks: [netLoudest('¥3,743.50'), moneyStyle, bodyText, noLegacy, has('实发工资'), has('应发'), has('扣款'), lrowCount(1), tapTall('#app .lrow')] },
  { app: 'seeker', screen: 'payslips', state: 'normal', persona: 'veteran', path: '/payslips', width: NARROW, checks: [moneyStyle] },
  { app: 'seeker', screen: 'payslips', state: 'months', persona: 'veteran', path: '/payslips', rules: [{ url: SLIPS_API, action: 'respond', body: reply(fakeSlips) }],
    checks: [netLoudest('¥5,163.50'), lrowCount(3), moneyStyle, has('预支抵扣'), has('−¥500.00'), has('抵扣预支 ¥500.00'), has('−¥1,036.50')] },
  { app: 'seeker', screen: 'payslips', state: 'months', persona: 'veteran', path: '/payslips', width: NARROW, rules: [{ url: SLIPS_API, action: 'respond', body: reply(fakeSlips) }], steps: [toBottom] },
  { app: 'seeker', screen: 'payslips', state: 'empty', persona: 'registered', path: '/payslips', checks: [has('还没有工资条'), hasNot('¥')] },
  { app: 'seeker', screen: 'payslips', state: 'loading', persona: 'veteran', path: '/payslips', rules: [{ url: SLIPS_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'payslips', state: 'error', persona: 'veteran', path: '/payslips', rules: [{ url: SLIPS_API, action: 'fail' }], checks: [has('重新加载')] },
  // 工资条明细：真实这张有一条处理中的申诉，申诉按钮置灰并写原因
  { app: 'seeker', screen: 'payslip-detail', state: 'normal', persona: 'veteran', path: SLIP, rules: [{ url: SLIP_APPEALS_API, method: 'POST', action: 'hang' }],
    checks: [blocks('实发工资', '应发项', '扣款项', '我的申诉'), netLoudest('¥3,743.50'), moneyStyle, bodyText, noLegacy, disabledBtn('申诉处理中'), stays('#app .bottom-bar .bar-why', '已有一条申诉在处理中，请等待公司回复'), bottomBar('申诉处理中'), has('扣款合计'), has('−456.50')] },
  { app: 'seeker', screen: 'payslip-detail', state: 'normal', persona: 'veteran', path: SLIP, width: NARROW, rules: [{ url: SLIP_APPEALS_API, method: 'POST', action: 'hang' }], checks: [moneyStyle, bottomBar('申诉处理中')] },
  { app: 'seeker', screen: 'payslip-detail', state: 'advance-deduct', persona: 'veteran', path: '/payslips/GZ-SHOT-1', rules: slipRules(fakeSlips[0], fakePayAppeals, { action: 'hang' }),
    checks: [blocks('实发工资', '应发项', '扣款项', '我的申诉'), netLoudest('¥5,163.50'), moneyStyle, has('发薪日系统自动抵扣已到账的薪资预支'), has('查看预支记录与欠款'), has('公司回复'), has('未受理'), has('已受理'),
      enabledBtn('对这张工资条提出申诉'), noBarWhy, bottomBar('对这张工资条提出申诉'), onePrimary] },
  { app: 'seeker', screen: 'payslip-detail', state: 'advance-deduct', persona: 'veteran', path: '/payslips/GZ-SHOT-1', width: NARROW, rules: slipRules(fakeSlips[0], fakePayAppeals, { action: 'hang' }), steps: [toBottom] },
  { app: 'seeker', screen: 'payslip-detail', state: 'not-found', persona: 'veteran', path: '/payslips/GZ-NONE', checks: [has('工资条不存在'), has('返回我的工资'), hasNot('重新加载')] },
  { app: 'seeker', screen: 'payslip-detail', state: 'loading', persona: 'veteran', path: SLIP, rules: [{ url: SLIP_API, action: 'hang' }], checks: [spinnerPrimary] },
  { app: 'seeker', screen: 'payslip-detail', state: 'error', persona: 'veteran', path: SLIP, rules: [{ url: SLIP_APPEALS_API, action: 'respond', body: reply([]) }, { url: SLIP_API, action: 'fail' }], checks: [has('重新加载'), hasNot('工资条不存在')] },
  // 工资申诉弹层
  { app: 'seeker', screen: 'payslip-appeal', state: 'normal', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'hang' }), steps: [openAppeal],
    checks: [`document.querySelector('.van-popup .van-cell-group .van-field textarea') ? '' : '说明情况不在单元格组里'`, tapArea('.van-popup .sheet-x'), tapArea('.van-popup .chip-tap'), bodyText,
      `parseFloat(getComputedStyle(document.querySelector('.van-popup textarea')).fontSize) >= 16 ? '' : '输入框的字小于 16px'`, `document.querySelectorAll('.van-popup .chip-tap').length === 7 ? '' : '可选的项目不是 7 个'`] },
  { app: 'seeker', screen: 'payslip-appeal', state: 'normal', persona: 'veteran', path: SLIP, width: NARROW, rules: appealOpenRules({ action: 'hang' }), steps: [openAppeal] },
  { app: 'seeker', screen: 'payslip-appeal', state: 'selected', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'hang' }), steps: [openAppeal, click('其他扣款'), fillPayAppeal('上个月没有请假，其他扣款不清楚扣的是什么。')],
    checks: [`document.querySelectorAll('.van-popup .chip-tap[aria-pressed=true]').length === 1 && document.querySelector('.van-popup .chip-tap[aria-pressed=true] svg') && !document.querySelector('.van-popup .chip-tap[aria-pressed=false] svg') ? '' : '选中的项目没有勾（或选中了不止一个）'`] },
  // 没选项目、说明太短：轻提示之外，原因写在对应字段下方；请求不发出去
  { app: 'seeker', screen: 'payslip-appeal', state: 'no-item', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'hang' }), steps: [openAppeal, countXhr, `(async () => { ${sheetSubmit}; await ${toastGone('请选择有疑问的项目')} })()`],
    checks: [stays('.van-popup .fhint--err', '请选择有疑问的项目'), `window.__sent === 0 ? '' : '没选项目也把请求发出去了'`, popupIdle] },
  { app: 'seeker', screen: 'payslip-appeal', state: 'too-short', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'hang' }),
    steps: [openAppeal, click('其他扣款'), fillPayAppeal('不对'), countXhr, `(async () => { ${sheetSubmit}; await ${toastGone('请至少用 5 个字说明问题')} })()`],
    checks: [fieldError('请至少用 5 个字说明问题'), `window.__sent === 0 ? '' : '说明太短也把请求发出去了'`] },
  { app: 'seeker', screen: 'payslip-appeal', state: 'submitting', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'hang' }),
    steps: [openAppeal, click('其他扣款'), fillPayAppeal('上个月没有请假，其他扣款不清楚扣的是什么。'), countXhr, clickTwice('提交申诉', '.van-popup')], quick: true,
    checks: [`document.querySelector('.van-popup .van-button--loading') ? '' : '提交中「提交申诉」没有转圈'`, sentOnce] },
  { app: 'seeker', screen: 'payslip-appeal', state: 'rejected', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'respond', body: refuse('SYS_4000', '请用 5–500 个字说明问题') }),
    steps: [openAppeal, click('其他扣款'), fillPayAppeal('上个月没有请假，其他扣款不清楚扣的是什么。'), `(async () => { ${sheetSubmit}; await ${toastGone('请用 5–500 个字说明问题')} })()`],
    checks: [popupIdle, stays('.van-popup .tipbar--danger', '没有提交成功：请用 5–500 个字说明问题'), bodyText] },
  // 已有一条在处理（SYS_4090）：弹层关掉，页面重新拉申诉（真实后端这时会返回那条处理中的），按钮置灰、原因留在按钮上方
  { app: 'seeker', screen: 'payslip-appeal', state: 'conflict', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'respond', body: refuse('SYS_4090', '这张工资条已有处理中的申诉') }),
    lateRules: [{ url: SLIP_APPEALS_API, method: 'GET', action: 'respond', body: reply([fakePayAppeal(3, 'OTHER_DEDUCT', 'OPEN', { payslipId: data.ids.payslipId, content: '上个月没有请假，其他扣款不清楚扣的是什么。' })]) }],
    steps: [openAppeal, click('其他扣款'), fillPayAppeal('上个月没有请假，其他扣款不清楚扣的是什么。'), `(async () => { ${sheetSubmit}; await ${toastGone('这张工资条已有处理中的申诉')} })()`, toBottom],
    checks: [`[...document.querySelectorAll('.van-popup')].some((p) => p.getClientRects().length) ? '已有申诉在处理时弹层没有关掉' : ''`,
      disabledBtn('申诉处理中'), stays('#app .bottom-bar .bar-why', '已有一条申诉在处理中，请等待公司回复'), has('我的申诉'), has('待处理'), bodyText] },
  // 冲突之后重新拉申诉没拉到（接口还是空的）：后端给的原因留在按钮上方
  { app: 'seeker', screen: 'payslip-appeal', state: 'conflict-stale', persona: 'veteran', path: SLIP, rules: appealOpenRules({ action: 'respond', body: refuse('SYS_4090', '这张工资条已有处理中的申诉') }),
    steps: [openAppeal, click('其他扣款'), fillPayAppeal('上个月没有请假，其他扣款不清楚扣的是什么。'), `(async () => { ${sheetSubmit}; await ${toastGone('这张工资条已有处理中的申诉')} })()`],
    checks: [stays('#app .bottom-bar .bar-why', '没有提交成功：这张工资条已有处理中的申诉'), bodyText, bottomBar('对这张工资条提出申诉')] },
  // 工单 11：消息中心。标记已读（POST）一律拦住，不落库
  { app: 'seeker', screen: 'messages', state: 'normal', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'hang' }),
    checks: [readAllBtn, tapArea('#app .van-nav-bar__right button'), msgRows(2), unreadMarks(['问题反馈已回复', '面试信息'], []), tapTall('#app .msg'), msgButtons, bodyText, noLegacy, has('系统消息覆盖'), enabledBtn('全部已读')] },
  { app: 'seeker', screen: 'messages', state: 'normal', persona: 'acknowledged', path: '/messages', width: NARROW, rules: msgRules({ action: 'hang' }), checks: [readAllBtn, msgRows(2)] },
  { app: 'seeker', screen: 'messages', state: 'mixed', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'hang' }, fakeMsgs),
    checks: [msgRows(4), unreadMarks(['工伤上报提醒', '面试信息', '预支审批结果'], ['问题反馈已回复']), has('没有更多了'),
      `getComputedStyle(${msgRow('工伤上报提醒')}.querySelector('h3')).color === ${tokenColor('--danger-text')} ? '' : '最高优先级的标题不是危险文字色'`] },
  { app: 'seeker', screen: 'messages', state: 'mixed', persona: 'acknowledged', path: '/messages', width: NARROW, rules: msgRules({ action: 'hang' }, fakeMsgs), checks: [msgRows(4)] },
  // 不带链接的消息：点了就地展开全文，并变成已读
  { app: 'seeker', screen: 'messages', state: 'expanded', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'hang' }, fakeMsgs), steps: [`${msgRow('预支审批结果')}.querySelector('button').click()`],
    checks: [unreadMarks(['工伤上报提醒', '面试信息'], ['预支审批结果', '问题反馈已回复']), `${msgRow('预支审批结果')}.querySelector('.msg-c').classList.contains('open') ? '' : '点了不带链接的消息没有展开'`,
      has('有疑问可以在工资条页面提出申诉'), `location.pathname === '/messages' ? '' : '不带链接的消息不该跳走'`] },
  { app: 'seeker', screen: 'messages', state: 'empty', persona: 'registered', path: '/messages', rules: msgRules({ action: 'hang' }), checks: [has('暂无消息'), readAllBtn, readAllOff, hasNot('没有更多了')] },
  { app: 'seeker', screen: 'messages', state: 'loading', persona: 'acknowledged', path: '/messages', rules: [{ url: MSG_API, action: 'hang' }], checks: [spinnerPrimary, hasNot('暂无消息'), readAllOff] },
  { app: 'seeker', screen: 'messages', state: 'error', persona: 'acknowledged', path: '/messages', rules: [{ url: MSG_API, action: 'fail' }], checks: [has('重新加载'), hasNot('暂无消息'), readAllOff] },
  { app: 'seeker', screen: 'messages', state: 'submitting', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'hang' }, fakeMsgs), steps: [countXhr, clickTwice('全部已读')], quick: true,
    checks: [sentOnce, disabledBtn('全部已读'), `document.querySelector('#app .van-nav-bar__right .van-loading') ? '' : '标记中「全部已读」没有转圈'`] },
  { app: 'seeker', screen: 'messages', state: 'rejected', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'respond', body: refuse('SYS_4290', '操作太频繁，请稍后再试') }, fakeMsgs),
    steps: [click('全部已读'), toastGone('操作太频繁，请稍后再试')],
    checks: [stays('#app .tipbar--danger', '没有标记成功：操作太频繁，请稍后再试'), unreadMarks(['工伤上报提醒', '面试信息', '预支审批结果'], ['问题反馈已回复']), enabledBtn('全部已读'), bodyText] },
  { app: 'seeker', screen: 'messages', state: 'all-read', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'respond', body: reply(3) }, fakeMsgs), steps: [click('全部已读')], quick: true,
    checks: [unreadMarks([], ['工伤上报提醒', '面试信息', '预支审批结果', '问题反馈已回复']), `document.querySelector('.van-toast')?.innerText.includes('已全部标为已读') ? '' : '标记成功后没有轻提示'`] },
  // 没有未读：「全部已读」直接置灰，原因写在列表上方，不等点了才提示
  { app: 'seeker', screen: 'messages', state: 'none-unread', persona: 'acknowledged', path: '/messages', rules: msgRules({ action: 'hang' }, [fakeMsgs[3]]), steps: [countXhr, click('全部已读')], quick: true,
    checks: [readAllOff, stays('#app .read-note', '没有未读消息'), `window.__sent === 0 ? '' : '没有未读也把请求发出去了'`] },
  // 问题反馈：提交（POST）一律拦住，不落库
  { app: 'seeker', screen: 'feedback', state: 'normal', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')],
    checks: [formGroups, bottomBar('提交反馈'), onePrimary, tapTall('#app .chip-tap'), bodyText, noLegacy, has('遇到问题、想投诉或有建议'), has('不填则用注册手机号联系你'),
      `document.querySelectorAll('#app .chip-tap').length === 6 ? '' : '问题类型不是 6 个'`] },
  { app: 'seeker', screen: 'feedback', state: 'normal', persona: 'acknowledged', path: '/feedback', width: NARROW, rules: [fbPost('hang')], checks: [formGroups, bottomBar('提交反馈'), tapArea('#app .chip-tap')] },
  { app: 'seeker', screen: 'feedback', state: 'selected', persona: 'acknowledged', path: '/feedback', width: NARROW, rules: [fbPost('hang')], steps: [keepChipPos, pickCat], checks: [chipStable, tapArea('#app .chip-tap')] },
  { app: 'seeker', screen: 'feedback', state: 'list', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')], steps: [toBottom],
    checks: [has('我的反馈'), has('2 条'), has('平台回复'), has('已回复'), `document.querySelectorAll('#app .fb-item').length === 2 && [...document.querySelectorAll('#app .fb-item')].every((i) => i.querySelector('.status-tag')) ? '' : '反馈记录不是 2 条，或有记录没有状态标签'`] },
  { app: 'seeker', screen: 'feedback', state: 'list', persona: 'acknowledged', path: '/feedback', width: NARROW, rules: [fbPost('hang')], steps: [toBottom] },
  { app: 'seeker', screen: 'feedback', state: 'all-status', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang'), fbList('respond', fakeFbs)], steps: [toBottom],
    checks: [has('待处理'), has('已回复'), has('已关闭'), has('3 条'), `document.querySelectorAll('#app .fb-item').length === 3 ? '' : '反馈记录不是 3 条'`] },
  { app: 'seeker', screen: 'feedback', state: 'selected', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')], steps: [keepChipPos, pickCat, fillArea(FB_TEXT), fill(CONTACT_PH, '13800001234')],
    checks: [chipStable, tapArea('#app .chip-tap'), `document.querySelectorAll('#app .chip-tap[aria-pressed=true]').length === 1 && document.querySelector('#app .chip-tap[aria-pressed=true] svg') && !document.querySelector('#app .chip-tap[aria-pressed=false] svg') ? '' : '选中的问题类型没有勾（或选中了不止一个）'`, has('20/1000')] },
  // 没选类型、描述太短、电话不对：轻提示之外原因写在字段下方，请求不发出去
  { app: 'seeker', screen: 'feedback', state: 'no-category', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')], steps: [fillArea(FB_TEXT), countXhr, click('提交反馈'), toastGone('请选择问题类型')],
    checks: [stays('#app .fhint--err', '请选择问题类型'), `window.__sent === 0 ? '' : '没选类型也把请求发出去了'`, idle, inView('#app [data-field="category"]')] },
  { app: 'seeker', screen: 'feedback', state: 'too-short', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')], steps: [pickCat, fillArea('不对'), countXhr, click('提交反馈'), toastGone('请至少用 5 个字描述问题')],
    checks: [fieldError('请至少用 5 个字描述问题'), `window.__sent === 0 ? '' : '描述太短也把请求发出去了'`] },
  { app: 'seeker', screen: 'feedback', state: 'bad-contact', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')], steps: [pickCat, fillArea(FB_TEXT), fill(CONTACT_PH, '12345'), countXhr, click('提交反馈'), toastGone('回访电话格式不正确')],
    checks: [fieldError('回访电话格式不正确'), `window.__sent === 0 ? '' : '电话不对也把请求发出去了'`] },
  { app: 'seeker', screen: 'feedback', state: 'submitting', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang')], steps: [pickCat, fillArea(FB_TEXT), countXhr, clickTwice('提交反馈')], quick: true, checks: [spinning('提交中'), sentOnce] },
  { app: 'seeker', screen: 'feedback', state: 'rejected', persona: 'acknowledged', path: '/feedback', rules: [fbPost('respond', refuse('SYS_4290', '提交太频繁，请稍后再试'))], steps: [pickCat, fillArea(FB_TEXT), click('提交反馈'), toastGone('提交太频繁，请稍后再试')],
    checks: [idle, stays('#app .bottom-bar .bar-why', '没有提交成功：提交太频繁，请稍后再试'), bottomBar('提交反馈'), bodyText,
      `document.querySelector('#app textarea').value === ${JSON.stringify(FB_TEXT)} ? '' : '被拒之后填的内容被清掉了'`] },
  { app: 'seeker', screen: 'feedback', state: 'empty', persona: 'veteran', path: '/feedback', rules: [fbPost('hang')], steps: [toBottom],
    checks: [has('还没有提交过反馈'), bottomBar('提交反馈'), `(() => { const e = document.querySelector('#app .state-block'); const r = e?.getBoundingClientRect(), bar = document.querySelector('.bottom-bar').getBoundingClientRect()
      return r && r.top >= 44 && r.bottom <= bar.top ? '' : '「我的反馈」的空状态不在这一屏里或被底部栏挡住' })()`] },
  { app: 'seeker', screen: 'feedback', state: 'loading', persona: 'acknowledged', path: '/feedback', rules: [{ url: FB_API, action: 'hang' }], steps: [toBottom], quick: true, checks: [spinnerPrimary, has('提交反馈')] },
  { app: 'seeker', screen: 'feedback', state: 'error', persona: 'acknowledged', path: '/feedback', rules: [fbPost('hang'), fbList('fail')], steps: [toBottom], checks: [has('重新加载'), hasNot('还没有提交过反馈')] },
  // 我的：退出登录（POST）一律拦住
  { app: 'seeker', screen: 'me', state: 'normal', persona: 'veteran', path: '/me', rules: [{ url: LOGOUT_API, action: 'hang' }],
    checks: [profileCard, cellGroups(12), logoutOutlined, tapTall('#app .me-group .lrow'), bodyText, noLegacy, has('进入我的工作'), has('身份档案'), has('已完成实名认证'),
      `document.querySelectorAll('#app .van-button--primary:not(.van-button--plain)').length === 0 ? '' : '个人中心不该有主色实心按钮'`] },
  { app: 'seeker', screen: 'me', state: 'normal', persona: 'veteran', path: '/me', width: NARROW, rules: [{ url: LOGOUT_API, action: 'hang' }], checks: [profileCard, cellGroups(12)] },
  { app: 'seeker', screen: 'me', state: 'bottom', persona: 'veteran', path: '/me', rules: [{ url: LOGOUT_API, action: 'hang' }], steps: [toBottom], checks: [logoutOutlined] },
  { app: 'seeker', screen: 'me', state: 'bottom', persona: 'veteran', path: '/me', width: NARROW, rules: [{ url: LOGOUT_API, action: 'hang' }], steps: [toBottom] },
  // 刚注册、什么都还没有的人：入口摘要是「暂无合同」「尚未入职」
  { app: 'seeker', screen: 'me', state: 'empty', persona: 'registered', path: '/me', rules: [{ url: LOGOUT_API, action: 'hang' }], checks: [profileCard, cellGroups(12), has('暂无合同'), has('尚未入职')] },
  // 角标：待签署的合同、99 条以上的未读
  { app: 'seeker', screen: 'me', state: 'badges', persona: 'veteran', path: '/me',
    rules: [{ url: LOGOUT_API, action: 'hang' }, { url: MSG_UNREAD_API, action: 'respond', body: reply(120) }, { url: CONTRACTS_API, action: 'respond', body: fakeContracts }],
    checks: [has('有 1 份合同待你签署'), has('待签署'), has('99+'), cellGroups(12),
      `(() => { const b = document.querySelector('#app .me-group .cnt'); return b && parseFloat(getComputedStyle(b).fontSize) >= 12 ? '' : '未读角标没出来或字号小于 12px' })()`] },
  // 档案接口一开始就挂住的话停在应用的启动加载上，进不到这一页：先让它失败，再点「重新加载」时挂住
  { app: 'seeker', screen: 'me', state: 'loading', persona: 'veteran', path: '/me', rules: [{ url: ME, action: 'fail' }], lateRules: [{ url: ME, action: 'hang' }], steps: [click('重新加载')], quick: true,
    checks: [spinnerPrimary, cellGroups(12), hasNot('重新加载'), descBlank] },
  { app: 'seeker', screen: 'me', state: 'error', persona: 'veteran', path: '/me', rules: [{ url: ME, action: 'fail' }], checks: [has('重新加载'), cellGroups(12), descBlank] },
  { app: 'seeker', screen: 'me', state: 'logout-confirm', persona: 'veteran', path: '/me', rules: [{ url: LOGOUT_API, action: 'hang' }], steps: [click('退出登录')],
    checks: [`document.querySelector('.van-dialog')?.innerText.includes('确定退出当前账号吗？') ? '' : '点「退出登录」没有弹出确认'`] },
  // 退出中：确认之后再点一次；要是又弹出确认框就再确认一次。只能发出一条请求
  { app: 'seeker', screen: 'me', state: 'submitting', persona: 'veteran', path: '/me', rules: [{ url: LOGOUT_API, action: 'hang' }],
    steps: [`${findBtn('退出登录')}.scrollIntoView({ block: 'center' })`, click('退出登录'), countXhr, `(async () => { ${confirmLogout}; await ${wait(500)}; ${findBtn('退出登录')}.click(); await ${wait(500)}
      const again = [...document.querySelectorAll('.van-dialog')].find((d) => d.getClientRects().length); if (again) [...again.querySelectorAll('button')].find((b) => b.innerText.trim() === '退出').click() })()`], quick: true,
    checks: [spinning('退出登录'), sentOnce, `(() => { const r = ${findBtn('退出登录')}.getBoundingClientRect(); return r.top >= 44 && r.bottom <= innerHeight - 50 ? '' : '截图里看不到转圈的「退出登录」' })()`] },
  // ---- 工单 12：驻场 ----
  { app: 'staff', screen: 'workbench', state: 'normal', persona: 'site', path: '/', rules: sr(),
    checks: [whiteBg('#app .id-head'), fourMetrics, todoCards(1), tabbarIcons, pageBg, staffText, staffLegacy, has('待知悉报名'), has('更多事项')] },
  { app: 'staff', screen: 'workbench', state: 'normal', persona: 'site', path: '/', width: NARROW, rules: sr(), checks: [fourMetrics, todoCards(1)] },
  { app: 'staff', screen: 'workbench', state: 'long', persona: 'site', path: '/', rules: sr(), steps: [toBottom], checks: [tabbarIcons] },
  { app: 'staff', screen: 'workbench', state: 'alarm', persona: 'site', path: '/', rules: alarmRules(), checks: [alarm, todoCards(1)] },
  { app: 'staff', screen: 'workbench', state: 'alarm', persona: 'site', path: '/', width: NARROW, rules: alarmRules(), checks: [alarm] },
  { app: 'staff', screen: 'workbench', state: 'empty', persona: 'site', path: '/', rules: sr({ url: TAPPS_API, method: 'GET', action: 'respond', body: emptyPage }), checks: [has('暂无待知悉的报名'), staffText, emptyPadded] },
  { app: 'staff', screen: 'workbench', state: 'loading', persona: 'site', path: '/', rules: sr({ url: TAPPS_API, action: 'hang' }, { url: WB_API, action: 'hang' }), quick: true, checks: [spinnerPrimary, hasNot('暂无待知悉的报名')] },
  { app: 'staff', screen: 'workbench', state: 'error', persona: 'site', path: '/', rules: sr({ url: TAPPS_API, action: 'fail' }, { url: WB_API, action: 'fail' }),
    checks: [has('重新加载'), hasNot('下拉可重试'), hasNot('暂无待知悉的报名')] },
  // 拦截自检：发一条不存在的 PUT（不会落库），1.5 秒内有回应就说明非 GET 的写请求没被拦住
  { app: 'staff', screen: 'workbench', state: 'write-guard', persona: 'site', path: '/', rules: sr(),
    checks: [`new Promise((ok) => { const x = new XMLHttpRequest(); x.open('PUT', '/api/v1/tenant/employments/E-NONE/absences'); x.onloadend = () => ok('PUT 写请求没被拦住（状态 ' + x.status + '）'); x.send('{}'); setTimeout(() => ok(''), 1500) })`] },
  // 只有待办数字没取到：顶部提示条说一次
  { app: 'staff', screen: 'workbench', state: 'metrics-error', persona: 'site', path: '/', rules: sr({ url: WB_API, action: 'fail' }), checks: [has('下拉可重试'), hasNot('重新加载')] },
  // 待知悉区块点「重新加载」：重试期间是加载中，不闪空状态
  { app: 'staff', screen: 'workbench', state: 'retry', persona: 'site', path: '/', rules: sr({ url: TAPPS_API, action: 'fail' }), lateRules: [{ url: TAPPS_API, action: 'hang' }],
    steps: [click('重新加载')], quick: true, checks: [hasNot('暂无待知悉的报名'), hasNot('待知悉报名加载失败'), `document.querySelector('#app .todo-sec .van-loading') ? '' : '重试期间没有回到加载中'`] },
  { app: 'staff', screen: 'workbench', state: 'page-error', persona: 'site', path: '/', rules: sr({ url: TME_API, action: 'fail' }), checks: [has('重新加载')] },
  // 工作台的卡片都是待知悉，主按钮是「知悉并推送」（全屏表单）；到厂确认在「更多」里
  { app: 'staff', screen: 'workbench', state: 'submitting', persona: 'site', path: '/', rules: sr(), steps: [click('更多'), countXhr, click('到厂确认'), dialogTwice('确认到厂')], quick: true,
    checks: [sentOnce, `document.querySelector('.van-dialog .van-button--loading') ? '' : '提交中确认按钮没有转圈'`] },
  { app: 'staff', screen: 'workbench', state: 'rejected', persona: 'site', path: '/', rules: sr({ url: '/arrive', action: 'respond', body: refuse('APP_4090', '该报名状态已变化，请刷新后重试') }),
    steps: [click('更多'), click('到厂确认'), dialogBtn('确认到厂'), toastGone('该报名状态已变化，请刷新后重试'), dialogBtn('取消')],
    checks: [stays('#app .why', '暂时不能到厂确认：该报名状态已变化，请刷新后重试'), disabledBtn('知悉并推送'), disabledBtn('更多'), staffText] },
  { app: 'staff', screen: 'todo', state: 'normal', persona: 'site', path: '/todo', rules: sr(), checks: [todoCards(1), tabUnderline, tabbarIcons, staffText, staffLegacy, has('没有更多了')] },
  { app: 'staff', screen: 'todo', state: 'normal', persona: 'site', path: '/todo', width: NARROW, rules: sr(), checks: [todoCards(1)] },
  { app: 'staff', screen: 'todo', state: 'interview', persona: 'site', path: '/todo?tab=interview', rules: sr(), checks: [todoCards(1)] },
  { app: 'staff', screen: 'todo', state: 'interview', persona: 'site', path: '/todo?tab=interview', width: NARROW, rules: sr(), checks: [todoCards(1)] },
  { app: 'staff', screen: 'todo', state: 'confirm', persona: 'site', path: '/todo?tab=confirm', rules: sr(), checks: [todoCards(1)] },
  { app: 'staff', screen: 'todo', state: 'empty', persona: 'site', path: '/todo?tab=arrived', rules: sr({ url: TAPPS_API, method: 'GET', action: 'respond', body: emptyPage }), checks: [has('今天还没有确认到厂的求职者'), staffLegacy] },
  { app: 'staff', screen: 'todo', state: 'loading', persona: 'site', path: '/todo', rules: sr({ url: TAPPS_API, action: 'hang' }), quick: true, checks: [spinnerPrimary] },
  { app: 'staff', screen: 'todo', state: 'error', persona: 'site', path: '/todo', rules: sr({ url: TAPPS_API, action: 'fail' }), checks: [has('重新加载')] },
  { app: 'staff', screen: 'todo', state: 'submitting', persona: 'site', path: '/todo?tab=interview', rules: sr(), steps: [countXhr, click('到厂确认'), dialogTwice('确认到厂')], quick: true,
    checks: [sentOnce, `document.querySelector('.van-dialog .van-button--loading') ? '' : '提交中确认按钮没有转圈'`] },
  { app: 'staff', screen: 'todo', state: 'rejected', persona: 'site', path: '/todo?tab=interview', rules: sr({ url: '/arrive', action: 'respond', body: refuse('APP_4090', '该报名状态已变化，请刷新后重试') }),
    steps: [click('到厂确认'), dialogBtn('确认到厂'), toastGone('该报名状态已变化，请刷新后重试'), dialogBtn('取消'), scrollTo('#app .why')],
    checks: [stays('#app .why', '暂时不能到厂确认：该报名状态已变化，请刷新后重试'), onScreen('#app .why'), disabledBtn('到厂确认'), staffText] },
  { app: 'staff', screen: 'reminders', state: 'normal', persona: 'site', path: '/reminders', rules: sr(), checks: [tabUnderline, tabbarIcons, staffText, staffLegacy, has('24 小时窗口内待跟进')] },
  { app: 'staff', screen: 'reminders', state: 'normal', persona: 'site', path: '/reminders', width: NARROW, rules: sr() },
  { app: 'staff', screen: 'reminders', state: 'private', persona: 'site', path: '/reminders?f=private', rules: sr(), checks: [has('一键流转经纪人'), has('私域待匹配')] },
  { app: 'staff', screen: 'reminders', state: 'empty', persona: 'site', path: '/reminders', rules: sr({ url: TAPPS_API, method: 'GET', action: 'respond', body: emptyPage }, { url: PP_API, action: 'respond', body: reply([]) }), checks: [has('暂无 24 小时窗口内待跟进的用户')] },
  { app: 'staff', screen: 'reminders', state: 'loading', persona: 'site', path: '/reminders', rules: sr({ url: PP_API, action: 'hang' }), quick: true, checks: [spinnerPrimary] },
  { app: 'staff', screen: 'reminders', state: 'error', persona: 'site', path: '/reminders', rules: sr({ url: TAPPS_API, action: 'fail' }, { url: PP_API, action: 'fail' }), checks: [has('重新加载')] },
  { app: 'staff', screen: 'reminders', state: 'submitting', persona: 'site', path: '/reminders?f=private', rules: sr(), steps: [countXhr, click('一键流转经纪人'), dialogTwice('确认流转')], quick: true,
    checks: [sentOnce, `document.querySelector('.van-dialog .van-button--loading') ? '' : '提交中确认按钮没有转圈'`] },
  { app: 'staff', screen: 'reminders', state: 'rejected', persona: 'site', path: '/reminders?f=private', rules: sr({ url: '/transfer-to-broker', action: 'respond', body: refuse('SYS_4090', '该用户已在流转池') }),
    steps: [click('一键流转经纪人'), dialogBtn('确认流转'), toastGone('该用户已在流转池'), dialogBtn('取消')],
    checks: [stays('#app .why', '暂时不能流转：该用户已在流转池'), staffText] },
  { app: 'staff', screen: 'application', state: 'normal', persona: 'site', path: DETAIL, rules: sr(), checks: [whiteBg('.van-nav-bar'), bottomBar('拨打'), staffText, staffLegacy, has('跟进记录')] },
  { app: 'staff', screen: 'application', state: 'normal', persona: 'site', path: DETAIL, width: NARROW, rules: sr(), checks: [bottomBar('拨打')] },
  { app: 'staff', screen: 'application', state: 'bottom', persona: 'site', path: DETAIL, rules: sr(), steps: [toBottom] },
  { app: 'staff', screen: 'application', state: 'loading', persona: 'site', path: DETAIL, rules: sr({ url: TAPPS_API + '/', action: 'hang' }), quick: true, checks: [spinnerPrimary] },
  { app: 'staff', screen: 'application', state: 'error', persona: 'site', path: DETAIL, rules: sr({ url: TAPPS_API + '/', action: 'fail' }), checks: [has('重新加载')] },
  { app: 'staff', screen: 'application', state: 'submitting', persona: 'site', path: DETAIL, rules: sr(), steps: [countXhr, `${findBtn('到厂确认')}.click()`, dialogTwice('确认到厂')], quick: true,
    checks: [sentOnce, `document.querySelector('.van-dialog .van-button--loading') ? '' : '提交中确认按钮没有转圈'`] },
  { app: 'staff', screen: 'application', state: 'rejected', persona: 'site', path: DETAIL, rules: sr({ url: '/arrive', action: 'respond', body: refuse('APP_4090', '该报名状态已变化，请刷新后重试') }),
    steps: [`${findBtn('到厂确认')}.click()`, dialogBtn('确认到厂'), toastGone('该报名状态已变化，请刷新后重试'), dialogBtn('取消')],
    checks: [stays('#app .bar-why', '暂时不能到厂确认：该报名状态已变化，请刷新后重试'), disabledBtn('到厂确认'), disabledBtn('更多'), `document.querySelector('#app .van-pull-refresh') ? '' : '没有下拉刷新入口'`] },
  { app: 'staff', screen: 'application', state: 'forbidden', persona: 'site', path: '/applications/BM-NONE', rules: sr(), checks: [has('返回'), hasNot('重新加载')] },
  { app: 'staff', screen: 'login', state: 'normal', persona: 'guest', path: '/login', rules: sr(), checks: [whiteBg('.login'), staffLegacy, loginPhone] },
  { app: 'staff', screen: 'login', state: 'normal', persona: 'guest', path: '/login', width: NARROW, rules: sr(), checks: [loginPhone] },
  { app: 'staff', screen: 'login', state: 'invalid', persona: 'guest', path: '/login', rules: sr(), steps: [click('登录'), toastGone('请输入正确的 11 位手机号')], checks: [stays('#app .form-err', '请输入正确的 11 位手机号')] },
  { app: 'staff', screen: 'login', state: 'submitting', persona: 'guest', path: '/login', rules: sr(), steps: [fill('成员手机号', '13800000003'), fill('6 位验证码', '123456'), countXhr, clickTwice('登录')], quick: true, checks: [spinning('登录中'), sentOnce] },
  { app: 'staff', screen: 'login', state: 'rejected', persona: 'guest', path: '/login', rules: sr({ url: '/tenant/auth/sms-login', action: 'respond', body: refuse('AUTH_4001', '验证码错误或已过期') }),
    steps: [fill('成员手机号', '13800000003'), fill('6 位验证码', '123456'), click('登录'), toastGone('验证码错误或已过期')], checks: [stays('#app .form-err', '验证码错误或已过期'), idle] },
  { app: 'staff', screen: 'notice', state: 'pending', persona: 'site', path: '/notice', rules: sr(staffMe('PENDING_AUDIT')), checks: [has('公司入驻审核中'), has('刷新状态'), has('退出登录'), onePrimary] },
  { app: 'staff', screen: 'notice', state: 'pending', persona: 'site', path: '/notice', width: NARROW, rules: sr(staffMe('PENDING_AUDIT')) },
  { app: 'staff', screen: 'notice', state: 'rejected-company', persona: 'site', path: '/notice', rules: sr(staffMe('REJECTED', { auditRemark: '营业执照照片模糊，请重新上传清晰的原件照片' })),
    checks: [has('公司入驻未通过'), has('营业执照照片模糊'), has('修改资料后重新提交')] },
  { app: 'staff', screen: 'notice', state: 'banned', persona: 'site', path: '/notice', rules: sr(staffMe('BANNED', { statusRemark: '多次发布虚假岗位，已限制使用' })), checks: [has('公司账号已被限制使用'), has('多次发布虚假岗位')] },
  { app: 'staff', screen: 'notice', state: 'submitting', persona: 'site', path: '/notice', rules: sr(staffMe('PENDING_AUDIT')), lateRules: [{ url: TME_API, action: 'hang' }], steps: [countXhr, clickTwice('刷新状态')], quick: true, checks: [spinning('刷新中'), sentOnce] },
  { app: 'staff', screen: 'notice', state: 'refresh-failed', persona: 'site', path: '/notice', rules: sr(staffMe('PENDING_AUDIT')), lateRules: [{ url: TME_API, action: 'fail' }], steps: [click('刷新状态')],
    checks: [stays('#app .bar-why', '没有刷新成功'), idle, noToast] },
  { app: 'staff', screen: 'notice', state: 'loading', persona: 'site', path: '/notice', rules: sr({ url: TME_API, action: 'hang' }), quick: true, checks: [spinnerPrimary, hasNot('公司暂不可使用')] },
  { app: 'staff', screen: 'notice', state: 'error', persona: 'site', path: '/notice', rules: sr({ url: TME_API, action: 'fail' }), checks: [has('重新加载'), hasNot('公司暂不可使用')] },
  // 知悉推送弹层（工作台卡片的「知悉并推送」）
  { app: 'staff', screen: 'ack-popup', state: 'normal', persona: 'site', path: '/', rules: sr(), steps: [click('知悉并推送')],
    checks: [footInView('.ack'), popText('.ack'), popTaps('.ack'), popLegacy('.ack'), ackChipStable] },
  { app: 'staff', screen: 'ack-popup', state: 'normal', persona: 'site', path: '/', width: NARROW, rules: sr(), steps: [click('知悉并推送')], checks: [footInView('.ack'), ackTimeWhole, footClear('.ack')] },
  { app: 'staff', screen: 'ack-popup', state: 'submitting', persona: 'site', path: '/', rules: sr(), steps: [click('知悉并推送'), fillAddr, countXhr, clickTwice(ACK_BTN, '.ack')], quick: true,
    checks: [sentOnce, popSpin('.ack', '推送中')] },
  { app: 'staff', screen: 'ack-popup', state: 'rejected', persona: 'site', path: '/', rules: sr({ url: '/acknowledge', action: 'respond', body: refuse('APP_4090', '该报名状态已变化，请刷新后重试') }),
    steps: [click('知悉并推送'), fillAddr, `${findBtn(ACK_BTN, '.ack')}.click()`, toastGone('该报名状态已变化，请刷新后重试')], checks: [popRejected('.ack', '该报名状态已变化，请刷新后重试', ACK_BTN), popText('.ack')] },
  // 确权签约弹层（待确权分组卡片的「入职确权」）
  { app: 'staff', screen: 'confirm-popup', state: 'normal', persona: 'site', path: '/todo?tab=confirm', rules: sr(), steps: [click('入职确权')],
    checks: [footInView('.cf'), popText('.cf'), popTaps('.cf'), popLegacy('.cf'), popInset('.cf', '.note'), popInset('.cf', '.grp'), popInset('.cf', '.foot .van-button')] },
  { app: 'staff', screen: 'confirm-popup', state: 'normal', persona: 'site', path: '/todo?tab=confirm', width: NARROW, rules: sr(), steps: [click('入职确权')], checks: [footInView('.cf')] },
  { app: 'staff', screen: 'confirm-popup', state: 'submitting', persona: 'site', path: '/todo?tab=confirm', rules: sr(), steps: [click('入职确权'), countXhr, clickTwice(CF_BTN, '.cf')], quick: true,
    checks: [sentOnce, popSpin('.cf', '提交中')] },
  { app: 'staff', screen: 'confirm-popup', state: 'rejected', persona: 'site', path: '/todo?tab=confirm', rules: sr({ url: '/confirm', action: 'respond', body: refuse('APP_4090', '该报名已超过确权时限') }),
    steps: [click('入职确权'), `${findBtn(CF_BTN, '.cf')}.click()`, toastGone('该报名已超过确权时限')], checks: [popRejected('.cf', '该报名已超过确权时限', CF_BTN), popText('.cf')] },
  // 原因弹窗（工作台「更多」→「取消报名」）
  { app: 'staff', screen: 'reason-dialog', state: 'normal', persona: 'site', path: '/', rules: sr(), steps: openCancel, checks: [popText('.reason-dlg'), popTaps('.reason-dlg .rd')] },
  { app: 'staff', screen: 'reason-dialog', state: 'rejected', persona: 'site', path: '/', rules: sr({ url: '/cancel', action: 'respond', body: refuse('APP_4090', '该报名状态已变化，请刷新后重试') }),
    steps: [...openCancel, dialogBtn('确认取消'), toastGone('该报名状态已变化，请刷新后重试')], checks: [popRejected('.reason-dlg', '该报名状态已变化，请刷新后重试', '确认取消'), popText('.reason-dlg')] },
  // 工单 13：预支初审列表
  { app: 'staff', screen: 'advance', state: 'normal', persona: 'site', path: '/advance', rules: sr(), checks: [whiteBg('.van-nav-bar'), pageBg, tabUnderline, advCards, staffMoney, staffText, staffLegacy, has('驻场初审')] },
  { app: 'staff', screen: 'advance', state: 'normal', persona: 'site', path: '/advance', width: NARROW, rules: sr(), checks: [advCards] },
  { app: 'staff', screen: 'advance', state: 'all', persona: 'site', path: '/advance?tab=all', rules: sr(), checks: [advCards, staffMoney, has('没有更多了')] },
  { app: 'staff', screen: 'advance', state: 'empty', persona: 'site', path: '/advance', rules: sr(advGet('respond', reply([]))), checks: [has('暂无待你初审的预支申请'), staffLegacy] },
  { app: 'staff', screen: 'advance', state: 'loading', persona: 'site', path: '/advance', rules: sr(advGet('hang')), quick: true, checks: [spinnerPrimary, hasNot('暂无')] },
  { app: 'staff', screen: 'advance', state: 'error', persona: 'site', path: '/advance', rules: sr(advGet('fail')), checks: [has('重新加载'), hasNot('暂无')] },
  { app: 'staff', screen: 'advance', state: 'submitting', persona: 'site', path: '/advance', rules: sr(), steps: [...pickReject, countXhr, dialogTwice('确认驳回')], quick: true,
    checks: [popSpin('.reason-dlg', ''), sentOnce] },
  { app: 'staff', screen: 'advance', state: 'rejected', persona: 'site', path: '/advance', rules: sr(advReview('respond', refuse('ADV_4090', ADV_REASON))),
    steps: [...pickReject, dialogBtn('确认驳回'), toastGone(ADV_REASON), dialogBtn('取消')],
    checks: [stays('#app .why', '暂时不能驳回：' + ADV_REASON), whyDanger('#app .why'), disabledBtn('驳回'), disabledBtn('初审通过'), staffText] },
  // 预支详情（审核）
  { app: 'staff', screen: 'advance-detail', state: 'normal', persona: 'site', path: ADV_DETAIL, rules: sr(), checks: [whiteBg('.van-nav-bar'), reviewBar, bottomBar('驳回'), staffMoney, tlDots, staffText, staffLegacy, has('审批记录')] },
  { app: 'staff', screen: 'advance-detail', state: 'normal', persona: 'site', path: ADV_DETAIL, width: NARROW, rules: sr(), checks: [reviewBar, bottomBar('初审通过')] },
  { app: 'staff', screen: 'advance-detail', state: 'approve-dialog', persona: 'site', path: ADV_DETAIL, rules: sr(), steps: [click('初审通过')], checks: [popText('.reason-dlg'), popTaps('.reason-dlg .rd'), chipPicked('.reason-dlg .chip-tap')] },
  { app: 'staff', screen: 'advance-detail', state: 'loading', persona: 'site', path: ADV_DETAIL, rules: sr(advGet('hang')), quick: true, checks: [spinnerPrimary] },
  { app: 'staff', screen: 'advance-detail', state: 'error', persona: 'site', path: ADV_DETAIL, rules: sr(advGet('fail')), checks: [has('重新加载'), hasNot('返回')] },
  { app: 'staff', screen: 'advance-detail', state: 'forbidden', persona: 'site', path: '/advance/YZ-NONE', rules: sr(), checks: [has('返回'), hasNot('重新加载')] },
  { app: 'staff', screen: 'advance-detail', state: 'done', persona: 'site', path: ADV_DETAIL, rules: sr(advGet('respond', reply({ advance: advFake('SITE_APPROVED'), approvals: [{ step: 'SITE', decision: 'APPROVE', opinion: '在岗正常，出勤稳定，同意', at: '2026-11-12T18:00:00' }], ledger: [] }))),
    checks: [has('驻场初审 · 通过'), has('待处理'), `document.querySelector('.bottom-bar') ? '已初审的单子还有驳回 / 通过通栏' : ''`] },
  { app: 'staff', screen: 'advance-detail', state: 'submitting', persona: 'site', path: ADV_DETAIL, rules: sr(), steps: [...pickReject, countXhr, dialogTwice('确认驳回')], quick: true,
    checks: [popSpin('.reason-dlg', ''), sentOnce] },
  { app: 'staff', screen: 'advance-detail', state: 'rejected', persona: 'site', path: ADV_DETAIL, rules: sr(advReview('respond', refuse('ADV_4090', ADV_REASON))),
    steps: [...pickReject, dialogBtn('确认驳回'), toastGone(ADV_REASON)], checks: [popRejected('.reason-dlg', ADV_REASON, '确认驳回'), popText('.reason-dlg'), whyDanger('.reason-dlg .bar-why')] },
  { app: 'staff', screen: 'advance-detail', state: 'rejected-bar', persona: 'site', path: ADV_DETAIL, rules: sr(advReview('respond', refuse('ADV_4090', ADV_REASON))),
    steps: [...pickReject, dialogBtn('确认驳回'), toastGone(ADV_REASON), dialogBtn('取消')],
    checks: [stays('.bottom-bar .bar-why', '暂时不能驳回：' + ADV_REASON), whyDanger('.bottom-bar .bar-why'), disabledBtn('驳回'), disabledBtn('初审通过'), bottomBar('驳回'), staffText] },
  // 在岗人员
  { app: 'staff', screen: 'employees', state: 'normal', persona: 'site', path: '/employees', rules: sr(), checks: [whiteBg('.van-nav-bar'), pageBg, staffText, staffLegacy, tapTall('#app .ft .tel, #app .ft .go'), focusRing('#app article.item'), has('没有更多了')] },
  { app: 'staff', screen: 'employees', state: 'normal', persona: 'site', path: '/employees', width: NARROW, rules: sr() },
  { app: 'staff', screen: 'employees', state: 'empty', persona: 'site', path: '/employees', rules: sr({ url: EMP_API, action: 'respond', body: emptyPage }), checks: [has('暂无在岗员工'), staffLegacy] },
  { app: 'staff', screen: 'employees', state: 'loading', persona: 'site', path: '/employees', rules: sr({ url: EMP_API, action: 'hang' }), quick: true, checks: [spinnerPrimary, hasNot('暂无')] },
  { app: 'staff', screen: 'employees', state: 'error', persona: 'site', path: '/employees', rules: sr({ url: EMP_API, action: 'fail' }), checks: [has('重新加载'), hasNot('暂无')] },
  { app: 'staff', screen: 'absence-popup', state: 'normal', persona: 'site', path: '/employees', rules: sr(), steps: [empFirst], checks: [popTaps('.abs'), absLegacy] },
  { app: 'staff', screen: 'absence-popup', state: 'normal', persona: 'site', path: '/employees', width: NARROW, rules: sr(), steps: [empFirst] },
  { app: 'staff', screen: 'absence-popup', state: 'records-loading', persona: 'site', path: '/employees', rules: sr(absGet('hang')), steps: [empFirst], quick: true, checks: [absSpin] },
  { app: 'staff', screen: 'absence-popup', state: 'records-error', persona: 'site', path: '/employees', rules: sr(absGet('fail')), steps: [empFirst],
    checks: [`[...document.querySelectorAll('.abs button')].some((b) => b.innerText.includes('重新加载')) ? '' : '缺勤记录加载失败时没有「重新加载」'`, `document.querySelector('.abs').innerText.includes('本月无缺勤记录') ? '加载失败显示成了空记录' : ''`] },
  { app: 'staff', screen: 'absence-popup', state: 'submitting', persona: 'site', path: '/employees', rules: sr(), steps: [empFirst, countXhr, clickTwice('标记', '.abs')], quick: true,
    checks: [popSpin('.abs', '提交中'), sentOnce] },
  { app: 'staff', screen: 'absence-popup', state: 'rejected', persona: 'site', path: '/employees', rules: sr({ url: ABS_API, method: 'PUT', action: 'respond', body: refuse('EMP_4090', '该员工已离职，不能再标记') }),
    steps: [empFirst, `${findBtn('标记', '.abs')}.click()`, toastGone('该员工已离职，不能再标记')], checks: [popRejected('.abs', '该员工已离职，不能再标记', '标记')] },
  // 工伤上报
  { app: 'staff', screen: 'incidents', state: 'normal', persona: 'site', path: '/incidents', rules: sr(), checks: [whiteBg('.van-nav-bar'), pageBg, bottomBar('上报工伤'), staffText, staffLegacy, has('处理结论')] },
  { app: 'staff', screen: 'incidents', state: 'normal', persona: 'site', path: '/incidents', width: NARROW, rules: sr(), checks: [bottomBar('上报工伤')] },
  { app: 'staff', screen: 'incidents', state: 'empty', persona: 'site', path: '/incidents', rules: sr({ url: INC_API, method: 'GET', action: 'respond', body: reply([]) }), checks: [has('暂无工伤记录')] },
  { app: 'staff', screen: 'incidents', state: 'loading', persona: 'site', path: '/incidents', rules: sr({ url: INC_API, method: 'GET', action: 'hang' }), quick: true, checks: [spinnerPrimary, hasNot('暂无')] },
  { app: 'staff', screen: 'incidents', state: 'error', persona: 'site', path: '/incidents', rules: sr({ url: INC_API, method: 'GET', action: 'fail' }), checks: [has('重新加载'), hasNot('暂无')] },
  { app: 'staff', screen: 'incident-form', state: 'normal', persona: 'site', path: '/incidents', rules: sr(), steps: [click('上报工伤')], checks: [allRequired, popTaps('.sheet .seg'), popLegacy('.sheet'), chipPicked('.sheet .seg button')] },
  { app: 'staff', screen: 'incident-form', state: 'normal', persona: 'site', path: '/incidents', width: NARROW, rules: sr(), steps: [click('上报工伤')] },
  { app: 'staff', screen: 'incident-form', state: 'invalid', persona: 'site', path: '/incidents', rules: sr(), steps: [click('上报工伤'), click('立即上报'), toastGone('请填写受伤人员姓名')],
    checks: [stays('.sheet [data-field="personName"]', '请填写受伤人员姓名')] },
  { app: 'staff', screen: 'incident-form', state: 'submitting', persona: 'site', path: '/incidents', rules: sr(),
    steps: [click('上报工伤'), fill('姓名', '张三'), fillArea('搬运料箱时划伤左手食指，已在厂医务室包扎。', '.sheet'), countXhr, clickTwice('立即上报', '.sheet')], quick: true,
    checks: [popSpin('.sheet', '上报中'), sentOnce] },
  { app: 'staff', screen: 'incident-form', state: 'rejected', persona: 'site', path: '/incidents', rules: sr({ url: INC_API, method: 'POST', action: 'respond', body: refuse('SYS_4030', '该项目已结束，不能再上报') }),
    steps: [click('上报工伤'), fill('姓名', '张三'), fillArea('搬运料箱时划伤左手食指，已在厂医务室包扎。', '.sheet'), `${findBtn('立即上报', '.sheet')}.click()`, toastGone('该项目已结束，不能再上报')],
    checks: [popRejected('.sheet', '该项目已结束，不能再上报', '立即上报')] },
  // 专属码与海报
  { app: 'staff', screen: 'my-code', state: 'normal', persona: 'site', path: '/my-code', rules: sr(), checks: [whiteBg('.van-nav-bar'), pageBg, bottomBar('保存图片'), qrPure('#app img.qr'), onePrimary, staffText, staffLegacy] },
  { app: 'staff', screen: 'my-code', state: 'normal', persona: 'site', path: '/my-code', width: NARROW, rules: sr(), checks: [bottomBar('复制链接')] },
  { app: 'staff', screen: 'my-code', state: 'disabled', persona: 'site', path: '/my-code', rules: sr({ url: CODE_API, action: 'respond', body: reply({ ...codeReal, status: 'DISABLED' }) }), checks: [has('已停用'), has('已被公司停用')] },
  { app: 'staff', screen: 'my-code', state: 'loading', persona: 'site', path: '/my-code', rules: sr({ url: CODE_API, action: 'hang' }), quick: true, checks: [spinnerPrimary] },
  { app: 'staff', screen: 'my-code', state: 'error', persona: 'site', path: '/my-code', rules: sr({ url: CODE_API, action: 'fail' }), checks: [has('重新加载')] },
  { app: 'staff', screen: 'poster', state: 'generated', persona: 'site', path: '/my-code', rules: sr(), steps: [composeShot], checks: [posterCheck] },
  // 消息
  { app: 'staff', screen: 'messages', state: 'normal', persona: 'site', path: '/messages', rules: sr(), checks: [whiteBg('.van-nav-bar'), pageBg, readAllBtn, msgDot, staffText, staffLegacy] },
  { app: 'staff', screen: 'messages', state: 'normal', persona: 'site', path: '/messages', width: NARROW, rules: sr() },
  { app: 'staff', screen: 'messages', state: 'all-read', persona: 'site', path: '/messages', rules: sr({ url: TMSG_API, action: 'respond', body: allReadMsgs }, { url: TUNREAD_API, action: 'respond', body: reply(0) }), checks: [readAllOff, has('没有未读消息'), timeAligned] },
  { app: 'staff', screen: 'messages', state: 'empty', persona: 'site', path: '/messages', rules: sr({ url: TMSG_API, action: 'respond', body: emptyPage }, { url: TUNREAD_API, action: 'respond', body: reply(0) }), checks: [has('暂无消息'), readAllOff, hasNot('没有更多了')] },
  { app: 'staff', screen: 'messages', state: 'loading', persona: 'site', path: '/messages', rules: sr({ url: TMSG_API, action: 'hang' }), quick: true, checks: [spinnerPrimary, hasNot('暂无消息'), readAllOff] },
  { app: 'staff', screen: 'messages', state: 'error', persona: 'site', path: '/messages', rules: sr({ url: TMSG_API, action: 'fail' }), checks: [has('重新加载'), hasNot('暂无消息'), readAllOff] },
  { app: 'staff', screen: 'messages', state: 'submitting', persona: 'site', path: '/messages', rules: sr(), steps: [countXhr, clickTwice('全部已读', '.van-nav-bar')], quick: true, checks: [readAllOff, sentOnce] },
  { app: 'staff', screen: 'messages', state: 'rejected', persona: 'site', path: '/messages', rules: sr({ url: TREAD_API, action: 'respond', body: refuse('SYS_4290', '操作太频繁，请稍后再试') }),
    steps: [click('全部已读'), toastGone('操作太频繁，请稍后再试')], checks: [stays('#app .tipbar--danger', '操作太频繁，请稍后再试'), readAllOff, staffText] },
  // 我的
  { app: 'staff', screen: 'me', state: 'normal', persona: 'site', path: '/me', rules: sr(), checks: [whiteBg('.van-nav-bar'), pageBg, profileCard, cellGroups(5), logoutOutlined, tabbarIcons, staffText, staffLegacy] },
  { app: 'staff', screen: 'me', state: 'normal', persona: 'site', path: '/me', width: NARROW, rules: sr(), checks: [profileCard, cellGroups(5)] },
  // 加载中：启动时成员信息没拉到，在本页点「重新加载」，顶栏和标签栏留着
  { app: 'staff', screen: 'me', state: 'loading', persona: 'site', path: '/me', rules: sr({ url: TME_API, action: 'fail' }), lateRules: [{ url: TME_API, action: 'hang' }], steps: [click('重新加载')], quick: true,
    checks: [spinnerPrimary, shellKept] },
  { app: 'staff', screen: 'me', state: 'error', persona: 'site', path: '/me', rules: sr({ url: TME_API, action: 'fail' }),
    checks: [has('请检查网络后重新加载'), `${findBtn('重新加载')}?.classList.contains('van-button--primary') ? '' : '「重新加载」不是主色按钮'`, has('退出登录'), shellKept] },
  { app: 'staff', screen: 'me', state: 'submitting', persona: 'site', path: '/me', rules: sr(), steps: [toLogout, countXhr, logoutFlow], quick: true,
    checks: [spinning('退出登录'), sentOnce, logoutVisible] },
  // ---- 工单 14：企业后台外壳 ----
  { app: 'console', screen: 'shell', state: 'owner', persona: 'owner', path: '/owner/overview', rules: sr(), checks: [cSide('owner'), cTop('劳务公司老板/数据总览'), cPrimaryOnly, pageBg] },
  // 最后一项是拦截自检：同驻场，发一条不存在的 PUT（不会落库），1.5 秒内有回应就说明写请求没被拦住（不单独截图：画面和正常一样）
  { app: 'console', screen: 'shell', state: 'pm', persona: 'pm', path: '/pm/jobs', rules: sr(), checks: [cSide('pm'), cTop('项目经理/岗位管理'), cPrimaryOnly, cFit, cBadge, noThrottleWord,
    `new Promise((ok) => { const x = new XMLHttpRequest(); x.open('PUT', '/api/v1/tenant/employments/E-NONE/absences'); x.onloadend = () => ok('PUT 写请求没被拦住（状态 ' + x.status + '）'); x.send('{}'); setTimeout(() => ok(''), 1500) })`] },
  { app: 'console', screen: 'shell', state: 'pm', persona: 'pm', path: '/pm/jobs', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, cRoom] },
  { app: 'console', screen: 'shell', state: 'site', persona: 'site', path: '/site/home', rules: sr(), checks: [cSide('site'), cTop('驻场/驻场工作台'), cPrimaryOnly] },
  { app: 'console', screen: 'shell', state: 'site', persona: 'site', path: '/site/home', width: 1280, height: 800, rules: sr(), checks: [cSide('site')] },
  { app: 'console', screen: 'shell', state: 'broker', persona: 'broker', path: '/broker/pool', rules: sr(), checks: [cSide('broker'), cTop('人才经纪人/流转池')] },
  { app: 'console', screen: 'shell', state: 'org', persona: 'owner', path: '/settings/org', width: 1280, height: 800, rules: sr(), checks: [cSide('owner'), cFit] },
  // 账单表各列最小宽度合计 1060，1280 宽下「操作」列要在表格里横向滚动才看得到：表格列宽归账单页的改版工单，这里只查外壳没挤占内容区
  { app: 'console', screen: 'shell', state: 'bills', persona: 'owner', path: '/owner/bills', width: 1280, height: 800, rules: sr(), checks: [cSide('owner'), cRoom] },
  { app: 'console', screen: 'shell', state: 'throttled', persona: 'pm', path: '/pm/board', rules: sr(...cMe(pmMe, { status: 'THROTTLED', statusRemark: '近 30 天有 3 起求职者投诉经核实：到厂后岗位薪资与发布内容不符' })),
    checks: [has('公司当前处于平台处罚期'), has('岗位薪资与发布内容不符'), cBadge, noThrottleWord, `getComputedStyle(document.querySelector('#app .throttle')).backgroundColor === ${bgToken('--warning-soft')} ? '' : '处罚期提示条不是提醒浅底'`, cTop('项目经理/数据看板', 'warning')] },
  // 消息抽屉
  { app: 'console', screen: 'messages', state: 'normal', persona: 'pm', path: '/pm/jobs', rules: sr(), steps: [openBell], checks: [cDrawer, drawerShape] },
  { app: 'console', screen: 'messages', state: 'empty', persona: 'pm', path: '/pm/jobs', rules: sr({ url: C_MSG_API, action: 'respond', body: msgsEmpty }, { url: C_UNREAD_API, action: 'respond', body: reply(0) }), steps: [openBell],
    checks: [`document.querySelector('.msg-drawer').innerText.includes('暂无消息') ? '' : '空状态没写「暂无消息」'`, readAllOffEl] },
  { app: 'console', screen: 'messages', state: 'loading', persona: 'pm', path: '/pm/jobs', rules: sr({ url: C_MSG_API, action: 'hang' }), steps: [openBell], quick: true,
    checks: [`document.querySelector('.msg-drawer .el-loading-mask') ? '' : '没有加载遮罩'`, `document.querySelector('.msg-drawer').innerText.includes('暂无消息') ? '加载中闪了空状态' : ''`, readAllOffEl] },
  { app: 'console', screen: 'messages', state: 'error', persona: 'pm', path: '/pm/jobs', rules: sr({ url: C_MSG_API, action: 'fail' }), steps: [openBell],
    checks: [`${findBtn('重新加载', '.msg-drawer')} ? '' : '失败了没有「重新加载」'`, `document.querySelector('.msg-drawer .state svg') && document.querySelector('.msg-drawer .state-t')?.innerText.includes('消息加载失败') ? '' : '加载失败没有图标和标题'`, `document.querySelector('.msg-drawer').innerText.includes('暂无消息') ? '失败了显示成空状态' : ''`, readAllOffEl] },
  { app: 'console', screen: 'messages', state: 'submitting', persona: 'pm', path: '/pm/jobs', rules: sr(), steps: [openBell, countXhr, elClickTwice('全部已读', '.msg-drawer')], quick: true,
    checks: [elSpinning('全部已读', '.msg-drawer'), sentOnce] },
  { app: 'console', screen: 'messages', state: 'rejected', persona: 'pm', path: '/pm/jobs', rules: sr({ url: C_READ_API, action: 'respond', body: refuse('SYS_4290', '操作太频繁，请稍后再试') }),
    steps: [openBell, `${findBtn('全部已读', '.msg-drawer')}.click()`, elToastGone('操作太频繁，请稍后再试')], checks: [stays('.msg-drawer .form-err', '操作太频繁，请稍后再试'), readAllOffEl, elIdle] },
  // 网络失败：原因留着，但「全部已读」不置灰，可以直接再点
  { app: 'console', screen: 'messages', state: 'readall-network', persona: 'pm', path: '/pm/jobs', rules: sr({ url: C_READ_API, action: 'fail' }),
    steps: [openBell, `${findBtn('全部已读', '.msg-drawer')}.click()`, wait(4500)], checks: [stays('.msg-drawer .form-err', '可以再试一次'), `${findBtn('全部已读', '.msg-drawer')}.disabled ? '网络失败后「全部已读」被置灰了' : ''`, elIdle] },
  // 登录
  { app: 'console', screen: 'login', state: 'normal', persona: 'guest', path: '/login', rules: sr(), checks: [cLoginCard, cNoDecor, cLegacy, elPrimary] },
  { app: 'console', screen: 'login', state: 'normal', persona: 'guest', path: '/login', width: 1280, height: 800, rules: sr(), checks: [cLoginCard] },
  { app: 'console', screen: 'login', state: 'invalid', persona: 'guest', path: '/login', rules: sr(), steps: [`${findBtn('登录')}.click()`], checks: [elFieldError('请输入手机号'), elFieldError('请输入短信验证码'), fieldGap] },
  { app: 'console', screen: 'login', state: 'sms-submitting', persona: 'guest', path: '/login', rules: sr(), steps: [fillPhone, countXhr, elClickTwice('获取验证码')], quick: true, checks: [elSpinning('获取验证码'), sentOnce] },
  { app: 'console', screen: 'login', state: 'captcha', persona: 'guest', path: '/login', rules: sr({ url: C_SMS_API, action: 'respond', body: refuse('AUTH_4004', '请先完成图形验证码') }),
    steps: [fillPhone, `${findBtn('获取验证码')}.click()`, elToastGone('请先完成图形验证码')], checks: [`document.querySelector('#app img[alt="图形验证码"]') ? '' : '没有出图形验证码'`, stays('#app .form-err', '请先完成图形验证码')] },
  { app: 'console', screen: 'login', state: 'captcha-error', persona: 'guest', path: '/login', rules: sr({ url: C_SMS_API, action: 'respond', body: refuse('AUTH_4004', '请先完成图形验证码') }, { url: C_CAPTCHA_API, action: 'fail' }),
    steps: [fillPhone, `${findBtn('获取验证码')}.click()`, wait(4500)], checks: [stays('#app .form-err', '图形验证码加载失败')] },
  { app: 'console', screen: 'login', state: 'submitting', persona: 'guest', path: '/login', rules: sr(), steps: [fillPhone, fillCode, countXhr, elClickTwice('登录')], quick: true, checks: [elSpinning('登录'), sentOnce] },
  { app: 'console', screen: 'login', state: 'rejected', persona: 'guest', path: '/login', rules: sr({ url: C_LOGIN_API, action: 'respond', body: refuse('AUTH_4001', '验证码错误或已过期') }),
    steps: [fillPhone, fillCode, `${findBtn('登录')}.click()`, elToastGone('验证码错误或已过期')], checks: [stays('#app .form-err', '验证码错误或已过期'), elIdle] },
  // 入驻申请
  { app: 'console', screen: 'onboarding-apply', state: 'normal', persona: 'guest', path: '/login', rules: sr(), steps: [enterApply], checks: [cOnboardShell, cNoDecor, cLegacy, elPrimary] },
  { app: 'console', screen: 'onboarding-apply', state: 'normal', persona: 'guest', path: '/login', width: 1280, height: 800, rules: sr(), steps: [enterApply], checks: [cOnboardShell] },
  { app: 'console', screen: 'onboarding-apply', state: 'invalid', persona: 'guest', path: '/login', rules: sr(), steps: [enterApply, `${findBtn('提交入驻申请')}.click()`],
    checks: [elFieldError('请填写营业执照上的公司全称'), elFieldError('请上传营业执照'), fieldGap] },
  { app: 'console', screen: 'onboarding-apply', state: 'uploaded', persona: 'guest', path: '/login', rules: sr({ url: C_UPLOAD_API, action: 'respond', body: fakeUpload }), steps: [enterApply, fillApply],
    checks: [`document.querySelector('#app .uploader .status-tag--success') ? '' : '已上传的文件没有成功色共享标签'`] },
  { app: 'console', screen: 'onboarding-apply', state: 'upload-failed', persona: 'guest', path: '/login', rules: sr({ url: C_UPLOAD_API, action: 'respond', body: refuse('FILE_4001', '文件类型不支持') }),
    steps: [enterApply, fillApply, elToastGone('文件类型不支持')], checks: [stays('#app .uploader .form-err', '文件类型不支持')] },
  { app: 'console', screen: 'onboarding-apply', state: 'submitting', persona: 'guest', path: '/login', rules: sr({ url: C_UPLOAD_API, action: 'respond', body: fakeUpload }),
    steps: [enterApply, fillApply, countXhr, elClickTwice('提交入驻申请')], quick: true, checks: [elSpinning('提交入驻申请'), sentOnce] },
  { app: 'console', screen: 'onboarding-apply', state: 'rejected', persona: 'guest', path: '/login', rules: sr({ url: C_UPLOAD_API, action: 'respond', body: fakeUpload }, { url: C_APPLY_API, action: 'respond', body: refuse('COMPANY_4091', '该统一社会信用代码已入驻') }),
    steps: [enterApply, fillApply, `${findBtn('提交入驻申请')}.click()`, elToastGone('该统一社会信用代码已入驻')], checks: [stays('#app .form-err', '该统一社会信用代码已入驻'), elIdle] },
  // 入驻进度
  { app: 'console', screen: 'onboarding-status', state: 'pending', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(), checks: [cResult, has('入驻资料审核中'), has('入驻进度'), whiteBg('.top'), cNoDecor, cLegacy, elPrimary, resultActs, waitStepText] },
  { app: 'console', screen: 'onboarding-status', state: 'pending', persona: 'pendingOwner', path: '/onboarding/status', width: 1280, height: 800, rules: sr(), checks: [cResult] },
  { app: 'console', screen: 'onboarding-status', state: 'rejected-company', persona: 'rejectedOwner', path: '/onboarding/status', rules: sr(), checks: [cResult, has('入驻申请被驳回'), has('营业执照照片不清晰'), elPrimary] },
  { app: 'console', screen: 'onboarding-status', state: 'banned', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(...cMe(pendingMe, { status: 'BANNED', statusRemark: '多次发布虚假岗位，已封禁', auditedAt: '2026-11-01T10:00:00' })),
    checks: [cResult, has('公司账号已被封禁'), has('多次发布虚假岗位'), `document.querySelectorAll('#app .el-step__head.is-success').length === 2 && document.querySelector('#app .el-step:last-child .el-step__head.is-error') ? '' : '封禁时步骤条不是前两步完成、「开通使用」异常'`] },
  // 这一页没有真正的空状态（能进来就一定有公司资料）；这张是选填项和附件都没有时的样子
  { app: 'console', screen: 'onboarding-status', state: 'no-optional', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(...cMe(pendingMe, { licenseFiles: [], shortName: null, dispatchLicenseNo: null })), checks: [cResult, has('未上传')] },
  { app: 'console', screen: 'onboarding-status', state: 'submitting', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(), lateRules: [{ url: TME_API, action: 'hang' }],
    steps: [countXhr, elClickTwice('刷新状态')], quick: true, checks: [elSpinning('刷新状态'), sentOnce, `document.querySelector('#app .result .el-loading-mask') ? '' : '刷新中结果区没有加载遮罩'`] },
  { app: 'console', screen: 'onboarding-status', state: 'refresh-failed', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(), lateRules: [{ url: TME_API, action: 'fail' }],
    steps: [`${findBtn('刷新状态')}.click()`, wait(5000)], checks: [stays('#app .result .form-err', '刷新失败'), has('入驻资料审核中'), elIdle] },
  { app: 'console', screen: 'onboarding-status', state: 'editing', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(), steps: [`${findBtn('修改并重新提交')}.click()`, scrollStart('#app .company-form')],
    checks: [`document.querySelector('#app input[placeholder*="与营业执照一致"]')?.value === ${JSON.stringify(pendingMe.company.name)} ? '' : '修改表单没带出原资料'`, elPrimary] },
  { app: 'console', screen: 'onboarding-status', state: 'resubmitting', persona: 'pendingOwner', path: '/onboarding/status', rules: sr(),
    steps: [`${findBtn('修改并重新提交')}.click()`, scrollTo('#app .form-acts'), countXhr, elClickTwice('重新提交审核')], quick: true, checks: [elSpinning('重新提交审核'), sentOnce, inView('#app .form-acts .is-loading')] },
  { app: 'console', screen: 'onboarding-status', state: 'resubmit-rejected', persona: 'pendingOwner', path: '/onboarding/status', rules: sr({ url: C_RESUBMIT_API, action: 'respond', body: refuse('COMPANY_4090', '公司状态已变化，请刷新后再提交') }),
    steps: [`${findBtn('修改并重新提交')}.click()`, `${findBtn('重新提交审核')}.click()`, elToastGone('公司状态已变化，请刷新后再提交'), scrollTo('#app .form-acts')],
    checks: [stays('#app .form-err', '公司状态已变化，请刷新后再提交'), elIdle, inView('#app .form-err')] },

  // ---- 工单 15：驻场工作台（左今日待办 + 右选中人详情）----
  { app: 'console', screen: 'site-home', state: 'normal', persona: 'site', path: '/site/home', rules: sr(),
    checks: [cSide('site'), wbKpis, wbSorted, wbNoGap, wbDetail, wbOps, wbOneMain, wbActsClear, wbUrgent, statTone, cLegacy, noThrottleWord] },
  { app: 'console', screen: 'site-home', state: 'normal', persona: 'site', path: '/site/home', width: 1280, height: 800, rules: sr(), checks: [cSide('site'), wbKpis, wbKpiAligned, wbNoGap, wbFit, wbActsClear] },
  { app: 'console', screen: 'site-home', state: 'selected', persona: 'site', path: '/site/home', rules: sr(), steps: [wbPick(-1)], checks: [wbPicked(-1), wbDetail, wbOps, wbOneMain, wbActsClear] },
  { app: 'console', screen: 'site-home', state: 'filtered', persona: 'site', path: '/site/home', rules: sr(), steps: [wbTab('待确权')], checks: [wbFiltered('待确权'), wbNoGap, wbDetail, wbActsClear] },
  { app: 'console', screen: 'site-home', state: 'filtered-pushed', persona: 'site', path: '/site/home', rules: sr(), steps: [wbTab('已推送')], checks: [wbFiltered('已推送', '已推送，待到厂')] },
  { app: 'console', screen: 'site-home', state: 'loading', persona: 'site', path: '/site/home', rules: sr({ url: WB_API, action: 'hang' }, { url: TAPPS_API, action: 'hang' }), quick: true,
    steps: [wait(600)], checks: [`(() => { const m = [...document.querySelectorAll('#app .el-loading-mask')]; return m.length === 1 && m[0].parentElement.classList.contains('wb-body') ? '' : '加载中应只有指标和分栏共用的一个遮罩，实际 ' + m.length + ' 个' })()`,
      hasNot('没有选中的报名'), hasNot('暂无待办'), noNums] },
  { app: 'console', screen: 'site-home', state: 'empty', persona: 'site', path: '/site/home', rules: sr({ url: WB_API, action: 'respond', body: fakeWb({ pendingAck: 0, pendingInterview: 0, pendingConfirm: 0, privatePending: 0 }) }, { url: TAPPS_API, action: 'respond', body: emptyPage }),
    checks: [has('暂无待办，干得漂亮'), has('没有选中的报名'), wbNoGap, allZero] },
  { app: 'console', screen: 'site-home', state: 'error', persona: 'site', path: '/site/home', rules: sr({ url: WB_API, action: 'fail' }, { url: TAPPS_API, action: 'fail' }),
    checks: [`(() => { const n = [...document.querySelectorAll('#app button')].filter((b) => b.innerText.includes('重新加载')).length; return n === 1 ? '' : '失败时应只有一个「重新加载」，实际 ' + n + ' 个' })()`,
      has('暂时看不到报名详情'), hasNot('没有选中的报名'), hasNot('暂无待办'), noNums] },
  // 匹配记录（和求职画像同一个接口）加载失败：两块都写明失败、给重新加载，不整块消失
  { app: 'console', screen: 'site-home', state: 'insight-error', persona: 'site', path: '/site/home', rules: sr({ url: '/insight', action: 'fail' }),
    checks: [`(() => { const bs = [...document.querySelectorAll('#app .d-blk')].filter((b) => ['匹配记录', '求职画像'].includes(b.querySelector('h4')?.innerText.trim()))
      if (bs.length !== 2) return '匹配记录失败后求职画像那块不见了'; return bs.every((b) => [...b.querySelectorAll('button')].some((x) => x.innerText.includes('重新加载'))) ? '' : '匹配记录或求职画像没有「重新加载」' })()`] },
  // 提交中：确认框里的确认按钮转圈，连点两次只发一条（写请求一律挂住）
  { app: 'console', screen: 'site-home', state: 'submitting', persona: 'site', path: '/site/home', rules: sr(), quick: true,
    steps: [`${findBtn('到厂确认', '#app .d-acts')}.click()`, wait(400), countXhr, boxClickTwice('确认到厂')], checks: [elSpinning('确认到厂', '.el-message-box'), sentOnce] },
  // 被拒：确认框不关、原因写在框里；详情操作区上方也留原因，只置灰「到厂确认」
  { app: 'console', screen: 'site-home', state: 'rejected', persona: 'site', path: '/site/home', rules: sr({ url: '/arrive', method: 'POST', action: 'respond', body: refuse('APPLICATION_4091', '报名状态已变化，请刷新后再操作') }),
    steps: [`${findBtn('到厂确认', '#app .d-acts')}.click()`, wait(400), `${findBtn('确认到厂', '.el-message-box')}.click()`, elToastGone('报名状态已变化，请刷新后再操作')],
    checks: [whyStays('#app .d-acts .blocked-why', '暂时不能到厂确认：报名状态已变化，请刷新后再操作'), onlyOff('#app .d-acts', '到厂确认'), boxWhy('确认到厂', '暂时不能到厂确认'), elIdle] },
  // 网络失败不置灰，可以直接重试
  { app: 'console', screen: 'site-home', state: 'network', persona: 'site', path: '/site/home', rules: sr({ url: '/arrive', method: 'POST', action: 'fail' }),
    steps: [`${findBtn('到厂确认', '#app .d-acts')}.click()`, wait(400), `${findBtn('确认到厂', '.el-message-box')}.click()`, toastShown],
    checks: [`document.querySelector('.el-message--error') ? '' : '截图时看不到断网的轻提示'`, `document.querySelector('#app .d-acts .blocked-why, .msgbox-why') ? '网络失败也把原因当成被拒留下了' : ''`,
      `${findBtn('到厂确认', '#app .d-acts')}.disabled ? '网络失败后按钮被置灰了' : ''`, `${findBtn('确认到厂', '.el-message-box')}?.disabled === false ? '' : '网络失败后确认框关了或确认按钮被置灰'`] },
  // ---- 工单 15：待办清单、24h 响应监控、确权与签约（第 2 / 2 / 8 类：表格，操作列文字按钮）----
  ...siteTable('site-todo', '/site/todo', '暂无待知悉', { act: '知悉推送', api: '/acknowledge', dialog: true, submit: '知悉并推送', why: '暂时不能知悉推送' }),
  // 「待面试」页有「修改面试信息」，是操作列最宽的情况
  { app: 'console', screen: 'site-todo', state: 'interview', persona: 'site', path: '/site/todo?tab=interview', width: 1280, height: 800, rules: sr(), checks: [has('修改面试信息'), opsCol, tblFit] },
  ...siteTable('site-follow', '/site/follow', '没有进行中的响应窗口', { act: '面试通过', api: '/result', submit: '面试通过', why: '暂时不能面试通过' }),
  ...siteTable('site-onboard', '/site/onboard', '暂无待确权人员', { act: '确权签约', api: '/confirm', dialog: true, submit: '确认入职并发起电子签约', why: '暂时不能确权签约' }),
  { app: 'console', screen: 'site-todo', state: 'insight', persona: 'site', path: '/site/todo', rules: sr(), steps: [`document.querySelector('#app .person-btn').click()`],
    checks: [`(() => { const d = document.querySelector('.insight-drawer'); if (!d) return '没有画像抽屉'; const w = d.getBoundingClientRect().width; if (w < 560 || w > 720) return '画像抽屉宽 ' + w + '，应在 560–720'
      const h = [...d.querySelectorAll('h4')].map((x) => x.innerText.trim()); return ['画像标签', '匹配记录', '在本公司的历史报名'].every((t) => h.includes(t)) ? '' : '画像抽屉缺区块：' + h.join('、') })()`] },
  { app: 'console', screen: 'site-follow', state: 'released', persona: 'site', path: '/site/follow', rules: sr({ url: '/tenant/reports/timeouts', action: 'respond', body: reply({ month: '2026-11', released: 3, ownLeadsLost: 2, releasedLastMonth: 5, byReason: [{ event: 'RESPONSE_TIMEOUT', cnt: 3 }] }) }),
    checks: [has('本月已有 3 人因超时被释放到公域'), cLegacy] },
  // ---- 工单 16：流转池（第 4 类：表格 + 工单抽屉），经纪人看 ----
  { app: 'console', screen: 'broker-pool', state: 'normal', persona: 'broker', path: '/broker/pool', rules: sr(), checks: [cSide('broker'), kpiCards, opsCol, tblFit, statTone, rowsTall, cLegacy16, noThrottleWord] },
  { app: 'console', screen: 'broker-pool', state: 'normal', persona: 'broker', path: '/broker/pool', width: 1280, height: 800, rules: sr(), checks: [cSide('broker'), cFit, kpiCards, opsCol, tblFit, noWrap('#app .person .t-xs'), has('流转于')] },
  { app: 'console', screen: 'broker-pool', state: 'rematch', persona: 'broker', path: '/broker/rematch', rules: sr(), checks: [has('二次匹配与释放在工单详情中操作'), opsCol, cLegacy16] },
  { app: 'console', screen: 'broker-pool', state: 'loading', persona: 'broker', path: '/broker/pool', rules: sr({ url: CASES_API, action: 'hang' }), quick: true, steps: [wait(600)], checks: [loadMask, noNums, hasNot('流转池暂无工单'), hasNot('暂无')] },
  { app: 'console', screen: 'broker-pool', state: 'empty', persona: 'broker', path: '/broker/pool', rules: sr({ url: CASES_API, action: 'respond', body: reply([]) }), checks: [has('流转池暂无工单'), allZero, cLegacy16] },
  { app: 'console', screen: 'broker-pool', state: 'error', persona: 'broker', path: '/broker/pool', rules: sr({ url: CASES_API, action: 'fail' }), checks: [oneRetry, noNums, hasNot('流转池暂无工单')] },
  // 标记已联系：确认框里提交，连点只发一条；被拒时框不关、原因写在框里，表格上方留原因、只置灰这一条的「标记已联系」
  { app: 'console', screen: 'broker-pool', state: 'submitting', persona: 'broker', path: '/broker/pool', rules: sr(), quick: true,
    steps: [...openCase('标记已联系'), countXhr, boxClickTwice('已联系')], checks: [elSpinning('已联系', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'broker-pool', state: 'rejected', persona: 'broker', path: '/broker/pool', rules: sr({ url: '/contact', method: 'POST', action: 'respond', body: refuse('LC_4001', '工单已结束') }),
    steps: [...openCase('标记已联系'), `${findBtn('已联系', '.el-message-box')}.click()`, elToastGone('工单已结束')],
    checks: [...rowOff('暂时不能标记已联系：工单已结束', '标记已联系'), boxWhy('已联系', '暂时不能标记已联系：工单已结束'), elIdle] },
  { app: 'console', screen: 'broker-pool', state: 'network', persona: 'broker', path: '/broker/pool', rules: sr({ url: '/contact', method: 'POST', action: 'fail' }),
    steps: [...openCase('标记已联系'), `${findBtn('已联系', '.el-message-box')}.click()`, toastShown],
    checks: [`document.querySelector('#app .blocked-why, .msgbox-why') ? '网络失败也把原因当成被拒留下了' : ''`, `${findBtn('已联系', '.el-message-box')}?.disabled === false ? '' : '网络失败后确认框关了或确认按钮被置灰'`] },
  // 工单抽屉：宽 560–720、分块；释放在确认框里提交，被拒时框里和抽屉里都留原因
  { app: 'console', screen: 'broker-drawer', state: 'normal', persona: 'broker', path: '/broker/pool', rules: sr(), steps: openCase(), checks: [drawerBlocks('.case-drawer', ['时限', '画像摘要'])] },
  { app: 'console', screen: 'broker-drawer', state: 'release-submitting', persona: 'broker', path: '/broker/pool', rules: sr(), quick: true,
    steps: [...toRelease.slice(0, -2), countXhr, `${findBtn('确认释放', '.case-drawer')}.click()`, wait(400), boxClickTwice('确认释放')], checks: [elSpinning('确认释放', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'broker-drawer', state: 'release-rejected', persona: 'broker', path: '/broker/pool', rules: sr({ url: '/release', method: 'POST', action: 'respond', body: refuse('LC_4001', '工单已结束') }),
    steps: [...toRelease, `${findBtn('确认释放', '.el-message-box')}.click()`, elToastGone('工单已结束')],
    checks: [boxWhy('确认释放', '暂时不能释放：工单已结束'), whyStays('.case-drawer .blocked-why', '暂时不能释放：工单已结束'), `${findBtn('确认释放', '.case-drawer')}.disabled ? '' : '被拒后抽屉里的「确认释放」没有置灰'`] },
  // 抽屉里的推送推荐、生成报告：提交中只转这一个、连点只发一条；被拒时原因留在抽屉里、按钮置灰
  { app: 'console', screen: 'broker-drawer', state: 'recommend-submitting', persona: 'broker', path: '/broker/pool', rules: sr(), quick: true,
    steps: [...pickJob, countXhr, elClickTwice('推送推荐给用户', '.case-drawer')], checks: [elSpinning('推送推荐给用户', '.case-drawer'), sentOnce] },
  { app: 'console', screen: 'broker-drawer', state: 'recommend-rejected', persona: 'broker', path: '/broker/pool', rules: sr({ url: '/recommend', method: 'POST', action: 'respond', body: refuse('LC_4001', '工单已结束') }),
    steps: [...pickJob, `${findBtn('推送推荐给用户', '.case-drawer')}.click()`, elToastGone('工单已结束')],
    checks: [whyStays('.case-drawer .blocked-why', '暂时不能推送推荐：工单已结束'), `${findBtn('推送推荐给用户', '.case-drawer')}.disabled ? '' : '被拒后「推送推荐给用户」没有置灰'`, drawerIdle] },
  { app: 'console', screen: 'broker-drawer', state: 'report-submitting', persona: 'broker', path: '/broker/pool', rules: sr(), quick: true,
    steps: [...openCase(), countXhr, `(async () => { ${genBtn}.click(); await ${wait(300)}; (document.querySelector('.case-drawer .el-button.is-loading') ?? ${genBtn}).click() })()`],
    checks: [`(() => { const b = [...document.querySelectorAll('.case-drawer .el-button.is-loading')]; return b.length === 1 && /生成报告|重新生成/.test(b[0].innerText) ? '' : '提交中应当只有生成报告在转，实际 ' + b.length + ' 个' })()`, sentOnce] },
  { app: 'console', screen: 'broker-drawer', state: 'report-rejected', persona: 'broker', path: '/broker/pool', rules: sr({ url: '/report', method: 'POST', action: 'respond', body: refuse('LC_4001', '工单已结束') }),
    steps: [...openCase(), `${genBtn}.click()`, elToastGone('工单已结束')],
    checks: [whyStays('.case-drawer .blocked-why', '暂时不能生成报告：工单已结束'), `${genBtn}.disabled ? '' : '被拒后生成报告按钮没有置灰'`, drawerIdle] },
  // ---- 工单 16：流转账本、流转人员、费用账单（第 9 类）----
  ...ownerPage('ledger', '/circulation/ledger', LEDGER_API, { fake: [{ url: LEDGER_API, action: 'respond', body: fakeCircLedger }], empty: reply([]), emptyText: '没有流转记录',
    checks: [cMoney(), cSigns(), rowsTall, signedCases], wide: [cMoney()] }),
  ...ownerPage('circulation-people', '/circulation/people', PEOPLE_API, { fake: [{ url: PEOPLE_API, action: 'respond', body: fakePeople }], empty: reply([]), emptyText: '目前没有我司引入、在别的公司任职的人',
    checks: [cMoney(), cSigns()] }),
  { app: 'console', screen: 'circulation-people', state: 'in', persona: 'owner', path: '/circulation/people', width: 1280, height: 800, rules: sr({ url: PEOPLE_API, action: 'respond', body: fakePeople }),
    steps: [`[...document.querySelectorAll('#app .filter-tabs button')][1].click()`], checks: [has('鑫诚劳务'), tblFit, cMoney()] },
  { app: 'console', screen: 'circulation-people', state: 'ended', persona: 'owner', path: '/circulation/people', width: 1280, height: 800, rules: sr({ url: PEOPLE_API, action: 'respond', body: fakePeople }),
    steps: [`[...document.querySelectorAll('#app .filter-tabs button')][2].click()`], checks: [has('流入 · 我付'), tblFit, cMoney(), footSign('−¥180.00'),
      `document.querySelector('#app .el-table__body .status-tag--danger') ? '「流入 · 我付」是正常方向，不该用危险色' : ''`] },
  ...ownerPage('bills', '/owner/bills', BILLS_API, { fake: [{ url: BILLS_API, action: 'respond', body: fakeBills }], empty: emptyPage, emptyText: '暂无账单', fit: cFit,
    checks: [opsCol, rowsTall, cMoney(), cSigns(), has('异议期内'), selTone], wide: [opsCol, cMoney()] }),
  { app: 'console', screen: 'bills', state: 'submitting', persona: 'owner', path: '/owner/bills', rules: sr({ url: BILLS_API, action: 'respond', body: fakeBills }), quick: true,
    steps: [...openDispute, countXhr, boxClickTwice('提交异议')], checks: [elSpinning('提交异议', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'bills', state: 'rejected', persona: 'owner', path: '/owner/bills', rules: sr({ url: '/disputes', method: 'POST', action: 'respond', body: refuse('SYS_4000', '已过异议期（2026-11-20）') }, { url: BILLS_API, action: 'respond', body: fakeBills }),
    steps: [...openDispute, `${findBtn('提交异议', '.el-message-box')}.click()`, elToastGone('已过异议期')],
    checks: [...rowOff('暂时不能提出异议：已过异议期', '提出异议'), boxWhy('提交异议', '暂时不能提出异议：已过异议期'), `${findBtn('提出异议', '#app .page-hd')}.disabled ? '' : '被拒后页头的「提出异议」没有置灰'`, elIdle] },
  { app: 'console', screen: 'bill-drawer', state: 'normal', persona: 'owner', path: '/owner/bills', rules: sr({ url: BILLS_API, action: 'respond', body: fakeBills }, { url: BILL_API, action: 'respond', body: fakeBillDetail }),
    steps: [`${findBtn('明细', '#app .el-table__body')}.click()`, wait(600)], checks: [drawerBlocks('.bill-drawer', ['金额', '时间', '每日计费明细', '异议记录']), cMoney('.bill-drawer'), cSigns('.bill-drawer')] },
  { app: 'console', screen: 'bill-drawer', state: 'error', persona: 'owner', path: '/owner/bills', rules: sr({ url: BILLS_API, action: 'respond', body: fakeBills }, { url: BILL_API, action: 'fail' }),
    steps: [`${findBtn('明细', '#app .el-table__body')}.click()`, wait(600)], checks: [`[...document.querySelectorAll('.bill-drawer button')].some((b) => b.innerText.includes('重新加载')) ? '' : '账单详情失败时没有「重新加载」'`] },
  // ---- 工单 16：数据总览（第 1 类看板 + 第 10 类横条图）、渠道报表（第 10 类）----
  ...ownerPage('overview', '/owner/overview', OVERVIEW_API, { fake: [{ url: BILLS_API, action: 'respond', body: fakeBills }], empty: zeroOverview, emptyText: '还没有项目在岗数据', nums: noNumsBut('诚信分'), keep: '诚信分', errNot: ['暂无在岗人员', '暂无项目'],
    checks: [chartColors('#app .hbar .track i, #app .stack i'), cMoney(), cSigns()] }),
  { app: 'console', screen: 'overview', state: 'bill-error', persona: 'owner', path: '/owner/overview', rules: sr({ url: BILLS_API, action: 'fail' }), checks: [has('最近账单加载失败'), hasNot('暂无账单')] },
  { app: 'console', screen: 'channel-report', state: 'error-legend', persona: 'owner', path: '/owner/channel-report', rules: sr({ url: CHANNELS_API, action: 'fail' }), checks: [`document.querySelector('#app .chart-legend') ? '没数据却显示了图例' : ''`] },
  ...ownerPage('channel-report', '/owner/channel-report', CHANNELS_API, { empty: reply([]), emptyText: '暂无渠道码',
    checks: [chartColors('#app .mini-t i, #app .fn-b i, #app .chart-legend i'), funnelText] }),
  // ---- 工单 17：项目数据看板 ----
  { app: 'console', screen: 'pm-board', state: 'normal', persona: 'pm', path: '/pm/board', rules: sr(), checks: [cSide('pm'), kpiCards, statTone, cLegacy16, noThrottleWord, netSigned, has('本月人员变动'), has('待我处理'), todoAligned] },
  { app: 'console', screen: 'pm-board', state: 'todo-loading', persona: 'pm', path: '/pm/board', rules: sr({ url: KB_PENDING_API, action: 'hang' }), quick: true, steps: [wait(600)],
    checks: [`document.querySelector('#app .todo .el-loading-mask') ? '' : '待我处理加载时没有自己的加载遮罩'`, hasNot('暂无待处理事项')] },
  { app: 'console', screen: 'pm-board', state: 'normal', persona: 'pm', path: '/pm/board', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFitAny, kpiCards, wbKpiAligned] },
  { app: 'console', screen: 'pm-board', state: 'loading', persona: 'pm', path: '/pm/board', rules: sr({ url: BOARD_API, action: 'hang' }), quick: true, steps: [wait(600)],
    checks: [loadMask, noNums, monthBlank, hasNot('暂无待处理事项'), hasNot('你还没有被分配负责项目')] },
  { app: 'console', screen: 'pm-board', state: 'empty', persona: 'pm', path: '/pm/board', rules: sr({ url: BOARD_API, action: 'respond', body: reply({}) }),
    checks: [has('你还没有被分配负责项目'), has('组织与权限'), allZero, monthBlank, cLegacy16] },
  { app: 'console', screen: 'pm-board', state: 'error', persona: 'pm', path: '/pm/board', rules: sr({ url: BOARD_API, action: 'fail' }), checks: [oneRetry, noNums, monthBlank, hasNot('你还没有被分配负责项目')] },
  // ---- 工单 17：岗位管理 ----
  { app: 'console', screen: 'pm-jobs', state: 'normal', persona: 'pm', path: '/pm/jobs', rules: sr(), checks: [cSide('pm'), kpiCards, opsCol, tblFit, statTone, rowsTall, cLegacy16, noThrottleWord, opsTap, salaryRight, remarkFull, queryReset] },
  { app: 'console', screen: 'pm-jobs', state: 'normal', persona: 'pm', path: '/pm/jobs', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, kpiCards, opsCol, tblFit, remarkFull,
    `(() => { const r = [...document.querySelectorAll('#app .el-table__body tr')].find((tr) => !tr.querySelector('.remark') && tr.getBoundingClientRect().height > 90); return r ? '1280 宽行高 ' + Math.round(r.getBoundingClientRect().height) + '：' + r.innerText.slice(0, 12) : '' })()`] },
  { app: 'console', screen: 'pm-jobs', state: 'more', persona: 'pm', path: '/pm/jobs', rules: sr(), steps: [`${findBtn('更多', '#app .el-table__body')}.click()`, wait(400)],
    checks: [`[...document.querySelectorAll('.el-dropdown-menu__item')].some((x) => x.getClientRects().length && x.innerText.trim() === '下架') ? '' : '「更多」里没有「下架」'`] },
  { app: 'console', screen: 'pm-jobs', state: 'loading', persona: 'pm', path: '/pm/jobs', rules: sr({ url: JOBS_API, action: 'hang' }), quick: true, steps: [wait(600)],
    checks: [`document.querySelector('#app .el-table .el-loading-mask') ? '' : '加载中表格上没有加载遮罩'`, noNums, hasNot('暂无岗位')] },
  { app: 'console', screen: 'pm-jobs', state: 'empty', persona: 'pm', path: '/pm/jobs',
    rules: sr({ url: JOB_STATS_API, action: 'respond', body: reply({ PENDING_AUDIT: 0, REJECTED: 0, RECRUITING: 0, PAUSED: 0, OFFLINE: 0, FORCE_OFFLINE: 0 }) }, { url: JOBS_API, action: 'respond', body: emptyPage }),
    checks: [has('暂无岗位'), allZero, cLegacy16] },
  { app: 'console', screen: 'pm-jobs', state: 'error', persona: 'pm', path: '/pm/jobs', rules: sr({ url: JOBS_API, action: 'fail' }), checks: [oneRetry, noNums, hasNot('暂无岗位')] },
  { app: 'console', screen: 'pm-jobs', state: 'submitting', persona: 'pm', path: '/pm/jobs', rules: sr(), quick: true,
    steps: [...openJobRow('暂停'), countXhr, boxClickTwice('暂停招聘')], checks: [elSpinning('暂停招聘', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-jobs', state: 'rejected', persona: 'pm', path: '/pm/jobs', rules: sr({ url: '/pause', method: 'POST', action: 'respond', body: refuse('JOB_4091', '岗位状态已变化，请刷新后再操作') }),
    steps: [...openJobRow('暂停'), `${findBtn('暂停招聘', '.el-message-box')}.click()`, elToastGone('岗位状态已变化')],
    checks: [...rowOff('暂时不能暂停招聘：岗位状态已变化', '暂停'), boxWhy('暂停招聘', '暂时不能暂停招聘：岗位状态已变化'), elIdle] },
  { app: 'console', screen: 'pm-jobs', state: 'network', persona: 'pm', path: '/pm/jobs', rules: sr({ url: '/pause', method: 'POST', action: 'fail' }),
    steps: [...openJobRow('暂停'), `${findBtn('暂停招聘', '.el-message-box')}.click()`, toastShown],
    checks: [`document.querySelector('#app .blocked-why, .msgbox-why') ? '网络失败也把原因当成被拒留下了' : ''`, `${findBtn('暂停招聘', '.el-message-box')}?.disabled === false ? '' : '网络失败后确认框关了或确认按钮被置灰'`] },
  { app: 'console', screen: 'pm-jobs', state: 'quota-submitting', persona: 'pm', path: '/pm/jobs', rules: sr(), quick: true,
    steps: [...openJobRow('名额'), countXhr, elClickTwice('保存', '.el-dialog')], checks: [elSpinning('保存', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'pm-jobs', state: 'quota-rejected', persona: 'pm', path: '/pm/jobs', rules: sr({ url: '/quota', method: 'PUT', action: 'respond', body: refuse('JOB_4092', '名额不能少于已占用数') }),
    steps: [...openJobRow('名额'), `${findBtn('保存', '.el-dialog')}.click()`, elToastGone('名额不能少于已占用数')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能调整名额：名额不能少于已占用数'), `${findBtn('保存', '.el-dialog')}.disabled ? '' : '被拒之后弹窗里的「保存」没有置灰'`, elIdle] },
  // 岗位详情抽屉（第 5 类）
  { app: 'console', screen: 'job-drawer', state: 'normal', persona: 'pm', path: '/pm/jobs', rules: sr(), steps: openJobTitle,
    checks: [drawerBlocks('.job-drawer', ['基本信息', '食宿', '要求', '面试', '岗位职责', '时间', '审核轨迹']), drawerSalary, drawerUnit] },
  { app: 'console', screen: 'job-drawer', state: 'error', persona: 'pm', path: '/pm/jobs', rules: sr({ url: '/audits', action: 'fail' }), steps: openJobTitle,
    checks: [`[...document.querySelectorAll('.job-drawer button')].some((b) => b.innerText.includes('重新加载')) ? '' : '岗位详情失败时没有「重新加载」'`] },
  // ---- 工单 17：岗位编辑（第 6 类长表单）----
  { app: 'console', screen: 'pm-job-edit', state: 'normal', persona: 'pm', path: MATCHED_EDIT, rules: sr(), checks: [cSide('pm'), jobForm, jobBar, elPrimary, cLegacy16, has('元/月（综合）')] },
  { app: 'console', screen: 'pm-job-edit', state: 'normal', persona: 'pm', path: MATCHED_EDIT, width: 1280, height: 800, rules: sr(), checks: [cFitAny, jobForm, jobBar] },
  { app: 'console', screen: 'pm-job-edit', state: 'create', persona: 'pm', path: '/pm/jobs/edit', rules: sr(), checks: [jobForm, jobBar, has('提交审核并发布')] },
  { app: 'console', screen: 'pm-job-edit', state: 'loading', persona: 'pm', path: MATCHED_EDIT, rules: sr({ url: PROJECTS_API, action: 'hang' }), quick: true, steps: [wait(600)], checks: [loadMask, editSpinner] },
  { app: 'console', screen: 'pm-job-edit', state: 'empty', persona: 'pm', path: '/pm/jobs/edit', rules: sr({ url: PROJECTS_API, action: 'respond', body: reply([]) }), checks: [has('暂无进行中的项目'), jobBar] },
  { app: 'console', screen: 'pm-job-edit', state: 'error', persona: 'pm', path: MATCHED_EDIT, rules: sr({ url: PROJECTS_API, action: 'fail' }), checks: [oneRetry, jobBar] },
  { app: 'console', screen: 'pm-job-edit', state: 'invalid', persona: 'pm', path: '/pm/jobs/edit', rules: sr(), steps: [`${findBtn('提交审核并发布', '#app .save-bar')}.click()`],
    checks: [elFieldError('请填写岗位名称')] },
  // 招聘中的岗位：确认框里提交
  { app: 'console', screen: 'pm-job-edit', state: 'submitting', persona: 'pm', path: MATCHED_EDIT, rules: sr(), quick: true,
    steps: [`${findBtn('保存并提交审核', '#app .save-bar')}.click()`, wait(600), countXhr, boxClickTwice('保存并提交审核')], checks: [elSpinning('保存并提交审核', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-job-edit', state: 'rejected', persona: 'pm', path: MATCHED_EDIT, rules: sr({ url: JOBS_API + '/', method: 'PUT', action: 'respond', body: refuse('JOB_4091', '岗位状态已变化，请刷新后再操作') }),
    steps: [`${findBtn('保存并提交审核', '#app .save-bar')}.click()`, wait(600), `${findBtn('保存并提交审核', '.el-message-box')}.click()`, elToastGone('岗位状态已变化')],
    checks: [boxWhy('保存并提交审核', '暂时不能保存：岗位状态已变化'), whyStays('#app .save-bar .blocked-why', '暂时不能保存：岗位状态已变化'), elIdle] },
  { app: 'console', screen: 'pm-job-edit', state: 'rejected-contract', persona: 'pm', path: MATCHED_EDIT, rules: sr({ url: JOBS_API + '/', method: 'PUT', action: 'respond', body: refuse('TEN_4004', '甲方没有有效的合作合同') }),
    steps: [`${findBtn('保存并提交审核', '#app .save-bar')}.click()`, wait(600), `${findBtn('保存并提交审核', '.el-message-box')}.click()`, elToastGone('甲方没有有效的合作合同')],
    checks: [boxWhy('保存并提交审核', '请先在「项目与甲方 → 合作合同」上传合同并等待平台审核通过'), whyStays('#app .save-bar .blocked-why', '请先在「项目与甲方 → 合作合同」上传合同')] },
  // 被驳回的岗位：不弹框，直接保存
  ...(rejectedJobId ? [
    { app: 'console', screen: 'pm-job-edit', state: 'direct-submitting', persona: 'pm', path: `/pm/jobs/edit?id=${rejectedJobId}`, rules: sr(), quick: true,
      steps: [countXhr, elClickTwice('保存并提交审核', '#app .save-bar')], checks: [elSpinning('保存并提交审核', '#app .save-bar'), sentOnce] },
    { app: 'console', screen: 'pm-job-edit', state: 'direct-rejected', persona: 'pm', path: `/pm/jobs/edit?id=${rejectedJobId}`,
      rules: sr({ url: JOBS_API + '/', method: 'PUT', action: 'respond', body: refuse('JOB_4091', '岗位状态已变化，请刷新后再操作') }),
      steps: [`${findBtn('保存并提交审核', '#app .save-bar')}.click()`, elToastGone('岗位状态已变化')],
      checks: [whyStays('#app .save-bar .blocked-why', '暂时不能保存：岗位状态已变化'), `${findBtn('保存并提交审核', '#app .save-bar')}.disabled ? '' : '被拒之后「保存并提交审核」没有置灰'`, elIdle] },
  ] : []),
  // ---- 工单 17：知识库 ----
  { app: 'console', screen: 'pm-kb', state: 'normal', persona: 'pm', path: '/pm/kb', rules: sr(), checks: [cSide('pm'), kpiCards, opsCol, tblFit, statTone, rowsTall, cLegacy16, noThrottleWord, opsTap, queryReset, hasPager] },
  { app: 'console', screen: 'pm-kb', state: 'normal', persona: 'pm', path: '/pm/kb', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, kpiCards, opsCol, tblFit] },
  { app: 'console', screen: 'pm-kb', state: 'pending', persona: 'pm', path: '/pm/kb?tab=pending', rules: sr(), checks: [opsCol, tblFit, rowsTall, chartColors('#app .track i'), cLegacy16, opsTap, hasPager] },
  { app: 'console', screen: 'pm-kb', state: 'pending', persona: 'pm', path: '/pm/kb?tab=pending', width: 1280, height: 800, rules: sr(), checks: [cFit, opsCol, tblFit] },
  { app: 'console', screen: 'pm-kb', state: 'loading', persona: 'pm', path: '/pm/kb', rules: sr({ url: KB_API, action: 'hang' }), quick: true, steps: [wait(600)],
    checks: [`document.querySelector('#app .el-table .el-loading-mask') ? '' : '加载中表格上没有加载遮罩'`, noNums, hasNot('暂无问答条目')] },
  { app: 'console', screen: 'pm-kb', state: 'empty', persona: 'pm', path: '/pm/kb', rules: sr({ url: KB_API, action: 'respond', body: reply([]) }), checks: [has('暂无问答条目'), allZero, cLegacy16] },
  { app: 'console', screen: 'pm-kb', state: 'pending-empty', persona: 'pm', path: '/pm/kb?tab=pending', rules: sr({ url: KB_PENDING_API, action: 'respond', body: reply([]) }), checks: [has('没有待补充的问题')] },
  { app: 'console', screen: 'pm-kb', state: 'error', persona: 'pm', path: '/pm/kb', rules: sr({ url: KB_API, action: 'fail' }), checks: [oneRetry, noNums, hasNot('暂无问答条目')] },
  { app: 'console', screen: 'pm-kb', state: 'submitting', persona: 'pm', path: '/pm/kb', rules: sr(), quick: true,
    steps: [...openJobRow('删除'), countXhr, boxClickTwice('删除')], checks: [elSpinning('删除', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-kb', state: 'rejected', persona: 'pm', path: '/pm/kb', rules: sr({ url: KB_API + '/', method: 'DELETE', action: 'respond', body: refuse('KB_4091', '条目已被他人修改') }),
    steps: [...openJobRow('删除'), `${findBtn('删除', '.el-message-box')}.click()`, elToastGone('条目已被他人修改')],
    checks: [...rowOff(KB_WHY, '删除'), boxWhy('删除', KB_WHY), elIdle] },
  { app: 'console', screen: 'pm-kb', state: 'ignore-rejected', persona: 'pm', path: '/pm/kb?tab=pending', rules: sr({ url: '/ignore', method: 'POST', action: 'respond', body: refuse('KB_4092', '问题已被处理') }),
    steps: [...openJobRow('忽略'), `${findBtn('忽略', '.el-message-box')}.click()`, elToastGone('问题已被处理')],
    checks: [...rowOff('暂时不能忽略：问题已被处理', '忽略'), boxWhy('忽略', '暂时不能忽略：问题已被处理'), elIdle] },
  { app: 'console', screen: 'pm-kb', state: 'edit-submitting', persona: 'pm', path: '/pm/kb', rules: sr(), quick: true,
    steps: [...openJobRow('编辑'), countXhr, elClickTwice('保存', '.el-dialog')], checks: [elSpinning('保存', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'pm-kb', state: 'edit-rejected', persona: 'pm', path: '/pm/kb', rules: sr({ url: KB_API + '/', method: 'PUT', action: 'respond', body: refuse('KB_4091', '条目已被他人修改') }),
    steps: [...openJobRow('编辑'), `${findBtn('保存', '.el-dialog')}.click()`, elToastGone('条目已被他人修改')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能保存：条目已被他人修改'), `${findBtn('保存', '.el-dialog')}.disabled ? '' : '被拒之后弹窗里的「保存」没有置灰'`, elIdle] },
  // ---- 工单 18：人员管理（第 2 类）----
  { app: 'console', screen: 'pm-staff', state: 'normal', persona: 'pm', path: '/pm/staff', rules: sr(), checks: [cSide('pm'), kpiCards, opsCol, tblFit, statTone, rowsTall, cLegacy16, noThrottleWord, opsTap, queryReset, hasPager, statusTags] },
  { app: 'console', screen: 'pm-staff', state: 'normal', persona: 'pm', path: '/pm/staff', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, sideActive, kpiCards, opsCol, tblFit] },
  { app: 'console', screen: 'pm-staff', state: 'left', persona: 'pm', path: '/pm/staff', rules: sr(), steps: [`[...document.querySelectorAll('#app .filter-tabs button')].find((b) => b.innerText.includes('已离职')).click()`, wait(600)],
    checks: [opsCol, tblFit, statusTags, has('缺勤记录')] },
  { app: 'console', screen: 'pm-staff', state: 'loading', persona: 'pm', path: '/pm/staff', rules: sr({ url: EMP_API, action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, noNums, tabsBlank, hasNot('暂无人员')] },
  { app: 'console', screen: 'pm-staff', state: 'empty', persona: 'pm', path: '/pm/staff', rules: sr({ url: EMP_API, action: 'respond', body: emptyPage }), checks: [has('暂无人员'), allZero, cLegacy16] },
  { app: 'console', screen: 'pm-staff', state: 'error', persona: 'pm', path: '/pm/staff', rules: sr({ url: EMP_API, action: 'fail' }), checks: [oneRetry, noNums, tabsBlank, hasNot('暂无人员')] },
  // 请假 / 旷工弹窗：标记在弹窗里提交；撤销在确认框里提交
  { app: 'console', screen: 'staff-absence', state: 'normal', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('respond', fakeAbs)), steps: openStaff('请假/旷工'),
    checks: [dlgLegacy, `document.querySelector('.el-dialog .rec-sum')?.innerText.includes('请假 1 天 · 旷工 1 天') ? '' : '没写本月请假 / 旷工天数'`] },
  { app: 'console', screen: 'staff-absence', state: 'loading', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('hang')), quick: true,
    // 点开和等待放在同一步：分成两步时中间的 settle 会等挂住的请求满 10 秒，接口超时后截到的是失败
    steps: [`(async () => { ${findBtn('请假/旷工', '#app .el-table__body')}.click(); await ${wait(900)} })()`],
    checks: [`document.querySelector('.el-dialog .el-loading-mask') ? '' : '记录加载中没有加载遮罩'`, `document.querySelector('.el-dialog .rec-sum') ? '没拿到记录却显示了天数' : ''`, `document.querySelector('.el-dialog').innerText.includes('没有缺勤记录') ? '加载中就说没有记录' : ''`] },
  { app: 'console', screen: 'staff-absence', state: 'empty', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('respond', reply([]))), steps: openStaff('请假/旷工'),
    checks: [`document.querySelector('.el-dialog').innerText.includes('没有缺勤记录') ? '' : '空记录没写明'`] },
  { app: 'console', screen: 'staff-absence', state: 'error', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('fail')), steps: openStaff('请假/旷工'),
    checks: [`${findBtn('重新加载', '.el-dialog')} ? '' : '记录加载失败没有「重新加载」'`, `document.querySelector('.el-dialog .rec-sum') ? '没拿到记录却显示了天数' : ''`, `document.querySelector('.el-dialog').innerText.includes('没有缺勤记录') ? '失败说成没有记录' : ''`] },
  { app: 'console', screen: 'staff-absence', state: 'submitting', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('respond', fakeAbs)), quick: true,
    steps: [...openStaff('请假/旷工'), countXhr, elClickTwice('标记', '.el-dialog .mark-row')], checks: [elSpinning('标记', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'staff-absence', state: 'rejected', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('respond', fakeAbs), { url: ABS_API, method: 'PUT', action: 'respond', body: refuse('EMP_4090', '该日期不在任职期内') }),
    steps: [...openStaff('请假/旷工'), `${findBtn('标记', '.el-dialog .mark-row')}.click()`, elToastGone('该日期不在任职期内')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能标记：该日期不在任职期内'), dlgOff('标记'), dlgIdle] },
  { app: 'console', screen: 'staff-absence', state: 'revoke-submitting', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('respond', fakeAbs)), quick: true,
    steps: [...openStaff('请假/旷工'), `${findBtn('撤销', '.el-dialog .el-table__body')}.click()`, wait(400), countXhr, boxClickTwice('撤销')], checks: [elSpinning('撤销', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'staff-absence', state: 'revoke-rejected', persona: 'pm', path: '/pm/staff', rules: sr(absGetR('respond', fakeAbs), { url: ABS_API, method: 'PUT', action: 'respond', body: refuse('EMP_4091', '工资已核算，不能撤销') }),
    steps: [...openStaff('请假/旷工'), `${findBtn('撤销', '.el-dialog .el-table__body')}.click()`, wait(400), `${findBtn('撤销', '.el-message-box')}.click()`, elToastGone('工资已核算，不能撤销')],
    checks: [boxTitle, boxWhy('撤销', '暂时不能撤销：工资已核算'), whyStays('.el-dialog .rec-why', '暂时不能撤销：工资已核算'), onlyOff('.el-dialog td.ops-col', '撤销'), dlgIdle] },
  // 发起离职弹窗
  { app: 'console', screen: 'staff-resign', state: 'normal', persona: 'pm', path: '/pm/staff', rules: sr(), steps: openStaff('离职'), checks: [dlgLegacy, dlgNoWrap] },
  { app: 'console', screen: 'staff-resign', state: 'submitting', persona: 'pm', path: '/pm/staff', rules: sr(), quick: true,
    steps: [...openStaff('离职'), ...pickOpt(0), countXhr, elClickTwice('提交审核', '.el-dialog')], checks: [elSpinning('提交审核', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'staff-resign', state: 'rejected', persona: 'pm', path: '/pm/staff', rules: sr({ url: '/resign', method: 'POST', action: 'respond', body: refuse('RESIGN_4090', '该员工已有待审核的离职申请') }),
    steps: [...openStaff('离职'), ...pickOpt(0), `${findBtn('提交审核', '.el-dialog')}.click()`, elToastGone('该员工已有待审核的离职申请')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能提交离职申请：该员工已有待审核的离职申请'), dlgOff('提交审核'), dlgIdle] },
  // 内部调岗弹窗：选好岗位后在确认框里提交
  { app: 'console', screen: 'staff-transfer', state: 'normal', persona: 'pm', path: '/pm/staff', rules: sr(), steps: [...openStaff('调岗'), ...pickOpt(1, '成品仓储分拣员')], checks: [dlgLegacy, dlgNoWrap] },
  { app: 'console', screen: 'staff-transfer', state: 'submitting', persona: 'pm', path: '/pm/staff', rules: sr(), quick: true,
    steps: [...openStaff('调岗'), ...pickOpt(1, '成品仓储分拣员'), `${findBtn('确认调岗', '.el-dialog')}.click()`, wait(400), countXhr, boxClickTwice('确认调岗')], checks: [elSpinning('确认调岗', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'staff-transfer', state: 'rejected', persona: 'pm', path: '/pm/staff', rules: sr({ url: '/transfer', method: 'POST', action: 'respond', body: refuse('EMP_4093', '目标岗位已停止招聘') }),
    steps: [...openStaff('调岗'), ...pickOpt(1, '成品仓储分拣员'), `${findBtn('确认调岗', '.el-dialog')}.click()`, wait(400), `${findBtn('确认调岗', '.el-message-box')}.click()`, elToastGone('目标岗位已停止招聘')],
    checks: [boxTitle, boxWhy('确认调岗', '暂时不能调岗：目标岗位已停止招聘'), whyStays('.el-dialog .blocked-why', '暂时不能调岗：目标岗位已停止招聘'), dlgOff('确认调岗'), dlgIdle] },
  // ---- 工单 18：离职审核（第 8 类：表格操作列里驳回在左、通过在右）----
  { app: 'console', screen: 'pm-resign', state: 'normal', persona: 'pm', path: '/pm/resign', rules: sr(), checks: [cSide('pm'), reviewOps, tblFit, opsTap, rowsTall, cLegacy16, noThrottleWord, hasPager] },
  { app: 'console', screen: 'pm-resign', state: 'normal', persona: 'pm', path: '/pm/resign', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, sideActive, reviewOps, tblFit] },
  { app: 'console', screen: 'pm-resign', state: 'approved', persona: 'pm', path: '/pm/resign', rules: sr(), steps: [`[...document.querySelectorAll('#app .filter-tabs button')].find((b) => b.innerText.includes('已通过')).click()`, wait(600)],
    checks: [tblFit, rowsTall, cLegacy16, `[...document.querySelectorAll('#app .el-table__header th')].some((th) => th.innerText.trim() === '操作') ? '已通过页签不该有操作列' : ''`] },
  { app: 'console', screen: 'pm-resign', state: 'loading', persona: 'pm', path: '/pm/resign', rules: sr({ url: RESIGN_API, action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, tabsBlank, hasNot('没有待审核的离职申请')] },
  { app: 'console', screen: 'pm-resign', state: 'empty', persona: 'pm', path: '/pm/resign', rules: sr({ url: RESIGN_API, action: 'respond', body: reply([]) }), checks: [has('没有待审核的离职申请'), allZero, cLegacy16] },
  { app: 'console', screen: 'pm-resign', state: 'error', persona: 'pm', path: '/pm/resign', rules: sr({ url: RESIGN_API, action: 'fail' }), checks: [oneRetry, tabsBlank, hasNot('没有待审核的离职申请')] },
  { app: 'console', screen: 'pm-resign', state: 'submitting', persona: 'pm', path: '/pm/resign', rules: sr(), quick: true,
    steps: [...openJobRow('确认离职'), countXhr, boxClickTwice('确认离职')], checks: [elSpinning('确认离职', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-resign', state: 'rejected', persona: 'pm', path: '/pm/resign', rules: sr({ url: '/decide', method: 'POST', action: 'respond', body: resignRefused }),
    steps: [...openJobRow('确认离职'), `${findBtn('确认离职', '.el-message-box')}.click()`, elToastGone(RESIGN_WHY)],
    checks: [boxTitle, has('「徐**」暂时不能确认离职'), hasNot('请刷新后再操作。刷新后重新判断'), ...rowOff('暂时不能确认离职：' + RESIGN_WHY, '确认离职'), boxWhy('确认离职', '暂时不能确认离职：' + RESIGN_WHY), elIdle] },
  { app: 'console', screen: 'pm-resign', state: 'reject-box', persona: 'pm', path: '/pm/resign', rules: sr(), steps: openJobRow('驳回'), checks: [boxReject, boxTitle] },
  { app: 'console', screen: 'pm-resign', state: 'reject-submitting', persona: 'pm', path: '/pm/resign', rules: sr(), quick: true,
    steps: [...openJobRow('驳回'), fillBox('员工已同意继续上班'), countXhr, boxClickTwice('驳回')], checks: [elSpinning('驳回', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-resign', state: 'reject-rejected', persona: 'pm', path: '/pm/resign', rules: sr({ url: '/decide', method: 'POST', action: 'respond', body: resignRefused }),
    steps: [...openJobRow('驳回'), fillBox('员工已同意继续上班'), `${findBtn('驳回', '.el-message-box')}.click()`, elToastGone(RESIGN_WHY)],
    checks: [has('「徐**」暂时不能驳回'), hasNot('请刷新后再操作。刷新后重新判断'), ...rowOff('暂时不能驳回：' + RESIGN_WHY, '驳回'), boxWhy('驳回', '暂时不能驳回：' + RESIGN_WHY), elIdle] },
  { app: 'console', screen: 'pm-resign', state: 'network', persona: 'pm', path: '/pm/resign', rules: sr({ url: '/decide', method: 'POST', action: 'fail' }),
    steps: [...openJobRow('确认离职'), `${findBtn('确认离职', '.el-message-box')}.click()`, toastShown],
    checks: [`document.querySelector('#app .blocked-why, .msgbox-why') ? '网络失败也把原因当成被拒留下了' : ''`, `${findBtn('确认离职', '.el-message-box')}?.disabled === false ? '' : '网络失败后确认框关了或确认按钮被置灰'`] },
  // ---- 工单 18：花名册导入（第 16 类）----
  { app: 'console', screen: 'pm-roster', state: 'normal', persona: 'pm', path: '/pm/roster', rules: sr(), checks: [cSide('pm'), importLayout, tblFit, opsTap, cLegacy16, noThrottleWord] },
  { app: 'console', screen: 'pm-roster', state: 'normal', persona: 'pm', path: '/pm/roster', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFitAny, sideActive, importLayout, tblFit] },
  { app: 'console', screen: 'pm-roster', state: 'loading', persona: 'pm', path: '/pm/roster', rules: sr({ url: ROSTER_BATCHES_API, action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, hasNot('暂无导入记录')] },
  { app: 'console', screen: 'pm-roster', state: 'empty', persona: 'pm', path: '/pm/roster', rules: sr({ url: ROSTER_BATCHES_API, action: 'respond', body: reply([]) }), checks: [has('暂无导入记录'), cLegacy16] },
  { app: 'console', screen: 'pm-roster', state: 'error', persona: 'pm', path: '/pm/roster', rules: sr({ url: ROSTER_BATCHES_API, action: 'fail' }), checks: [oneRetry, hasNot('暂无导入记录')] },
  { app: 'console', screen: 'pm-roster', state: 'picked', persona: 'pm', path: '/pm/roster', rules: sr(), steps: [pickXlsx, wait(300)],
    checks: [nameOnce('十一月花名册.xlsx'), `${findBtn('开始导入')}.disabled ? '选了文件「开始导入」还是灰的' : ''`] },
  { app: 'console', screen: 'pm-roster', state: 'submitting', persona: 'pm', path: '/pm/roster', rules: sr(), quick: true,
    steps: [...startImport, countXhr, boxClickTwice('开始导入')], checks: [elSpinning('开始导入', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-roster', state: 'result', persona: 'pm', path: '/pm/roster', rules: sr({ url: ROSTER_IMPORT_API, method: 'POST', action: 'respond', body: fakeRoster }),
    steps: [...startImport, `${findBtn('开始导入', '.el-message-box')}.click()`, wait(800), scrollStart('#app .result')],
    checks: [importLayout, rosterRows, tblFit, cLegacy16, has('下载失败行')] },
  { app: 'console', screen: 'pm-roster', state: 'result', persona: 'pm', path: '/pm/roster', width: 1280, height: 800, rules: sr({ url: ROSTER_IMPORT_API, method: 'POST', action: 'respond', body: fakeRoster }),
    steps: [...startImport, `${findBtn('开始导入', '.el-message-box')}.click()`, wait(800), scrollStart('#app .result')], checks: [cFitAny, importLayout, rosterRows, tblFit] },
  { app: 'console', screen: 'pm-roster', state: 'all-ok', persona: 'pm', path: '/pm/roster', rules: sr({ url: ROSTER_IMPORT_API, method: 'POST', action: 'respond', body: fakeRosterOk }),
    steps: [...startImport, `${findBtn('开始导入', '.el-message-box')}.click()`, wait(800), scrollStart('#app .result')], checks: [has('全部导入成功。'), importLayout] },
  { app: 'console', screen: 'pm-roster', state: 'rejected', persona: 'pm', path: '/pm/roster', rules: sr({ url: ROSTER_IMPORT_API, method: 'POST', action: 'respond', body: refuse('ROSTER_4001', '表头与模板不一致，请下载最新模板') }),
    steps: [...startImport, `${findBtn('开始导入', '.el-message-box')}.click()`, elToastGone('表头与模板不一致')],
    checks: [boxTitle, boxWhy('开始导入', '暂时不能导入：表头与模板不一致'), whyStays('#app .up-why', '暂时不能导入：表头与模板不一致'), `${findBtn('开始导入')}.disabled ? '' : '被拒之后页面上的「开始导入」没有置灰'`, elIdle] },
  // ---- 工单 18：工伤上报（第 2 类）----
  { app: 'console', screen: 'pm-incidents', state: 'normal', persona: 'pm', path: '/pm/incidents', rules: sr(), checks: [cSide('pm'), opsCol, tblFit, opsTap, rowsTall, cLegacy16, noThrottleWord, hasPager, elPrimary, statusTags] },
  { app: 'console', screen: 'pm-incidents', state: 'normal', persona: 'pm', path: '/pm/incidents', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, sideActive, opsCol, tblFit] },
  { app: 'console', screen: 'pm-incidents', state: 'all', persona: 'pm', path: '/pm/incidents', rules: sr(), steps: [`[...document.querySelectorAll('#app .filter-tabs button')].find((b) => b.innerText.includes('全部')).click()`, wait(600)],
    checks: [opsCol, tblFit, rowsTall, statusTags, has('处理结论')] },
  { app: 'console', screen: 'pm-incidents', state: 'loading', persona: 'pm', path: '/pm/incidents', rules: sr({ url: INC_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, hasNot('没有处理中的工伤')] },
  { app: 'console', screen: 'pm-incidents', state: 'empty', persona: 'pm', path: '/pm/incidents', rules: sr({ url: INC_API, method: 'GET', action: 'respond', body: reply([]) }), checks: [has('没有处理中的工伤'), cLegacy16] },
  { app: 'console', screen: 'pm-incidents', state: 'error', persona: 'pm', path: '/pm/incidents', rules: sr({ url: INC_API, method: 'GET', action: 'fail' }), checks: [oneRetry, hasNot('没有处理中的工伤')] },
  { app: 'console', screen: 'pm-incidents', state: 'report', persona: 'pm', path: '/pm/incidents', rules: sr(), steps: [`${findBtn('上报工伤')}.click()`, wait(500)], checks: [dlgLegacy] },
  { app: 'console', screen: 'pm-incidents', state: 'report-submitting', persona: 'pm', path: '/pm/incidents', rules: sr(), quick: true,
    steps: [`${findBtn('上报工伤')}.click()`, wait(500), fillDlg('input[placeholder="姓名"]', '陈立新'), fillDlg('textarea[placeholder*="哪里"]', '二号线搬运料箱时扭伤腰部，已送厂医务室'), countXhr, elClickTwice('立即上报', '.el-dialog')],
    checks: [elSpinning('立即上报', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'pm-incidents', state: 'report-rejected', persona: 'pm', path: '/pm/incidents', rules: sr({ url: INC_API, method: 'POST', action: 'respond', body: refuse('INC_4001', '该项目已结束，不能再上报') }),
    steps: [`${findBtn('上报工伤')}.click()`, wait(500), fillDlg('input[placeholder="姓名"]', '陈立新'), fillDlg('textarea[placeholder*="哪里"]', '二号线搬运料箱时扭伤腰部，已送厂医务室'), `${findBtn('立即上报', '.el-dialog')}.click()`, elToastGone('该项目已结束')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能上报：该项目已结束'), dlgOff('立即上报'), dlgIdle] },
  { app: 'console', screen: 'pm-incidents', state: 'close-submitting', persona: 'pm', path: '/pm/incidents', rules: sr(), quick: true,
    steps: [...openJobRow('结案'), fillDlg('textarea[placeholder*="救治"]', '包扎后当天复工，未申报工伤认定'), countXhr, elClickTwice('结案', '.el-dialog__footer')], checks: [elSpinning('结案', '.el-dialog'), sentOnce, `[...document.querySelectorAll('.el-dialog .el-form-item__label')].some((l) => l.getClientRects().length && l.innerText.includes('处理结论')) ? '' : '处理结论输入框没有可见标签'`] },
  { app: 'console', screen: 'pm-incidents', state: 'close-rejected', persona: 'pm', path: '/pm/incidents', rules: sr({ url: '/close', method: 'POST', action: 'respond', body: refuse('INC_4091', '该工伤已结案') }),
    steps: [...openJobRow('结案'), fillDlg('textarea[placeholder*="救治"]', '包扎后当天复工，未申报工伤认定'), `${findBtn('结案', '.el-dialog__footer')}.click()`, elToastGone('该工伤已结案')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能结案：该工伤已结案'), dlgOff('结案'), dlgIdle] },
  // ---- 工单 19：预支审批（第 8 类：表格操作列里驳回在左、终审通过在右，驳回原因在确认框里填）----
  { app: 'console', screen: 'pm-advance', state: 'normal', persona: 'pm', path: '/pm/advance', rules: sr(),
    checks: [cSide('pm'), kpiCards, reviewOpsFor('终审通过'), chainOneLine, tblFit, opsTap, rowsTall, statTone, cLegacy16, noThrottleWord, queryReset, hasPager, cMoney('#app .tbl-card')] },
  { app: 'console', screen: 'pm-advance', state: 'normal', persona: 'pm', path: '/pm/advance', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, sideActive, kpiCards, reviewOpsFor('终审通过'), chainOneLine, tblFit, noWrap('#app .person b')] },
  { app: 'console', screen: 'pm-advance', state: 'all', persona: 'pm', path: '/pm/advance?tab=all', rules: sr({ url: TADV_API, method: 'GET', action: 'respond', body: fakeTAdvs }),
    checks: [reviewOpsFor('终审通过'), chainOneLine, tblFit, opsTap, rowsTall, cLegacy16, cMoney('#app .tbl-card'), has('登记拨款'), has('已驳回')] },
  { app: 'console', screen: 'pm-advance', state: 'all', persona: 'pm', path: '/pm/advance?tab=all', width: 1280, height: 800, rules: sr({ url: TADV_API, method: 'GET', action: 'respond', body: fakeTAdvs }), checks: [cFit, chainOneLine, tblFit, noWrap('#app .person b')] },
  { app: 'console', screen: 'pm-advance', state: 'loading', persona: 'pm', path: '/pm/advance', rules: sr({ url: TADV_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, noNums, hasNot('暂无需要你处理的预支申请')] },
  { app: 'console', screen: 'pm-advance', state: 'empty', persona: 'pm', path: '/pm/advance', rules: sr({ url: TADV_API, method: 'GET', action: 'respond', body: reply([]) }), checks: [has('暂无需要你处理的预支申请'), allZero, cLegacy16] },
  { app: 'console', screen: 'pm-advance', state: 'error', persona: 'pm', path: '/pm/advance', rules: sr({ url: TADV_API, method: 'GET', action: 'fail' }), checks: [oneRetry, noNums, hasNot('暂无需要你处理的预支申请')] },
  { app: 'console', screen: 'pm-advance', state: 'submitting', persona: 'pm', path: '/pm/advance', rules: sr(), quick: true,
    steps: [...openJobRow('终审通过'), countXhr, boxClickTwice('终审通过')], checks: [elSpinning('终审通过', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-advance', state: 'rejected', persona: 'pm', path: '/pm/advance', rules: sr({ url: '/pm-review', method: 'POST', action: 'respond', body: advRefused }),
    steps: [...openJobRow('终审通过'), `${findBtn('终审通过', '.el-message-box')}.click()`, elToastGone(ADV_WHY)],
    checks: [boxTitle, has('暂时不能终审通过'), hasNot('请刷新后再操作。刷新后重新判断'), ...rowOff('暂时不能终审通过：' + ADV_WHY, '终审通过'), boxWhy('终审通过', '暂时不能终审通过：' + ADV_WHY), elIdle] },
  { app: 'console', screen: 'pm-advance', state: 'reject-box', persona: 'pm', path: '/pm/advance', rules: sr(), steps: openJobRow('驳回'), checks: [boxReject, boxTitle, boxInput] },
  { app: 'console', screen: 'pm-advance', state: 'reject-submitting', persona: 'pm', path: '/pm/advance', rules: sr(), quick: true,
    steps: [...openJobRow('驳回'), fillBox('本月已预支过一次，请下月再申请'), countXhr, boxClickTwice('确认驳回')], checks: [elSpinning('确认驳回', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'pm-advance', state: 'reject-rejected', persona: 'pm', path: '/pm/advance', rules: sr({ url: '/pm-review', method: 'POST', action: 'respond', body: advRefused }),
    steps: [...openJobRow('驳回'), fillBox('本月已预支过一次，请下月再申请'), `${findBtn('确认驳回', '.el-message-box')}.click()`, elToastGone(ADV_WHY)],
    checks: [...rowOff('暂时不能驳回：' + ADV_WHY, '驳回'), boxWhy('确认驳回', '暂时不能驳回：' + ADV_WHY), elIdle] },
  { app: 'console', screen: 'pm-advance', state: 'network', persona: 'pm', path: '/pm/advance', rules: sr({ url: '/pm-review', method: 'POST', action: 'fail' }),
    steps: [...openJobRow('终审通过'), `${findBtn('终审通过', '.el-message-box')}.click()`, toastShown],
    checks: [`document.querySelector('#app .blocked-why, .msgbox-why') ? '网络失败也把原因当成被拒留下了' : ''`, `${findBtn('终审通过', '.el-message-box')}?.disabled === false ? '' : '网络失败后确认框关了或确认按钮被置灰'`] },
  { app: 'console', screen: 'pm-advance', state: 'payout-box', persona: 'pm', path: '/pm/advance?tab=all', rules: sr({ url: TADV_API, method: 'GET', action: 'respond', body: fakeTAdvs }),
    steps: openJobRow('登记拨款'), checks: [boxTitle, `${findBtn('已转账，登记拨款', '.el-message-box')} ? '' : '确认框里没有「已转账，登记拨款」'`] },
  // ---- 工单 19：工资表导入（第 16 类，同花名册导入）----
  { app: 'console', screen: 'payroll-batches', state: 'normal', persona: 'pm', path: '/payroll/batches', rules: sr(), checks: [cSide('pm'), importLayout, tplBtn, tblFit, cLegacy16, noThrottleWord, cMoney('#app .tbl-card')] },
  { app: 'console', screen: 'payroll-batches', state: 'normal', persona: 'pm', path: '/payroll/batches', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFitAny, sideActive, importLayout, tblFit] },
  { app: 'console', screen: 'payroll-batches', state: 'loading', persona: 'pm', path: '/payroll/batches', rules: sr({ url: PB_API, action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, hasNot('暂无导入记录')] },
  { app: 'console', screen: 'payroll-batches', state: 'empty', persona: 'pm', path: '/payroll/batches', rules: sr({ url: PB_API, action: 'respond', body: reply([]) }), steps: [scrollStart('#app .tbl-card')], checks: [has('暂无导入记录'), cLegacy16] },
  { app: 'console', screen: 'payroll-batches', state: 'error', persona: 'pm', path: '/payroll/batches', rules: sr({ url: PB_API, action: 'fail' }), steps: [scrollStart('#app .tbl-card')], checks: [oneRetry, hasNot('暂无导入记录')] },
  { app: 'console', screen: 'payroll-batches', state: 'picked', persona: 'pm', path: '/payroll/batches', rules: sr(), steps: [pickPay, wait(300)],
    checks: [nameOnce('十月工资表.xlsx'), `${findBtn('开始导入')}.disabled ? '选了文件「开始导入」还是灰的' : ''`] },
  { app: 'console', screen: 'payroll-batches', state: 'submitting', persona: 'pm', path: '/payroll/batches', rules: sr(), quick: true,
    steps: [...startPay, countXhr, boxClickTwice('开始导入')], checks: [boxTitle, elSpinning('开始导入', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'payroll-batches', state: 'result', persona: 'pm', path: '/payroll/batches', rules: sr({ url: PIMPORT_API, method: 'POST', action: 'respond', body: fakePayroll }),
    steps: [...startPay, `${findBtn('开始导入', '.el-message-box')}.click()`, wait(800), scrollStart('#app .result')],
    checks: [importLayout, rosterRows, tblFit, cLegacy16, cMoney('#app .result'), sumPlain, has('下载失败行'), has('只保留失败行')] },
  { app: 'console', screen: 'payroll-batches', state: 'result', persona: 'pm', path: '/payroll/batches', width: 1280, height: 800, rules: sr({ url: PIMPORT_API, method: 'POST', action: 'respond', body: fakePayroll }),
    steps: [...startPay, `${findBtn('开始导入', '.el-message-box')}.click()`, wait(800), scrollStart('#app .result')], checks: [cFitAny, importLayout, rosterRows, tblFit] },
  { app: 'console', screen: 'payroll-batches', state: 'all-ok', persona: 'pm', path: '/payroll/batches', rules: sr({ url: PIMPORT_API, method: 'POST', action: 'respond', body: fakePayrollOk }),
    steps: [...startPay, `${findBtn('开始导入', '.el-message-box')}.click()`, wait(800), scrollStart('#app .result')], checks: [has('全部导入成功'), importLayout] },
  { app: 'console', screen: 'payroll-batches', state: 'rejected', persona: 'pm', path: '/payroll/batches', rules: sr({ url: PIMPORT_API, method: 'POST', action: 'respond', body: refuse('SYS_4000', '无法读取工资表，请检查格式（第一行为表头）') }),
    steps: [...startPay, `${findBtn('开始导入', '.el-message-box')}.click()`, elToastGone('无法读取工资表')],
    checks: [boxTitle, boxWhy('开始导入', '暂时不能导入：无法读取工资表'), whyStays('#app .up-why', '暂时不能导入：无法读取工资表'), `${findBtn('开始导入')}.disabled ? '' : '被拒之后页面上的「开始导入」没有置灰'`, elIdle] },
  // ---- 工单 19：工资申诉（第 8 类：表格「处理」打开弹窗，弹窗里填说明，不受理在左、受理并回复在右）----
  { app: 'console', screen: 'payroll-appeals', state: 'normal', persona: 'pm', path: '/payroll/appeals', rules: sr(),
    checks: [cSide('pm'), opsCol, tblFit, opsTap, rowsTall, statusTags, cLegacy16, noThrottleWord, hasPager, cMoney('#app .tbl-card')] },
  { app: 'console', screen: 'payroll-appeals', state: 'normal', persona: 'pm', path: '/payroll/appeals', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, sideActive, opsCol, tblFit] },
  { app: 'console', screen: 'payroll-appeals', state: 'all', persona: 'pm', path: '/payroll/appeals', rules: sr(), steps: [`[...document.querySelectorAll('#app .filter-tabs button')].find((b) => b.innerText.includes('全部')).click()`, wait(600)],
    checks: [opsCol, tblFit, rowsTall, statusTags, has('处理说明')] },
  { app: 'console', screen: 'payroll-appeals', state: 'loading', persona: 'pm', path: '/payroll/appeals', rules: sr({ url: APPEAL_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, refreshBusy, hasNot('没有待处理的工资申诉')] },
  { app: 'console', screen: 'payroll-appeals', state: 'empty', persona: 'pm', path: '/payroll/appeals', rules: sr({ url: APPEAL_API, method: 'GET', action: 'respond', body: reply([]) }), checks: [has('没有待处理的工资申诉'), cLegacy16] },
  { app: 'console', screen: 'payroll-appeals', state: 'error', persona: 'pm', path: '/payroll/appeals', rules: sr({ url: APPEAL_API, method: 'GET', action: 'fail' }), checks: [oneRetry, hasNot('没有待处理的工资申诉')] },
  { app: 'console', screen: 'payroll-appeals', state: 'handle', persona: 'pm', path: '/payroll/appeals', rules: sr(), steps: openJobRow('处理'), checks: [dlgReview, dlgLegacy, dlgNoWrap, cMoney('.el-dialog'), `document.querySelector('.el-dialog .slip').innerText.includes('扣款合计') ? '' : '扣款块没有「扣款合计」'`] },
  { app: 'console', screen: 'payroll-appeals', state: 'submitting', persona: 'pm', path: '/payroll/appeals', rules: sr(), quick: true,
    steps: [...openJobRow('处理'), fillReply, countXhr, elClickTwice('受理并回复', '.el-dialog')], checks: [elSpinning('受理并回复', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'payroll-appeals', state: 'rejected', persona: 'pm', path: '/payroll/appeals', rules: sr({ url: '/handle', method: 'POST', action: 'respond', body: refuse('APPEAL_4091', APPEAL_WHY) }),
    steps: [...openJobRow('处理'), fillReply, `${findBtn('受理并回复', '.el-dialog')}.click()`, elToastGone(APPEAL_WHY)],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能受理：' + APPEAL_WHY), whyStays('#app .tbl-tip', '暂时不能受理：' + APPEAL_WHY), dlgOff('受理并回复'),
      `${findBtn('不受理', '.el-dialog')}.disabled ? '被拒的是受理，「不受理」也被置灰了' : ''`, dlgIdle] },
  { app: 'console', screen: 'payroll-appeals', state: 'reject-rejected', persona: 'pm', path: '/payroll/appeals', rules: sr({ url: '/handle', method: 'POST', action: 'respond', body: refuse('APPEAL_4091', APPEAL_WHY) }),
    steps: [...openJobRow('处理'), fillReply, `${findBtn('不受理', '.el-dialog')}.click()`, elToastGone(APPEAL_WHY)],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能标记不受理：' + APPEAL_WHY), hasNot('不能不受理'), dlgOff('不受理'), dlgIdle] },
  { app: 'console', screen: 'payroll-appeals', state: 'network', persona: 'pm', path: '/payroll/appeals', rules: sr({ url: '/handle', method: 'POST', action: 'fail' }),
    steps: [...openJobRow('处理'), fillReply, `${findBtn('受理并回复', '.el-dialog')}.click()`, toastShown],
    checks: [`document.querySelector('#app .blocked-why, .el-dialog .blocked-why') ? '网络失败也把原因当成被拒留下了' : ''`, `${findBtn('受理并回复', '.el-dialog')}?.disabled === false ? '' : '网络失败后弹窗关了或按钮被置灰'`] },
  // ---- 工单 19：预支抵扣对账（第 9 类：汇总卡 → 明细表，金额等宽右对齐）。演示库 10 月没有抵扣，正常状态用后端形状的假数据 ----
  { app: 'console', screen: 'payroll-recon', state: 'normal', persona: 'pm', path: '/payroll/recon', rules: sr({ url: RECON_API, action: 'respond', body: fakeRecon }),
    checks: [cSide('pm'), kpiCards, tblFit, statTone, rowsTall, cLegacy16, noThrottleWord, cMoney(), moneyAligned()] },
  { app: 'console', screen: 'payroll-recon', state: 'normal', persona: 'pm', path: '/payroll/recon', width: 1280, height: 800, rules: sr({ url: RECON_API, action: 'respond', body: fakeRecon }),
    checks: [cSide('pm'), cFitAny, sideActive, kpiCards, tblFit, cMoney(), moneyAligned()] },
  { app: 'console', screen: 'payroll-recon', state: 'live', persona: 'pm', path: '/payroll/recon', rules: sr(), checks: [has('这个月没有工资抵扣'), tblFit, cMoney(), moneyAligned()] },
  { app: 'console', screen: 'payroll-recon', state: 'loading', persona: 'pm', path: '/payroll/recon', rules: sr({ url: RECON_API, action: 'hang' }), quick: true, steps: [wait(600)],
    checks: [loadMask, noNums, refreshBusy, switchBlank, hasNot('这个月没有工资抵扣'), hasNot('没有未还清的预支')] },
  { app: 'console', screen: 'payroll-recon', state: 'empty', persona: 'pm', path: '/payroll/recon', rules: sr({ url: RECON_API, action: 'respond', body: emptyRecon }),
    checks: [has('这个月没有工资抵扣'), has('没有未还清的预支'), reconZero, statTone, cLegacy16] },
  { app: 'console', screen: 'payroll-recon', state: 'error', persona: 'pm', path: '/payroll/recon', rules: sr({ url: RECON_API, action: 'fail' }),
    checks: [oneRetry, noNums, switchBlank, hasNot('这个月没有工资抵扣'), hasNot('没有未还清的预支')] },
  // 切换月份：接口挂住时月份框保留新选的月份，标题、数字、结论都不显示；失败时同样保留月份、给「重新加载」
  { app: 'console', screen: 'payroll-recon', state: 'switch-loading', persona: 'pm', path: '/payroll/recon', rules: sr({ url: RECON_API, action: 'respond', body: fakeRecon }),
    lateRules: [{ url: RECON_API, action: 'hang' }], quick: true, steps: [...pickMonth('2026-09'), wait(600)], checks: [loadMask, monthKept('2026-09'), noNums, switchBlank, refreshBusy] },
  { app: 'console', screen: 'payroll-recon', state: 'switch-error', persona: 'pm', path: '/payroll/recon', rules: sr({ url: RECON_API, action: 'respond', body: fakeRecon }),
    lateRules: [{ url: RECON_API, action: 'fail' }], steps: pickMonth('2026-09'), checks: [oneRetry, monthKept('2026-09'), noNums, switchBlank] },
  // ---- 工单 20：项目与甲方（第 11 类：页面头 → 标签页 → 白卡片表格；新增按钮在页面头）----
  { app: 'console', screen: 'settings-projects', state: 'normal', persona: 'pm', path: '/settings/projects', rules: sr(),
    checks: [cSide('pm'), setLayout('新建项目', true), opsCol, tblFit, opsTap, rowsTall, cLegacy16, queryReset, hasPager, statusTags, elPrimary] },
  { app: 'console', screen: 'settings-projects', state: 'normal', persona: 'pm', path: '/settings/projects', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFit, sideActive, opsCol, tblFit] },
  { app: 'console', screen: 'settings-projects', state: 'loading', persona: 'pm', path: '/settings/projects', rules: sr({ url: PROJ_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, hasNot('暂无项目')] },
  { app: 'console', screen: 'settings-projects', state: 'empty', persona: 'pm', path: '/settings/projects', rules: sr({ url: PROJ_API, method: 'GET', action: 'respond', body: reply([]) }), checks: [has('暂无项目'), cLegacy16] },
  { app: 'console', screen: 'settings-projects', state: 'error', persona: 'pm', path: '/settings/projects', rules: sr({ url: PROJ_API, method: 'GET', action: 'fail' }), checks: [oneRetry, hasNot('暂无项目')] },
  // 结束项目：在确认框里提交
  { app: 'console', screen: 'settings-projects', state: 'close-submitting', persona: 'pm', path: '/settings/projects', rules: sr(), quick: true,
    steps: [...openRow('结束'), countXhr, boxClickTwice('结束项目')], checks: [boxTitle, elSpinning('结束项目', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'settings-projects', state: 'close-rejected', persona: 'pm', path: '/settings/projects', rules: sr({ url: '/close', method: 'POST', action: 'respond', body: refuse('TEN_4092', '项目下还有招聘中的岗位') }),
    steps: [...openRow('结束'), `${findBtn('结束项目', '.el-message-box')}.click()`, elToastGone('项目下还有招聘中的岗位')],
    checks: [boxWhy('结束项目', '暂时不能结束项目：项目下还有招聘中的岗位'), whyStays('#app .tbl-tip', '暂时不能结束项目：项目下还有招聘中的岗位'), onlyOff('#app td.ops-col', '结束'), dlgIdle] },
  // 新建 / 编辑项目弹窗
  { app: 'console', screen: 'settings-project-dlg', state: 'create', persona: 'pm', path: '/settings/projects', rules: sr(), steps: [`${findBtn('新建项目', '#app .page-hd')}.click()`, wait(500)], checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-project-dlg', state: 'client-create', persona: 'pm', path: '/settings/projects', rules: sr(),
    steps: [`${findBtn('新建项目', '#app .page-hd')}.click()`, wait(500), `${findBtn('新建甲方企业', '.el-dialog')}.click()`, wait(500)], checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-project-dlg', state: 'edit', persona: 'pm', path: '/settings/projects', rules: sr(), steps: openRow('编辑'), checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-project-dlg', state: 'submitting', persona: 'pm', path: '/settings/projects', rules: sr(), quick: true,
    steps: [...openRow('编辑'), countXhr, elClickTwice('保存', '.el-dialog')], checks: [elSpinning('保存', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'settings-project-dlg', state: 'rejected', persona: 'pm', path: '/settings/projects', rules: sr({ url: PROJ_API + '/', method: 'PUT', action: 'respond', body: refuse('TEN_4093', '项目已结束，不能修改') }),
    steps: [...openRow('编辑'), `${findBtn('保存', '.el-dialog')}.click()`, elToastGone('项目已结束，不能修改')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能保存：项目已结束，不能修改'), dlgOff('保存'), dlgIdle] },
  // 合作合同标签页
  { app: 'console', screen: 'settings-contracts', state: 'normal', persona: 'pm', path: '/settings/projects?tab=contracts', rules: sr(),
    checks: [cSide('pm'), setLayout('上传合同', true), tblFit, opsTap, rowsTall, cLegacy16, queryReset, hasPager, elPrimary] },
  { app: 'console', screen: 'settings-contracts', state: 'normal', persona: 'pm', path: '/settings/projects?tab=contracts', width: 1280, height: 800, rules: sr(), checks: [cSide('pm'), cFitAny, sideActive, tblFit] },
  { app: 'console', screen: 'settings-contracts', state: 'loading', persona: 'pm', path: '/settings/projects?tab=contracts', rules: sr({ url: CONTRACT_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, hasNot('暂无合作合同')] },
  { app: 'console', screen: 'settings-contracts', state: 'empty', persona: 'pm', path: '/settings/projects?tab=contracts', rules: sr({ url: CONTRACT_API, method: 'GET', action: 'respond', body: reply([]) }), checks: [has('暂无合作合同'), cLegacy16] },
  { app: 'console', screen: 'settings-contracts', state: 'error', persona: 'pm', path: '/settings/projects?tab=contracts', rules: sr({ url: CONTRACT_API, method: 'GET', action: 'fail' }), checks: [oneRetry, hasNot('暂无合作合同')] },
  { app: 'console', screen: 'settings-contract-dlg', state: 'normal', persona: 'pm', path: '/settings/projects?tab=contracts', rules: contractRules(), steps: fillContract, checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-contract-dlg', state: 'submitting', persona: 'pm', path: '/settings/projects?tab=contracts', rules: contractRules(), quick: true,
    steps: [...fillContract, countXhr, elClickTwice('提交审核', '.el-dialog')], checks: [elSpinning('提交审核', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'settings-contract-dlg', state: 'rejected', persona: 'pm', path: '/settings/projects?tab=contracts',
    rules: contractRules({ url: CONTRACT_API, method: 'POST', action: 'respond', body: refuse('TEN_4095', '该甲方已有待审核的合同') }),
    steps: [...fillContract, `${findBtn('提交审核', '.el-dialog')}.click()`, elToastGone('该甲方已有待审核的合同')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能提交审核：该甲方已有待审核的合同'), dlgOff('提交审核'), dlgIdle] },
  // ---- 工单 20：渠道二维码（码点纯黑白、和链接一致；下载图静区够 4 个模块）----
  { app: 'console', screen: 'settings-channels', state: 'normal', persona: 'owner', path: '/settings/channels', rules: sr(),
    checks: [cSide('owner'), setLayout('生成渠道码'), kpiCards, opsCol, tblFit, opsTap, rowsTall, cLegacy16, queryReset, hasPager, statusTags, elPrimary, qrScreen, qrRowsPure, qrPng] },
  { app: 'console', screen: 'settings-channels', state: 'normal', persona: 'owner', path: '/settings/channels', width: 1280, height: 800, rules: sr(), checks: [cSide('owner'), cFit, sideActive, kpiCards, opsCol, tblFit] },
  { app: 'console', screen: 'settings-channels', state: 'loading', persona: 'owner', path: '/settings/channels', rules: sr({ url: CHANNEL_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)],
    checks: [eachMask(['.mine-card', '.tbl-card']), noNums, tabsBlank, hasNot('暂无渠道码'), hasNot('暂无专属码')] },
  { app: 'console', screen: 'settings-channels', state: 'empty', persona: 'owner', path: '/settings/channels', rules: sr({ url: CHANNEL_API + '/mine', action: 'continue' }, { url: CHANNEL_API, method: 'GET', action: 'respond', body: reply([]) }),
    checks: [has('暂无渠道码'), allZero, cLegacy16] },
  { app: 'console', screen: 'settings-channels', state: 'error', persona: 'owner', path: '/settings/channels', rules: sr({ url: CHANNEL_API, method: 'GET', action: 'fail' }),
    checks: [eachRetry(['.mine-card', '.tbl-card']), noNums, tabsBlank, hasNot('暂无渠道码'), hasNot('暂无专属码')] },
  { app: 'console', screen: 'settings-channels', state: 'toggle-submitting', persona: 'owner', path: '/settings/channels', rules: sr(), quick: true,
    steps: [...openRow('停用'), countXhr, boxClickTwice('停用')], checks: [boxTitle, elSpinning('停用', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'settings-channels', state: 'toggle-rejected', persona: 'owner', path: '/settings/channels', rules: sr({ url: '/disable', method: 'POST', action: 'respond', body: refuse('CHANNEL_4091', '渠道码状态已变化，请刷新后再操作') }),
    steps: [...openRow('停用'), `${findBtn('停用', '.el-message-box')}.click()`, elToastGone('渠道码状态已变化')],
    checks: [boxWhy('停用', '暂时不能停用：渠道码状态已变化'), whyStays('#app .tbl-tip', '暂时不能停用：渠道码状态已变化'), onlyOff('#app td.ops-col', '停用'), dlgIdle] },
  { app: 'console', screen: 'settings-channel-dlg', state: 'normal', persona: 'owner', path: '/settings/channels', rules: sr(), steps: [`${findBtn('生成渠道码', '#app .page-hd')}.click()`, wait(600)], checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-channel-dlg', state: 'submitting', persona: 'owner', path: '/settings/channels', rules: sr(), quick: true,
    steps: [`${findBtn('生成渠道码', '#app .page-hd')}.click()`, wait(600), fillDlg('input[maxlength="30"]', '视频号直播间'), countXhr, elClickTwice('生成', '.el-dialog__footer')], checks: [elSpinning('生成', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'settings-channel-dlg', state: 'rejected', persona: 'owner', path: '/settings/channels', rules: sr({ url: CHANNEL_API, method: 'POST', action: 'respond', body: refuse('CHANNEL_4090', '渠道码数量已达上限') }),
    steps: [`${findBtn('生成渠道码', '#app .page-hd')}.click()`, wait(600), fillDlg('input[maxlength="30"]', '视频号直播间'), `${findBtn('生成', '.el-dialog__footer')}.click()`, elToastGone('渠道码数量已达上限')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能生成：渠道码数量已达上限'), dlgOff('生成'), dlgIdle] },
  // 驻场只有自己的专属码
  { app: 'console', screen: 'settings-channels', state: 'mine-only', persona: 'site', path: '/settings/channels', rules: sr(), checks: [has('我的专属码'), hasNot('启用中的渠道码'), qrScreen, cLegacy16] },
  // ---- 工单 20：组织与权限 ----
  { app: 'console', screen: 'settings-org', state: 'normal', persona: 'owner', path: '/settings/org', rules: sr(),
    checks: [cSide('owner'), setLayout('新增成员'), kpiCards, opsCol, tblFit, opsTap, cLegacy16, queryReset, hasPager, statusTags, elPrimary, matrixIcons,
      `(() => { const r = [...document.querySelectorAll('#app .members .el-table__body tr')].find((tr) => tr.getBoundingClientRect().height < 44); return r ? '成员表行高只有 ' + Math.round(r.getBoundingClientRect().height) + 'px' : '' })()`] },
  { app: 'console', screen: 'settings-org', state: 'normal', persona: 'owner', path: '/settings/org', width: 1280, height: 800, rules: sr(), checks: [cSide('owner'), cFit, sideActive, kpiCards, opsCol, tblFit] },
  { app: 'console', screen: 'settings-org', state: 'loading', persona: 'owner', path: '/settings/org', rules: sr({ url: MEMBER_API, method: 'GET', action: 'hang' }), quick: true, steps: [wait(600)], checks: [tblMask, noNums, hasNot('暂无成员')] },
  { app: 'console', screen: 'settings-org', state: 'empty', persona: 'owner', path: '/settings/org', rules: sr({ url: MEMBER_API, method: 'GET', action: 'respond', body: reply([]) }),
    checks: [has('暂无成员'), cLegacy16, `(() => { const n = [...document.querySelectorAll('#app .stat-v')].map((e) => e.innerText.trim()).filter((t) => !/^0( \\/ 0)?$/.test(t)); return n.length ? '列表是空的，计数却不是 0：' + n.join('、') : '' })()`] },
  { app: 'console', screen: 'settings-org', state: 'error', persona: 'owner', path: '/settings/org', rules: sr({ url: MEMBER_API, method: 'GET', action: 'fail' }), checks: [oneRetry, noNums, hasNot('暂无成员')] },
  { app: 'console', screen: 'settings-org', state: 'toggle-submitting', persona: 'owner', path: '/settings/org', rules: sr(), quick: true,
    steps: [...openRow('停用'), countXhr, boxClickTwice('停用')], checks: [boxTitle, elSpinning('停用', '.el-message-box'), sentOnce] },
  { app: 'console', screen: 'settings-org', state: 'toggle-rejected', persona: 'owner', path: '/settings/org', rules: sr({ url: '/status', method: 'POST', action: 'respond', body: refuse('TEN_4031', '不能停用自己') }),
    steps: [...openRow('停用'), `${findBtn('停用', '.el-message-box')}.click()`, elToastGone('不能停用自己')],
    checks: [boxWhy('停用', '暂时不能停用：不能停用自己'), whyStays('#app .tbl-tip', '暂时不能停用：不能停用自己'), onlyOff('#app td.ops-col', '停用'), dlgIdle] },
  { app: 'console', screen: 'settings-org', state: 'readonly', persona: 'pm', path: '/settings/org', rules: sr(), checks: [hasNot('新增成员'), has('只读'), cLegacy16, `document.querySelector('#app td.ops-col') ? '只读视图不该有操作列' : ''`] },
  { app: 'console', screen: 'settings-member-dlg', state: 'create', persona: 'owner', path: '/settings/org', rules: sr(), steps: [`${findBtn('新增成员', '#app .page-hd')}.click()`, wait(500)], checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-member-dlg', state: 'edit', persona: 'owner', path: '/settings/org', rules: sr(), steps: openRow('编辑'), checks: [dlgWidth, dlgNoWrap, dlgLegacy] },
  { app: 'console', screen: 'settings-member-dlg', state: 'submitting', persona: 'owner', path: '/settings/org', rules: sr(), quick: true,
    steps: [...openRow('编辑'), countXhr, elClickTwice('保存', '.el-dialog')], checks: [elSpinning('保存', '.el-dialog'), sentOnce] },
  { app: 'console', screen: 'settings-member-dlg', state: 'rejected', persona: 'owner', path: '/settings/org', rules: sr({ url: MEMBER_API + '/', method: 'PUT', action: 'respond', body: refuse('TEN_4032', '公司至少要保留一位老板') }),
    steps: [...openRow('编辑'), `${findBtn('保存', '.el-dialog')}.click()`, elToastGone('公司至少要保留一位老板')],
    checks: [whyStays('.el-dialog .blocked-why', '暂时不能保存：公司至少要保留一位老板'), dlgOff('保存'), dlgIdle] },
]

const todo = STATES.filter((s) => (!args.apps.length || args.apps.includes(s.app)) && (!only || `${s.screen}_${s.state}`.includes(only)))
if (!todo.length) { console.log('没有匹配的状态'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
let bad = 0
for (const s of todo) {
  const conf = APPS[s.app]
  const viewport = { ...(conf.mobile ? VIEWPORT.mobile : VIEWPORT.desktop), ...(s.width ? { width: s.width } : {}), ...(s.height ? { height: s.height } : {}) }
  const name = `${s.app}_${s.screen}_${s.state}_${viewport.width}x${viewport.height}.png`
  // 驻场端、企业后台用公司成员（routes.mjs 的 MEMBERS，没有的再找截图数据里的人物，如待审核老板），会话在 tenant-<手机号>.rt；求职者端用截图数据里的人物
  const staff = s.app === 'staff' || s.app === 'console'
  const phone = s.persona === 'guest' ? null : (staff && MEMBERS[s.persona]) || data.personas[s.persona]?.phone
  const rtFile = phone ? `${staff ? 'tenant' : 'seeker'}-${phone}.rt` : null
  if (phone) await (staff ? tenantSession : seekerSession)(phone)
  const b = await openTab(viewport)
  await b.send('Network.clearBrowserCookies')
  await b.send('Storage.clearDataForOrigin', { origin: conf.base, storageTypes: 'local_storage,session_storage' })
  if (rtFile) await b.send('Network.setCookie', { name: 'shitu_rt', value: readRt(rtFile), url: conf.base + conf.cookiePath, path: conf.cookiePath, httpOnly: true })
  if (s.pre) { await b.send('Page.navigate', { url: conf.base + s.pre }); await b.settle() }
  if (s.rules) await b.intercept(s.rules)
  await b.send('Page.navigate', { url: conf.base + s.path })
  await b.settle()
  if (s.lateRules) await b.intercept([...s.lateRules, ...(s.rules ?? [])])
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
