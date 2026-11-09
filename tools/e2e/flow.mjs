// 端到端业务流（本地开发库，演示公司 C10002）：
// 扫码注册 → 私域 → 问薪 → 报名 → 驻场知悉 / 到厂 / 面试通过 → 确权 → 电子签 → 在岗
// → 岗位问答回流 → 投诉 → 看板 / 报表 → 离职 → 回公域 → 身份证占用申诉 → 归属治理
import {
  get, post, put, ok, check, summary, seekerLogin, tenantSession, opsLogin, readySeeker, phone, makeIdCard,
} from './lib.mjs'

const CODE = 'qYAtWMU9'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const plusDays = (n) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10)

async function waitFor(label, fn, tries = 15) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return check(label, true)
    await sleep(1000)
  }
  return check(label, false, '超时未满足（发件箱投递？）')
}

async function answers(t) {
  const q = await ok('读取题库', get('/seeker/quiz', t))
  return q.questions.map((qq) => {
    const pick = (pred) => qq.options.find(pred) ?? qq.options[0]
    let o
    if (qq.profileField === 'accept_factory') o = pick((x) => x.value === 'YES')
    else if (qq.profileField === 'locked_region') o = pick((x) => x.value === 'ANY')
    else if (qq.profileField === 'expect_job_type') o = pick((x) => x.value === 'ANY')
    else if (qq.profileField === 'dorm_req') o = pick((x) => x.value === 'NONE')
    else o = qq.options[0]
    return { seq: qq.seq, code: o.code }
  })
}

