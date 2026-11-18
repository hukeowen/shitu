// 四个端的截图清单：每个路由页面用谁登录、打开哪个地址。shots.mjs 按它截图，compare.mjs 按它排对照页。
// route 是路由表里的原样写法（带 :参数）；path 不写就等于 route，带参数的用 baseline-data.json 里的单据编号拼。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(DIR, '../../web/apps')

export const APPS = {
  seeker: { base: 'http://127.0.0.1:5183', mobile: true, cookiePath: '/api/v1/seeker/auth' },
  staff: { base: 'http://127.0.0.1:5184', mobile: true, cookiePath: '/api/v1/tenant/auth' },
  console: { base: 'http://127.0.0.1:5175', mobile: false, cookiePath: '/api/v1/tenant/auth' },
  ops: { base: 'http://127.0.0.1:5176', mobile: false, cookiePath: '/api/v1/ops/auth' },
}

/** 目标视口（PRD）：后台 1440×900，手机 390×844 */
export const VIEWPORT = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
}

/** 公司成员人物：手机号固定（演示公司种子数据 + seed.mjs 新增的经纪人）；其余人物的手机号在 baseline-data.json 里 */
export const MEMBERS = { owner: '13800000001', pm: '13800000002', site: '13800000003', broker: '13800000004' }

// 两个页面靠页面内的状态才能进，直接输地址会被踢走：先打开 start，在页面里执行 script 再截图
const enterApplySuccess = (ids, personas) => ({
  start: '/reports',
  // 报名成功页读的是问薪暂存（sessionStorage）里的报名结果
  script: `sessionStorage.setItem('shitu.match', ${JSON.stringify(JSON.stringify({
    owner: personas.acknowledged.userId, quizVersion: null, answers: {}, step: 0, applyResult: ids.applyResult }))}); location.assign('/apply/success')`,
})
const enterOnboardingApply = () => ({
  start: '/login',
  // 入驻申请页要求内存里有入驻凭证（非成员手机号登录后下发），这里塞一个假的，只为看到表单
  script: `(() => { const g = document.querySelector('#app').__vue_app__.config.globalProperties
    g.$pinia._s.get('onboarding').set('screenshot-only', '138****0019'); return g.$router.push('/onboarding/apply') })()`,
})

const enterGuestHome = () => ({
  start: '/',
  // 游客第一次打开先看到启动屏，点「先逛逛」才是游客首页
  script: `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('先逛逛')).click()`,
})

// [route, 人物, path（可选，函数时入参是 baseline-data.json 的 ids）, enter（可选，见上）, 文件名（可选）]
const SEEKER = [
  ['/', 'guest', null, null, 'splash'],
  ['/', 'guest', null, enterGuestHome],
  ['/login', 'guest'],
  ['/', 'registered'], // 首页按状态各截一张，文件名带人物
  ['/', 'public'],
  ['/', 'acknowledged'],
  ['/', 'confirmed'],
  ['/', 'veteran'],
  ['/match', 'registered'],
  ['/match/quiz', 'registered'],
  ['/match/result', 'matched'],
  ['/jobs/:jobId', 'matched', (ids) => `/jobs/${ids.matchedJobId}`],
  ['/kyc', 'veteran'],
  ['/kyc/appeals', 'appealing'],
  ['/apply/success', 'acknowledged', null, enterApplySuccess],
  ['/reports', 'acknowledged'],
  ['/reports', 'registered'], // 列表页另截空状态
  ['/reports/:applicationId', 'acknowledged', (ids) => `/reports/${ids.seekerApplicationId}`],
  ['/messages', 'acknowledged'],
  ['/messages', 'registered'], // 列表页另截空状态
  ['/contracts/sign', 'confirmed'],
  ['/contracts', 'veteran'],
  ['/contracts/:id', 'employedToday', (ids) => `/contracts/${ids.contractId}`],
  ['/work', 'veteran'], // 我的工作按状态各截一张：在岗 / 待面试 / 待签约入职 / 还没报名（已离职没有现成人物，在 states.mjs 里用假数据截）
  ['/work', 'acknowledged'],
  ['/work', 'confirmed'],
  ['/work', 'public'],
  ['/advance', 'veteran'],
  ['/advance', 'employedToday'], // 入职第 1 天：准入条件不满足，发起按钮置灰
  ['/advance/records', 'veteran'],
  ['/advance/records', 'registered'], // 列表页另截空状态
  ['/advance/:id', 'veteran', (ids) => `/advance/${ids.seekerAdvanceId}`],
  ['/payslips', 'veteran'],
  ['/payslips', 'registered'],
  ['/payslips/:id', 'veteran', (ids) => `/payslips/${ids.payslipId}`],
  ['/recommendations', 'recommended'],
  ['/recommendations', 'registered'],
  ['/resume', 'veteran'],
  ['/ledger', 'veteran'], // 老员工是花名册导入的，没有报名记录：这张就是空状态
  ['/ledger', 'veteran', () => '/ledger?tab=work', null, 'ledger@work'],
  ['/me', 'veteran'],
  ['/feedback', 'acknowledged'],
]

