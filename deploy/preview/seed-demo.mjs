// 预览环境演示数据：在服务器本机以 root 运行，全部走真实业务接口，再把日期往前拨并补跑历史计费。
//   node /opt/shitu/upload/seed-demo.mjs          （admin 密码已改过：OPS_PASSWORD=新密码 node ...）
// 前置：后端以 preview profile 运行（短信验证码回显）、平台管理员 admin 的密码还是初始密码。
// 整套数据只能造一次；在途流程（待面试、待确权等）过 24 小时会被系统释放，演示前补一批：node seed-demo.mjs refresh
// 库里已经有第二家公司时不带 refresh 直接退出。全部是虚构的人员与公司，不要在有真实数据的库上运行。
import fs from 'node:fs'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const API = process.env.SEED_API ?? 'http://127.0.0.1:8080/api/v1'
const DB = process.env.SEED_DB ?? 'shitu'
const ENV = Object.fromEntries(fs.readFileSync('/etc/shitu/shitu.env', 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = (n) => Math.floor(Math.random() * n)
const pad = (n, w = 2) => String(n).padStart(w, '0')
const shNow = () => new Date(Date.now() + 8 * 3600e3)
const day = (offset = 0) => new Date(shNow().getTime() + offset * 86400e3).toISOString().slice(0, 10)
const sql = (q) => execFileSync('mysql', ['-uroot', '-N', '-B', DB, '-e', q], { encoding: 'utf8' }).trim()
const redis = (...a) => execFileSync('redis-cli', ['-a', ENV.REDIS_PASSWORD, '--no-auth-warning', ...a], { encoding: 'utf8' }).trim()
const esc = (s) => String(s).replace(/'/g, "''")
// 每个登录身份一个模拟来源 IP（同一 IP 发 3 次短信后要图形验证）；每次运行随机起点，避免和上一次运行撞上
let ipSeq = Math.floor(Math.random() * 60000) * 250
const newIp = () => `36.${1 + Math.floor(ipSeq / 62500) % 250}.${Math.floor(ipSeq / 250) % 250}.${1 + (ipSeq++ % 250)}`
let failed = 0

async function raw(method, url, { token, body, ip, headers = {}, form } = {}) {
  const h = { 'X-Forwarded-For': ip ?? '36.0.0.1', ...headers }
  if (token) h.Authorization = 'Bearer ' + token
  if (!form && body !== undefined) h['Content-Type'] = 'application/json'
  const r = await fetch(API + url, { method, headers: h, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  let j = null
  try { j = await r.json() } catch { /* 非 JSON */ }
  return { status: r.status, code: j?.code, msg: j?.message, data: j?.data }
}

/** 一个登录身份：令牌 15 分钟过期，过期后自动重新短信登录（同号 60 秒冷却就等一下）。 */
class Actor {
  constructor(domain, phone, channel) { Object.assign(this, { domain, phone, channel, ip: newIp(), token: null }) }
  async login() {
    for (let i = 0; i < 3; i++) {
      const s = await raw('POST', `/${this.domain}/auth/sms-code`, { body: { phone: this.phone }, ip: this.ip })
      if (s.code === 'AUTH_4004') { this.ip = newIp(); continue }   // 这个 IP 要图形验证了，换一个
      if (s.code !== '0') { await sleep(61000); continue }             // 同号 60 秒冷却
      const body = { phone: this.phone, code: s.data.devCode }
      if (this.channel) body.channelCode = this.channel
      const l = await raw('POST', `/${this.domain}/auth/sms-login`, { body, ip: this.ip })
      if (l.code !== '0') throw new Error(`login ${this.phone}: ${l.code} ${l.msg}`)
      this.token = l.data.accessToken
      this.ticket = l.data.onboardingTicket
      return this
    }
    throw new Error('sms-code ' + this.phone)
  }
  async call(method, url, body, opt = {}) {
    let r = await raw(method, url, { token: this.token, body, ip: this.ip, ...opt })
    if (r.status === 401 && this.domain !== 'ops') {
      await this.login()
      r = await raw(method, url, { token: this.token, body, ip: this.ip, ...opt })
    }
    return r
  }
  async ok(method, url, body, opt) {
    const r = await this.call(method, url, body, opt)
    if (r.status !== 200 || r.code !== '0') throw new Error(`${method} ${url}: ${r.status} ${r.code} ${r.msg}`)
    return r.data
  }
  get(url) { return this.ok('GET', url) }
  post(url, body = {}) { return this.ok('POST', url, body) }
  put(url, body = {}) { return this.ok('PUT', url, body) }
  async upload(url, bytes, name, type, headers) {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type }), name)
    return this.ok('POST', url, undefined, { form, headers })
  }
}

async function step(label, fn) {
  try {
    const v = await fn()
    console.log('ok    ' + label)
    return v
  } catch (e) {
    failed++
    console.log('FAIL  ' + label + '  — ' + e.message)
    return null
  }
}
async function waitFor(fn, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true
    await sleep(700)
  }
  return false
}

// ------------------------------------------------------------------ 小工具：图片与 xlsx
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function zip(files) {
  const parts = []; const central = []; let off = 0
  for (const [name, text] of files) {
    const data = Buffer.from(text); const comp = zlib.deflateRawSync(data); const n = Buffer.from(name)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(8, 8)
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(comp.length, 18)
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26); head.writeUInt16LE(0, 28)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(off, 42)
    parts.push(head, n, comp); central.push(cen, n); off += 30 + n.length + comp.length
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, end])
}
function xlsx(rows) {
  const col = (i) => String.fromCharCode(65 + i)
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) =>
    `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${x(v)}</t></is></c>`).join('') + '</row>').join('')
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="工资表" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`],
  ])
}

// ------------------------------------------------------------------ 虚构人员
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢'
const MALE = ['建军', '志强', '海涛', '国庆', '伟', '磊', '军', '勇', '杰', '涛', '明辉', '德胜', '永刚', '小龙', '文斌', '俊杰', '春生', '立新', '大伟', '红兵']
const FEMALE = ['秀英', '桂兰', '丽娟', '海燕', '芳', '娜', '敏', '静', '艳', '玉梅', '春梅', '雪梅', '小红', '美玲', '晓燕', '翠花', '金凤', '彩霞', '慧敏', '丽华']
const AREAS = ['320583', '320506', '321281', '340621', '341222', '411422', '412726', '371521', '130434', '522401', '513022', '430524', '360731', '610729']
const usedNames = new Set()
function person() {
  const male = Math.random() < 0.62
  let name
  do { name = SURNAMES[rnd(SURNAMES.length)] + (male ? MALE : FEMALE)[rnd(20)] } while (usedNames.has(name))
  usedNames.add(name)
  const age = 19 + rnd(22)
  const y = shNow().getUTCFullYear() - age
  const body = AREAS[rnd(AREAS.length)] + y + pad(1 + rnd(9)) + pad(1 + rnd(27)) + pad(rnd(99)) + (male ? '13579' : '02468')[rnd(5)]
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  let s = 0
  for (let i = 0; i < 17; i++) s += Number(body[i]) * w[i]
  return { name, idCard: body + '10X98765432'[s % 11] }
}
let phoneSeq = 0
const seekerPhone = () => ['139', '137', '150', '158', '186', '177'][rnd(6)] + pad(10000000 + rnd(80000000) + phoneSeq++, 8)

let quiz = null
/** 按目标岗位作答（工种、薪资档、班次都对上），这样每个人匹配到的首选就是要去的岗位，人员能分散到各岗位。 */
async function answers(s, job) {
  quiz ??= (await s.get('/seeker/quiz')).questions
  const mid = (Number(job.salaryMin) + Number(job.salaryMax)) / 2
  return quiz.map((qq) => {
    const pick = (v) => qq.options.find((x) => x.value === v) ?? qq.options[0]
    let o
    switch (qq.profileField) {
      case 'accept_factory': o = pick('YES'); break
      case 'locked_region': o = pick('ANY'); break
      case 'expect_job_type': o = pick(job.jobType); break
      case 'expect_salary': o = qq.options.find((x) => mid >= x.min && mid <= x.max) ?? qq.options[1]; break
      case 'shift_pref': o = pick(job.shiftType); break
      case 'dorm_req': o = pick(['REQUIRED', 'AIRCON', 'NONE'][rnd(3)]); break
      default: o = qq.options[rnd(qq.options.length)]
    }
    return { seq: qq.seq, code: o.code }
  })
}

/** 注册（可带渠道码）→ 告知书 → 实名。 */
async function newSeeker(channel) {
  const p = person()
  const s = await new Actor('seeker', seekerPhone(), channel).login()
  Object.assign(s, p)
  const d = await s.get('/seeker/disclaimer')
  await s.post('/seeker/disclaimer/agree', { version: d.version })
  await s.post('/seeker/kyc', { realName: p.name, idCard: p.idCard, idCardConfirm: p.idCard })
  s.userId = (await s.get('/seeker/me')).userId
  return s
}

/** 问薪 → 报名指定公司的岗位。返回报名单号。 */
async function apply(s, co, jobIdx) {
  const want = co.jobs[jobIdx % co.jobs.length]
  const m = await s.post('/seeker/match', { answers: await answers(s, co.meta[want]) })
  const ids = (m.results ?? []).map((r) => r.jobId)
  const jobId = ids.includes(want) ? want : co.jobs.find((j) => ids.includes(j))
  if (!jobId) throw new Error(`${s.name} 的匹配结果里没有 ${co.short} 的岗位（${ids.length} 个结果）`)
  s.jobId = jobId
  return (await s.post('/seeker/applications', { jobId })).applicationId
}

const ack = (co, appId, offsetDays = 1) => co.site.post(`/tenant/applications/${appId}/acknowledge`, {
  // 当天的面试用半小时前（接口只接受不早于一小时前的时间）
  interviewAt: offsetDays > 0 ? day(offsetDays) + 'T09:30:00' : new Date(shNow().getTime() - 30 * 60e3).toISOString().slice(0, 19), address: co.address + ' 人事接待室', routeTips: '到门卫处报仕兔报名，驻场老师来接',
  documents: ['身份证原件', '一寸照片 2 张'], contactName: co.siteName, contactPhone: co.site.phone,
})

/** 报名 → 知悉 → 到厂 → 面试通过 → 确权 → 电子签 → 在岗。 */
async function employ(s, co, jobIdx) {
  const appId = await apply(s, co, jobIdx)
  await ack(co, appId)
  await co.site.post(`/tenant/applications/${appId}/arrive`)
  await co.site.post(`/tenant/applications/${appId}/result`, { pass: true })
  const conf = await co.site.post(`/tenant/applications/${appId}/confirm`, { startDate: day(0), employeeNo: co.prefix + pad(++co.empSeq, 4) })
  await s.post(`/seeker/esign/mock/${conf.signUrl.replace(/.*\/esign\/mock\//, '')}/sign`)
  if (!(await waitFor(async () => (await s.get('/seeker/me')).status === 'EMPLOYED'))) throw new Error(s.name + ' 签署后没有变成在岗')
  s.appId = appId
  s.employmentId = sql(`SELECT employment_id FROM employment WHERE user_id = '${s.userId}' AND end_date IS NULL`)
  s.employer = co
  return s
}

/** 把一个人的全部痕迹往前拨 d 天（入职日 = 今天 - d）。 */
function backdate(s, d) {
  const u = esc(s.userId)
  sql([
    `UPDATE \`user\` SET registered_at = registered_at - INTERVAL ${d + 2} DAY, created_at = created_at - INTERVAL ${d + 2} DAY WHERE user_id = '${u}'`,
    `UPDATE user_status_log SET created_at = created_at - INTERVAL ${d + 1} DAY WHERE user_id = '${u}'`,
    `UPDATE user_status_log SET created_at = created_at - INTERVAL 1 DAY WHERE user_id = '${u}' AND event LIKE 'REGISTER%'`,
    `UPDATE match_session SET started_at = started_at - INTERVAL ${d + 1} DAY, finished_at = finished_at - INTERVAL ${d + 1} DAY WHERE user_id = '${u}'`,
    `UPDATE application SET created_at = created_at - INTERVAL ${d + 1} DAY, acknowledged_at = acknowledged_at - INTERVAL ${d + 1} DAY, interview_at = interview_at - INTERVAL ${d + 1} DAY, arrived_at = arrived_at - INTERVAL ${d} DAY WHERE user_id = '${u}'`,
    `UPDATE interview_notice n JOIN application a ON a.application_id = n.application_id SET n.interview_at = a.interview_at, n.pushed_at = a.acknowledged_at WHERE a.user_id = '${u}'`,
    // 站内信是异步发的，这里能拨到多少算多少（面试、到厂的提醒在入职前一天，签约提醒在入职当天）
    `UPDATE notification SET created_at = created_at - INTERVAL ${d + 1} DAY WHERE recipient_type = 'SEEKER' AND recipient_id = '${u}' AND template_code IN ('INTERVIEW_INFO_PUSHED', 'ARRIVAL_CONFIRMED')`,
    `UPDATE notification SET created_at = created_at - INTERVAL ${d} DAY WHERE recipient_type = 'SEEKER' AND recipient_id = '${u}' AND template_code = 'CONTRACT_SIGN_REQUIRED'`,
    `UPDATE employment SET start_date = CURDATE() - INTERVAL ${d} DAY, created_at = created_at - INTERVAL ${d} DAY WHERE user_id = '${u}'`,
    `UPDATE contract SET term_start = CURDATE() - INTERVAL ${d} DAY, signed_at = signed_at - INTERVAL ${d} DAY, created_at = created_at - INTERVAL ${d} DAY WHERE user_id = '${u}'`,
    `UPDATE kyc_record SET created_at = created_at - INTERVAL ${d + 2} DAY WHERE user_id = '${u}'`,
  ].join('; '))
  s.days = d
}

// ------------------------------------------------------------------ 平台登录
// 首次登录强制改密码的标记：造数期间临时关掉，结束（含中断）时恢复原值
let ENGINE = null   // 造数期间临时放宽的匹配结果数量，结束时恢复
const MUST_CHANGE = sql("SELECT must_change_password FROM ops_admin WHERE username = 'admin'")
async function opsLogin() {
  const ops = new Actor('ops', 'admin')
  sql("UPDATE ops_admin SET must_change_password = 0 WHERE username = 'admin'")
  const cap = await raw('GET', '/ops/auth/captcha', { ip: ops.ip })
  const key = redis('--scan', '--pattern', `*cap:${cap.data.captchaId}`).split('\n')[0]
  const code = redis('GET', key).replace(/^"|"$/g, '')
  const l = await raw('POST', '/ops/auth/login', { ip: ops.ip, body: { username: 'admin', password: process.env.OPS_PASSWORD ?? ENV.SHITU_OPS_INIT_PASSWORD, captchaId: cap.data.captchaId, captchaCode: code } })
  if (l.code !== '0') { throw new Error('平台登录失败（admin 密码已不是初始密码？）：' + l.code + ' ' + l.msg) }
  ops.token = l.data.accessToken
  ops.relogin = opsLogin
  return ops
}

// ------------------------------------------------------------------ 公司
const JOB_BASE = { dormProvided: true, dormRoomSize: 6, dormAircon: true, mealProvided: true }
async function approveJob(ops, co, body) {
  const jobId = (await co.pm.post('/tenant/jobs', { ...JOB_BASE, projectId: co.projectId, interviewAddress: co.address, ...body })).jobId
  co.meta[jobId] = body
  await ops.post(`/ops/jobs/${jobId}/approve`)
  return jobId
}

async function newCompany(ops, c) {
  const owner = await new Actor('tenant', c.ownerPhone).login()
  const hdr = { 'X-Onboarding-Ticket': owner.ticket }
  const license = (await owner.upload('/tenant/onboarding/files', PNG, '营业执照.png', 'image/png', hdr)).key
  const applied = await owner.ok('POST', '/tenant/onboarding/apply', { name: c.name, unifiedCreditCode: c.credit, contactName: c.ownerName, licenseFiles: [license] }, { headers: hdr })
  owner.token = applied.accessToken
  const companyId = (await owner.get('/tenant/me')).company.companyId
  const co = { ...c, owner, companyId, jobs: [], meta: {}, empSeq: 0 }
  if (c.pending) return co
  await ops.post(`/ops/companies/${companyId}/approve`)
  sql(`UPDATE company SET short_name = '${esc(c.short)}' WHERE company_id = '${companyId}'`)
  await owner.post('/tenant/members', { name: c.pmName, phone: c.pmPhone, roles: ['PM'] })
  co.pm = await new Actor('tenant', c.pmPhone).login()
  const clientId = (await co.pm.post('/tenant/clients', { name: c.client, city: c.city })).clientId
  const key = (await co.pm.upload('/tenant/files?category=contract', PNG, '合作合同.png', 'image/png')).key
  const contractId = (await co.pm.post('/tenant/client-contracts', { clientId, fileKey: key, validFrom: day(-120), validTo: day(600) })).contractId
  await ops.post(`/ops/client-contracts/${contractId}/approve`)
  co.projectId = (await co.pm.post('/tenant/projects', { name: c.project, clientId, city: c.city, address: c.address })).projectId
  await owner.post('/tenant/members', { name: c.siteName, phone: c.sitePhone, roles: ['SITE'], projectIds: [co.projectId] })
  co.site = await new Actor('tenant', c.sitePhone).login()
  for (const j of c.jobList) co.jobs.push(await approveJob(ops, co, j))
  co.channel = (await owner.post('/tenant/channel-codes', { name: c.short + ' 线下门店码' })).code
  return co
}

/** 今天的在途流程：私域待匹配、待面试各阶段、待确权、爽约、未通过、取消。过 24 小时会被系统按规则释放，演示前用 refresh 再补一批。 */
async function inflight(A, B, C) {
  const fresh = async (label, co, fn) => step(`${co.short}：${label}`, async () => fn(await newSeeker(co.channel)))
  for (let i = 0; i < 2; i++) await fresh('私域待匹配（刚扫码注册）', A, async () => undefined)
  await fresh('私域待匹配 → 已转人才经纪人、经纪人已联系', A, async (s) => {
    const caseId = await A.site.post(`/tenant/seekers/${s.userId}/transfer-to-broker`)
    await A.broker.post(`/tenant/broker/cases/${caseId}/contact`)
    await A.broker.post(`/tenant/broker/cases/${caseId}/report`)
  })
  await fresh('待面试（驻场还没知悉）', A, (s) => apply(s, A, 0))
  await fresh('待面试（已约明天面试）', A, async (s) => ack(A, await apply(s, A, 1)))
  await fresh('待面试（已到厂，等面试结果）', A, async (s) => { const id = await apply(s, A, 0); await ack(A, id, 0); await A.site.post(`/tenant/applications/${id}/arrive`) })
  await fresh('待确权（面试通过）', A, async (s) => { const id = await apply(s, A, 1); await ack(A, id, 0); await A.site.post(`/tenant/applications/${id}/result`, { pass: true }) })
  await fresh('待确权（合同已发、等本人签署）', A, async (s) => {
    const id = await apply(s, A, 0); await ack(A, id, 0); await A.site.post(`/tenant/applications/${id}/result`, { pass: true })
    await A.site.post(`/tenant/applications/${id}/confirm`, { startDate: day(1), employeeNo: 'ST' + pad(++A.empSeq, 4) })
  })
  await fresh('爽约', A, async (s) => { const id = await apply(s, A, 2); await ack(A, id, 0); await A.site.post(`/tenant/applications/${id}/no-show`, { remark: '约好 9 点半面试，电话三次未接' }) })
  await fresh('面试未通过', A, async (s) => { const id = await apply(s, A, 2); await ack(A, id, 0); await A.site.post(`/tenant/applications/${id}/result`, { pass: false, remark: '色弱，不符合目检岗位要求' }) })
  await fresh('取消报名', A, async (s) => { const id = await apply(s, A, 1); await A.site.post(`/tenant/applications/${id}/cancel`, { reason: '本人来电说已在别处上班' }) })
  await fresh('待面试（已约明天面试）', B, async (s) => ack(B, await apply(s, B, 0)))
  await fresh('待面试（驻场还没知悉）', B, (s) => apply(s, B, 1))
  await fresh('私域待匹配', B, async () => undefined)
  await fresh('待面试（已约明天面试）', C, async (s) => ack(C, await apply(s, C, 0)))
}

/** 读取一家已有公司的三个角色、项目、在招岗位和渠道码。 */
async function loadCompany(short, phones, siteName, address) {
  const co = { short, jobs: [], meta: {}, empSeq: 5000 + rnd(4000), siteName, address }
  co.owner = await new Actor('tenant', phones[0]).login()
  co.pm = await new Actor('tenant', phones[1]).login()
  co.site = await new Actor('tenant', phones[2]).login()
  co.companyId = (await co.owner.get('/tenant/me')).company.companyId
  co.projectId = (await co.pm.get('/tenant/projects'))[0].projectId
  for (const j of (await co.pm.get('/tenant/jobs?pageSize=50')).records.filter((x) => x.status === 'RECRUITING')) {
    co.jobs.push(j.jobId)
    co.meta[j.jobId] = j
  }
  co.channel = (await co.owner.get('/tenant/channel-codes'))[0].code
  return co
}

/** 只补今天的在途流程（公司、在岗人员、账单等不动）。 */
async function refresh() {
  for (const pat of ['*rl:sms:day:*', '*sms:iv:*']) {
    const keys = redis('--scan', '--pattern', pat).split(String.fromCharCode(10)).filter(Boolean)
    for (let i = 0; i < keys.length; i += 100) redis('DEL', ...keys.slice(i, i + 100))
  }
  ENGINE = sql("SELECT CONCAT(JSON_EXTRACT(config, '$.resultCount'), ',', JSON_EXTRACT(config, '$.maxPerCompanyPublic')) FROM engine_config WHERE status = 'ACTIVE'")
  sql("UPDATE engine_config SET config = JSON_SET(config, '$.resultCount', 30, '$.maxPerCompanyPublic', 30) WHERE status = 'ACTIVE'")
  const A = await step('读取公司 A', () => loadCompany('仕兔演示', ['13800000001', '13800000002', '13800000003'], '王磊', '昆山开发区前进东路 88 号'))
  const B = await step('读取公司 B', () => loadCompany('宏泰人力', ['13800000011', '13800000012', '13800000013'], '赵志刚', '苏州工业园区星湖街 328 号'))
  const C = await step('读取公司 C', () => loadCompany('汇智劳务', ['13800000021', '13800000022', '13800000023'], '冯大伟', '无锡新吴区长江路 16 号'))
  if (!A || !B || !C) throw new Error('读取演示公司失败')
  A.broker = await new Actor('tenant', '13800000004').login()
  await inflight(A, B, C)
  console.log(`\n完成：补了一批今天的在途流程，失败步骤 ${failed} 个`)
}

// ==================================================================== 主流程
async function main() {
  if (Number(sql('SELECT COUNT(*) FROM company')) > 1) {
    if (process.argv[2] === 'refresh') return refresh()
    console.log('库里已有多家公司，演示数据应该已经造过，退出。在途流程过了 24 小时会被系统自动释放，演示前补一批：node seed-demo.mjs refresh')
    return
  }
  // 演示账号的手机号当天可能已经登录过多次（同号一天发满 3 次短信就要图形验证），先清掉短信计数
  for (const pat of ['*rl:sms:day:*', '*sms:iv:*']) {
    const keys = redis('--scan', '--pattern', pat).split(String.fromCharCode(10)).filter(Boolean)
    for (let i = 0; i < keys.length; i += 100) redis('DEL', ...keys.slice(i, i + 100))
  }
  const ops = await opsLogin()
  ENGINE = sql("SELECT CONCAT(JSON_EXTRACT(config, '$.resultCount'), ',', JSON_EXTRACT(config, '$.maxPerCompanyPublic')) FROM engine_config WHERE status = 'ACTIVE'")
  sql("UPDATE engine_config SET config = JSON_SET(config, '$.resultCount', 30, '$.maxPerCompanyPublic', 30) WHERE status = 'ACTIVE'")
  const prevMonth = new Date(Date.UTC(shNow().getUTCFullYear(), shNow().getUTCMonth() - 1, 1))
  const prevYm = prevMonth.toISOString().slice(0, 7)
  const billFrom = prevYm + '-01'
  const sinceBillFrom = Math.round((new Date(day(0)) - new Date(billFrom)) / 86400e3)   // 上月 1 日距今多少天

  // ---------------------------------------------------------------- 1. 公司
  const A = { short: '仕兔演示', prefix: 'ST', jobs: [], meta: {}, empSeq: 0, siteName: '王磊', address: '昆山开发区前进东路 88 号' }
  await step('演示公司 A：登录三个角色、读取项目与岗位', async () => {
    A.owner = await new Actor('tenant', '13800000001').login()
    A.pm = await new Actor('tenant', '13800000002').login()
    A.site = await new Actor('tenant', '13800000003').login()
    A.companyId = (await A.owner.get('/tenant/me')).company.companyId
    A.projectId = (await A.pm.get('/tenant/projects'))[0].projectId
    for (const j of (await A.pm.get('/tenant/jobs?pageSize=50')).records.filter((x) => x.status === 'RECRUITING')) {
      A.jobs.push(j.jobId)
      A.meta[j.jobId] = j
    }
    const codes = await A.owner.get('/tenant/channel-codes')
    A.channel = codes[0]?.code ?? (await A.owner.post('/tenant/channel-codes', { name: '昆山人才市场地推码' })).code
    await A.owner.post('/tenant/members', { name: '陈晓峰', phone: '13800000004', roles: ['BROKER'] })
    A.broker = await new Actor('tenant', '13800000004').login()
    sql(`UPDATE company SET short_name = '仕兔演示劳务' WHERE company_id = '${A.companyId}'`)
  })
  const B = await step('公司 B：苏州宏泰人力（入驻、甲方合同、项目、岗位）', () => newCompany(ops, {
    name: '苏州宏泰人力资源有限公司', short: '宏泰人力', prefix: 'HT', credit: '91320594MA1HT' + pad(rnd(99999), 5),
    ownerName: '周宏泰', ownerPhone: '13800000011', pmName: '孙丽华', pmPhone: '13800000012', siteName: '赵志刚', sitePhone: '13800000013',
    client: '苏州博世达汽车零部件有限公司', city: '苏州', project: '博世达苏州工业园项目', address: '苏州工业园区星龙街 428 号',
    jobList: [
      { title: '汽车线束装配工', jobType: 'GENERAL', salaryMin: 6200, salaryMax: 7800, shiftType: 'TWO_SHIFT', duties: '线束插接、包胶、目检', quotaTotal: 40 },
      { title: '注塑机操作工', jobType: 'MACHINING', salaryMin: 6500, salaryMax: 8200, shiftType: 'TWO_SHIFT', duties: '注塑机上下料、修毛边、装箱', quotaTotal: 20 },
      { title: '成品质检员', jobType: 'QC', salaryMin: 5800, salaryMax: 6800, shiftType: 'LONG_DAY', duties: '成品外观与尺寸检验、记录', quotaTotal: 8 },
    ],
  }))
  const C = await step('公司 C：无锡汇智劳务（免费期内的新公司）', () => newCompany(ops, {
    name: '无锡汇智劳务派遣有限公司', short: '汇智劳务', prefix: 'HZ', credit: '91320213MA1HU' + pad(rnd(99999), 5),
    ownerName: '吴汇智', ownerPhone: '13800000021', pmName: '郑海燕', pmPhone: '13800000022', siteName: '冯大伟', sitePhone: '13800000023',
    client: '无锡先导智能装备股份有限公司', city: '无锡', project: '先导智能新吴区项目', address: '无锡新吴区新锡路 20 号',
    jobList: [
      { title: '设备装配普工', jobType: 'GENERAL', salaryMin: 6000, salaryMax: 7200, shiftType: 'LONG_DAY', duties: '设备部件装配、打螺丝、配线', quotaTotal: 25 },
      { title: '仓库叉车工', jobType: 'WAREHOUSE', salaryMin: 6500, salaryMax: 7500, shiftType: 'DAY', duties: '叉车装卸、库位整理（需叉车证）', quotaTotal: 6 },
    ],
  }))
  await step('公司 D：常州诚信人力（停在待审核，给运营中台看审核队列）', () => newCompany(ops, {
    name: '常州诚信人力资源服务有限公司', short: '诚信人力', credit: '91320411MA1CX' + pad(rnd(99999), 5), ownerName: '钱诚', ownerPhone: '13800000031', pending: true,
  }))
  if (!A.companyId || !B || !C) throw new Error('公司没建起来，后面的数据都依赖它们，停止')

  await step('A 新发一个岗位（停在待审核）', () => A.pm.post('/tenant/jobs', { ...JOB_BASE, projectId: A.projectId, interviewAddress: A.address,
    title: '包装工（临时工 · 日结）', jobType: 'GENERAL', salaryMin: 4800, salaryMax: 5600, shiftType: 'DAY', duties: '成品装箱、贴标、打包', quotaTotal: 15 }))
  await step('B 新备案一份甲方合同（停在待审核）', async () => {
    const clientId = (await B.pm.post('/tenant/clients', { name: '苏州纽威阀门股份有限公司', city: '苏州' })).clientId
    const key = (await B.pm.upload('/tenant/files?category=contract', PNG, '合作合同.png', 'image/png')).key
    await B.pm.post('/tenant/client-contracts', { clientId, fileKey: key, validFrom: day(-10), validTo: day(355) })
  })

  // ---------------------------------------------------------------- 2. 在岗人员（先全部入职，再往前拨日期）
  const staff = []
  /** src：注册用谁的渠道码（null = 公域自然注册）；release：先由来源公司释放到公域再去别家 */
  async function hire(label, src, co, days, jobIdx) {
    const s = await step(`入职 ${co.short}：${label}（${days} 天前）`, async () => {
      const x = await newSeeker(src?.channel)
      if (src && src !== co) {
        const caseId = await src.site.post(`/tenant/seekers/${x.userId}/transfer-to-broker`)
        await src.site.post(`/tenant/broker/cases/${caseId}/release`, { reason: '本公司暂无合适岗位，用户希望看其他公司' })
      }
      await employ(x, co, jobIdx)
      backdate(x, days)
      x.src = src
      return x
    })
    if (s) staff.push(s)
    return s
  }
  for (const [d, j] of [[75, 0], [70, 1], [62, 0], [55, 2], [30, 1], [21, 0], [12, 1], [5, 0]]) await hire('本公司引流', A, A, d, j)
  for (const [d, j] of [[50, 0], [33, 1], [18, 0], [9, 2]]) await hire('仕兔演示引流 → 流转', A, B, d, j)
  for (const [d, j] of [[40, 0], [15, 1]]) await hire('公域自然注册', null, B, d, j)
  for (const [d, j] of [[65, 0], [48, 1], [25, 0]]) await hire('本公司引流', B, B, d, j)
  for (const [d, j] of [[20, 0], [8, 1]]) await hire('本公司引流', C, C, d, j)
  await hire('仕兔演示引流 → 流转', A, C, 14, 0)
  await hire('宏泰人力引流 → 流转', B, A, 28, 1)
  const of = (co, pred = () => true) => staff.filter((s) => s.employer === co && pred(s))

  // 入驻日：A、B 设成「上月 1 日正好出免费期」，这样上月有增长服务费；C 留在免费期内
  sql(`UPDATE company SET onboard_date = '${billFrom}' - INTERVAL 3 MONTH, free_period_end = '${billFrom}' - INTERVAL 1 DAY, created_at = created_at - INTERVAL 130 DAY WHERE company_id IN ('${A.companyId}', '${B.companyId}')`)
  sql(`UPDATE company SET onboard_date = CURDATE() - INTERVAL 25 DAY, free_period_end = CURDATE() - INTERVAL 25 DAY + INTERVAL 3 MONTH - INTERVAL 1 DAY, created_at = created_at - INTERVAL 26 DAY WHERE company_id = '${C.companyId}'`)

  // ---------------------------------------------------------------- 3. 考勤、离职（要在补跑计费之前）
  await step('A 标记请假 / 旷工', async () => {
    const [p1, p2] = of(A, (s) => s.days >= 20)
    await A.site.put(`/tenant/employments/${p1.employmentId}/absences`, { date: day(-6), type: 'LEAVE', remark: '家中有事请假一天' })
    await A.site.put(`/tenant/employments/${p1.employmentId}/absences`, { date: day(-5), type: 'LEAVE', remark: '续假' })
    await A.site.put(`/tenant/employments/${p2.employmentId}/absences`, { date: day(-3), type: 'ABSENT', remark: '未到岗，电话未接' })
  })
  await step('A 一人已离职（3 天前）', async () => {
    const s = of(A, (x) => x.days === 55)[0]
    const rid = await A.site.post(`/tenant/employments/${s.employmentId}/resign`, { resignDate: day(-3), reason: '回老家照顾家人' })
    await A.pm.post(`/tenant/resign-requests/${rid}/decide`, { approve: true })
    s.resigned = true
  })
  await step('A 一人离职待生效（5 天后）', async () => {
    const s = of(A, (x) => x.days === 12)[0]
    const rid = await A.site.post(`/tenant/employments/${s.employmentId}/resign`, { resignDate: day(5), reason: '合同到期不续签' })
    await A.pm.post(`/tenant/resign-requests/${rid}/decide`, { approve: true })
    s.leaving = true
  })
  await step('B 一人离职待审核', async () => {
    const s = of(B, (x) => x.days === 25)[0]
    await B.site.post(`/tenant/employments/${s.employmentId}/resign`, { resignDate: day(2), reason: '找到离家近的工作' })
  })

  // ---------------------------------------------------------------- 4. 预支（已拨款 / 待终审 / 待初审）
  const advance = async (co, s, to) => {
    const id = await s.post('/seeker/advance')
    if (to === 'SUBMITTED') return
    await co.site.post(`/tenant/advances/${id}/site-review`, { approve: true, opinion: '出勤正常，同意' })
    if (to === 'SITE_APPROVED') return
    await co.pm.post(`/tenant/advances/${id}/pm-review`, { approve: true, opinion: '同意' })
    await co.pm.post(`/tenant/advances/${id}/payout`)
  }
  await step('A 预支：一笔已拨款', () => advance(A, of(A, (s) => s.days === 30)[0], 'PAID'))
  await step('A 预支：一笔已拨款（入职较久）', () => advance(A, of(A, (s) => s.days === 70)[0], 'PAID'))
  await step('A 预支：一笔待驻场初审', () => advance(A, of(A, (s) => s.days === 21)[0], 'SUBMITTED'))
  await step('B 预支：一笔待项目经理终审', () => advance(B, of(B, (s) => s.days === 33)[0], 'SITE_APPROVED'))

  // ---------------------------------------------------------------- 5. 补跑计费 → 上月账单 → 上月工资
  await step(`补跑每日计费：${billFrom} 至昨天（${sinceBillFrom} 天）`, async () => {
    for (let i = sinceBillFrom; i >= 1; i--) await ops.post(`/ops/billing/daily?date=${day(-i)}`)
  })
  await step(`生成并下发 ${prevYm} 账单`, () => ops.post(`/ops/billing/monthly?month=${prevYm}`))
  await step('B 对上月账单提异议；A 的上月账单登记已结算', async () => {
    const bb = (await B.owner.get('/tenant/bills')).records[0]
    await B.owner.post(`/tenant/bills/${bb.billId}/disputes`, { content: `${prevYm} 流转费里有 1 人月中请了 5 天事假，这几天是否应该停止计费？请核对。` })
    const ab = (await A.owner.get('/tenant/bills')).records[0]
    await ops.post(`/ops/bills/${ab.billId}/settle`)
  })
  const payroll = async (co) => {
    const rows = [['手机号', '工号（与手机号二选一）', '应发工资', '社保个人部分', '个税', '其他扣款']]
    for (const s of of(co, (x) => x.days > sinceBillFrom - 25 && !x.resigned)) {
      const gross = 5200 + rnd(26) * 100
      rows.push([s.phone, '', String(gross), '428.50', gross > 6500 ? String(rnd(60) + 12) : '0', rnd(4) === 0 ? '150' : '0'])
    }
    await co.pm.upload(`/tenant/payroll/import?month=${prevYm}`, xlsx(rows), `${prevYm}工资表.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }
  await step(`A 导入 ${prevYm} 工资表（自动抵扣预支）`, () => payroll(A))
  await step(`B 导入 ${prevYm} 工资表`, () => payroll(B))
  await step('A 一名员工对工资条提申诉', async () => {
    const s = of(A, (x) => x.days === 62)[0]
    const p = (await s.get('/seeker/payslips'))[0]
    await s.post(`/seeker/payslips/${p.payslipId}/appeals`, { content: '上个月加了 4 个晚班，加班费好像没有算进去，麻烦核对一下。' })
  })

  // ---------------------------------------------------------------- 6. 今天的在途流程
  await inflight(A, B, C)
  const pub = []
  for (let i = 0; i < 3; i++) { const s = await step('公域求职者（自然注册）', () => newSeeker(null)); if (s) pub.push(s) }

  // ---------------------------------------------------------------- 7. 问答、投诉、反馈、工伤、治理
  await step('A 知识库：三条常见问答 + 一条待补充', async () => {
    await A.owner.post('/tenant/kb', { question: '宿舍是几人间？有没有空调和热水？', answer: '4 到 6 人间，有空调、独立卫生间和 24 小时热水，水电费公司承担。' })
    await A.owner.post('/tenant/kb', { question: '工资几号发？怎么发？', answer: '每月 15 号发上个月工资，打到本人银行卡，工资条可以在手机上「我的工资」里看。' })
    await A.owner.post('/tenant/kb', { question: '入职要体检吗？费用谁出？', answer: '需要入职体检，在厂区医务室做，费用公司承担。' })
    const s = of(A, (x) => !x.resigned)[0]
    await s.post(`/seeker/jobs/${s.jobId}/ask`, { question: '夜班有没有夜班补贴，一个晚上多少钱？' })
  })
  await step('岗位投诉：一条待核实、一条核实属实', async () => {
    const [s1, s2] = of(A, (x) => !x.resigned)
    await s1.post('/seeker/complaints', { jobId: s1.jobId, category: 'INFO_FALSE', content: '岗位写的是长白班，实际进厂第二周就被安排上夜班。' })
    const id = await s2.post('/seeker/complaints', { jobId: s2.jobId, category: 'MISMATCH_AFTER_INTERVIEW', content: '面试时说包吃住，入职后食堂每餐要自己付 8 块钱。' })
    await ops.post(`/ops/complaints/${id}/handle`, { verified: true, remark: '电话回访 3 名在岗员工，情况属实，已要求公司更正岗位描述。' })
  })
  await step('问题反馈：一条已回复、一条待处理', async () => {
    const [s1] = of(B); const s2 = pub[0] ?? of(C)[0]
    const id = await s1.post('/seeker/feedback', { category: 'PAY', content: '预支的钱什么时候能到账？申请两天了还显示审批中。' })
    await ops.post(`/ops/feedback/${id}/reply`, { reply: '已联系你所在公司的项目经理，今天内会完成审批，审批通过后公司线下打款。', close: true })
    await s2.post('/seeker/feedback', { category: 'SUGGEST', content: '希望岗位详情里能看到工厂大门和宿舍的照片。' })
  })
  await step('A 工伤上报一条（处理中）', () => A.site.post('/tenant/incidents', { projectId: A.projectId, personName: of(A)[1].name, severity: 'MINOR',
    occurredAt: day(-1) + 'T14:20:00', detail: '搬运料箱时右手食指被夹伤，已在厂区医务室包扎，下午休息，明天复查。' }))
  await step('归属争议：登记一条待处理', () => ops.post('/ops/attribution/disputes', { userId: of(B, (s) => s.src === A)[0].userId, companyId: B.companyId,
    content: '宏泰人力称该员工是其业务员在苏州汽车站线下招来的，扫码时扫错了别家的码，要求把来源归属改为宏泰。' }))
  await step('诚信分：C 因岗位信息更新不及时被人工扣 5 分', () => ops.post(`/ops/companies/${C.companyId}/credit`, { delta: -5, remark: '岗位薪资调整后超过 7 天未更新岗位信息，经提醒后改正。' }))

  console.log(`\n完成：在岗 / 曾在岗 ${staff.length} 人，失败步骤 ${failed} 个`)
  console.log(`公司：${A.companyId} 仕兔演示  ${B.companyId} 宏泰人力  ${C.companyId} 汇智劳务，另有一家待审核`)
}

main().catch((e) => { console.error('中断：' + e.message); process.exitCode = 1 })
  .finally(() => {
    if (ENGINE) {
      const [n, m] = ENGINE.split(',')
      try { sql(`UPDATE engine_config SET config = JSON_SET(config, '$.resultCount', ${n}, '$.maxPerCompanyPublic', ${m}) WHERE status = 'ACTIVE'`) } catch (e) { console.error('匹配参数没恢复：' + e.message) }
    }
    try { sql(`UPDATE ops_admin SET must_change_password = ${MUST_CHANGE} WHERE username = 'admin'`) } catch { /* 忽略 */ } })
