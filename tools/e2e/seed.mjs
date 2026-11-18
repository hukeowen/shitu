// 截图用的演示数据：在演示公司里造出各个阶段的人和单据，让四个端的列表、详情、账单类页面有内容可截。
// 只对本地开发后端（http://localhost:8080）发请求。跑完把人物和单据编号写进 shots/baseline-data.json，shots.mjs 按它登录和拼地址。
// 用法：node seed.mjs（已有 shots/baseline-data.json 时拒绝重跑，避免数据越造越多）
// FORCE=1 可以强行再跑：会再造一批求职者和单据；经纪人、入驻申请这些用固定手机号的步骤会因为已存在而跳过。
// 注意：后端限制同一 IP 每小时 30 条短信验证码，这个脚本要新登录约 29 个手机号。跑之前一小时内别跑 flow.mjs / ui-smoke.mjs。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE, get, post, put, ok, upload, phone, makeIdCard, companyCode, quizAnswers,
  seekerSession, tenantSession, onboardingTicket, opsLogin,
} from './lib.mjs'
import { MEMBERS } from './routes.mjs'
import { xlsx } from './xlsx.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(DIR, 'shots', 'baseline-data.json')
if (fs.existsSync(OUT) && !process.env.FORCE) {
  console.log('已有 shots/baseline-data.json，说明这个库造过数据了。确实要再造一批：FORCE=1 node seed.mjs')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const day = (n = 0) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10)
const lastMonth = () => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(0); return d.toISOString().slice(0, 7) }
// 1×1 的 PNG，当营业执照 / 凭证图片上传
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const data = { createdAt: new Date().toISOString(), companyCode: '', personas: {}, ids: {} }
const skipped = []
/** 一步失败不影响后面的步骤，最后统一列出。 */
async function step(name, fn) {
  try { return await fn() } catch (e) { skipped.push(name); console.log(`SKIP  ${name}  — ${e.message}`) }
}
const persona = (key, s, note) => { data.personas[key] = { phone: s.phone, name: s.realName, userId: s.userId, note } }

const ops = await opsLogin()
const owner = await tenantSession(MEMBERS.owner)
const pm = await tenantSession(MEMBERS.pm)
const site = await tenantSession(MEMBERS.site)
const companyId = (await ok('公司', get('/tenant/company', owner))).companyId
const CODE = data.companyCode = await companyCode(owner)
const project = (await ok('项目', get('/tenant/projects', pm)))[0]
const jobs = (await ok('岗位', get('/tenant/jobs?pageSize=20', pm))).records

