// 工单29：真实浏览器请求失败 / 15秒超时后的原地重试；不截图，业务写入全部拦截。
// node tools/e2e/network-retry.mjs [--app seeker|staff]；前提同 README，必须已有测试人物会话。
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { openTab, sleep } from './cdp.mjs'
import { readRt, writeRt } from './lib.mjs'
import { APPS, VIEWPORT } from './routes.mjs'

const data = JSON.parse(fs.readFileSync(new URL('./shots/baseline-data.json', import.meta.url)))
const modes = process.argv.includes('--mode') ? [process.argv[process.argv.indexOf('--mode') + 1]] : ['fail', 'hang', 'business']
const selection = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : ''
const only = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : ''
const reply = (data) => ({ code: '0', message: 'ok', data })
const response = (url, data) => ({ url, method: 'GET', action: 'respond', body: reply(data) })
const reason = '该报名状态已变化，请刷新后重试'
const input = '用户误操作报名'
const hour = (h) => new Date(Date.now() + (h + 8) * 3600e3).toISOString().slice(0, 19)
const application = { applicationId: 'BM-UI29', userId: 'U-UI29', seekerName: '赵**', phone: '13900000001', jobId: 'J-UI29', jobTitle: '成品仓储分拣员', projectId: 'P-UI29', projectName: '测试项目', status: 'PENDING_INTERVIEW', fromPublic: false, createdAt: hour(-22), responseDeadline: hour(2), allowedActions: ['ACKNOWLEDGE', 'ARRIVE', 'PASS', 'FAIL', 'NO_SHOW', 'CANCEL'] }
const button = (text, scope = 'body') => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b => b.getClientRects().length && b.innerText.trim() === ${JSON.stringify(text)})`
const cases = [
  { app: 'seeker', path: '/recommendations', rt: `seeker-${data.personas.matched.phone}.rt`, endpoint: '/seeker/recommendations/1/decision', submit: button('去报名'),
    rules: [response('/seeker/jobs/J-UI29', { jobId: 'J-UI29', title: '推荐岗位', companyName: '测试劳务', salaryMin: 5000, salaryMax: 6000, quotaRemaining: 10, shiftType: 'DAY', canApply: true }), response('/seeker/recommendations', [{ id: 1, jobId: 'J-UI29', jobTitle: '推荐岗位', companyName: '测试劳务', note: '', decision: 'PENDING', createdAt: hour(-1) }]),
      response('/seeker/messages', []), response('/seeker/me', { userId: data.personas.matched.userId, status: 'PRIVATE_PENDING', domainTag: 'PRIVATE', kycStatus: 'VERIFIED', canStartMatching: true, boundCompanyName: '测试劳务' })],
    success: "location.pathname === '/jobs/J-UI29' && document.body.innerText.includes('报名面试')" },
  { app: 'staff', path: '/', rt: 'tenant-13800000003.rt', endpoint: '/tenant/applications/BM-UI29/cancel', submit: button('确认取消', '.reason-dlg'),
    rules: [response('/tenant/site/workbench', { pendingAck: 1, pendingInterview: 1, pendingConfirm: 0, windowsDueIn4h: 1, privatePending: 0, arrivedToday: 0 }),
      response('/tenant/site/private-pending', []), response('/tenant/applications', { records: [application], total: 1, page: 1, pageSize: 20 })],
    steps: [`${button('更多')}.click()`, `${button('取消报名')}.click()`, `${button(input)}.click()`],
    success: "!document.querySelector('.reason-dlg')?.getClientRects().length" },
]
const fill = (selector, value) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })) })()`
const staffBase = { ...cases[1] }
cases[0].name = 'recommendations'
cases[1].name = 'reason'
cases[1].kept = ".reason-dlg textarea"
cases[1].value = input
const advance = { advanceId: 'YZ-UI29', seekerName: '刘**', projectName: '测试项目', amount: 500, bizMonth: '2026-11', status: 'SUBMITTED', repaidAmount: 0, createdAt: hour(-1), allowedActions: ['SITE_APPROVE', 'SITE_REJECT'] }
cases.push(
  { ...staffBase, name: 'ack', endpoint: '/tenant/applications/BM-UI29/acknowledge', submit: button('确认知悉并推送', '.ack'),
    rules: [...staffBase.rules, response('/tenant/jobs/J-UI29', { interviewAddress: '测试面试地点' })],
    steps: [`[...document.querySelectorAll('button')].find(b => b.innerText.includes('知悉并推送')).click()`, fill('.ack textarea', '测试面试地点')], kept: '.ack textarea', value: '测试面试地点', success: "!document.querySelector('.ack')?.getClientRects().length", result: application },
  { ...staffBase, name: 'confirm', path: '/todo?tab=confirm', endpoint: '/tenant/applications/BM-UI29/confirm', submit: button('确认入职并发起电子签约', '.cf'),
    rules: [response('/tenant/applications', { records: [{ ...application, status: 'PENDING_CONFIRM', allowedActions: ['CONFIRM', 'CANCEL'] }], total: 1, page: 1, pageSize: 20 })],
    steps: [`[...document.querySelectorAll('button')].find(b => b.innerText.includes('入职确权')).click()`, fill('.cf input[placeholder^="选填"]', 'UI29')], kept: '.cf input[placeholder^="选填"]', value: 'UI29', success: "document.querySelector('.cf')?.innerText.includes('电子合同已生成')", result: { contractId: 'HT-UI29', status: 'PENDING_SIGN' } },
  { ...staffBase, name: 'advance', path: '/advance', endpoint: '/tenant/advances/YZ-UI29/site-review', submit: button('确认驳回', '.reason-dlg'),
    rules: [response('/tenant/advances', [advance])], steps: [`${button('驳回')}.click()`, fill('.reason-dlg textarea', input)], kept: '.reason-dlg textarea', value: input },
  { ...staffBase, name: 'messages', path: '/messages', endpoint: '/tenant/messages/read', submit: button('全部已读'),
    rules: [response('/tenant/messages/unread-count', 1), response('/tenant/messages', { records: [{ id: 29, title: '测试消息', content: '测试内容', read: false, createdAt: hour(-1) }], total: 1, page: 1, pageSize: 20 })],
    steps: [], success: "!document.querySelector('.msg.unread')", result: 1 },
  { ...staffBase, name: 'incidents', path: '/incidents', endpoint: '/tenant/incidents', submit: button('立即上报'),
    rules: [response('/tenant/incidents', []), response('/tenant/projects', [{ projectId: 'P-UI29', name: '测试项目' }])],
    steps: [`${button('上报工伤')}.click()`, fill('input[placeholder="姓名"]', '测试人员'), fill('.sheet textarea', '测试事发经过与处置')], kept: '.sheet textarea', value: '测试事发经过与处置', success: "!document.querySelector('.sheet')?.getClientRects().length", result: 29 },
  { ...staffBase, name: 'absence', path: '/employees', endpoint: '/tenant/employments/E-UI29/absences', method: 'PUT', submit: button('标记 请假', '.abs'),
    rules: [response('/tenant/employments/E-UI29/absences', []), response('/tenant/employments', { records: [{ employmentId: 'E-UI29', seekerName: '测试人员', startDate: '2026-01-01', projectName: '测试项目', jobTitle: '测试岗位' }], total: 1, page: 1, pageSize: 20 })],
    steps: ["document.querySelector('#app article.item').click()", fill('.abs input[placeholder^="选填"]', '测试请假备注')], kept: '.abs input[placeholder^="选填"]', value: '测试请假备注', success: "document.body.innerText.includes('已标记')" },
  { ...staffBase, name: 'transfer', path: '/reminders?f=private', endpoint: '/tenant/seekers/U-UI29/transfer-to-broker', submit: button('确认流转', '.van-dialog'),
    rules: [response('/tenant/site/private-pending', [{ userId: 'U-UI29', seekerName: '测试人员', phone: '13900000001', registeredAt: hour(-22), deadline: hour(2), inBrokerPool: false }]), response('/tenant/applications', { records: [], total: 0, page: 1, pageSize: 20 })],
    steps: [`${button('一键流转经纪人')}.click()`], success: "!document.querySelector('.van-dialog')?.getClientRects().length", businessDisabled: false },
)
// 共用组件的其他页面入口也走同一套检查，避免只验证工作台实例。
cases.push(
  { ...cases[1], name: 'reason-todo', path: '/todo' },
  { ...cases[1], name: 'reason-detail', path: '/applications/BM-UI29', rules: [response('/tenant/applications/BM-UI29/insight', { profileTags: [], matchRecords: [], history: [] }), response('/tenant/applications/BM-UI29', application)] },
  { ...cases.find(c => c.name === 'ack'), name: 'ack-reminders', path: '/reminders?f=ack' },
  { ...cases.find(c => c.name === 'advance'), name: 'advance-detail', path: '/advance/YZ-UI29', rules: [response('/tenant/advances/YZ-UI29', { advance, approvals: [], ledger: [] })] },
)
const selected = cases.filter(c => (!only || c.app === only) && (!selection || selection.split(',').includes(c.name)))
assert.ok(selected.length, '没有匹配的回归用例')
assert.ok(modes.every(mode => ['fail', 'hang', 'business'].includes(mode)), '不支持的失败模式')
if (selection) assert.ok(selection.split(',').every(name => selected.some(c => c.name === name)), '存在未匹配的用例名称')
let failed = 0
for (const c of selected) {
  for (const mode of modes) {
    const b = await openTab(VIEWPORT.mobile)
    const conf = APPS[c.app]
    const evaluate = async (expression) => {
      const r = await b.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] ?? r.result.exceptionDetails.text)
      return r.result?.result?.value
    }
    const until = async (expression, message, timeout = 5000) => {
      const start = Date.now()
      while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100) }
      throw new Error(message)
    }
    // refresh 是唯一放行的写请求；任何未登记的业务写请求均失败，不能落库。
    const safe = [{ url: '/auth/refresh', action: 'continue' }, { url: '/api/', method: '!GET', action: 'fail' }]
    const rule = { url: c.endpoint, method: c.method ?? 'POST', action: mode === 'business' ? 'respond' : mode, body: { code: 'APP_4090', message: reason, data: null } }
    try {
      await b.send('Network.setCookie', { name: 'shitu_rt', value: readRt(c.rt), url: conf.base + conf.cookiePath, path: conf.cookiePath, httpOnly: true })
      await b.intercept([rule, ...c.rules, ...safe])
      await b.send('Page.navigate', { url: conf.base + c.path })
      await b.settle()
      for (const step of c.steps ?? []) { await evaluate(step); await sleep(350) }
      await until(`!!(${c.submit})`, '未找到提交按钮（检查服务和测试会话）')
      // 只计数目标请求，不读请求头、令牌或 Cookie；请求仍通过真实 XHR 与 http.ts。
      await evaluate(`(() => { window.__retryCount = 0; const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method, url, ...args) { if (String(method).toUpperCase() === ${JSON.stringify(c.method ?? 'POST')} && String(url).includes(${JSON.stringify(c.endpoint)})) window.__retryCount++; return open.call(this, method, url, ...args) } })()`)
      await evaluate(`${c.submit}.click()`)
      const hint = mode === 'business' ? reason : '网络异常，请检查网络后重试'
      await until(`document.body.innerText.includes(${JSON.stringify(hint)})`, '没有错误提示', 18000)
      await until(`!document.querySelector('.van-button--loading')`, '错误后仍在提交中')
      assert.equal(await evaluate('window.__retryCount'), 1, '第一次提交必须经过真实请求')
      if (c.kept) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(c.kept)})?.value`), c.value, '失败丢失弹窗或输入')
      if (mode === 'business') {
        assert.equal(await evaluate(`${c.submit}?.disabled`), c.businessDisabled !== false, '真正业务拒绝的确认禁用行为改变')
        await sleep(2200)
        assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(reason)})`), true, '业务拒绝原因没有保留')
      } else {
        assert.equal(await evaluate(`${c.submit}?.disabled`), false, '网络失败被误判业务拒绝，无法立即重试')
        if (c.app === 'staff') assert.equal(await evaluate("document.querySelector('#app').innerText.includes('暂时不能')"), false, '网络失败传播为列表拒绝')
        await b.intercept([{ ...rule, action: 'respond', body: reply(c.result ?? null) }, ...c.rules, ...safe])
        await evaluate(`${c.submit}.click()`)
        await until(c.success, '恢复网络后原地重试没有成功')
        assert.equal(await evaluate('window.__retryCount'), 2, '重试必须发出第二次请求')
      }
      console.log(`PASS ${c.app}/${c.name} ${mode}：提示、输入、按钮及${mode === 'business' ? '业务拒绝' : '原地重试'}符合预期`)
    } catch (e) {
      failed++
      console.log(`FAIL ${c.app}/${c.name} ${mode}：${e.message}`)
    } finally {
      const cookies = await b.send('Network.getCookies', { urls: [conf.base + conf.cookiePath + '/refresh'] })
      const rt = cookies.result?.cookies.find(c => c.name === 'shitu_rt')
      if (rt) writeRt(c.rt, rt.value)
      await b.close()
    }
  }
}
process.exitCode = failed ? 1 : 0
