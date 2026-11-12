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
const staffLegacy = `document.querySelector('#app .tag, #app .num, #app .mono, #app .van-icon:not(.van-icon-arrow-left):not(.van-icon-arrow-down):not(.van-badge__wrapper), #app .van-empty') ? '还在用旧标签、等宽数字类、Vant 图标或 van-empty' : ''`
const staffText = `(() => { const bad = [...document.querySelectorAll('#app .facts li, #app .tipbar-t, #app .tipbar-d, #app .note, #app .kv dt, #app .kv dd, #app .why, #app .bar-why, #app .state-block-d')].find((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 15)
  return bad ? '正文小于 15px：' + bad.innerText.slice(0, 20) : '' })()`
const alarm = `(() => { const a = document.querySelector('#app .alarm'); if (!a) return '没有超时提示条'
  if (!/\\d+ 人即将超时，最短还剩 (\\d+ 小时 \\d+ 分|\\d+ 分钟)/.test(a.innerText)) return '提示条没写几人即将超时、最短还剩多久（带单位）：' + a.innerText.slice(0, 40)
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
  { app: 'staff', screen: 'workbench', state: 'alarm', persona: 'site', path: '/', rules: sr({ url: WB_API, action: 'respond', body: fakeWb({ windowsDueIn4h: 3 }) }), checks: [alarm, todoCards(1)] },
  { app: 'staff', screen: 'workbench', state: 'alarm', persona: 'site', path: '/', width: NARROW, rules: sr({ url: WB_API, action: 'respond', body: fakeWb({ windowsDueIn4h: 3 }) }), checks: [alarm] },
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
]

const todo = STATES.filter((s) => (!args.apps.length || args.apps.includes(s.app)) && (!only || `${s.screen}_${s.state}`.includes(only)))
if (!todo.length) { console.log('没有匹配的状态'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
let bad = 0
for (const s of todo) {
  const conf = APPS[s.app]
  const viewport = { ...(conf.mobile ? VIEWPORT.mobile : VIEWPORT.desktop), ...(s.width ? { width: s.width } : {}) }
  const name = `${s.app}_${s.screen}_${s.state}_${viewport.width}x${viewport.height}.png`
  // 驻场端用公司成员（routes.mjs 的 MEMBERS），会话在 tenant-<手机号>.rt；求职者端用截图数据里的人物
  const staff = s.app === 'staff'
  const phone = s.persona === 'guest' ? null : staff ? MEMBERS[s.persona] : data.personas[s.persona]?.phone
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
