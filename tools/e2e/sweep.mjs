// 接口巡检：前端用到的每个 GET 接口，用对应角色调一遍。5xx 一律算失败；同时检查响应里是否混入下划线字段名。
import { get, check, summary, opsLogin, tenantSession, seekerLogin, phone, ok } from './lib.mjs'

const SNAKE_ALLOWED = /^(?:[A-Z0-9_]+|[a-z]+(?:_[a-z]+)+\.(?:png|jpg|pdf))$/   // 枚举值 / 文件名
function snakeKeys(v, out = new Set(), depth = 0) {
  if (depth > 6 || v == null || typeof v !== 'object') return out
  if (Array.isArray(v)) { v.slice(0, 5).forEach((x) => snakeKeys(x, out, depth + 1)); return out }
  for (const [k, x] of Object.entries(v)) {
    // 以业务编码为键的 Map（状态计数、字典、题目画像字段）不算
    if (/^[a-z]+(_[a-z0-9]+)+$/.test(k) && !SNAKE_ALLOWED.test(k)) out.add(k)
    snakeKeys(x, out, depth + 1)
  }
  return out
}

async function probe(role, token, url, { expect = [200], snakeOk = false } = {}) {
  const r = await get(url, token)
  const good = expect.includes(r.status) && r.status < 500
  const snakes = r.status === 200 && !snakeOk ? [...snakeKeys(r.data)] : []
  check(`${role.padEnd(6)} GET ${url}`, good && snakes.length === 0,
    !good ? `${r.status} ${r.code} ${r.msg}` : snakes.length ? '下划线字段：' + snakes.slice(0, 6).join(',') : '')
  return r.data
}