const STAFF = [
  ['/login', 'guest'],
  ['/', 'site'],
  ['/notice', 'pendingOwner'],
  ['/my-code', 'site'],
  ['/todo', 'site'],
  ['/applications/:id', 'site', (ids) => `/applications/${ids.siteApplicationId}`],
  ['/messages', 'site'],
  ['/reminders', 'site'],
  ['/advance', 'site'],
  ['/advance/:id', 'site', (ids) => `/advance/${ids.staffAdvanceId}`],
  ['/employees', 'site'],
  ['/incidents', 'site'],
  ['/me', 'site'],
]

const CONSOLE = [
  ['/login', 'guest'],
  ['/onboarding/apply', 'guest', null, enterOnboardingApply],
  ['/onboarding/status', 'pendingOwner'],
  ['/onboarding/status', 'rejectedOwner'], // 被驳回的公司另截一张：结果页图标、审核意见和主按钮不同
  ['/site/home', 'site'],
  ['/site/todo', 'site'],
  ['/site/follow', 'site'],
  ['/site/onboard', 'site'],
  ['/broker/pool', 'broker'],
  ['/broker/report', 'broker'],
  ['/broker/rematch', 'broker'],
  ['/payroll/batches', 'pm'],
  ['/payroll/appeals', 'pm'],
  ['/payroll/recon', 'pm'],
  ['/circulation/ledger', 'owner'],
  ['/circulation/people', 'owner'],
  ['/pm/board', 'pm'],
  ['/pm/jobs', 'pm'],
  ['/pm/jobs/edit', 'pm', (ids) => `/pm/jobs/edit?id=${ids.matchedJobId}`],
  ['/pm/kb', 'pm'],
  ['/pm/staff', 'pm'],
  ['/pm/resign', 'pm'],
  ['/pm/roster', 'pm'],
  ['/pm/incidents', 'pm'],
  ['/pm/advance', 'pm'],
  ['/owner/overview', 'owner'],
  ['/owner/channel-report', 'owner'],
  ['/owner/bills', 'owner'],
  ['/settings/projects', 'pm'],
  ['/settings/channels', 'owner'],
  ['/settings/org', 'owner'],
]

const OPS = [
  ['/login', 'guest'],
  ['/workbench', 'ops'],
  ['/ops/overview', 'ops'],
  ['/ops/attribution', 'ops'],
  ['/engine/quiz', 'ops'],
  ['/engine/quiz/:versionId', 'ops', (ids) => `/engine/quiz/${ids.quizVersionId}`],
  ['/engine/match-snapshot', 'ops'],
  ['/engine/params', 'ops'],
  ['/companies/list', 'ops'],
  ['/companies/stock', 'ops'],
  ['/governance/job-audit', 'ops'],
  ['/governance/throttle', 'ops'],
  ['/governance/compliance', 'ops'],
  ['/governance/complaints', 'ops'],
  ['/governance/feedback', 'ops'],
  ['/governance/credit', 'ops'],
  ['/settlement/rules', 'ops'],
  ['/settlement/bills', 'ops'],
  ['/settlement/audit', 'ops'],
  ['/system/admins', 'ops'],
  ['/system/templates', 'ops'],
  ['/system/holidays', 'ops'],
  ['/system/params', 'ops'],
  ['/forbidden', 'ops', () => '/forbidden?from=/system/admins'],
]

