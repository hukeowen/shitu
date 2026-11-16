// 界面驱动：连到服务器本机的无头 Chrome，用真实鼠标键盘事件操作四个端的页面。
// 给 e2e.mjs 用，也可以单独跑一段步骤文件做排查：
//   node ui-driver.mjs start            启动常驻 Chrome（调试端口 9335）
//   node ui-driver.mjs run steps.mjs    在常驻 Chrome 里执行步骤文件（export default async (ui) => {}）
//   node ui-driver.mjs stop
import fs from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const ORIGIN = 'http://127.0.0.1:8888'
const PORT = 9335
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function startChrome() {
  const c = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/e2e-profile-' + Date.now(), 'about:blank'], { stdio: 'ignore', detached: true })
  c.unref()
  return c
}

export async function connect() {
  let tgt
  for (let i = 0; i < 40 && !tgt; i++) {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => null)
    tgt = list?.find((t) => t.type === 'page')
    if (!tgt) await sleep(500)
  }
  if (!tgt) throw new Error('连不上 Chrome')
  const ws = new WebSocket(tgt.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const apiReq = new Map()
  // 进行中的请求按编号记：跳转时被丢弃的请求不一定有结束事件，只数个数会越积越多，每次等待都耗到上限
  const open = new Map()
  let lastNet = Date.now()
  const busy = () => { const now = Date.now(); for (const [k, t] of open) if (now - t > 8000) open.delete(k); return open.size > 0 }
  const ui = { problems: [], calls: [], log: (...a) => console.log(...a), quiet: false }
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    const p = m.params
    if (m.method === 'Network.requestWillBeSent') { open.set(p.requestId, Date.now()); lastNet = Date.now(); if (p.request.url.includes('/api/')) apiReq.set(p.requestId, { m: p.request.method, u: p.request.url.replace(ORIGIN + '/api/v1', '') }) }
    if (m.method === 'Network.loadingFailed') { open.delete(p.requestId); lastNet = Date.now() }
    if (m.method === 'Page.frameNavigated' && !p.frame.parentId) open.clear()
    if (m.method === 'Network.responseReceived' && apiReq.has(p.requestId)) apiReq.get(p.requestId).status = p.response.status
    if (m.method === 'Network.loadingFinished') {
      open.delete(p.requestId); lastNet = Date.now()
      const r = apiReq.get(p.requestId)
      if (r) send('Network.getResponseBody', { requestId: p.requestId }).then((b) => {
        const body = b.result?.body ?? ''
        r.code = /"code":"([^"]+)"/.exec(body.slice(0, 200))?.[1]
        r.msg = /"message":"([^"]*)"/.exec(body.slice(0, 400))?.[1]
        r.body = body.length < 6000 ? body : body.slice(0, 300)
        const cap = /"captchaId":"([^"]+)"/.exec(body)
        if (cap) ui.captchaId = cap[1]
        ui.calls.push(r)
        if (r.m !== 'GET') ui.lastWrite = r
        const bad = r.status >= 500 || (r.code && r.code !== '0') || (r.status >= 400 && r.status !== 401)
        if (bad) { const line = `${r.m} ${r.u} → ${r.status} ${r.code ?? ''} ${r.msg ?? ''}`; ui.apiErrors.push(line); if (!ui.quiet) console.log('   ! 接口 ' + line) }
      })
    }
    if (m.method === 'Runtime.exceptionThrown') { const t = (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300); ui.problems.push('脚本报错 ' + t); console.log('   ! 脚本报错 ' + t) }
  })
  ui.apiErrors = []
  ui.send = send
  ui.ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text))
    return r.result?.result?.value
  }
  ui.idle = async (max = 9000) => { const t0 = Date.now(); await sleep(500); while (Date.now() - t0 < max && (busy() || Date.now() - lastNet < 600)) await sleep(120); await sleep(300) }
  ui.sleep = sleep
  await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('DOM.enable')
  // 轻提示两秒就消失，页面里留一份记录，see() 一并检查
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__toasts = []; setInterval(() => { for (const e of document.querySelectorAll('.van-toast, .el-message, .el-notification')) { const t = (e.innerText || '').trim(); if (t && e.getClientRects().length && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t) } }, 80)` })

  ui.viewport = (kind) => kind === 'mobile'
    ? send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    : send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  /** 换一个身份：清掉登录态并换视口。 */
  ui.fresh = async (kind, opt = {}) => {
    await send('Page.navigate', { url: ORIGIN + '/404-blank' }); await sleep(300)
    await ui.ev('try { localStorage.clear(); sessionStorage.clear() } catch (e) {}')
    await send('Network.clearBrowserCookies')
    // 每个身份一个模拟来源地址，免得同一地址短信发多了每次都要图形验证
    if (!opt.sameIp) await send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': `36.${1 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` } })
    await ui.viewport(kind)
  }
  ui.goto = async (path) => { await send('Page.navigate', { url: ORIGIN + path }); await ui.idle() }
  ui.url = () => ui.ev('location.pathname + location.search')
  ui.shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'))
  }

  // 页面里的查找函数：只看最上层的弹层（有的话），否则看整页
  const FIND = `
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
    const scope = () => {
      const layers = [...document.querySelectorAll('.el-message-box, .el-dialog, .el-drawer, .van-dialog, .van-popup, .el-popper, .el-picker-panel, .van-action-sheet')].filter(vis)
        .filter((e) => !e.classList.contains('van-toast') && !e.classList.contains('el-tooltip__popper') && !(e.classList.contains('el-popper') && !e.querySelector('.el-select-dropdown, .el-picker-panel, .el-dropdown-menu, .el-cascader-panel, .el-popconfirm, .el-autocomplete-suggestion')))
      if (!layers.length) return document.body
      let top = layers[0], tz = -1
      for (const l of layers) { let z = 0; for (let p = l; p && p !== document.body; p = p.parentElement) { const v = parseInt(getComputedStyle(p).zIndex); if (!isNaN(v)) z = Math.max(z, v) } if (z >= tz) { tz = z; top = l } }
      return top
    }
    const txt = (e) => (e.innerText || e.value || '').replace(/\\s+/g, ' ').trim()
  `
  /** 点击文字为 text 的元素（先精确后包含）；opt.nth 第几个，opt.within 限定在包含这段文字的行/卡片里，opt.any 不限弹层。 */
  ui.click = async (text, opt = {}) => {
    const r = await ui.ev(`(() => { ${FIND}
      const want = ${JSON.stringify(text)}, within = ${JSON.stringify(opt.within ?? null)}
      let root = ${opt.any ? 'document.body' : 'scope()'}
      if (within) {
        const rows = [...root.querySelectorAll('tr, .van-cell, .card, li, [class*=card], [class*=item], [class*=row]')].filter((e) => vis(e) && txt(e).includes(within) && txt(e).includes(want))
        rows.sort((a, b) => txt(a).length - txt(b).length)
        if (!rows.length) return { err: '找不到包含「' + within + '」的行' }
        root = rows[0]
      }
      const all = [...root.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)).filter(vis)
      let hit = all.filter((e) => txt(e) === want)
      if (!hit.length) hit = all.filter((e) => txt(e).includes(want) && txt(e).length < want.length + 12)
      if (!hit.length) return { err: '找不到「' + want + '」', seen: [...new Set([...root.querySelectorAll('button, a, [role=button], [role=tab], .van-cell, .van-tab')].filter(vis).map(txt).filter((t) => t && t.length < 20))].slice(0, 40) }
      // 同一段文字的嵌套元素取最里层；再按文档顺序取第 nth 个
      hit = hit.filter((e) => !hit.some((o) => o !== e && e.contains(o)))
      // 标题和按钮同名时点按钮
      const isBtn = (e) => !!e.closest('button, a, [role=button], [role=tab], [role=menuitem], [role=option], .van-tabbar-item, .van-tab')
      if (hit.some(isBtn)) hit = hit.filter(isBtn)
      const e = hit[${opt.nth ?? 0}]
      if (!e) return { err: '「' + want + '」只有 ' + hit.length + ' 个' }
      const btn = e.closest('button, a, [role=button], [role=tab], [role=menuitem], [role=option], label, .van-cell, .van-tabbar-item') || e
      if (btn.disabled || btn.classList.contains('is-disabled') || btn.classList.contains('van-button--disabled')) return { err: '「' + want + '」是禁用状态' }
      btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      const b = e.getBoundingClientRect()
      const x = b.left + b.width / 2, y = b.top + b.height / 2
      const at = document.elementFromPoint(x, y)
      const covered = at && !(btn.contains(at) || at.contains(btn)) ? (at.className || at.tagName) + ' ' + txt(at).slice(0, 20) : null
      return { x, y, covered }
    })()`)
    if (r.err) throw new Error(`点击失败：${r.err}${r.seen ? '；可见按钮：' + r.seen.join(' | ') : ''}`)
    if (r.covered) { ui.problems.push(`「${text}」被遮挡：${r.covered}（${await ui.url()}）`); console.log(`   ! 「${text}」被遮挡：${r.covered}`) }
    await sleep(150)
    // 滚动后坐标会变，重新取一次再点
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    if (!ui.quiet) console.log(`   · 点「${text}」${opt.within ? '（' + opt.within + '）' : ''}`)
    await ui.idle(opt.wait ?? 7000)
  }
  /** 按选择器点击（没有文字的控件：勾选框、图标按钮）；默认只在最上层弹层里找。 */
  ui.clickSel = async (sel, opt = {}) => {
    const r = await ui.ev(`(() => { ${FIND}
      const e = [...${opt.any ? 'document.body' : 'scope()'}.querySelectorAll(${JSON.stringify(sel)})].filter(vis)[${opt.nth ?? 0}]
      if (!e) return { err: 1 }
      e.scrollIntoView({ block: 'center', behavior: 'instant' })
      const b = e.getBoundingClientRect()
      const x = b.left + b.width / 2, y = b.top + b.height / 2
      const at = document.elementFromPoint(x, y)
      return { x, y, covered: at && !(e.contains(at) || at.contains(e)) ? (at.className || at.tagName) : null, t: txt(e).slice(0, 30) }
    })()`)
    if (r.err) throw new Error('点击失败：找不到 ' + sel)
    if (r.covered) { ui.problems.push(`${sel} 被遮挡：${r.covered}（${await ui.url()}）`); console.log(`   ! ${sel} 被遮挡：${r.covered}`) }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    if (!ui.quiet) console.log(`   · 点 ${sel}${r.t ? '「' + r.t + '」' : ''}`)
    await ui.idle(opt.wait ?? 7000)
    return r.t
  }
  ui.count = (sel) => ui.ev(`(() => { ${FIND} return [...scope().querySelectorAll(${JSON.stringify(sel)})].filter(vis).length })()`)
  /** 往输入框里填值：hint 匹配占位文字或所在表单项的标签；opt.nth 第几个。 */
  ui.fill = async (hint, value, opt = {}) => {
    const r = await ui.ev(`(() => { ${FIND}
      const want = ${JSON.stringify(hint)}
      const root = scope()
      const ins = [...root.querySelectorAll('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea')].filter(vis)
      const lab = (e) => { const f = e.closest('.el-form-item, .van-field, .field, label, .form-row, [class*=field]'); const l = f && f.querySelector('.el-form-item__label, .van-field__label, label, .label, .lab'); return l ? txt(l) : '' }
      let hit = ins.filter((e) => (e.placeholder || '').includes(want))
      if (!hit.length) hit = ins.filter((e) => lab(e).includes(want))
      const e = hit[${opt.nth ?? 0}]
      if (!e) return { err: '找不到输入框「' + want + '」', seen: ins.map((e) => (lab(e) + '/' + (e.placeholder || '')).slice(0, 30)) }
      e.scrollIntoView({ block: 'center', behavior: 'instant' })
      e.focus(); if (e.select) e.select()
      const b = e.getBoundingClientRect()
      return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2, readonly: e.readOnly }
    })()`)
    if (r.err) throw new Error(`填写失败：${r.err}；可见输入框：${(r.seen ?? []).join(' | ')}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(120)
    if (value === null) { await ui.idle(2500); return }
    if (!r.readonly) {
      await ui.ev('document.activeElement && document.activeElement.select && document.activeElement.select()')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await send('Input.insertText', { text: String(value) })
    }
    if (!ui.quiet) console.log(`   · 填「${hint}」= ${value}`)
    await sleep(200)
  }
  /** 下拉选择：点开 hint 对应的选择框，再点选项文字。 */
  ui.select = async (hint, option, opt = {}) => {
    await ui.fill(hint, null, opt)
    await sleep(300)
    try { await ui.click(option, { wait: 2000 }) } catch {
      // 弹窗还在做打开动画时第一下可能点偏，重点一次
      await sleep(600)
      await ui.fill(hint, null, opt)
      await sleep(300)
      await ui.click(option, { wait: 2000 })
    }
  }
  ui.key = async (key, code = key, vk = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
    await sleep(200)
  }
  /** 给第 nth 个文件选择框塞一个文件。 */
  ui.upload = async (file, nth = 0) => {
    const doc = await send('DOM.getDocument', { depth: 0 })
    const q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' })
    const nodeId = q.result.nodeIds[nth]
    if (!nodeId) throw new Error('页面上没有第 ' + nth + ' 个文件选择框')
    await send('DOM.setFileInputFiles', { nodeId, files: [file] })
    if (!ui.quiet) console.log('   · 上传 ' + file)
    await ui.idle()
  }
  ui.text = () => ui.ev(`(() => { ${FIND} return txt(scope()) })()`)
  ui.bodyText = () => ui.ev(`(document.body.innerText || '').replace(/\\s+/g, ' ') + ' ' + (window.__toasts || []).slice(-3).join(' ')`)
  /** 等页面（或弹层）出现某段文字。 */
  ui.see = async (want, ms = 8000) => {
    const t0 = Date.now()
    const re = want instanceof RegExp ? want : null
    for (;;) {
      const t = await ui.bodyText()
      if (re ? re.test(t) : t.includes(want)) return true
      if (Date.now() - t0 > ms) throw new Error(`没等到「${want}」，当前页 ${await ui.url()}：${t.slice(0, 300)}`)
      await sleep(300)
    }
  }
  ui.has = async (want) => (await ui.bodyText()).includes(want)
  /** 列出当前能操作的东西，排查用。 */
  ui.dump = async (max = 900) => {
    const d = await ui.ev(`(() => { ${FIND}
      const root = scope()
      const lab = (e) => { const f = e.closest('.el-form-item, .van-field, .field, label, [class*=field]'); const l = f && f.querySelector('.el-form-item__label, .van-field__label, label, .label, .lab'); return l ? txt(l) : '' }
      return { url: location.pathname + location.search, layer: root === document.body ? null : root.className.split(' ').slice(0, 2).join('.'),
        toast: [...document.querySelectorAll('.van-toast, .el-message, .el-notification')].filter(vis).map(txt),
        buttons: [...new Set([...root.querySelectorAll('button, a, [role=button], [role=tab], .van-cell--clickable, .van-tab, .van-tabbar-item, .el-menu-item, .el-radio-button, .el-checkbox, .el-radio, .el-switch')].filter(vis).map((e) => txt(e).slice(0, 24) + (e.disabled || e.classList.contains('is-disabled') || e.classList.contains('van-button--disabled') ? '(禁)' : '')).filter(Boolean))],
        inputs: [...root.querySelectorAll('input:not([type=file]), textarea')].filter(vis).map((e) => (lab(e) + '/' + (e.placeholder || '') + '=' + (e.value || '')).slice(0, 50)),
        files: document.querySelectorAll('input[type=file]').length,
        text: txt(root).slice(0, ${max}) }
    })()`)
    console.log(JSON.stringify(d, null, 1))
    return d
  }
  ui.close = () => ws.close()
  return ui
}

// ---------- 命令行 ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, file] = process.argv.slice(2)
  if (cmd === 'start') { startChrome(); await sleep(1500); console.log('started') }
  else if (cmd === 'stop') { try { execFileSync('pkill', ['-f', `remote-debugging-port=${PORT}`]) } catch { /* 没在跑 */ } console.log('stopped') }
  else if (cmd === 'run') {
    const ui = await connect()
    try { await (await import(pathToFileURL(fs.realpathSync(file)).href)).default(ui) }
    catch (e) { console.log('FAIL ' + e.message); try { await ui.shot('/tmp/e2e-fail.png'); await ui.dump() } catch { /* 忽略 */ } }
    await sleep(300)
    ui.close()
  }
  process.exit(0)
}
