// 预览环境界面端到端验收：在服务器本机运行，用真实的点击和输入把主要业务从界面上走一遍。
//   OPS_PASSWORD=xxx node e2e.mjs [输出目录] [只跑的流程名...]
// 流程名见下面的 FLOWS（hire、reject、member、absence、broker、payroll、advance、job、feedback、complaint、resign、engine、onboard），说明见 docs/06-运维手册.md。
// 每步失败会截图到输出目录并继续下一个流程；结束时汇总通过 / 失败、被遮挡的按钮、意外的接口错误。
// 会新增虚构的求职者、岗位等数据（名字以「验收」开头），不要在有真实数据的库上运行。
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { connect, startChrome } from './ui-driver.mjs'
import { xlsx } from './xlsx.mjs'

const args = process.argv.slice(2)
const out = args[0] && !/^[a-z]+$/.test(args[0]) ? args.shift() : '/tmp/e2e'
const only = args
fs.mkdirSync(out, { recursive: true })
const ENV = Object.fromEntries(fs.readFileSync('/etc/shitu/shitu.env', 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const redis = (...a) => execFileSync('redis-cli', ['-a', ENV.REDIS_PASSWORD, '--no-auth-warning', ...a], { encoding: 'utf8' }).trim()
const sql = (q) => execFileSync('mysql', ['-N', '-B', '-h', ENV.DB_HOST.split(':')[0], '-u', ENV.DB_USER, ENV.DB_NAME, '-e', q],
  { encoding: 'utf8', env: { ...process.env, MYSQL_PWD: ENV.DB_PASSWORD } }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
const dec = (s) => {
  const all = Buffer.from(s.slice(3), 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENV.SHITU_ENC_KEY, 'base64'), all.subarray(0, 12))
  d.setAuthTag(all.subarray(all.length - 16))
  return Buffer.concat([d.update(all.subarray(12, all.length - 16)), d.final()]).toString('utf8')
}
const STATE = '/tmp/e2e-state.json'
const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {}
const save = () => fs.writeFileSync(STATE, JSON.stringify(st))
/** 界面操作完再到库里核对一次结果。 */
const expectDb = (q, want) => { const got = sql(q)[0]?.[0]; if (String(got) !== String(want)) throw new Error(`库里结果不对：期望 ${want}，实际 ${got}（${q.slice(0, 80)}）`) }
const spaced = (p) => p.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3')
const idCard = () => {
  const r = (n) => Math.floor(Math.random() * n)
  const body = '320583' + (1988 + r(15)) + String(1 + r(12)).padStart(2, '0') + String(1 + r(28)).padStart(2, '0') + String(r(1000)).padStart(3, '0')
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  let s = 0
  for (let i = 0; i < 17; i++) s += Number(body[i]) * w[i]
  return body + '10X98765432'[s % 11]
}
const hanzi = () => { const h = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉'; return h[Math.floor(Math.random() * h.length)] }

let ui
/** 图形验证弹出来就从 Redis 读答案填上（预览环境同一来源地址短信发多了会要求）。 */
async function solveCaptcha() {
  // 点完「获取验证码」后：要么按钮进入倒计时（已发出），要么弹出图形验证
  for (let i = 0; ; i++) {
    if (await ui.count('input[placeholder*="图"]')) break
    if ((await ui.has('后重发')) || i > 20) return
    await ui.sleep(200)
  }
  await ui.sleep(400)
  if (!ui.captchaId) await ui.clickSel('img')
  const key = redis('--scan', '--pattern', `*cap:${ui.captchaId}`).split('\n')[0]
  await ui.fill('图', redis('GET', key).replace(/^"|"$/g, ''))
  await ui.click('确定')
  ui.captchaId = null
}
/** 验收要反复登录同几个账号：发短信前清掉 Redis 里的发送间隔、每日次数和同一来源地址的计数（只适用于预览环境）。 */
function clearSmsLimits() {
  for (const pat of ['*sms:iv:*', '*rl:sms:day:*', '*rl:sms:ip:*']) {
    for (const k of redis('--scan', '--pattern', pat).split(String.fromCharCode(10)).filter(Boolean)) redis('DEL', k)
  }
}
async function loginSeeker(phone) {
  await ui.fresh('mobile')
  await ui.goto('/login')
  clearSmsLimits()
  await ui.fill('手机号', phone)
  await ui.click('获取验证码')
  await solveCaptcha()
  await ui.clickSel('.agree .van-checkbox')
  await ui.click('登录 / 注册并开始匹配')
  if ((await ui.url()).startsWith('/login')) throw new Error('求职者登录后还停在登录页')
}
async function loginStaff(phone) {
  await ui.fresh('mobile')
  await ui.goto('/staff/login')
  clearSmsLimits()
  await ui.fill('手机号', phone)
  await ui.click('获取验证码')
  await solveCaptcha()
  await ui.click('登录')
  await ui.see('工作台')
}

const captchaAnswer = () => { const key = redis('--scan', '--pattern', `*cap:${ui.captchaId}`).split(String.fromCharCode(10))[0]; return redis('GET', key).replace(/^"|"$/g, '') }
async function loginConsole(phone) {
  await ui.fresh('pc')
  await ui.goto('/admin/login')
  clearSmsLimits()
  await ui.fill('请输入 11 位手机号', phone)
  await ui.clickSel('.send')
  if (await ui.count('input[placeholder="请输入右侧字符"]')) {
    await ui.fill('请输入右侧字符', captchaAnswer())
    await ui.clickSel('.send')
  }
  await ui.click('登录')
  if ((await ui.url()).includes('/login')) throw new Error('公司后台登录后还停在登录页')
}
async function loginOps() {
  await ui.fresh('pc')
  await ui.goto('/ops/login')
  await ui.fill('请输入用户名', 'admin')
  await ui.fill('请输入密码', process.env.OPS_PASSWORD)
  if (!ui.captchaId) await ui.clickSel('.captcha img, img')
  await ui.fill('请输入右侧字符', captchaAnswer())
  await ui.click('登录')
  if ((await ui.url()).includes('/login')) throw new Error('运营中台登录后还停在登录页')
}

/** 新求职者注册（可带渠道码）→ 问薪 → 报名第一个匹配岗位（告知书、实名）。返回手机号、姓名、报名的公司。 */
async function registerAndApply(channel) {
  const p = { phone: '139' + String(Date.now()).slice(-8), name: '验收' + hanzi() + hanzi(), idCard: idCard() }
  await ui.fresh('mobile')
  await ui.goto(channel ? '/r/' + channel : '/')
  await ui.sleep(3000) // 启动页
  await ui.click('开始匹配')
  await ui.click('立即匹配工作')
  await ui.fill('手机号', p.phone)
  clearSmsLimits()
  await ui.click('获取验证码')
  await solveCaptcha()
  await ui.clickSel('.agree .van-checkbox')
  await ui.click('登录 / 注册并开始匹配')
  await ui.see(channel ? '专属服务' : '自由求职')
  await ui.click('开始 AI 问薪')
  await ui.see('本次匹配范围')
  await ui.clickSel('.bottom-bar .van-button--primary') // 开始回答
  for (const pick of ['能接受，我就是找厂里的活儿', '不限，哪里合适去哪里', '普工 / 流水线', '6,500 – 8,000 元', '两班倒可以', '必须包住', '没做过']) {
    await ui.click(pick, { wait: 2500 })
    await ui.sleep(500)
  }
  await ui.click('生成我的求职画像')
  await ui.see('为你锁定', 20000)
  await ui.click('查看并报名')
  await ui.see('面试信息')
  await ui.click('报名面试')
  await ui.see('求职告知书与免责声明')
  await ui.ev(`[...document.querySelectorAll('.van-popup *')].filter((e) => e.scrollHeight > e.clientHeight + 4).forEach((e) => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })`)
  await ui.sleep(500)
  await ui.click('我已完整阅读并同意上述告知书与免责声明')
  await ui.click('同意并继续')
  await ui.see('验证你的真实身份')
  await ui.fill('与身份证上的姓名一致', p.name)
  await ui.fill('18 位身份证号码', p.idCard)
  await ui.fill('请再输入一次', p.idCard)
  await ui.click('确认并提交报名')
  await ui.see('报名成功')
  await ui.click('查看我的报备')
  await ui.see('待面试')
  p.companyId = sql('SELECT company_id FROM application ORDER BY created_at DESC LIMIT 1')[0][0]
  return p
}
// ==================================================================== 流程
const FLOWS = {
  /** 主链路：扫渠道码注册 → 问薪 → 报名（告知书、实名）→ 驻场知悉、到厂、面试通过、确权 → 求职者签约 → 在岗。 */
  async hire() {
    const channel = sql("SELECT code FROM channel_code WHERE company_id = (SELECT company_id FROM company ORDER BY company_id LIMIT 1) LIMIT 1")[0][0]
    Object.assign(st, await registerAndApply(channel)); save()

    const tel = spaced(st.phone)
    await loginStaff('13800000003')
    await ui.goto('/staff/todo')
    await ui.click('知悉并推送面试信息', { within: tel })
    await ui.click('确认知悉并推送')
    await ui.see('已推送给求职者')
    await ui.click('待面试')
    await ui.click('到厂确认', { within: tel })
    await ui.click('确认到厂')
    await ui.see('已确认到厂')
    await ui.click('已到厂')
    await ui.click('面试通过', { within: tel })
    await ui.click('面试通过')
    await ui.click('待确权')
    await ui.click('入职确权 + 电子签', { within: tel })
    await ui.fill('选填，如 XC', 'E2E' + st.phone.slice(-5))
    await ui.click('确认入职并发起电子签约')
    await ui.see('确权完成，已发起电子签约')
    await ui.click('完成')

    await loginSeeker(st.phone)
    await ui.see('请签署劳动合同')
    await ui.goto('/messages')
    await ui.see('面试通过')
    await ui.click('请签署劳动合同')
    await ui.click('去签署')
    await ui.see('合同摘要')
    await ui.click('去签署')
    await ui.see('电子签署')
    await ui.click('我已阅读并同意上述合同条款')
    await ui.click('同意并签署')
    await ui.see('签署完成')
    await ui.click('查看我的工作')
    await ui.see('E2E' + st.phone.slice(-5))
    await ui.goto('/')
    await ui.see('在岗')
  },

  /** 反向链路：公域求职者注册报名 → 驻场知悉、到厂、面试未通过（填原因）→ 求职者收到结果并能重新匹配。 */
  async reject() {
    const p = await registerAndApply(null)
    const site = { C10001: '13800000003', C10002: '13800000013', C10003: '13800000023' }[p.companyId]
    if (!site) throw new Error('报名到了演示三家公司以外的公司 ' + p.companyId)
    const tel = spaced(p.phone)
    await loginStaff(site)
    await ui.goto('/staff/todo')
    await ui.click('知悉并推送面试信息', { within: tel })
    await ui.click('确认知悉并推送')
    await ui.see('已推送给求职者')
    await ui.click('待面试')
    await ui.click('到厂确认', { within: tel })
    await ui.click('确认到厂')
    await ui.see('已确认到厂')
    await ui.click('已到厂')
    await ui.click('未通过', { within: tel })
    await ui.fill('请填写未通过原因', '色弱，不符合目检岗位要求')
    await ui.click('确认未通过')
    await ui.see('已标记面试未通过')

    await loginSeeker(p.phone)
    await ui.goto('/messages')
    await ui.see('面试结果')
    await ui.goto('/match')
    await ui.see('开始回答')
  },

  /** 成员：老板在公司后台新增一个驻场成员 → 新成员用手机号登录驻场端。 */
  async member() {
    const phone = '135' + String(Date.now()).slice(-8)
    await loginConsole('13800000001')
    await ui.goto('/admin/settings/org')
    await ui.click('新增成员')
    await ui.sleep(600)
    const name = '验收驻场' + hanzi() + hanzi()
    await ui.fill('成员真实姓名', name)
    await ui.fill('成员用此手机号登录', phone)
    await ui.click('驻场')
    await ui.select('负责项目', '立讯精密昆山二期')
    await ui.click('姓名', { any: true }) // 点一下别处，收起多选下拉
    await ui.click('保存')
    await ui.see('成员已添加，可使用该手机号登录')
    await loginStaff(phone)
    await ui.see('驻场')

    // 收尾：老板把这个验收成员停用
    await loginConsole('13800000001')
    await ui.goto('/admin/settings/org')
    await ui.fill('姓名 / 完整手机号', phone) // 手机号加密存储，按完整号码查
    await ui.click('查询')
    await ui.click('停用', { within: name })
    await ui.click('停用')
    await ui.see('已停用')
  },

  /** 考勤：驻场给在岗员工标记一天请假，再撤销。 */
  async absence() {
    if (!st.phone) throw new Error('先跑 hire')
    const no = 'E2E' + st.phone.slice(-5)
    await loginStaff('13800000003')
    await ui.goto('/staff/employees')
    await ui.fill('输入工号', no)
    await ui.key('Enter', 'Enter', 13)
    await ui.idle()
    await ui.click(no)
    await ui.click('标记 请假')
    await ui.see('已标记')
    await ui.click('撤销')
    await ui.clickSel('.van-dialog__confirm')
    await ui.see('已撤销')
  },

  /** 人才经纪人：在流转池给求职者推荐本公司岗位 → 求职者在「专属顾问推荐」里看到并反馈。 */
  async broker() {
    await loginConsole('13800000004')
    await ui.goto('/admin/broker/pool')
    await ui.click('推荐岗位')
    await ui.sleep(800)
    await ui.fill('推荐岗位', null)
    await ui.clickSel('.el-select-dropdown__item:not(.is-disabled)')
    await ui.fill('给求职者的说明', '这个岗位离你住的地方近，长白班不倒班，可以先来看看车间。')
    await ui.click('推送推荐给用户')
    await ui.see('推荐已推送给求职者')
    const row = sql('SELECT u.phone_enc FROM broker_recommendation r JOIN broker_case c ON c.id = r.broker_case_id JOIN user u ON u.user_id = c.user_id ORDER BY r.created_at DESC LIMIT 1')[0]
    await loginSeeker(dec(row[0]))
    await ui.goto('/recommendations')
    await ui.see('先来看看车间')
    await ui.click('不考虑')
    await ui.click('不考虑')
    await ui.see('已反馈给专属顾问')
  },

  /** 发薪：项目经理在公司后台上传上月工资表 → 生成工资条 → 员工在求职者端看到。上月已全部导入过时，验证重复导入会被逐行拦下。 */
  async payroll() {
    const ym = sql("SELECT DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m')")[0][0]
    const company = sql('SELECT company_id FROM company ORDER BY company_id LIMIT 1 OFFSET 2')[0][0]
    const base = `FROM employment e JOIN user u ON u.user_id = e.user_id WHERE e.company_id = '${company}' AND e.start_date <= LAST_DAY(CURDATE() - INTERVAL 1 MONTH) AND (e.end_date IS NULL OR e.end_date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'))`
    let emps = sql(`SELECT u.phone_enc ${base} AND NOT EXISTS (SELECT 1 FROM payslip p WHERE p.employment_id = e.employment_id AND p.pay_month = '${ym}') LIMIT 2`)
    const fresh = emps.length > 0
    if (!fresh) emps = sql(`SELECT u.phone_enc ${base} LIMIT 1`)
    if (!emps.length) throw new Error('第三家演示公司上个月没有在职员工')
    const phones = emps.map((r) => dec(r[0]))
    const file = `${out}/${ym}工资表.xlsx`
    fs.writeFileSync(file, xlsx([['手机号', '工号（与手机号二选一）', '应发工资', '社保个人部分', '个税', '其他扣款'], ...phones.map((ph, i) => [ph, '', String(5800 + i * 300), '428.50', '0', '0'])]))
    await loginConsole('13800000022')
    await ui.goto('/admin/payroll/batches')
    await ui.upload(file)
    await ui.see(ym + '工资表.xlsx')
    await ui.click('开始导入')
    await ui.see('不可撤销')
    await ui.click('开始导入') // 二次确认
    if (fresh) {
      await ui.see(`导入完成：${phones.length} 人全部成功`, 15000)
      await loginSeeker(phones[0])
      await ui.goto('/payslips')
      await ui.see('5,371.50') // 5800 − 428.50
    } else {
      await ui.see('该员工本月工资已导入过', 15000)
    }
  },

  /** 预支：在岗满 7 天的员工申请 → 驻场初审 → 项目经理终审。 */
  async advance() {
    // 三家演示公司里找一个在岗满 9 天、本月还没预支过、没在办离职的人；再按公司取对应的驻场和项目经理账号
    const rows = sql("SELECT e.company_id, u.phone_enc FROM employment e JOIN user u ON u.user_id = e.user_id WHERE e.company_id IN ('C10001', 'C10002', 'C10003') AND e.end_date IS NULL AND e.start_date <= CURDATE() - INTERVAL 9 DAY AND NOT EXISTS (SELECT 1 FROM advance_request a WHERE a.user_id = e.user_id AND a.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AND NOT EXISTS (SELECT 1 FROM resign_request r WHERE r.user_id = e.user_id) ORDER BY e.company_id, e.start_date LIMIT 1")
    const STAFF = { C10001: ['13800000003', '13800000002'], C10002: ['13800000013', '13800000012'], C10003: ['13800000023', '13800000022'] }
    // 上次跑到一半留下的待初审申请接着用，免得把可预支的人用光
    const resume = st.advId && sql(`SELECT status FROM advance_request WHERE advance_id = '${st.advId}'`)[0]?.[0] === 'SUBMITTED'
    if (!resume) {
      if (!rows.length) throw new Error('库里没有可预支的在岗员工')
      st.advPhone = dec(rows[0][1]); st.advCompany = rows[0][0]; save()
      await loginSeeker(st.advPhone)
      await ui.goto('/advance')
      await ui.click('申请预支')
      await ui.click('确认申请')
      await ui.see('申请已提交')
      st.advId = (await ui.url()).match(/advance\/([A-Z0-9]+)/)[1]; save()
    }
    const [site, pm] = STAFF[st.advCompany ?? 'C10001']
    await loginStaff(site)
    await ui.goto('/staff/advance')
    await ui.click('初审通过', { within: st.advId })
    await ui.clickSel('.van-dialog__confirm, .van-popup .van-button--primary')
    await ui.sleep(800)
    expectDb(`SELECT status FROM advance_request WHERE advance_id = '${st.advId}'`, 'SITE_APPROVED')
    await loginConsole(pm)
    await ui.goto('/admin/pm/advance')
    await ui.click('终审通过', { within: st.advId })
    await ui.click('终审通过')
    await ui.see('终审通过，待拨款')
    await ui.click('登记拨款', { within: st.advId })
    await ui.click('已转账，登记拨款')
    await ui.see('已登记拨款')
    expectDb(`SELECT status FROM advance_request WHERE advance_id = '${st.advId}'`, 'PAID')
  },

  /** 岗位：项目经理在公司后台发布 → 平台在运营中台审核通过 → 岗位变为招聘中。 */
  async job() {
    st.jobTitle = '验收岗位' + String(Date.now()).slice(-6); save()
    await loginConsole('13800000002')
    await ui.goto('/admin/pm/jobs/edit')
    await ui.fill('如：SMT 贴片操作工', st.jobTitle)
    await ui.select('所属项目', '立讯精密昆山二期')
    await ui.select('工种', '普工')
    await ui.fill('逐条描述岗位工作内容', '1. 按作业指导书完成包装、贴标\n2. 服从班组长安排')
    await ui.fill('最低，如 5800', '5200')
    await ui.fill('最高，如 6800', '6300')
    await ui.select('班次', '白班')
    await ui.fill('如：立讯精密二期 · 招聘大厅', '昆山市锦溪镇长云路 1 号东门招聘中心')
    await ui.fill('如：每日 09:00', '工作日 09:00')
    await ui.click('提交审核并发布')
    await ui.see('岗位已提交，等待平台审核')
    expectDb(`SELECT job_status FROM job WHERE title = '${st.jobTitle}'`, 'PENDING_AUDIT')

    await loginOps()
    await ui.goto('/ops/governance/job-audit')
    await ui.fill('岗位名称 / 岗位 ID', st.jobTitle)
    await ui.click('查询')
    await ui.click('审核', { within: st.jobTitle })
    await ui.click('审核通过')
    await ui.click('通过')
    await ui.see('审核通过，岗位已上架')
    expectDb(`SELECT job_status FROM job WHERE title = '${st.jobTitle}'`, 'RECRUITING')

    // 收尾：项目经理把这个验收岗位下架，免得出现在求职者的匹配结果里
    await loginConsole('13800000002')
    await ui.goto('/admin/pm/jobs')
    await ui.fill('岗位名称', st.jobTitle)
    await ui.key('Enter', 'Enter', 13)
    await ui.idle()
    await ui.click('更多', { within: st.jobTitle })
    await ui.click('下架')
    await ui.clickSel('.el-message-box .el-button--primary')
    await ui.see('已下架')
    expectDb(`SELECT COUNT(*) FROM job WHERE title = '${st.jobTitle}' AND job_status = 'RECRUITING'`, 0)
  },

  /** 问题反馈：求职者提交 → 运营中台回复 → 求职者在消息中心看到回复。 */
  async feedback() {
    const phone = st.phone ?? st.advPhone
    if (!phone) throw new Error('先跑 hire 或 advance，拿到一个求职者手机号')
    st.fbText = '验收反馈 ' + String(Date.now()).slice(-6) + '：工资条里的夜班补贴和驻场说的不一致'; save()
    await loginSeeker(phone)
    await ui.goto('/feedback')
    await ui.click('工资与预支')
    await ui.fill('请写清楚发生了什么', st.fbText)
    await ui.click('提交反馈')
    await ui.see('已提交，平台会尽快处理')

    await loginOps()
    await ui.goto('/ops/governance/feedback')
    await ui.click('处理', { within: st.fbText.slice(0, 11) })
    await ui.fill('回复内容会通过站内信发给求职者', '已核实：夜班补贴按 25 元 / 班发放，本月工资条会补上差额。')
    await ui.click('回复')
    await ui.see('已回复，求职者会收到站内信')

    await loginSeeker(phone)
    await ui.goto('/messages')
    await ui.see('夜班补贴按 25 元')
  },

  /** 岗位投诉：求职者在岗位详情页投诉 → 运营中台核实处理（按不属实驳回，不影响演示岗位）。 */
  async complaint() {
    if (!st.phone) throw new Error('先跑 hire')
    const jobId = sql(`SELECT a.job_id FROM application a JOIN employment e ON e.application_id = a.application_id WHERE e.employee_no = 'E2E${st.phone.slice(-5)}'`)[0][0]
    st.cpText = '验收投诉 ' + String(Date.now()).slice(-6) + '：宿舍实际是 8 人间'; save()
    await loginSeeker(st.phone)
    await ui.goto('/jobs/' + jobId)
    await ui.click('投诉该岗位')
    await ui.click('岗位信息不实')
    await ui.fill('请描述具体情况', st.cpText)
    await ui.click('提交投诉')
    await ui.see('投诉已提交，平台将尽快核实')

    await loginOps()
    await ui.goto('/ops/governance/complaints')
    await ui.click('核实处理', { within: st.cpText.slice(0, 11) })
    await ui.fill('核实过程与结论', '已电话回访并查看宿舍照片，实际为 6 人间，与岗位信息一致。')
    await ui.click('驳回投诉')
    await ui.see('已驳回投诉')
  },

  /** 离职：驻场在公司后台发起 → 项目经理确认。用 hire 流程刚入职的那个人。 */
  async resign() {
    if (!st.phone) throw new Error('先跑 hire')
    const no = 'E2E' + st.phone.slice(-5)
    const pending = () => sql(`SELECT COUNT(*) FROM resign_request r JOIN employment e ON e.employment_id = r.employment_id WHERE e.employee_no = '${no}' AND r.status = 'PENDING'`)[0][0]
    if (pending() === '0') {
      await loginConsole('13800000003')
      await ui.goto('/admin/pm/staff')
      await ui.fill('工号或完整手机号', no)
      await ui.click('查询')
      await ui.click('离职', { within: no })
      await ui.see('发起离职')
      await ui.select('离职原因', '个人 / 家庭原因')
      await ui.click('提交审核')
      await ui.see('离职申请已提交，待项目经理审核')
    }

    await loginConsole('13800000002')
    await ui.goto('/admin/pm/resign')
    await ui.click('确认离职', { within: no })
    await ui.click('确认离职')
    await ui.see('已确认')
    expectDb(`SELECT COUNT(*) FROM resign_request r JOIN employment e ON e.employment_id = r.employment_id WHERE e.employee_no = '${no}' AND r.status IN ('SCHEDULED', 'APPROVED')`, 1)
  },

  /** 匹配引擎参数：新建草稿 → 保存 → 删除（不发布，不改动生效版本）。 */
  async engine() {
    await loginOps()
    await ui.goto('/ops/engine/params')
    if (await ui.has('继续编辑草稿')) await ui.click('继续编辑草稿')
    else { await ui.click('新建草稿'); await ui.see('已从生效版本复制草稿') }
    await ui.click('有人入职后重置衰减计时')
    await ui.click('保存草稿')
    await ui.see('草稿已保存')
    await ui.see('1 项')
    await ui.click('删除草稿')
    await ui.clickSel('.el-message-box .el-button--primary, .el-message-box .el-button--danger')
    await ui.see('草稿已删除')
    expectDb("SELECT COUNT(*) FROM engine_config WHERE status = 'DRAFT'", 0)
    expectDb("SELECT COUNT(*) FROM engine_config WHERE status = 'ACTIVE'", 1)
  },

  /** 入驻：新手机号登录公司后台 → 填资料、传执照 → 平台审核通过 → 老板再登录进入工作台。 */
  async onboard() {
    const tail = String(Date.now()).slice(-5)
    st.coPhone = '136' + String(Date.now()).slice(-8)
    st.coName = `昆山验收${tail}人力资源有限公司`
    save()
    await ui.fresh('pc')
    await ui.goto('/admin/login')
    await ui.shot(`${out}/licence.png`) // 借一张真实的 PNG 当执照扫描件
    clearSmsLimits()
    await ui.fill('请输入 11 位手机号', st.coPhone)
    await ui.clickSel('.send')
    if (await ui.count('input[placeholder="请输入右侧字符"]')) {
      await ui.fill('请输入右侧字符', captchaAnswer())
      await ui.clickSel('.send')
    }
    await ui.click('登录')
    await ui.see('劳务公司入驻申请')
    await ui.fill('与营业执照一致', st.coName)
    await ui.fill('求职者端展示', '验收' + tail)
    await ui.fill('18 位', '91320583MA1HT' + tail)
    await ui.fill('负责对接平台的联系人姓名', '验收联系人')
    await ui.upload(`${out}/licence.png`)
    await ui.click('提交入驻申请')
    await ui.see('入驻申请已提交')

    await loginOps()
    await ui.goto('/ops/companies/list')
    await ui.fill('公司名称 / 公司 ID', st.coName)
    await ui.click('查询')
    await ui.click('审核', { within: st.coName })
    await ui.see('验收联系人')
    await ui.click('通过入驻')
    await ui.click('通过')
    await ui.sleep(1500)
    expectDb(`SELECT company_status FROM company WHERE name = '${st.coName}'`, 'NORMAL')

    await loginConsole(st.coPhone)
    await ui.see('验收' + tail)
    if ((await ui.url()).includes('onboarding')) throw new Error('审核通过后老板登录仍停在入驻页')

    // 收尾：平台把这家验收公司封禁，不留一家「正常」的空公司在演示数据里
    await loginOps()
    await ui.goto('/ops/companies/list')
    await ui.click('全部')
    await ui.fill('公司名称 / 公司 ID', st.coName)
    await ui.click('查询')
    await ui.click('详情', { within: st.coName })
    await ui.click('调整状态')
    await ui.sleep(600)
    await ui.click('封禁')
    await ui.fill('将记录到审计日志并通知该公司', '界面验收用的测试公司，验收完成后停用。')
    await ui.click('确认调整')
    await ui.sleep(1500)
    expectDb(`SELECT COUNT(*) FROM company WHERE name = '${st.coName}' AND company_status = 'NORMAL'`, 0)
  },
}

// ==================================================================== 运行
const flows = Object.keys(FLOWS).filter((f) => !only.length || only.includes(f))
const attach = await fetch('http://127.0.0.1:9335/json').then(() => true).catch(() => false)
if (!attach) startChrome()
ui = await connect()
const results = []
// 流程里本来就会遇到的业务码：未同意告知书、未实名、要图形验证、未登录时的刷新
const EXPECTED = /APP_4012|APP_4010|AUTH_4004|auth\/refresh/
for (const f of flows) {
  console.log(`\n== ${f}`)
  const t0 = Date.now()
  const before = ui.apiErrors.length
  let err = null
  try { await FLOWS[f]() } catch (e) {
    err = e.message
    console.log('   ✗ ' + err)
    try { await ui.shot(`${out}/${f}-fail.png`); if (process.env.E2E_DUMP) await ui.dump() } catch { /* 忽略 */ }
  }
  const api = ui.apiErrors.slice(before).filter((l) => !EXPECTED.test(l))
  results.push({ flow: f, ok: !err, err, api, sec: Math.round((Date.now() - t0) / 1000) })
  console.log(`   ${err ? '失败' : '通过'}（${Math.round((Date.now() - t0) / 1000)} 秒）`)
}
console.log('\n==== 汇总')
for (const r of results) console.log(`${r.ok ? '通过' : '失败'}  ${r.flow}${r.err ? '  ' + r.err.slice(0, 200) : ''}${r.api.length ? '\n      意外的接口错误：' + r.api.join('；') : ''}`)
if (ui.problems.length) console.log('界面问题：\n  ' + [...new Set(ui.problems)].join('\n  '))
fs.writeFileSync(`${out}/e2e-report.json`, JSON.stringify({ results, problems: ui.problems }, null, 1))
ui.close()
if (!attach) { try { execFileSync('pkill', ['-f', 'remote-debugging-port=9335']) } catch { /* 已退出 */ } }
process.exit(results.some((r) => !r.ok) ? 1 : 0)
