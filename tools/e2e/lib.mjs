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

/** 公司成员：优先用缓存的 refresh cookie（避免触发 60 秒短信冷却），失效再走短信登录。 */
export async function tenantSession(phoneNo) {
  const file = path.join(DIR, `tenant-${phoneNo}.rt`)
  if (fs.existsSync(file)) {
    const r = await fetch(BASE + '/tenant/auth/refresh', {
      method: 'POST', headers: { Cookie: 'shitu_rt=' + fs.readFileSync(file, 'utf8').trim(), 'X-Requested-With': 'XMLHttpRequest' },
    })
    const j = await r.json()
    const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
    if (j.code === '0') {
      if (m) fs.writeFileSync(file, m[1])
      return j.data.accessToken
    }
  }
  const s = await req('POST', '/tenant/auth/sms-code', null, { phone: phoneNo })
  if (s.code !== '0') throw new Error(`tenant sms-code ${phoneNo}: ${s.code} ${s.msg}`)
  const r = await fetch(BASE + '/tenant/auth/sms-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneNo, code: s.data.devCode }),
  })
  const j = await r.json()
  if (j.code !== '0') throw new Error(`tenant login ${phoneNo}: ${j.code} ${j.message}`)
  const m = (r.headers.get('set-cookie') || '').match(/shitu_rt=([^;]+)/)
  if (m) fs.writeFileSync(file, m[1])
  return j.data.accessToken
}