// ---------------------------------------------------------------- 求职者各阶段
async function newSeeker(realName, code, age = 22 + Math.floor(Math.random() * 15)) {
  const p = phone()
  const token = await seekerSession(p, code)
  const d = await ok('告知书', get('/seeker/disclaimer', token))
  await ok('同意告知书', post('/seeker/disclaimer/agree', token, { version: d.version }))
  const idCard = makeIdCard(age)
  await ok(`实名 ${realName}`, post('/seeker/kyc', token, { realName, idCard, idCardConfirm: idCard }))
  const me = await ok('me', get('/seeker/me', token))
  return { phone: p, token, idCard, realName, userId: me.userId }
}
async function match(s, pick = 0) {
  const m = await ok(`匹配 ${s.realName}`, post('/seeker/match', s.token, { answers: await quizAnswers(s.token) }))
  s.sessionId = m.sessionId
  s.jobId = m.results[pick % m.results.length].jobId
  return s
}
async function apply(s) {
  s.applyResult = await ok(`报名 ${s.realName}`, post('/seeker/applications', s.token, { jobId: s.jobId }))
  s.applicationId = s.applyResult.applicationId
  return s
}
const acknowledge = (s, inDays = 1) => ok(`知悉 ${s.realName}`, post(`/tenant/applications/${s.applicationId}/acknowledge`, site, {
  interviewAt: day(inDays) + 'T09:30:00', address: '昆山市锦溪镇长云路 1 号东门招聘中心', documents: ['身份证', '一寸照片 2 张'],
  contactName: '王磊', contactPhone: '13800000003',
}))
const arrive = (s) => ok(`到厂 ${s.realName}`, post(`/tenant/applications/${s.applicationId}/arrive`, site, {}))
const pass = (s) => ok(`面试通过 ${s.realName}`, post(`/tenant/applications/${s.applicationId}/result`, site, { pass: true }))
async function confirm(s, no) {
  const c = await ok(`确权 ${s.realName}`, post(`/tenant/applications/${s.applicationId}/confirm`, site, { startDate: day(), employeeNo: no }))
  s.flowId = c.signUrl.replace(/.*\/esign\/mock\//, '')
  s.contractId = c.contractId
}
async function sign(s) {
  await ok(`签署 ${s.realName}`, post(`/seeker/esign/mock/${s.flowId}/sign`, s.token, {}))
  for (let i = 0; i < 15; i++) {
    if ((await ok('me', get('/seeker/me', s.token))).status === 'EMPLOYED') return
    await sleep(1000)
  }
  throw new Error(`${s.realName} 签署后 15 秒内没有变成在岗`)
}
/** 把一个新求职者推进到指定阶段。阶段依次是：registered → matched → applied → acknowledged → arrived → passed → confirmed → employed */
async function seekerAt(stage, realName, { code = CODE, pick = 0, no } = {}) {
  const order = ['registered', 'matched', 'applied', 'acknowledged', 'arrived', 'passed', 'confirmed', 'employed']
  const s = await newSeeker(realName, code)
  const reach = (x) => order.indexOf(stage) >= order.indexOf(x)
  if (reach('matched')) await match(s, pick)
  if (reach('applied')) await apply(s)
  if (reach('acknowledged')) await acknowledge(s)
  if (reach('arrived')) await arrive(s)
  if (reach('passed')) await pass(s)
  if (reach('confirmed')) await confirm(s, no)
  if (reach('employed')) await sign(s)
  return s
}

await step('私域待匹配', async () => {
  persona('registered', await seekerAt('registered', '陈志强'), '扫公司码注册并实名，还没问薪（专属服务待匹配）')
})
await step('已匹配未报名', async () => {
  const s = await seekerAt('matched', '周建军')
  persona('matched', s, '做完问薪，有匹配结果，没报名')
  data.ids.matchSessionId = s.sessionId
  data.ids.matchedJobId = s.jobId
})
await step('已报名待知悉 2 人', async () => {
  persona('applied', await seekerAt('applied', '吴丽娟'), '已报名，驻场还没知悉')
  await seekerAt('applied', '郑海涛', { pick: 1 })
})
await step('已知悉待面试', async () => {
  const s = await seekerAt('acknowledged', '孙玉兰')
  persona('acknowledged', s, '驻场已知悉并推送面试信息（待面试）')
  data.ids.seekerApplicationId = s.applicationId
  data.ids.siteApplicationId = s.applicationId
  data.ids.applyResult = s.applyResult // 报名成功页只在刚报完名时能看到，截图时靠它还原
})
await step('已到厂', () => seekerAt('arrived', '马国庆', { pick: 1 }))
await step('面试通过待确权', () => seekerAt('passed', '朱晓梅'))
await step('已确权待签合同', async () => {
  persona('confirmed', await seekerAt('confirmed', '胡文斌', { no: 'KS-1001' }), '已确权，劳动合同待签署')
})
await step('今天入职', async () => {
  const s = await seekerAt('employed', '林小燕', { no: 'KS-1002' })
  persona('employedToday', s, '今天签约入职（在岗第 1 天，不能预支）')
  data.ids.contractId = s.contractId
})
await step('公域求职者', async () => {
  const s = await seekerAt('matched', '高翠花', { code: null })
  persona('public', s, '没扫码自己注册（自由求职），做过问薪')
})

// ---------------------------------------------------------------- 岗位问答、投诉、反馈
/** 提问、投诉、反馈都用「已匹配未报名」那个人（前面那步没成功时这里会报错，由 step 兜住）。 */
const asker = async () => ({ token: await seekerSession(data.personas.matched.phone), jobId: data.ids.matchedJobId })
await step('知识库与待补充问题', async () => {
  await ok('知识库条目 1', post('/tenant/kb', pm, { projectId: project.projectId, question: '宿舍几个人一间？有空调吗？', answer: '4–8 人间，都有空调和热水，被褥自带或在厂区超市买。' }))
  await ok('知识库条目 2', post('/tenant/kb', pm, { projectId: project.projectId, question: '工资几号发？', answer: '每月 15 号发上个月的工资，打到本人银行卡。' }))
  // 不挂项目的公司通用条目只有老板能维护
  await ok('知识库条目 3', post('/tenant/kb', owner, { question: '体检要自己花钱吗？', answer: '入职体检在指定医院做，费用 60 元左右，满 3 个月报销。' }))
  const a = await asker()
  await ok('提问（转人工）', post(`/seeker/jobs/${a.jobId}/ask`, a.token, { question: '车间里要穿无尘服吗夏天会不会很热' }))
  await ok('提问（转人工）', post(`/seeker/jobs/${a.jobId}/ask`, a.token, { question: '可以和老乡分到同一个班组吗' }))
})
await step('投诉：一条待处理、一条已核实', async () => {
  const who = await asker()
  const a = await ok('投诉 1', post('/seeker/complaints', who.token, { jobId: who.jobId, category: 'INFO_FALSE', content: '岗位写的是长白班，面试时说要倒班。' }))
  const s = await seekerSession(data.personas.public.phone)
  const m = await ok('最近匹配', get('/seeker/match/latest', s))
  await ok('投诉 2', post('/seeker/complaints', s, { jobId: m.results[0].jobId, category: 'FULL_STILL_HIRING', content: '打电话说已经招满了，页面上还能报名。' }))
  await ok('核实投诉 1', post(`/ops/complaints/${a}/handle`, ops, { verified: false, remark: '已联系劳务公司核实，班次与岗位信息一致。' }))
})
await step('问题反馈：一条已回复、两条待处理', async () => {
  const s1 = await seekerSession(data.personas.acknowledged.phone)
  const f = await ok('反馈 1', post('/seeker/feedback', s1, { category: 'JOB', content: '面试地址在地图上搜不到，能不能发个定位？' }))
  await ok('反馈 2', post('/seeker/feedback', s1, { category: 'SUGGEST', content: '希望能在首页直接看到面试倒计时。' }))
  await ok('反馈 3', post('/seeker/feedback', (await asker()).token, { category: 'ACCOUNT', content: '换了手机号，原来的账号怎么找回？', contact: '13900001234' }))
  await ok('回复反馈 1', post(`/ops/feedback/${f}/reply`, ops, { reply: '已请驻场老师把定位发到你的消息里，也可以直接拨打面试通知里的电话。' }))
})

// ---------------------------------------------------------------- 花名册：有在岗天数的老员工（预支、工资条、离职都靠他们）
const veterans = [
  ['李建华', 50, 'KS-0101'], ['王秀兰', 46, 'KS-0102'], ['张伟民', 41, 'KS-0103'], ['刘桂芳', 36, 'KS-0104'],
  ['赵国强', 30, 'KS-0105'], ['杨丽萍', 24, 'KS-0106'], ['徐德胜', 16, 'KS-0107'], ['曹春梅', 11, 'KS-0108'],
].map(([realName, daysAgo, no], i) => ({ realName, daysAgo, no, phone: phone(), idCard: makeIdCard(24 + i * 2), job: jobs[i % jobs.length] }))
await step('花名册导入 8 人（另有 1 行故意填错）', async () => {
  const rows = [['姓名', '手机号', '身份证号', '项目（编号或名称）', '岗位编号（选填）', '入职日期（yyyy-MM-dd）', '工号（选填）']]
  for (const v of veterans) rows.push([v.realName, v.phone, v.idCard, project.name, v.job.jobId, day(-v.daysAgo), v.no])
  rows.push(['钱多多', '1380000', '110101199001011234', project.name, '', day(-5), 'KS-0109'])
  const r = await upload('/tenant/roster/import', pm, '花名册-立讯二期.xlsx', xlsx(rows, '花名册'))
  if (r.code !== '0') throw new Error(`${r.status} ${r.code} ${r.msg}`)
  console.log(`      花名册：共 ${r.data.total} 行，成功 ${r.data.success}，失败 ${r.data.failed}`)
  if (r.data.success < veterans.length) throw new Error('有老员工没导入成功：' + JSON.stringify(r.data.rows.filter((x) => !x.success)).slice(0, 300))
  for (const v of veterans) {
    v.token = await seekerSession(v.phone)
    const d = await get('/seeker/disclaimer', v.token)
    if (d.data && !d.data.agreed) await post('/seeker/disclaimer/agree', v.token, { version: d.data.version })
    v.userId = (await ok(`me ${v.realName}`, get('/seeker/me', v.token))).userId
  }
})
await step(`工资表导入（${lastMonth()}）`, async () => {
  const rows = [['手机号', '工号（与手机号二选一）', '应发工资', '社保个人部分', '个税', '其他扣款']]
  veterans.slice(0, 6).forEach((v, i) => rows.push([v.phone, '', String(4200 + i * 380), '420', i < 2 ? '36.5' : '0', i === 3 ? '120' : '0']))
  rows.push(['13912345678', '', '5000', '420', '0', '0'])
  const r = await upload('/tenant/payroll/import', pm, `工资表-${lastMonth()}.xlsx`, xlsx(rows, '工资表'), { fields: { month: lastMonth() } })
  if (r.code !== '0') throw new Error(`${r.status} ${r.code} ${r.msg}`)
  console.log('      工资表：' + JSON.stringify(r.data).slice(0, 200))
})
await step('预支：待初审 / 待终审 / 已拨款 / 已驳回', async () => {
  const applyAdvance = async (v) => ok(`发起预支 ${v.realName}`, post('/seeker/advance', v.token))
  const [a, b, c, d] = veterans
  const paid = await applyAdvance(a)
  await ok('初审通过', post(`/tenant/advances/${paid}/site-review`, site, { approve: true, opinion: '出勤正常' }))
  await ok('终审通过', post(`/tenant/advances/${paid}/pm-review`, pm, { approve: true, opinion: '同意' }))
  await ok('登记拨款', post(`/tenant/advances/${paid}/payout`, pm))
  const rejected = await applyAdvance(b)
  await ok('初审驳回', post(`/tenant/advances/${rejected}/site-review`, site, { approve: false, opinion: '本周有 2 天旷工，考勤核实后再申请' }))
  const waitPm = await applyAdvance(c)
  await ok('初审通过', post(`/tenant/advances/${waitPm}/site-review`, site, { approve: true, opinion: '出勤正常' }))
  const waitSite = await applyAdvance(d)
  data.ids.staffAdvanceId = waitSite
  // 老员工 A 再发起一笔，让他同时有「已拨款」和「审批中」两条记录
  data.ids.seekerAdvanceId = await applyAdvance(a).catch(() => paid)
  persona('veteran', a, '花名册导入的老员工：在岗 50 天，有工资条、预支记录和欠款')
})
await step('工资条与工资申诉', async () => {
  const [a, b] = veterans
  const slips = await ok('工资条', get('/seeker/payslips', a.token))
  data.ids.payslipId = slips[0].payslipId
  await ok('工资申诉 1', post(`/seeker/payslips/${slips[0].payslipId}/appeals`, a.token, { itemCode: 'OTHER_DEDUCT', content: '上个月没有请假，其他扣款不清楚扣的是什么。' }))
  const slipsB = await ok('工资条', get('/seeker/payslips', b.token))
  const ap = await ok('工资申诉 2', post(`/seeker/payslips/${slipsB[0].payslipId}/appeals`, b.token, { itemCode: 'GROSS', content: '加班 36 小时，应发工资好像少算了。' }))
  await ok('处理工资申诉 2', post(`/tenant/payroll/appeals/${ap}/handle`, pm, { accept: true, reply: '核对考勤后确认少算 6 小时加班，差额随下月工资补发。' }))
})
await step('请假 / 旷工标记、离职申请、工伤上报', async () => {
  const emps = (await ok('人员列表', get('/tenant/employments?pageSize=50', pm))).records
  const emp = (v) => emps.find((e) => e.userId === v.userId)
  await ok('请假', put(`/tenant/employments/${emp(veterans[4]).employmentId}/absences`, site, { date: day(-2), type: 'LEAVE', remark: '家里有事' }))
  await ok('旷工', put(`/tenant/employments/${emp(veterans[5]).employmentId}/absences`, site, { date: day(-1), type: 'ABSENT' }))
  await ok('离职申请（待审核）', post(`/tenant/employments/${emp(veterans[6]).employmentId}/resign`, site, { resignDate: day(3), reason: '回老家照顾家人' }))
  const rid = await ok('离职申请（通过）', post(`/tenant/employments/${emp(veterans[7]).employmentId}/resign`, site, { resignDate: day(-1), reason: '不适应夜班' }))
  await ok('批准离职', post(`/tenant/resign-requests/${rid}/decide`, pm, { approve: true, remark: '已办完交接' }))
  await ok('工伤上报 1', post('/tenant/incidents', site, { projectId: project.projectId, personName: '张伟民', severity: 'MINOR', occurredAt: day(-1) + 'T14:20:00', detail: '搬运料箱时划伤左手食指，已在厂医务室包扎。' }))
  const inc = await ok('工伤上报 2', post('/tenant/incidents', site, { projectId: project.projectId, personName: '杨丽萍', severity: 'SERIOUS', occurredAt: day(-6) + 'T21:05:00', detail: '夜班下楼梯扭伤脚踝，送昆山市第一人民医院拍片，无骨折。' }))
  await ok('工伤结案', post(`/tenant/incidents/${inc}/close`, pm, { note: '已休息 3 天复工，医药费由公司垫付并走工伤保险。' }))
})

// ---------------------------------------------------------------- 经纪人流转
await step('经纪人与流转池', async () => {
  await ok('新增经纪人', post('/tenant/members', owner, { name: '孟晓东', phone: MEMBERS.broker, roles: ['BROKER'], projectIds: [] }))
  const broker = await tenantSession(MEMBERS.broker)
  const a = await seekerAt('registered', '邓永福')
  const b = await seekerAt('registered', '彭雪琴')
  await ok('转经纪人 1', post(`/tenant/seekers/${a.userId}/transfer-to-broker`, site))
  const caseB = await ok('转经纪人 2', post(`/tenant/seekers/${b.userId}/transfer-to-broker`, site))
  await ok('经纪人已联系', post(`/tenant/broker/cases/${caseB}/contact`, broker))
  await ok('AI 分析报告', post(`/tenant/broker/cases/${caseB}/report`, broker))
  await ok('推荐岗位', post(`/tenant/broker/cases/${caseB}/recommend`, broker, { jobId: jobs[0].jobId, note: '离你老乡的宿舍近，长白班不熬夜。' }))
  persona('recommended', b, '被驻场转给专属顾问，顾问推荐了一个岗位，还没答复')
})

// ---------------------------------------------------------------- 岗位审核、入驻申请、平台侧单据
await step('岗位：一个待审核、一个被驳回', async () => {
  const base = { ...jobs[0], quotaTotal: 20 }
  await ok('新岗位（待审核）', post('/tenant/jobs', pm, { ...base, title: 'QC 外观检验员（坐班）', jobType: 'QC', salaryMin: 5200, salaryMax: 6500 }))
  const j = await ok('新岗位（驳回）', post('/tenant/jobs', pm, { ...base, title: 'CNC 操机学徒', jobType: 'MACHINING', salaryMin: 4800, salaryMax: 9000 }))
  await ok('驳回岗位', post(`/ops/jobs/${j.jobId}/reject`, ops, { remark: '薪资范围跨度过大，请按实际到手区间填写。' }))
})
async function applyCompany(phoneNo, name, shortName, credit, contactName) {
  const ticket = await onboardingTicket(phoneNo)
  const f = await upload('/tenant/onboarding/files', null, '营业执照.png', PNG, { headers: { 'X-Onboarding-Ticket': ticket }, type: 'image/png' })
  if (f.code !== '0') throw new Error(`上传执照 ${f.status} ${f.code} ${f.msg}`)
  const r = await fetch(BASE + '/tenant/onboarding/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Onboarding-Ticket': ticket },
    body: JSON.stringify({ name, shortName, unifiedCreditCode: credit, dispatchLicenseNo: '320500' + credit.slice(-6), licenseFiles: [f.data.key], contactName }),
  })
  const j = await r.json()
  if (j.code !== '0') throw new Error(`入驻申请 ${j.code} ${j.message}`)
  // 申请成功即登录：把会话存下来，截「入驻进度」「公司状态」页要用
  const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
  if (m) fs.writeFileSync(path.join(DIR, `tenant-${phoneNo}.rt`), m[1])
}
await step('入驻申请：一家审核中、一家被驳回', async () => {
  await applyCompany('13800000011', '苏州吴中恒信人力资源有限公司', '恒信人力', '91320506MA1HX00011', '沈国平')
  data.personas.pendingOwner = { phone: '13800000011', name: '沈国平', note: '入驻申请审核中的公司老板' }
  await applyCompany('13800000012', '常熟聚贤劳务派遣有限公司', '聚贤劳务', '91320581MA1JX00012', '顾丽华')
  const list = (await ok('公司列表', get('/ops/companies?pageSize=20', ops))).records
  const c = list.find((x) => x.name.includes('聚贤'))
  await ok('驳回入驻', post(`/ops/companies/${c.companyId}/reject`, ops, { remark: '营业执照照片不清晰，劳务派遣许可证编号与公示信息不一致，请重新上传。' }))
  data.personas.rejectedOwner = { phone: '13800000012', name: '顾丽华', note: '入驻申请被驳回的公司老板' }
})
await step('实名占用申诉（待复核）', async () => {
  const p = phone()
  const t = await seekerSession(p)
  const d = await ok('告知书', get('/seeker/disclaimer', t))
  await ok('同意告知书', post('/seeker/disclaimer/agree', t, { version: d.version }))
  const taken = veterans[2].idCard
  await post('/seeker/kyc', t, { realName: veterans[2].realName, idCard: taken, idCardConfirm: taken })
  await ok('提交申诉', post('/seeker/kyc/appeals', t, { type: 'ID_OCCUPIED_APPEAL', remark: '原来的手机号丢了，已经补不回来，这个是我的新号码。' }))
  data.personas.appealing = { phone: p, name: veterans[2].realName, note: '身份证被旧账号占用，申诉待平台复核' }
})
await step('归属争议、诚信分、黑名单', async () => {
  await ok('归属争议', post('/ops/attribution/disputes', ops, { userId: data.personas.public.userId, companyId, content: '劳务公司称该求职者是其线下门店带来的，要求改归属。' }))
  await ok('诚信分调整', post(`/ops/companies/${companyId}/credit`, ops, { delta: -2, remark: '一起岗位信息投诉核实属实，按规则扣 2 分。' }))
  const s = await seekerAt('registered', '测试黑名单', { code: null })
  await ok('加入黑名单', post('/ops/blacklist', ops, { userId: s.userId, reasonCode: 'FRAUD', detail: '批量注册刷单，证件与本人不符。' }))
})
await step('计费与月账单', async () => {
  for (const n of [-3, -2, -1]) await ok(`重算日计费 ${day(n)}`, post(`/ops/billing/daily?date=${day(n)}`, ops))
  await ok(`生成月账单 ${lastMonth()}`, post(`/ops/billing/monthly?month=${lastMonth()}`, ops))
  const bills = (await ok('账单列表', get('/tenant/bills', owner))).records
  if (bills.length) data.ids.billId = bills[0].billId
  else console.log('      没有产生账单：演示公司入驻不满一个月且在免费期内，账单类页面只能截到空状态')
})
await step('题库草稿', async () => {
  const d = await ok('题库草稿', post('/ops/quiz/drafts', ops, { name: '2026 冬季版（草稿）' }))
  data.ids.quizVersionId = d.versionId
})

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(data, null, 2))
console.log(`\n人物和单据编号已写入 ${path.basename(OUT)}`)
console.log(skipped.length ? '没造成功的步骤：\n  ' + skipped.join('\n  ') : '全部步骤完成')
process.exit(skipped.length ? 1 : 0)