async function main() {
  const ops = await opsLogin()
  const owner = await tenantSession('13800000001')
  const pm = await tenantSession('13800000002')
  const site = await tenantSession('13800000003')
  const before = await ok('运营总览（前）', get('/ops/reports/overview', ops))

  // ------------------------------------------------------------ 1. 扫码注册 → 私域待匹配
  const s = await readySeeker(CODE)
  const me = await ok('C 端 me', get('/seeker/me', s.token))
  check('扫码注册 → 私域待匹配', me.status === 'PRIVATE_PENDING', me.status)
  const pp = await ok('私域待匹配名单', get('/tenant/site/private-pending', site))
  const mine = pp.find((r) => r.userId === me.userId)
  check('驻场在私域名单看到新用户（完整手机号）', mine && mine.phone === s.phone, JSON.stringify(mine ?? {}).slice(0, 120))

  // ------------------------------------------------------------ 2. 问薪 → 报名
  const m = await ok('问薪匹配', post('/seeker/match', s.token, { answers: await answers(s.token) }))
  check('匹配有结果', m.results?.length > 0, `结果 ${m.results?.length ?? 0} 个`)
  if (!m.results?.length) return
  const jobId = m.results[0].jobId
  const job = await ok('岗位详情', get('/seeker/jobs/' + jobId, s.token))
  const app = await ok('报名', post('/seeker/applications', s.token, { jobId }))
  const appId = app.applicationId
  check('报名后状态待面试', (await ok('me', get('/seeker/me', s.token))).status === 'PENDING_INTERVIEW')

  // ------------------------------------------------------------ 3. 驻场处理
  const one = await ok('驻场看报名详情', get('/tenant/applications/' + appId, site))
  check('报名带 24h 截止时间', !!one.responseDeadline)
  check('驻场可知悉', one.allowedActions.includes('ACKNOWLEDGE'), one.allowedActions.join(','))
  const list = await ok('按截止排序的待办', get('/tenant/applications?status=PENDING_INTERVIEW&sort=DEADLINE&pageSize=50', site))
  check('待办列表包含新报名', list.records.some((r) => r.applicationId === appId))
  const interviewAt = plusDays(1) + 'T09:30:00'
  await ok('知悉并推送面试信息', post(`/tenant/applications/${appId}/acknowledge`, site, {
    interviewAt, address: '演示工业园 3 号门', documents: ['身份证', '一寸照片'], contactName: '王驻场', contactPhone: '13800000003',
  }))
  const afterAck = await ok('知悉后详情', get('/tenant/applications/' + appId, site))
  check('面试通知回显（重新推送可预填）', afterAck.notice?.address === '演示工业园 3 号门')
  await waitFor('求职者收到面试通知站内信', async () =>
    JSON.stringify(await ok('消息', get('/seeker/messages', s.token))).includes('演示工业园'))
  await ok('到厂确认', post(`/tenant/applications/${appId}/arrive`, site, {}))
  await ok('面试通过', post(`/tenant/applications/${appId}/result`, site, { pass: true }))
  const conf = await ok('确权签约', post(`/tenant/applications/${appId}/confirm`, site, {
    startDate: today(), employeeNo: 'E2E' + Date.now() % 100000,
  }))
  const pending = await ok('报名详情（待签）', get('/tenant/applications/' + appId, site))
  check('合同待签且返回签署链接', pending.contract?.status === 'PENDING_SIGN' && !!pending.contract?.signUrl)
  const flow = conf.signUrl.replace(/.*\/esign\/mock\//, '')
  await ok('求职者模拟签署', post(`/seeker/esign/mock/${flow}/sign`, s.token, {}))
  await waitFor('签署回调后在岗', async () => (await ok('me', get('/seeker/me', s.token))).status === 'EMPLOYED')
  const work = await ok('我的工作', get('/seeker/work', s.token))
  check('我的工作有在岗信息', !!work && JSON.stringify(work).includes(job.title ?? ''), JSON.stringify(work).slice(0, 120))

  // ------------------------------------------------------------ 4. 岗位问答 → 待补充 → 回复
  const POOL = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥金木水火土日月星辰风云雷电山川河海'
  const q = Array.from({ length: 10 }, () => POOL[Math.floor(Math.random() * POOL.length)]).join('')
  const ask = await ok('岗位提问', post(`/seeker/jobs/${jobId}/ask`, s.token, { question: q }))
  check('未命中转人工', ask.answered === false)
  const kbp = await ok('项目经理看待补充', get('/tenant/kb/pending', pm))
  const item = kbp.find((x) => x.question === q)
  check('待补充里有该问题', !!item)
  if (item) {
    await ok('补充答案', post(`/tenant/kb/pending/${item.id}/answer`, pm, { answer: '宿舍提供被褥，不用自带。' }))
    await waitFor('提问人收到回复', async () => JSON.stringify(await ok('消息', get('/seeker/messages', s.token))).includes('不用自带'))
    const again = await ok('再问一次', post(`/seeker/jobs/${jobId}/ask`, s.token, { question: q }))
    check('再问直接命中', again.answered === true)
  }

  // ------------------------------------------------------------ 5. 看板 / 报表
  const board = await ok('项目经理看板', get('/tenant/reports/board', pm))
  check('看板在岗 ≥ 1', board.employed >= 1, JSON.stringify(board))
  const ov = await ok('老板总览', get('/tenant/reports/overview', owner))
  check('老板总览不含手机号 / 用户 ID', !JSON.stringify(ov).includes(s.phone) && !JSON.stringify(ov).includes(me.userId))
  const ch = await ok('渠道转化', get('/tenant/reports/channels', owner))
  const chRow = ch.find((r) => r.code === CODE)
  check('渠道转化含该渠道码且入职 ≥ 1', chRow && chRow.hired >= 1, JSON.stringify(chRow ?? {}))
  const after = await ok('运营总览（后）', get('/ops/reports/overview', ops))
  check('运营总览今日注册数增加', after.registeredToday > before.registeredToday, `${before.registeredToday} → ${after.registeredToday}`)

  // ------------------------------------------------------------ 6. 投诉
  const cpl = await ok('投诉岗位', post('/seeker/complaints', s.token, { jobId, category: 'INFO_FALSE', content: '端到端测试投诉' }))
  const cs = await ok('平台投诉队列', get('/ops/complaints?status=PENDING', ops))
  check('平台看到投诉', cs.some((c) => String(c.id) === String(cpl)))
  await ok('核实不属实', post(`/ops/complaints/${cpl}/handle`, ops, { verified: false, remark: '端到端测试：不属实' }))

  // ------------------------------------------------------------ 7. 预支额度（入职当天不满足条件）
  const quota = await ok('预支额度', get('/seeker/advance/quota', s.token))
  check('入职当天不能预支且给出原因', quota.eligible === false && quota.reasons.length > 0, quota.reasons.join('；'))

  // ------------------------------------------------------------ 8. 离职 → 回公域
  const emps = await ok('人员列表', get('/tenant/employments?keyword=' + s.phone, pm))
  const emp = (emps.records ?? emps).find((e) => e.userId === me.userId)
  check('人员管理能按手机号找到', !!emp)
  if (emp) {
    const rid = await ok('驻场发起离职', post(`/tenant/employments/${emp.employmentId}/resign`, site, { resignDate: plusDays(1), reason: '端到端测试' }))
    const rr = await ok('离职申请列表', get('/tenant/resign-requests?status=PENDING', pm))
    const row = rr.find((x) => String(x.id) === String(rid))
    check('离职申请带项目 / 岗位 / 经办人姓名', row && row.projectName && row.requestedByName, JSON.stringify(row ?? {}).slice(0, 160))
    await ok('项目经理批准离职', post(`/tenant/resign-requests/${rid}/decide`, pm, { approve: true }))
    check('离职后回到公域', (await ok('me', get('/seeker/me', s.token))).status === 'PUBLIC_SEEKING')
  }

  // ------------------------------------------------------------ 9. 身份证占用 → 申诉 → 复核通过 → 新号实名
  const s2Phone = phone()
  const s2 = await seekerLogin(s2Phone)
  const kyc2 = await post('/seeker/kyc', s2, { realName: '测试甲', idCard: s.idCard, idCardConfirm: s.idCard })
  check('同证另一手机号被拦截 APP_4007', kyc2.code === 'APP_4007', kyc2.code)
  const appealId = await ok('提交申诉', post('/seeker/kyc/appeals', s2, { type: 'ID_OCCUPIED_APPEAL', remark: '旧号码已停用' }))
  const queue = await ok('实名复核队列', get('/ops/kyc-reviews?status=PENDING', ops))
  const rv = queue.find((x) => String(x.id) === String(appealId))
  check('复核队列显示原账号且可解除', rv?.occupant?.userId === me.userId && rv.occupant.releasable === true)
  await ok('复核通过', post(`/ops/kyc-reviews/${appealId}/decide`, ops, { approve: true, remark: '端到端测试：核实为本人' }))
  const k2 = await ok('新号重新实名', post('/seeker/kyc', s2, { realName: '测试甲', idCard: s.idCard, idCardConfirm: s.idCard }))
  check('新号实名成功', k2.kycStatus === 'VERIFIED')

  // ------------------------------------------------------------ 10. 归属治理
  const attr = await ok('归属治理查询', get('/ops/attribution?userId=' + me.userId, ops))
  const evs = (attr.statusLog ?? []).map((x) => x.event)
  check('状态日志完整（注册 → 报名 → 签约 → 离职）', ['REGISTER_VIA_COMPANY', 'APPLY', 'CONTRACT_SIGNED', 'RESIGN'].every((e) => evs.includes(e)),
    evs.join(','))
  check('归属治理字段为驼峰', 'userStatus' in attr && !('user_status' in attr))
}

main().catch((e) => console.error('中断：', e.message)).finally(() => process.exit(summary('flow')))