/** 规范的 17 类排法；同一路由可有多种排法，供总览交叉浏览。 */
export const PAGE_TYPES = {
  dashboard: '工作台 / 仪表盘', table: '数据表格列表', 'card-list': '卡片列表',
  'list-detail': '列表 + 详情', detail: '详情页', form: '表单 / 编辑', wizard: '多步向导',
  review: '审核处理', billing: '账单 / 财务明细', charts: '图表统计', settings: '设置 / 配置',
  login: '登录 / 认证', result: '结果 / 提示', messages: '消息 / 通知', profile: '个人中心',
  import: '导入', lookup: '查询检索',
}

// 按 design-system 的适用页面登记，不能用路径前缀猜测页面类型。
const TYPE_ROUTES = {
  seeker: {
    dashboard: ['/'], 'card-list': ['/reports', '/match/result', '/kyc/appeals', '/contracts', '/recommendations', '/ledger'],
    detail: ['/reports/:applicationId', '/jobs/:jobId', '/contracts/sign', '/contracts/:id', '/work', '/advance/:id'],
    form: ['/kyc', '/resume', '/feedback'], wizard: ['/match', '/match/quiz'],
    billing: ['/advance', '/advance/records', '/payslips', '/payslips/:id'],
    login: ['/login'], result: ['/apply/success'], messages: ['/messages'], profile: ['/me'],
  },
  staff: {
    dashboard: ['/'], 'card-list': ['/todo', '/reminders', '/employees', '/advance'],
    detail: ['/applications/:id', '/my-code'], form: ['/incidents'], review: ['/advance', '/advance/:id'],
    login: ['/login'], result: ['/notice'], messages: ['/messages'], profile: ['/me'],
  },
  console: {
    dashboard: ['/site/home', '/pm/board', '/owner/overview'],
    table: ['/site/todo', '/site/follow', '/site/onboard', '/pm/resign', '/pm/jobs', '/pm/kb', '/pm/staff', '/pm/incidents'],
    'list-detail': ['/site/home', '/broker/pool', '/broker/report', '/broker/rematch'],
    form: ['/pm/jobs/edit', '/onboarding/apply'], review: ['/pm/advance', '/payroll/appeals', '/site/onboard', '/pm/resign'],
    billing: ['/owner/bills', '/circulation/ledger', '/circulation/people', '/payroll/recon'],
    charts: ['/owner/channel-report', '/owner/overview', '/pm/kb', '/site/follow'],
    settings: ['/settings/projects', '/settings/channels', '/settings/org'], login: ['/login'],
    result: ['/onboarding/status'], import: ['/payroll/batches', '/pm/roster'],
  },
  ops: {
    dashboard: ['/workbench'], table: ['/engine/quiz', '/companies/stock', '/governance/throttle', '/settlement/audit', '/system/admins'],
    form: ['/engine/quiz/:versionId'], review: ['/companies/list', '/governance/job-audit', '/governance/compliance', '/governance/complaints', '/governance/feedback', '/ops/attribution'],
    billing: ['/settlement/bills'], charts: ['/ops/overview', '/engine/quiz'],
    settings: ['/engine/params', '/settlement/rules', '/system/templates', '/system/holidays', '/system/params', '/engine/quiz', '/engine/quiz/:versionId'],
    login: ['/login'], result: ['/forbidden'], lookup: ['/ops/attribution', '/engine/match-snapshot', '/governance/credit'],
  },
}

const slug = (route) => (route === '/' ? 'home' : route.slice(1).replaceAll('/', '_').replaceAll(':', ''))

/** 全部截图条目。同一路由截多个人物时，除第一个外文件名带上人物。 */
export const ROUTES = Object.entries({ seeker: SEEKER, staff: STAFF, console: CONSOLE, ops: OPS }).flatMap(([app, list]) => {
  const seen = new Set()
  return list.map(([route, persona, to, enter, fixedName]) => {
    const name = fixedName ?? (seen.has(route) || (route === '/' && app === 'seeker') ? `${slug(route)}@${persona}` : slug(route))
    seen.add(route)
    const types = name === 'splash' ? ['login'] : Object.entries(TYPE_ROUTES[app]).filter(([, routes]) => routes.includes(route)).map(([type]) => type)
    return { app, route, persona, to, enter, name, types, file: `${app}/${name}.png` }
  })
})