async function main() {
  const ops = await opsLogin()
  const owner = await tenantSession('13800000001')
  const pm = await tenantSession('13800000002')
  const site = await tenantSession('13800000003')
  const seeker = await seekerLogin(phone())

  // ---- 字典（公开）
  await probe('anon', null, '/dict', { snakeOk: true })

  // ---- 公司后台
  const jobs = await probe('pm', pm, '/tenant/jobs?pageSize=20')
  const jobId = jobs?.records?.[0]?.jobId
  const projects = await probe('pm', pm, '/tenant/projects')
  const projectId = projects?.[0]?.projectId
  for (const u of ['/tenant/me', '/tenant/company', '/tenant/members', '/tenant/clients', '/tenant/client-contracts',
    '/tenant/channel-codes', '/tenant/jobs/stats', '/tenant/bills', '/tenant/ledger?month=' + new Date().toISOString().slice(0, 7),
    '/tenant/reports/overview', '/tenant/reports/channels', '/tenant/kb', '/tenant/kb/pending', '/tenant/payroll/batches',
    '/tenant/advances', '/tenant/messages', '/tenant/messages/unread-count', '/tenant/site/workbench',
    '/tenant/applications?pageSize=20', '/tenant/ledger/people', '/tenant/payroll/recon?month=' + new Date().toISOString().slice(0, 7)]) {
    await probe('owner', owner, u)
  }
  for (const u of ['/tenant/reports/board', '/tenant/resign-requests', '/tenant/broker/cases', '/tenant/broker/cases/counts',
    '/tenant/employments?pageSize=20', '/tenant/applications?sort=DEADLINE&pageSize=20', '/tenant/applications?sort=CREATED_DESC',
    '/tenant/site/private-pending', '/tenant/advances', '/tenant/roster/batches', '/tenant/incidents', '/tenant/reports/timeouts']) {
    await probe('pm', pm, u, { snakeOk: u.includes('counts') })
  }
  await probe('site', site, '/tenant/channel-codes/mine')
  await probe('site', site, '/tenant/site/workbench')
  if (jobId) {
    await probe('pm', pm, '/tenant/jobs/' + jobId)
    await probe('pm', pm, '/tenant/jobs/' + jobId + '/audits')
  }
  if (projectId) await probe('pm', pm, '/tenant/projects/' + projectId)
  const apps = await get('/tenant/applications?pageSize=5', site)
  const appId = apps.data?.records?.[0]?.applicationId
  if (appId) await probe('site', site, '/tenant/applications/' + appId)
  const emps = await get('/tenant/employments?pageSize=5', pm)
  const empId = (emps.data?.records ?? emps.data ?? [])[0]?.employmentId
  if (empId) await probe('pm', pm, `/tenant/employments/${empId}/absences?month=${new Date().toISOString().slice(0, 7)}`)
  const bills = await get('/tenant/bills', owner)
  const billId = bills.data?.[0]?.billId
  if (billId) await probe('owner', owner, '/tenant/bills/' + billId)
  const advs = await get('/tenant/advances', pm)
  const advId = advs.data?.[0]?.advanceId
  if (advId) await probe('pm', pm, '/tenant/advances/' + advId)
  const cases = await get('/tenant/broker/cases', pm)
  const caseId = cases.data?.[0]?.id
  if (caseId) await probe('pm', pm, `/tenant/broker/cases/${caseId}/report`, { expect: [200, 404] })

  // ---- 平台中台
  for (const u of ['/ops/me', '/ops/pending', '/ops/companies', '/ops/companies/C10002', '/ops/companies/C10002/credit',
    '/ops/companies/lookup?keyword=演示', '/ops/client-contracts', '/ops/jobs', '/ops/quiz/versions', '/ops/engine/versions',
    '/ops/reports/overview', '/ops/billing/rules', '/ops/bills', '/ops/stock-bases', '/ops/complaints', '/ops/penalties',
    '/ops/job-weights', '/ops/kyc-reviews', '/ops/blacklist', '/ops/notify-templates', '/ops/admins', '/ops/audit-logs',
    '/ops/sys-params', '/ops/holidays', '/ops/attribution/disputes', '/ops/kyc-records', '/ops/reports/quiz-funnel',
    '/ops/attribution?phone=13800000001']) {
    await probe('ops', ops, u, { expect: u.includes('attribution?') ? [200, 404] : [200] })
  }
  const qv = await get('/ops/quiz/versions', ops)
  if (qv.data?.[0]) await probe('ops', ops, '/ops/quiz/versions/' + qv.data[0].versionId)
  const ev = await get('/ops/engine/versions', ops)
  if (ev.data?.[0]) await probe('ops', ops, '/ops/engine/versions/' + ev.data[0].versionId, { snakeOk: true })
  const oj = await get('/ops/jobs', ops)
  const ojId = (oj.data?.records ?? oj.data ?? [])[0]?.jobId
  if (ojId) await probe('ops', ops, '/ops/jobs/' + ojId)
  const ob = await get('/ops/bills', ops)
  const obId = (ob.data?.records ?? ob.data ?? [])[0]?.billId
  if (obId) await probe('ops', ops, '/ops/bills/' + obId)

  // ---- C 端（新注册用户）
  for (const u of ['/seeker/me', '/seeker/quiz', '/seeker/disclaimer', '/seeker/kyc', '/seeker/kyc/appeals', '/seeker/applications',
    '/seeker/messages', '/seeker/messages/unread-count', '/seeker/match/latest', '/seeker/work', '/seeker/contracts',
    '/seeker/contracts/pending', '/seeker/recommendations', '/seeker/advance', '/seeker/advance/quota', '/seeker/advance/debt-log',
    '/seeker/payslips', '/seeker/broker-case', '/seeker/ledger', '/seeker/resume', '/seeker/feedback', '/seeker/public/channel/qYAtWMU9']) {
    await probe('seeker', seeker, u, { snakeOk: u === '/seeker/quiz' })
  }
  if (jobId) await probe('seeker', seeker, '/seeker/jobs/' + jobId, { expect: [200, 404, 403] })
}

main().catch((e) => console.error('中断：', e.message)).finally(() => process.exit(summary('sweep')))
