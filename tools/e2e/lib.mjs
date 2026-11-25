// 端到端测试工具：对本地开发后端（http://localhost:8080）发真实请求
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE = 'http://localhost:8080/api/v1'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const results = []

export function phone() {
  return '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
}

export async function req(method, url, token, body, { raw = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON（文件下载） */ }
  return raw ? { status: r.status, json, text, headers: r.headers } : { status: r.status, code: json?.code, msg: json?.message, data: json?.data }
}

export const get = (u, t) => req('GET', u, t)
export const post = (u, t, b) => req('POST', u, t, b ?? {})
export const put = (u, t, b) => req('PUT', u, t, b ?? {})
export const del = (u, t) => req('DELETE', u, t)

/** 期望成功，返回 data；失败记录并抛出。 */
export async function ok(label, p) {
  const r = await p
  if (r.status !== 200 || r.code !== '0') {
    record(label, false, `${r.status} ${r.code} ${r.msg}`)
    throw new Error(`${label}: ${r.status} ${r.code} ${r.msg}`)
  }
  return r.data
}

export function check(label, cond, detail = '') {
  record(label, !!cond, detail)
  return !!cond
}

function record(label, pass, detail) {
  results.push({ label, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
}

export function summary(name) {
  const fail = results.filter((r) => !r.pass)
  console.log(`\n== ${name}: ${results.length - fail.length}/${results.length} 通过`)
  fs.writeFileSync(path.join(DIR, `${name}.result.json`), JSON.stringify(results, null, 2))
  return fail.length
}

async function smsLogin(domain, phoneNo, channelCode) {
  const s = await req('POST', `/${domain}/auth/sms-code`, null, { phone: phoneNo })
  if (s.code !== '0') throw new Error(`${domain} sms-code ${phoneNo}: ${s.code} ${s.msg}`)
  const body = { phone: phoneNo, code: s.data.devCode }
  if (channelCode) body.channelCode = channelCode
  const l = await req('POST', `/${domain}/auth/sms-login`, null, body)
  if (l.code !== '0') throw new Error(`${domain} login ${phoneNo}: ${l.code} ${l.msg}`)
  return l.data.accessToken
}

export const seekerLogin = (p, code) => smsLogin('seeker', p, code)
export const tenantLogin = (p) => smsLogin('tenant', p)

/** 平台：用保存的 refresh cookie 换令牌（cookie 轮换后回写）。 */
export async function opsLogin() {
  const file = path.join(DIR, 'ops.cookies')
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.includes('shitu_rt'))
  const val = line.trim().split('\t').pop()
  const r = await fetch(BASE + '/ops/auth/refresh', { method: 'POST', headers: { Cookie: 'shitu_rt=' + val, 'X-Requested-With': 'XMLHttpRequest' } })
  const j = await r.json()
  if (j.code !== '0') throw new Error('ops refresh: ' + j.code + ' ' + j.message)
  const set = r.headers.get('set-cookie') || ''
  const m = set.match(/shitu_rt=([^;]+)/)
  if (m) fs.writeFileSync(file, line.replace(val, m[1]) + '\n')
  return j.data.accessToken
}

/** 演示公司的公司码。每个库生成的码不一样，不能写死：优先用环境变量 CHANNEL_CODE，否则取老板名下第一个启用的公司码。 */
export async function companyCode(ownerToken) {
  if (process.env.CHANNEL_CODE) return process.env.CHANNEL_CODE
  const list = await ok('渠道码列表', get('/tenant/channel-codes', ownerToken))
  const hit = list.find((c) => c.kind === 'COMPANY' && c.status === 'ACTIVE')
  if (!hit) throw new Error('演示公司没有启用的公司码')
  return hit.code
}

/**
 * 按当前题库生成一组能匹配到岗位的答案（接受进厂、不限地区 / 工种 / 住宿，其余选第一项）。
 * 题库 v2（D-62）：年龄是数字题（填 30），班次是矩阵题（每种班次都「接受」）。
 */
export async function quizAnswers(t) {
  const q = await ok('读取题库', get('/seeker/quiz', t))
  return q.questions.map((qq) => {
    if (qq.questionType === 'NUMBER') return { seq: qq.seq, number: Math.min(qq.config?.max ?? 65, Math.max(qq.config?.min ?? 16, 30)) }
    if (qq.questionType === 'MATRIX') return { seq: qq.seq, matrix: Object.fromEntries(qq.options.map((r) => [r.code, 'ACCEPT'])) }
    const pick = (pred) => qq.options.find(pred) ?? qq.options[0]
    let o
    if (qq.profileField === 'accept_factory') o = pick((x) => x.value === 'YES')
    else if (qq.profileField === 'locked_region') o = pick((x) => x.value === 'ANY')
    else if (qq.profileField === 'expect_job_type') o = pick((x) => x.value === 'ANY')
    else if (qq.profileField === 'dorm_req') o = pick((x) => x.value === 'NONE' || x.value === 'NOT_NEEDED')
    else o = qq.options[0]
    return { seq: qq.seq, code: o.code }
  })
}

/** 上传文件（multipart），返回值结构同 req。 */
export async function upload(url, token, fileName, buf, { fields = {}, headers = {}, type = 'application/octet-stream' } = {}) {
  const form = new FormData()
  form.append('file', new Blob([buf], { type }), fileName)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const h = { ...headers }
  if (token) h.Authorization = 'Bearer ' + token
  const r = await fetch(BASE + url, { method: 'POST', headers: h, body: form })
  const json = await r.json().catch(() => null)
  return { status: r.status, code: json?.code, msg: json?.message, data: json?.data }
}

/** 新求职者：（可带渠道码）注册 → 告知书 → 实名 → 问薪。 */
export async function readySeeker(channelCode, idCard) {
  const p = phone()
  const t = await seekerLogin(p, channelCode)
  const d = await ok('告知书', get('/seeker/disclaimer', t))
  await ok('同意告知书', post('/seeker/disclaimer/agree', t, { version: d.version }))
  const id = idCard ?? makeIdCard(25 + Math.floor(Math.random() * 15))
  await ok('实名', post('/seeker/kyc', t, { realName: '测试' + '甲乙丙丁戊'[Math.floor(Math.random() * 5)], idCard: id, idCardConfirm: id }))
  return { token: t, phone: p, idCard: id }
}

export function makeIdCard(age) {
  const y = new Date().getFullYear() - age
  const body = '110105' + y + '0' + (1 + Math.floor(Math.random() * 9)) + String(10 + Math.floor(Math.random() * 18)) +
    String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const c = '10X98765432'
  let s = 0
  for (let i = 0; i < 17; i++) s += Number(body[i]) * w[i]
  return body + c[s % 11]
}

/** 带缓存的会话：优先用缓存的 refresh cookie（避免触发 60 秒短信冷却），失效再走短信登录。返回登录接口的 data。 */
async function cachedSession(domain, phoneNo, extra = {}) {
  const file = path.join(DIR, `${domain}-${phoneNo}.rt`)
  if (fs.existsSync(file)) {
    const r = await fetch(BASE + `/${domain}/auth/refresh`, {
      method: 'POST', headers: { Cookie: 'shitu_rt=' + fs.readFileSync(file, 'utf8').trim(), 'X-Requested-With': 'XMLHttpRequest' },
    })
    const j = await r.json()
    const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
    if (j.code === '0') {
      if (m) fs.writeFileSync(file, m[1])
      return j.data
    }
  }
  const s = await req('POST', `/${domain}/auth/sms-code`, null, { phone: phoneNo })
  if (s.code !== '0') throw new Error(`${domain} sms-code ${phoneNo}: ${s.code} ${s.msg}`)
  const r = await fetch(BASE + `/${domain}/auth/sms-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneNo, code: s.data.devCode, ...extra }),
  })
  const j = await r.json()
  if (j.code !== '0') throw new Error(`${domain} login ${phoneNo}: ${j.code} ${j.message}`)
  const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
  if (m) fs.writeFileSync(file, m[1])
  return j.data
}

/** 公司成员会话，缓存在 tenant-<手机号>.rt。 */
export const tenantSession = async (phoneNo) => (await cachedSession('tenant', phoneNo)).accessToken

/** 求职者会话，缓存在 seeker-<手机号>.rt；首次登录即注册，可带渠道码。 */
export const seekerSession = async (phoneNo, channelCode) =>
  (await cachedSession('seeker', phoneNo, channelCode ? { channelCode } : {})).accessToken

/** 还不是任何公司成员的手机号登录后台：返回入驻申请用的 onboardingTicket。 */
export const onboardingTicket = async (phoneNo) => (await cachedSession('tenant', phoneNo)).onboardingTicket

/** 读会话文件里的 refresh token（ops.cookies 是 curl 的 cookie 文件格式，*.rt 只有一个值）。 */
export function readRt(file) {
  const t = fs.readFileSync(path.join(DIR, file), 'utf8')
  const line = t.split('\n').find((l) => l.includes('shitu_rt'))
  return (line ? line.trim().split('\t').pop() : t).trim()
}
/** 浏览器里轮换过的 refresh token 要写回文件，否则旧 token 下次用会触发重放吊销。 */
export function writeRt(file, val) {
  const p = path.join(DIR, file)
  const t = fs.readFileSync(p, 'utf8')
  const line = t.split('\n').find((l) => l.includes('shitu_rt'))
  fs.writeFileSync(p, line ? line.replace(line.trim().split('\t').pop(), val) + '\n' : val)
}