/** 按端和路由筛选：apps 是端名数组；routes 里的每一项按前缀匹配路由（'/pm' 命中 /pm/jobs、/pm/kb…），'/' 只匹配首页。 */
export function selectRoutes({ apps = [], routes = [] } = {}) {
  return ROUTES.filter((r) => (!apps.length || apps.includes(r.app)) &&
    (!routes.length || routes.some((p) => (p === '/' ? r.route === '/' : r.route === p || r.route.startsWith(p.replace(/\/$/, '') + '/')))))
}

/** 解析命令行：--app seeker,staff --route /pm,/owner/bills，其余按顺序放进 _ */
export function parseArgs(argv) {
  const out = { _: [], apps: [], routes: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app' || argv[i] === '--route') {
      if (!argv[i + 1]) throw new Error(`${argv[i]} 后面要跟值，多个用逗号隔开`)
      out[argv[i] === '--app' ? 'apps' : 'routes'] = argv[++i].split(',')
    } else out._.push(argv[i])
  }
  const unknown = out.apps.filter((a) => !APPS[a])
  if (unknown.length) throw new Error(`没有这个端：${unknown.join('、')}（可选 ${Object.keys(APPS).join(' / ')}）`)
  return out
}

// 开发环境专用的模拟签署页不截；/r/:code 是扫码跳转，没有画面
const SKIP = { seeker: ['/esign/mock/:flowId', '/r/:code'] }

/** 路由表里有、清单里没有的路由（新增页面忘了登记时，shots.mjs 会报出来）。 */
export function missingRoutes() {
  const read = (app, file) => fs.readFileSync(path.join(WEB, app, 'src/router', file), 'utf8')
  const declared = {}
  for (const app of Object.keys(APPS)) {
    const src = read(app, 'index.ts') + (fs.existsSync(path.join(WEB, app, 'src/router/menu.ts')) ? read(app, 'menu.ts') : '')
    declared[app] = [...src.matchAll(/path: '([^']+)'(?![^{}]*redirect)/g)].map((m) => m[1].replace(/\(.*?\)/g, ''))
      .filter((p) => p.startsWith('/') && !p.includes('pathMatch') && !(SKIP[app] ?? []).includes(p))
  }
  declared.ops.push('/workbench') // 菜单里写的是常量 HOME_PATH
  const out = []
  for (const [app, list] of Object.entries(declared)) {
    for (const p of new Set(list)) {
      if (p === '/' && app !== 'seeker' && app !== 'staff') continue // 后台的 / 只是布局外壳
      if (!ROUTES.some((r) => r.app === app && r.route === p)) out.push(`${app} ${p}`)
    }
  }
  return out
}

/** 递归列出目录下的 .vue / .ts 源码文件。 */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? sourceFiles(p) : /\.(vue|ts)$/.test(e.name) ? [p] : []
  })
}

/**
 * 页面里写死的站内跳转地址（router.push / replace 的字符串、to="…"、{ path: '…' }）在路由表里找不到的。
 * 批量改名把 '/match/result' 误改成别的地址时，类型检查和冒烟都发现不了（冒烟不点按钮），这里能查出来。
 * 带 ${…} 的地址按「这一段是参数」比对；拼接出来的地址查不到。
 */
export function deadLinks() {
  const out = []
  for (const app of Object.keys(APPS)) {
    const routerDir = path.join(WEB, app, 'src/router')
    const declared = sourceFiles(routerDir).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/path: '(\/[^']*)'/g)].map((m) => m[1].replace(/\(.*?\)/g, '')))
    const patterns = declared.filter((p) => !p.includes('pathMatch')).map((p) => new RegExp('^' + p.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '/?$'))
    for (const file of sourceFiles(path.join(WEB, app, 'src'))) {
      if (file.startsWith(routerDir)) continue
      const src = fs.readFileSync(file, 'utf8')
      const links = [...src.matchAll(/\b(?:push|replace)\(\s*['"`](\/[^'"`]*)['"`]/g), ...src.matchAll(/\bto="(\/[^"]*)"/g), ...src.matchAll(/\bpath: ['"`](\/[^'"`]*)['"`]/g)].map((m) => m[1])
      for (const link of new Set(links)) {
        const target = link.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, 'x')
        if (!patterns.some((re) => re.test(target))) out.push(`${app} ${path.relative(path.join(WEB, app), file)}  ${link}`)
      }
    }
  }
  return out
}
