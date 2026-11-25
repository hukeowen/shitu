// 手机两端追加的界面验收流程：求职者端（/）和驻场端（/staff/）。由 e2e.mjs 自动加载，写法和约定同 e2e.mjs。
// 运行顺序就是下面的书写顺序：
//   mack → mhire → mabsence → mcancel → mrematch → mnoshow → mincident → madvreject → madvpass → mstaffme → mnotice
//   → mkyc → mask → mcomplaint → mresume → mpayappeal → mtour → mlogout
// 求职者都是流程自己用 registerAndApply 新注册的（姓名「验收××」，走第一家演示公司的渠道码）；
// 预支和工资申诉用不了新人（要在岗满 7 天、要有工资条），和 e2e.mjs 的 advance / payroll 一样借用演示公司的在岗员工。
// 手机端的输入框一律按占位文字找：Vant 输入框自己的类名里带 field，ui.fill 按标签找不到。
export default (h) => {
  const { sql, expectDb, dec, st, save, spaced, hanzi } = h

  // ------------------------------------------------------------------ 共用
  /** 三家演示公司的驻场 / 项目经理账号（和 e2e.mjs 里的一致） */
  const DEMO = {
    C10001: { site: '13800000003', pm: '13800000002' },
    C10002: { site: '13800000013', pm: '13800000012' },
    C10003: { site: '13800000023', pm: '13800000022' },
  }
  const CONTACT = '0512-57701234'
  const tail = () => String(Date.now()).slice(-6)
  const one = (q) => sql(q)[0]?.[0]
  const num = (q) => Number(one(q) ?? 0)
  /** 同一个页面里前后两次操作弹同样的轻提示时，先清掉记录，免得 see() 看到的是上一次的 */
  const noToasts = () => h.ui.ev('window.__toasts = []')

  /** 等库里出现某个结果（站内信是异步投递的） */
  async function waitDb(q, ok, what, ms = 15000) {
    const t0 = Date.now()
    for (;;) {
      const v = one(q)
      if (ok(v)) return v
      if (Date.now() - t0 > ms) throw new Error(`${what}（库里是 ${v}）`)
      await h.ui.sleep(700)
    }
  }

  /** 回车：带上字符，这样 keydown / keypress / keyup 三个事件都有（Vant 搜索框听的是 keypress） */
  async function pressEnter() {
    const ui = h.ui
    const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
    await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...k })
    await ui.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })
    await ui.idle(4000)
  }

  /** 原生 <select>：无头浏览器里没有可点的选项，聚焦后用方向键选；键盘选不上再直接赋值并派发 change。 */
  async function nativeSelect(sel, optionText) {
    const ui = h.ui
    const S = JSON.stringify(sel)
    const read = () => ui.ev(`(() => { const s = document.querySelector(${S}); if (!s) return null; const o = s.selectedOptions[0]; return { v: s.value, t: o ? o.text : '', n: s.options.length, all: [...s.options].map((x) => x.text) } })()`)
    const ok = (x) => !!x.v && (!optionText || x.t.includes(optionText))
    let s = await read()
    if (!s) throw new Error('找不到下拉框 ' + sel)
    if (ok(s)) return
    await ui.ev(`document.querySelector(${S}).focus()`)
    for (let i = 0; i < s.n; i++) {
      await ui.key('ArrowDown', 'ArrowDown', 40)
      s = await read()
      if (ok(s)) { ui.log(`   · 下拉选「${s.t}」`); return }
    }
    const set = await ui.ev(`(() => { const s = document.querySelector(${S}); const o = [...s.options].find((x) => !x.disabled && x.value && x.text.includes(${JSON.stringify(optionText ?? '')})); if (!o) return false; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    if (!set) throw new Error(`下拉框里没有「${optionText}」，可选：${s.all.join(' | ')}`)
    ui.log(`   · 下拉「${optionText}」键盘没选上，改为直接赋值`)
  }

  const members = () => sql("SELECT member_id, phone_enc, company_id, roles FROM member WHERE status = 'NORMAL'").map((r) => {
    try { return { id: r[0], phone: dec(r[1]), company: r[2], roles: r[3].split(',').map((x) => x.trim()) } } catch { return null }
  }).filter(Boolean)
  const memberOf = (phone) => {
    const m = members().find((x) => x.phone === phone)
    if (!m) throw new Error('库里没有成员 ' + phone)
    return m
  }
  /** 负责某个项目的驻场和项目经理（优先演示账号） */
  function staffOf(companyId, projectId) {
    const ids = new Set(sql(`SELECT member_id FROM member_project WHERE project_id = '${projectId}'`).map((r) => r[0]))
    const all = members().filter((m) => m.company === companyId && ids.has(m.id))
    const pick = (role, phone) => all.find((m) => m.phone === phone) ?? all.find((m) => m.roles.includes(role))
    const site = pick('SITE', DEMO[companyId]?.site)
    const pm = pick('PM', DEMO[companyId]?.pm)
    if (!site || !pm) throw new Error(`项目 ${projectId} 没有可用的驻场 / 项目经理账号`)
    return { site, pm }
  }
  const unreadOf = (type, id) => `SELECT COUNT(*) FROM notification WHERE recipient_type = '${type}' AND recipient_id = '${id}' AND read_at IS NULL`
  const logouts = (domain, id) => num(`SELECT COUNT(*) FROM auth_session WHERE domain = '${domain}' AND subject_id = '${id}' AND revoke_reason = 'LOGOUT'`)

  /** 第一家演示公司（仕兔演示劳务） */
  function companyA() {
    const c = one('SELECT company_id FROM company ORDER BY company_id LIMIT 1')
    if (!DEMO[c]) throw new Error('库里第一家公司不是演示公司：' + c)
    return c
  }
  /** 第一家演示公司的公司码：扫它注册的人是这家公司的私域用户，报名一定落在这家公司 */
  function channelA() {
    const c = one(`SELECT code FROM channel_code WHERE company_id = '${companyA()}' AND channel_type = 'COMPANY_QR' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`)
    if (!c) throw new Error('第一家演示公司没有可用的渠道码')
    return c
  }
  /** 新注册一个求职者并报名，带回报名单号等 */
  async function newApplicant() {
    const p = await h.registerAndApply(channelA())
    const r = sql('SELECT a.application_id, a.user_id, a.job_id, a.project_id, a.company_id, u.real_name_enc FROM application a JOIN user u ON u.user_id = a.user_id ORDER BY a.created_at DESC LIMIT 1')[0]
    if (!r || dec(r[5]) !== p.name) throw new Error('库里最新一笔报名不是刚注册的 ' + p.name)
    return Object.assign(p, { appId: r[0], userId: r[1], jobId: r[2], projectId: r[3], companyId: r[4] })
  }
  /** 验收流程入职的在岗员工（mhire 的优先，没有就用 hire 的） */
  function hired() {
    const r = sql("SELECT e.employee_no, u.phone_enc, e.user_id, e.company_id, e.project_id, e.employment_id FROM employment e JOIN user u ON u.user_id = e.user_id WHERE e.end_date IS NULL AND (e.employee_no LIKE 'YSM%' OR e.employee_no LIKE 'E2E%') ORDER BY (e.employee_no LIKE 'YSM%') DESC, e.created_at DESC LIMIT 1")[0]
    if (!r) throw new Error('先跑 mhire（或 hire），要有一个验收入职的在岗员工')
    return { no: r[0], phone: dec(r[1]), userId: r[2], companyId: r[3], projectId: r[4], employmentId: r[5] }
  }
  /** 报过名的验收求职者和他报的岗位（mack 的优先，没有就用验收入职的员工） */
  function applicant() {
    const a = st.mApp?.appId && sql(`SELECT job_id, user_id FROM application WHERE application_id = '${st.mApp.appId}'`)[0]
    if (a) return { phone: st.mApp.phone, jobId: a[0], userId: a[1] }
    const e = sql("SELECT u.phone_enc, a.job_id, a.user_id FROM employment e JOIN application a ON a.application_id = e.application_id JOIN user u ON u.user_id = e.user_id WHERE e.end_date IS NULL AND (e.employee_no LIKE 'YSM%' OR e.employee_no LIKE 'E2E%') ORDER BY e.created_at DESC LIMIT 1")[0]
    if (e) return { phone: dec(e[0]), jobId: e[1], userId: e[2] }
    throw new Error('先跑 mack（或 hire），要有一个报过名的验收求职者')
  }

  /** 驻场端「我的」退出登录，核对服务端会话被吊销、再进页面会回到登录页 */
  async function staffLogout(memberId) {
    const ui = h.ui
    const before = logouts('TENANT', memberId)
    await ui.goto('/staff/me')
    await ui.click('退出登录')
    await ui.click('退出')
    await ui.see('已退出登录')
    if (!(await ui.url()).startsWith('/staff/login')) throw new Error('驻场端退出后没有回到登录页')
    if (logouts('TENANT', memberId) !== before + 1) throw new Error('驻场端退出后服务端会话没有被吊销')
    await ui.goto('/staff/todo')
    if (!(await ui.url()).startsWith('/staff/login')) throw new Error('驻场端退出后还能直接打开待办清单')
  }

  // ------------------------------------------------------------------ 预支（借用演示公司在岗员工）
  const ADV_PENDING = "('SUBMITTED', 'SITE_APPROVED', 'PM_APPROVED')"
  const advStatus = (id) => one(`SELECT status FROM advance_request WHERE advance_id = '${id}'`)
  /** 已登录的求职者在预支首页发起一笔，返回申请单号；不满足准入条件返回 null。 */
  async function applyAdvance() {
    const ui = h.ui
    await ui.goto('/advance')
    await ui.see('单次可预支金额')
    if (await ui.count('.bottom-bar .van-button--disabled')) return null
    await ui.click('申请预支')
    await ui.click('确认申请')
    await ui.see('申请已提交')
    return (await ui.url()).match(/advance\/([A-Z0-9]+)/)[1]
  }
  /**
   * 一笔在审批中的预支：上次没走完的接着用；否则找一个还能申请的在岗员工在求职者端发起。
   * 优先用上次用过的人和本月已经有过预支的人，再从名单另一头挑，尽量不碰 e2e.mjs advance 流程要用的人。
   */
  async function advance() {
    const left = st.mAdv && sql(`SELECT advance_id, status FROM advance_request WHERE user_id = '${st.mAdv.userId}' AND status IN ${ADV_PENDING} LIMIT 1`)[0]
    if (left) return { ...st.mAdv, advId: left[0], status: left[1] }
    const rows = sql(`SELECT u.phone_enc, e.company_id, e.user_id FROM employment e JOIN user u ON u.user_id = e.user_id WHERE e.company_id IN ('C10001', 'C10002', 'C10003') AND e.end_date IS NULL AND e.start_date <= CURDATE() - INTERVAL 9 DAY AND NOT EXISTS (SELECT 1 FROM advance_request a WHERE a.user_id = e.user_id AND a.status IN ${ADV_PENDING}) AND NOT EXISTS (SELECT 1 FROM resign_request r WHERE r.user_id = e.user_id) ORDER BY (e.user_id = '${st.mAdv?.userId ?? ''}') DESC, (SELECT COUNT(*) FROM advance_request a WHERE a.user_id = e.user_id AND a.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) DESC, e.company_id DESC, e.start_date DESC LIMIT 4`)
    for (const r of rows) {
      const c = { phone: dec(r[0]), company: r[1], userId: r[2] }
      await h.loginSeeker(c.phone)
      const id = await applyAdvance()
      if (!id) continue
      st.mAdv = c; save()
      return { ...c, advId: id, status: 'SUBMITTED' }
    }
    throw new Error('库里没有还能申请预支的在岗员工')
  }

  // ==================================================================== 流程
  return {
    /**
     * 驻场端知悉：工作台数字进待办 → 知悉并推送（面试时间选择器、路线、自定义材料、联系电话）→ 修改面试信息重推
     * → 求职者在「我的报名」看到面试须知、消息全部已读 → 驻场点开一条未读站内信。
     * 接口：POST /tenant/applications/{id}/acknowledge（首次 + 重推）、POST /seeker/messages/read（全部）、POST /tenant/messages/read（单条）
     */
    async mack() {
      const ui = h.ui
      const p = await newApplicant()
      st.mApp = p; save()
      const { site } = staffOf(p.companyId, p.projectId)
      const tel = spaced(p.phone)
      const app = `application_id = '${p.appId}'`
      const route = `验收路线 ${tail()}：地铁 S1 线花桥站 2 号口出，步行 500 米到东门`
      const addr2 = `验收改址 ${tail()}：前进东路 88 号 2 号门招聘中心`

      await h.loginStaff(site.phone)
      await ui.click('待知悉') // 工作台的待办数字
      if (!(await ui.url()).includes('/staff/todo')) throw new Error('工作台的「待知悉」没有跳到待办清单')
      await ui.click('知悉并推送面试信息', { within: tel })
      await ui.click('面试时间') // 日期 + 时间两步选择器，按默认值（下一个工作日 9 点）确认
      await ui.click('下一步')
      await ui.click('确认')
      await ui.fill('地铁 S1 线', route)
      await ui.fill('其他材料', '体检报告')
      await ui.click('添加')
      await ui.fill('求职者可直接拨打', CONTACT)
      await ui.click('确认知悉并推送')
      await ui.see('已推送给求职者')
      expectDb(`SELECT COUNT(*) FROM application WHERE ${app} AND acknowledged_at IS NOT NULL AND interview_at > NOW()`, 1)
      expectDb(`SELECT COUNT(*) FROM interview_notice WHERE ${app} AND route_tips = '${route}' AND CAST(documents AS CHAR) LIKE '%体检报告%' AND contact_phone_enc IS NOT NULL`, 1)

      // 修改面试信息：带出上次推送的内容，只改地点
      await ui.goto('/staff/todo?tab=interview')
      await ui.click('更多', { within: tel })
      await ui.click('修改面试信息')
      await ui.see('已带出')
      await ui.fill('工厂 / 园区', addr2)
      await noToasts()
      await ui.click('保存并重新推送')
      await ui.see('已推送给求职者')
      expectDb(`SELECT COUNT(*) FROM interview_notice WHERE ${app}`, 2)
      expectDb(`SELECT interview_address FROM application WHERE ${app}`, addr2)
      expectDb(`SELECT route_tips FROM interview_notice WHERE ${app} ORDER BY id DESC LIMIT 1`, route)

      // 求职者：报备卡片上的面试信息 → 完整面试须知（证件清点）→ 消息全部已读
      await h.loginSeeker(p.phone)
      await ui.goto('/reports')
      await ui.see(addr2)
      await ui.click('查看完整面试须知')
      await ui.see('证件清单')
      await ui.see(route)
      await ui.see(CONTACT)
      await ui.click('体检报告')
      if (!(await ui.ev(`[...document.querySelectorAll('button.doc')].some((b) => b.innerText.includes('体检报告') && b.getAttribute('aria-checked') === 'true')`))) throw new Error('证件清单里的「体检报告」没有勾上')
      const mine = unreadOf('SEEKER', p.userId)
      await waitDb(mine, (v) => Number(v) > 0, '求职者没有收到面试信息的站内信')
      await ui.goto('/messages')
      await ui.click('全部已读')
      await ui.see('已全部标为已读')
      expectDb(mine, 0)

      // 驻场：从工作台的铃铛进消息通知，点开最新一条未读
      const inbox = unreadOf('MEMBER', site.id)
      await waitDb(inbox, (v) => Number(v) > 0, '驻场没有未读站内信（新报名应当通知到驻场）')
      await h.loginStaff(site.phone)
      const before = num(inbox)
      await ui.clickSel('a.bell')
      await ui.see('消息通知')
      await ui.clickSel('.msg.unread .msg-open')
      await ui.sleep(800)
      expectDb(inbox, before - 1)
    },

    /**
     * 驻场端把 mack 的求职者办到入职：驻场在报名详情页到厂确认 → 项目经理在详情页录面试通过、入职确权
     * → 驻场查看签署码并作废重发 → 求职者签约 → 在岗。先跑 mack。
     * 接口：POST /tenant/applications/{id}/arrive、/result（通过）、/confirm（确权 + 重发）、POST /seeker/esign/mock/{flowId}/sign
     */
    async mhire() {
      const ui = h.ui
      const p = st.mApp
      if (!p?.appId) throw new Error('先跑 mack')
      const app = `application_id = '${p.appId}'`
      const state = () => { const r = sql(`SELECT status, arrived_at IS NOT NULL FROM application WHERE ${app}`)[0]; return { status: r?.[0], arrived: r?.[1] === '1' } }
      const contracts = (s) => num(`SELECT COUNT(*) FROM contract WHERE ${app} AND status = '${s}'`)
      if (!['PENDING_INTERVIEW', 'PENDING_CONFIRM'].includes(state().status)) throw new Error('mack 的报名已经结束或已入职，先重跑 mack')
      const { site, pm } = staffOf(p.companyId, p.projectId)
      const tel = spaced(p.phone)
      const no = 'YSM' + p.phone.slice(-6)
      const detail = '/staff/applications/' + p.appId

      if (state().status === 'PENDING_INTERVIEW') {
        if (!state().arrived) {
          await h.loginStaff(site.phone)
          await ui.goto(detail)
          await ui.see('跟进记录')
          await ui.see(p.appId)
          await ui.click('更多') // 次要操作列表，看一眼就收起
          await ui.see('标记爽约')
          await ui.click('取消')
          await ui.click('到厂确认')
          await ui.click('确认到厂')
          await ui.see('已确认到厂')
          expectDb(`SELECT COUNT(*) FROM application WHERE ${app} AND arrived_at IS NOT NULL`, 1)
        }
        await h.loginStaff(pm.phone)
        await ui.goto(detail)
        await ui.see('跟进记录')
        if (!pm.roles.includes('SITE') && (await ui.has(tel))) throw new Error('项目经理在报名详情里看到了求职者的完整手机号')
        await ui.click('面试通过')
        await ui.click('面试通过')
        await ui.see('已标记面试通过')
        expectDb(`SELECT status FROM application WHERE ${app}`, 'PENDING_CONFIRM')
      }

      if (!contracts('PENDING_SIGN') && !contracts('VOIDED')) {
        await h.loginStaff(pm.phone)
        await ui.goto(detail)
        await ui.click('入职确权 + 电子签')
        await ui.fill('选填，如 XC', no)
        await ui.click('合同截止') // 日期选择器，按默认值（入职起 1 年）确认
        await ui.click('确认')
        await ui.click('确认入职并发起电子签约')
        await ui.see('确权完成，已发起电子签约')
        await ui.click('完成')
        expectDb(`SELECT COUNT(*) FROM contract WHERE ${app} AND status = 'PENDING_SIGN'`, 1)
        await ui.see('电子合同') // 详情页出现合同卡片
      }

      if (!contracts('VOIDED')) {
        await h.loginStaff(site.phone)
        await ui.goto('/staff/todo?tab=confirm')
        await ui.click('查看签署码 / 重发', { within: tel })
        await ui.see('当前签署码')
        await ui.click('作废并重发签约')
        await ui.fill('选填，如 XC', no)
        await ui.click('重发签约')
        await ui.click('重发')
        await ui.see('已重新发起电子签约')
        await ui.click('完成')
        expectDb(`SELECT COUNT(*) FROM contract WHERE ${app} AND status = 'PENDING_SIGN'`, 1)
        expectDb(`SELECT COUNT(*) FROM contract WHERE ${app} AND status = 'VOIDED'`, 1)
      }

      await h.loginSeeker(p.phone)
      await ui.see('请签署劳动合同')
      await ui.goto('/contracts')
      await ui.see('待签署')
      await ui.click('去签署')
      await ui.see('合同摘要')
      await ui.click('去签署')
      await ui.see('电子签署')
      await ui.click('我已阅读并同意上述合同条款')
      await ui.click('同意并签署')
      await ui.see('签署完成')
      await ui.click('查看我的工作')
      await ui.see(no)
      expectDb(`SELECT status FROM application WHERE ${app}`, 'EMPLOYED')
      expectDb(`SELECT COUNT(*) FROM employment WHERE ${app} AND employee_no = '${no}' AND end_date IS NULL`, 1)
    },

    /**
     * 考勤：驻场从工作台进在岗人员，搜工号，给验收入职的员工标记一天旷工（日期选择器、备注），再撤销。先跑 mhire（或 hire）。
     * 接口：PUT /tenant/employments/{id}/absences（旷工 + 撤销）
     */
    async mabsence() {
      const ui = h.ui
      const e = hired()
      const { site } = staffOf(e.companyId, e.projectId)
      const remark = '验收旷工 ' + tail()
      const today = `employment_id = '${e.employmentId}' AND absence_date = CURDATE()`
      await h.loginStaff(site.phone)
      await ui.click('请假 / 旷工') // 工作台「更多事项」
      await ui.see('在岗人员')
      await ui.fill('工号', e.no)
      await pressEnter()
      await ui.click(e.no)
      await ui.see('请假 / 旷工标记')
      await ui.click('日期')
      await ui.click('确认')
      await ui.click('旷工')
      await ui.fill('病假 / 事假', remark)
      await ui.click('标记 旷工')
      await ui.see('已标记')
      expectDb(`SELECT CONCAT(absence_type, '/', remark) FROM duty_absence WHERE ${today}`, 'ABSENT/' + remark)
      await ui.see(remark) // 当月记录
      await ui.click('撤销')
      await ui.clickSel('.van-dialog__confirm')
      await ui.see('已撤销')
      expectDb(`SELECT COUNT(*) FROM duty_absence WHERE ${today}`, 0)
    },

    /**
     * 取消报名与流转：驻场把消息全部标为已读 → 在待办卡片的「更多」里取消报名（必填原因）→ 求职者回到私域待匹配
     * → 驻场在「提醒」页把他一键流转给人才经纪人。
     * 接口：POST /tenant/messages/read（全部）、POST /tenant/applications/{id}/cancel、POST /tenant/seekers/{userId}/transfer-to-broker
     */
    async mcancel() {
      const ui = h.ui
      const p = await newApplicant()
      st.mRe = p; save()
      const { site } = staffOf(p.companyId, p.projectId)
      const tel = spaced(p.phone)
      const app = `application_id = '${p.appId}'`
      const reason = `验收取消 ${tail()}：求职者来电说报错了岗位`

      const inbox = unreadOf('MEMBER', site.id)
      await waitDb(inbox, (v) => Number(v) > 0, '驻场没有未读站内信（新报名应当通知到驻场）')
      await h.loginStaff(site.phone)
      await ui.goto('/staff/messages')
      await ui.click('全部已读')
      await ui.see('已全部标为已读')
      expectDb(inbox, 0)

      await ui.goto('/staff/todo')
      await ui.click('更多', { within: tel })
      await ui.click('取消报名')
      await ui.fill('请填写取消原因', reason)
      await ui.click('用户申请更换岗位') // 预设原因，接在手写内容后面
      await ui.click('确认取消')
      await ui.see('报名已取消')
      expectDb(`SELECT COUNT(*) FROM application WHERE ${app} AND status = 'CANCELLED' AND end_remark LIKE '%${reason}%' AND end_remark LIKE '%用户申请更换岗位%'`, 1)
      expectDb(`SELECT user_status FROM user WHERE user_id = '${p.userId}'`, 'PRIVATE_PENDING')

      await ui.goto('/staff/reminders?f=private')
      await ui.click('一键流转经纪人', { within: tel })
      await ui.click('确认流转')
      await ui.see('已流转至人才经纪人')
      expectDb(`SELECT COUNT(*) FROM broker_case WHERE user_id = '${p.userId}' AND trigger_type = 'SITE_TRANSFER' AND status = 'OPEN'`, 1)
      await ui.see('已在流转池')
    },

    /**
     * 重新匹配：报名被取消的求职者再做一遍 AI 问薪 → 对结果不满意重新匹配一次 → 重新报名（告知书、实名都不用再过）。先跑 mcancel。
     * 接口：POST /seeker/match（两次）、POST /seeker/applications
     */
    async mrematch() {
      const ui = h.ui
      const p = st.mRe
      if (!p?.userId) throw new Error('先跑 mcancel')
      const active = `SELECT COUNT(*) FROM application WHERE user_id = '${p.userId}' AND status IN ('PENDING_INTERVIEW', 'PENDING_CONFIRM')`
      if (num(active)) throw new Error('mcancel 的求职者已经有进行中的报名，直接跑 mnoshow，或重跑 mcancel')
      const sessions = `SELECT COUNT(*) FROM match_session WHERE user_id = '${p.userId}'`
      const answer = async () => {
        await h.answerQuiz()
        await ui.click('看看有哪些活')
        await ui.see('为你锁定', 20000)
      }
      await h.loginSeeker(p.phone)
      await ui.goto('/match')
      await ui.see('这次会给你找')
      const n0 = num(sessions)
      await ui.clickSel('.bottom-bar .van-button--primary') // 开始回答
      await answer()
      expectDb(sessions, n0 + 1)
      await ui.click('都不满意，重新匹配')
      await ui.see('已回答') // 上次的答案还在，逐题确认
      await answer()
      expectDb(sessions, n0 + 2)
      await ui.click('查看并报名')
      await ui.see('面试信息')
      await ui.click('报名面试')
      await ui.sleep(800)
      if (await ui.has('求职告知书与免责声明')) { // 告知书换了版本才会再弹
        await ui.ev(`[...document.querySelectorAll('.van-popup *')].filter((e) => e.scrollHeight > e.clientHeight + 4).forEach((e) => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })`)
        await ui.sleep(500)
        await ui.click('我已完整阅读并同意上述告知书与免责声明')
        await ui.click('同意并继续')
      }
      await ui.see('报名成功')
      await ui.click('查看我的报名')
      await ui.see('待面试')
      expectDb(active, 1)
      p.appId = one(`SELECT application_id FROM application WHERE user_id = '${p.userId}' AND status = 'PENDING_INTERVIEW'`)
      save()
    },

    /**
     * 爽约：驻场在「提醒」页知悉并推送面试信息 → 在待办卡片的「更多」里标记爽约 → 求职者看到结果并能重新匹配。
     * 接着用 mrematch 重新报名的那个人；没有就自己新注册一个。
     * 接口：POST /tenant/applications/{id}/acknowledge、POST /tenant/applications/{id}/no-show
     */
    async mnoshow() {
      const ui = h.ui
      let p = st.mRe
      const a = p?.userId && sql(`SELECT application_id, project_id, company_id FROM application WHERE user_id = '${p.userId}' AND status = 'PENDING_INTERVIEW' AND arrived_at IS NULL LIMIT 1`)[0]
      if (a) Object.assign(p, { appId: a[0], projectId: a[1], companyId: a[2] })
      else p = await newApplicant()
      const { site } = staffOf(p.companyId, p.projectId)
      const tel = spaced(p.phone)
      const app = `application_id = '${p.appId}'`

      await h.loginStaff(site.phone)
      if (!num(`SELECT COUNT(*) FROM application WHERE ${app} AND acknowledged_at IS NOT NULL`)) {
        await ui.goto('/staff/reminders?f=ack')
        await ui.see('24 小时窗口内待跟进')
        await ui.click('知悉并推送面试信息', { within: tel })
        await ui.click('确认知悉并推送')
        await ui.see('已推送给求职者')
        expectDb(`SELECT COUNT(*) FROM application WHERE ${app} AND acknowledged_at IS NOT NULL`, 1)
      }
      await ui.goto('/staff/todo?tab=interview')
      await ui.click('更多', { within: tel })
      await ui.click('标记爽约')
      await ui.click('未到场且电话无法接通')
      await ui.click('确认爽约')
      await ui.see('已标记爽约')
      expectDb(`SELECT COUNT(*) FROM application WHERE ${app} AND status = 'NO_SHOW' AND end_remark LIKE '%未到场且电话无法接通%'`, 1)
      expectDb(`SELECT COUNT(*) FROM user WHERE user_id = '${p.userId}' AND user_status <> 'PENDING_INTERVIEW'`, 1)

      await h.loginSeeker(p.phone)
      await ui.goto('/reports')
      await ui.see('爽约')
      await ui.goto('/match')
      await ui.see('这次会给你找')
    },

    /**
     * 工伤：驻场从「我的」进工伤上报并提交 → 项目经理在公司后台结案（驻场端没有结案入口）→ 驻场端看到处理结论。
     * 接口：POST /tenant/incidents、POST /tenant/incidents/{id}/close
     */
    async mincident() {
      const ui = h.ui
      const company = companyA()
      const site = memberOf(DEMO[company].site)
      const project = one(`SELECT p.name FROM project p JOIN member_project mp ON mp.project_id = p.project_id WHERE mp.member_id = '${site.id}' AND p.status = 'ACTIVE' ORDER BY p.created_at LIMIT 1`)
      if (!project) throw new Error('演示驻场没有负责的在管项目')
      const name = '验收' + hanzi() + hanzi()
      const detail = `验收工伤 ${tail()}：搬运纸箱时划伤左手食指，已在医务室消毒包扎，本人回岗休息`
      const note = `验收结案 ${tail()}：皮外伤已处理，无需申报工伤认定`
      const row = `FROM incident WHERE detail = '${detail}'`

      await h.loginStaff(site.phone)
      await ui.goto('/staff/me')
      await ui.click('工伤上报')
      await ui.see('上报记录')
      await ui.click('上报工伤')
      await nativeSelect('.sheet select.ctl', project)
      await ui.fill('姓名', name)
      await ui.click('轻伤')
      await ui.fill('哪里、怎么受的伤', detail)
      await ui.click('立即上报')
      await ui.see('已上报，老板和项目经理会立刻收到通知')
      expectDb(`SELECT CONCAT(status, '/', severity, '/', person_name) ${row}`, `OPEN/MINOR/${name}`)
      await ui.see(name)

      // 项目经理在驻场手机端结案（驻场只能上报和查看）
      await h.loginStaff(DEMO[company].pm)
      await ui.goto('/staff/incidents')
      await ui.click('结案', { within: name })
      await ui.see('登记处理结论')
      await ui.fill('救治情况、是否已申报工伤认定、费用如何处理等', note)
      await ui.click('结案')
      await ui.see('已结案')
      expectDb(`SELECT CONCAT(status, '/', handle_note) ${row}`, 'CLOSED/' + note)

      await h.loginStaff(site.phone)
      await ui.goto('/staff/incidents')
      await ui.see(note)
    },

    /**
     * 预支驳回：员工在求职者端申请 → 驻场在预支列表驳回（必填意见）→ 员工看到驳回意见、机会退回后再次申请
     * → 驻场在预支详情页初审通过 → 项目经理在驻场端的预支详情页驳回。走完后这名员工还能继续申请，可以反复跑。
     * 接口：POST /seeker/advance、POST /tenant/advances/{id}/site-review（驳回 + 通过）、POST /tenant/advances/{id}/pm-review（驳回）
     */
    async madvreject() {
      const ui = h.ui
      let a = await advance()
      if (a.status === 'PM_APPROVED') throw new Error('上次留下一笔终审通过、待拨款的预支，先跑 madvpass 把它登记拨款')
      const { site, pm } = DEMO[a.company]
      const link = (id) => `a[href$="/advance/${id}"]`

      if (a.status === 'SUBMITTED') {
        const why = `验收驳回 ${tail()}：本周请假两天，出勤待核实`
        const first = a.advId
        await h.loginStaff(site)
        await ui.goto('/staff/advance')
        await ui.click('驳回', { within: first })
        await ui.fill('请填写驳回意见', why)
        await ui.click('近期出勤异常')
        await ui.click('确认驳回')
        await ui.see('已驳回，机会已退回')
        expectDb(`SELECT status FROM advance_request WHERE advance_id = '${first}'`, 'REJECTED')
        expectDb(`SELECT COUNT(*) FROM advance_approval WHERE advance_id = '${first}' AND step = 'SITE' AND decision = 'REJECT' AND opinion LIKE '%${why}%'`, 1)
        await ui.click('全部记录')
        await ui.see(first)

        await h.loginSeeker(a.phone)
        await ui.goto('/advance/' + first)
        await ui.see('已退回本次机会')
        await ui.see(why)
        await ui.click('返回预支首页')
        const id = await applyAdvance()
        if (!id) throw new Error('驳回后本次机会应当退回，但求职者端不能再次申请')
        a = { ...a, advId: id, status: 'SUBMITTED' }
        await ui.see('审批进度')
        await ui.click('查看全部预支记录')
        await ui.see(first)
        await ui.see(id)
      }

      if (a.status === 'SUBMITTED') {
        await h.loginStaff(site)
        await ui.goto('/staff/advance')
        await ui.clickSel(link(a.advId)) // 卡片头部进详情
        await ui.see('审批记录')
        await ui.click('初审通过')
        await ui.click('同意预支')
        await ui.click('初审通过')
        await ui.see('初审已通过')
        expectDb(`SELECT status FROM advance_request WHERE advance_id = '${a.advId}'`, 'SITE_APPROVED')
        expectDb(`SELECT COUNT(*) FROM advance_approval WHERE advance_id = '${a.advId}' AND step = 'SITE' AND decision = 'APPROVE' AND opinion LIKE '%同意预支%'`, 1)
      }

      const why2 = `验收终审驳回 ${tail()}：本月已有一笔预支待还`
      await h.loginStaff(pm)
      await ui.goto('/staff/advance')
      await ui.see(a.advId)
      await ui.clickSel(link(a.advId))
      await ui.see('审批记录')
      await ui.click('驳回')
      await ui.fill('请填写驳回意见', why2)
      await ui.click('确认驳回')
      await ui.see('已驳回，机会已退回')
      expectDb(`SELECT status FROM advance_request WHERE advance_id = '${a.advId}'`, 'REJECTED')
      expectDb(`SELECT COUNT(*) FROM advance_approval WHERE advance_id = '${a.advId}' AND step = 'PM' AND decision = 'REJECT' AND opinion LIKE '%${why2}%'`, 1)
    },

    /**
     * 预支通过：员工申请 → 驻场在列表初审通过 → 项目经理在驻场端终审通过 → 项目经理在驻场端登记拨款
     * → 员工在预支记录、欠款流水、审批进度里看到到账。和 e2e.mjs 的 advance 一样，每跑一次给这名演示员工记一笔 500 元欠款。
     * 接口：POST /seeker/advance、POST /tenant/advances/{id}/site-review（通过）、POST /tenant/advances/{id}/pm-review（通过）、POST /tenant/advances/{id}/payout
     */
    async madvpass() {
      const ui = h.ui
      const a = await advance()
      const { site, pm } = DEMO[a.company]
      const id = a.advId
      if (advStatus(id) === 'SUBMITTED') {
        await h.loginStaff(site)
        await ui.goto('/staff/advance')
        await ui.click('初审通过', { within: id })
        await ui.click('初审通过')
        await ui.see('初审已通过')
        expectDb(`SELECT status FROM advance_request WHERE advance_id = '${id}'`, 'SITE_APPROVED')
      }
      if (advStatus(id) === 'SITE_APPROVED') {
        await h.loginStaff(pm)
        await ui.goto('/staff/advance')
        await ui.click('终审通过', { within: id })
        await ui.click('同意预支')
        await ui.click('终审通过')
        await ui.see('终审已通过')
        expectDb(`SELECT status FROM advance_request WHERE advance_id = '${id}'`, 'PM_APPROVED')
        expectDb(`SELECT COUNT(*) FROM advance_approval WHERE advance_id = '${id}' AND step = 'PM' AND decision = 'APPROVE' AND opinion LIKE '%同意预支%'`, 1)
        await ui.click('全部记录')
        await ui.see(id)
      }
      if (advStatus(id) === 'PM_APPROVED') {
        // 项目经理在驻场手机端登记拨款
        await h.loginStaff(pm)
        await ui.goto('/staff/advance')
        await ui.click('登记拨款', { within: id })
        await ui.see('此操作不可撤销')
        await ui.click('已转账，登记拨款')
        await ui.see('已登记拨款')
      }
      expectDb(`SELECT status FROM advance_request WHERE advance_id = '${id}'`, 'PAID')

      await h.loginSeeker(a.phone)
      await ui.goto('/advance/records')
      await ui.see('当前欠款')
      await ui.see(id)
      await ui.click('欠款流水')
      await ui.see('结余')
      await ui.goto('/advance/' + id)
      await ui.see('到账时间')
    },

    /**
     * 驻场端「我的」：专属码（复制链接、保存海报）→ 各入口 → 退出登录。
     * 接口：POST /tenant/auth/logout
     */
    async mstaffme() {
      const ui = h.ui
      const company = companyA()
      const site = memberOf(DEMO[company].site)
      await h.loginStaff(site.phone)
      await ui.goto('/staff/me')
      await ui.see('所属公司')
      if (await ui.has('我的专属码')) {
        await ui.click('我的专属码')
        await ui.see('专属码说明')
        const code = one(`SELECT code FROM channel_code WHERE member_id = '${site.id}' ORDER BY created_at DESC LIMIT 1`)
        if (code) await ui.see(code)
        await ui.click('复制链接')
        await ui.see(/链接已复制|复制失败，请长按链接手动复制/)
        await ui.click('保存图片')
        await ui.see(/图片已开始下载|长按图片保存到相册/)
        await ui.goto('/staff/me')
      } else ui.log('   · 这个驻场账号没有专属码权限，跳过专属码页')
      await ui.click('在岗人员')
      await ui.see(/请假 \/ 旷工|暂无在岗员工/)
      await ui.goto('/staff/me')
      await ui.click('消息通知')
      await ui.see('全部已读')
      await ui.goto('/staff/no-such-page')
      await ui.see('页面不存在')
      await staffLogout(site.id)
    },

    /**
     * 公司状态页：所在公司还在审核（或已被封禁）的成员登录驻场端，只能看到状态提示页 → 刷新状态 → 进不了待办 → 退出登录。
     * 用待审核演示公司的 13800000031；它已被审核过的话用 onboard 流程最后封禁的那家验收公司。
     * 接口：POST /tenant/auth/logout
     */
    async mnotice() {
      const ui = h.ui
      let phone = null
      for (const c of ['13800000031', st.coPhone].filter(Boolean)) {
        await ui.fresh('mobile')
        await ui.goto('/staff/login')
        h.clearSmsLimits()
        await ui.fill('手机号', c)
        await ui.click('获取验证码')
        await h.solveCaptcha()
        await ui.click('登录')
        await ui.sleep(600)
        if ((await ui.url()).includes('/staff/notice')) { phone = c; break }
      }
      if (!phone) throw new Error('没有能登录到「公司状态」页的账号：13800000031 的公司已不在审核中，先跑 onboard 留下一家封禁的验收公司')
      await ui.see('所属公司')
      await ui.click('刷新状态')
      await ui.see('状态暂未变化')
      await ui.goto('/staff/todo')
      if (!(await ui.url()).includes('/staff/notice')) throw new Error('公司不可用时还能打开待办清单')
      const m = members().find((x) => x.phone === phone)
      const before = m ? logouts('TENANT', m.id) : 0
      await ui.click('退出登录')
      await ui.sleep(500)
      if (!(await ui.url()).startsWith('/staff/login')) throw new Error('状态页退出后没有回到登录页')
      if (m && logouts('TENANT', m.id) !== before + 1) throw new Error('状态页退出后服务端会话没有被吊销')
    },

    /**
     * 实名申诉：新手机号注册，实名时填一个已经被别的账号绑定的身份证 → 被「一证一号」拦下 → 提交申诉 → 在「我的申诉」看到处理中。
     * 申诉留在平台的复核队列里（待处理），不在这里替平台裁决。接口返回 APP_4007 是这条流程本来就要遇到的。
     * 接口：POST /seeker/kyc（被拦）、POST /seeker/kyc/appeals
     */
    async mkyc() {
      const ui = h.ui
      // 挑一个 25 小时内没人拿去实名过的证件：同一证件 24 小时内 3 个账号提交会被记成疑似刷单
      const taken = one("SELECT u.id_card_enc FROM user u WHERE u.id_card_hash IS NOT NULL AND u.id_card_enc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kyc_record k WHERE k.id_card_hash = u.id_card_hash AND k.created_at > NOW() - INTERVAL 25 HOUR) ORDER BY RAND() LIMIT 1")
      const idCard = taken ? dec(taken) : (await h.registerAndApply(channelA())).idCard
      const phone = '137' + String(Date.now()).slice(-8)
      const remark = `验收申诉 ${tail()}：这是我本人的身份证，旧手机号已停用，申请换绑到当前手机号`
      await h.loginSeeker(phone)
      await ui.goto('/kyc')
      await ui.see('验证你的真实身份')
      await ui.fill('与身份证上的姓名一致', '验收' + hanzi() + hanzi())
      await ui.fill('18 位身份证号码', idCard)
      await ui.fill('请再输入一次', idCard)
      await ui.click('提交实名认证')
      await ui.see('证件已被其他账号绑定')
      await ui.click('提交申诉')
      await ui.fill('这是我本人身份证', remark)
      await ui.click('提交申诉')
      await ui.see('申诉已提交')
      await ui.see('申诉已在处理中')
      expectDb(`SELECT CONCAT(review_type, '/', status) FROM kyc_review WHERE remark = '${remark}'`, 'ID_OCCUPIED_APPEAL/PENDING')
      expectDb(`SELECT COUNT(*) FROM kyc_review r JOIN kyc_record k ON k.id = r.kyc_record_id WHERE r.remark = '${remark}' AND k.result = 'ID_OCCUPIED'`, 1)
      await ui.click('查看我的申诉')
      await ui.see('身份证被占用申诉')
      await ui.see(remark)
      await ui.see('待处理')
    },

    /**
     * 岗位问答：求职者在岗位详情页点「问问这个岗位」，先点一个推荐问题，再自己输入一个问题。先跑 mack（或 hire）。
     * 自己输入的那个问题知识库里没有，会转给岗位负责人，在公司后台的知识库「待补充」里留一条（每次跑问的是同一句）。
     * 接口：POST /seeker/jobs/{jobId}/ask
     */
    async mask() {
      const ui = h.ui
      const s = applicant()
      const question = '验收提问：从宿舍到车间步行大概要多久'
      const asked = (q) => num(`SELECT COUNT(*) FROM kb_query_log WHERE user_id = '${s.userId}' AND job_id = '${s.jobId}' AND question = '${q}'`)
      const answered = async (n) => {
        for (let i = 0; ; i++) {
          if ((await ui.ev(`document.querySelectorAll('.msgs .m.bot .txt').length`)) >= n) return
          if (i > 40) throw new Error(`岗位问答第 ${n} 个问题一直没有回复`)
          await ui.sleep(300)
        }
      }
      await h.loginSeeker(s.phone)
      await ui.goto('/jobs/' + s.jobId)
      await ui.see('面试信息')
      await ui.click('问问这个岗位')
      await ui.click('包吃住吗？')
      await answered(1)
      await ui.fill('输入你的问题', question)
      await ui.click('发送')
      await answered(2)
      await ui.see(question)
      if (await ui.ev(`document.querySelectorAll('.msgs .bub.fail').length`)) throw new Error('岗位问答有问题发送失败：' + (await ui.text()).slice(-120))
      if (!asked('包吃住吗？') || !asked(question)) throw new Error('岗位问答没有记到 kb_query_log')
    },

    /**
     * 带图投诉：求职者在「我的报名」的报名卡片上投诉岗位，附一张图片凭证 → 运营中台按不属实驳回（不影响演示岗位）。先跑 mack（或 hire）。
     * 接口：POST /seeker/complaints/images、POST /seeker/complaints
     */
    async mcomplaint() {
      const ui = h.ui
      const s = applicant()
      const CATS = [['MISMATCH_AFTER_INTERVIEW', '面试后发现不符'], ['FULL_STILL_HIRING', '招满了还在招'], ['INFO_FALSE', '岗位信息不实']]
      // 同一个人对同一岗位、同一类型只能有一条待核实的投诉：挑一个还没占用的类型
      const busy = new Set(sql(`SELECT category FROM complaint WHERE user_id = '${s.userId}' AND status = 'PENDING'`).map((r) => r[0]))
      const cat = CATS.find((c) => !busy.has(c[0]))
      if (!cat) throw new Error('这个求职者三种类型的投诉都还在待核实，先到运营中台处理掉')
      const text = `验收投诉 ${tail()}：面试时说的是坐岗，实际安排的是站岗两班倒`
      const file = `${h.out}/m-evidence.png`

      await h.loginSeeker(s.phone)
      await ui.goto('/reports')
      await ui.see('报名编号')
      await ui.shot(file) // 借当前页面的截图当凭证
      await ui.click('岗位与描述不符？投诉该岗位')
      await ui.click(cat[1])
      await ui.fill('请描述具体情况', text)
      await ui.upload(file)
      for (let i = 0; !(await ui.count('.shot img')); i++) {
        if (i > 30) throw new Error('投诉凭证图片没有传上去：' + (await ui.bodyText()).slice(-80))
        await ui.sleep(300)
      }
      await ui.click('提交投诉')
      await ui.see('投诉已提交，平台将尽快核实')
      expectDb(`SELECT CONCAT(category, '/', JSON_LENGTH(images), '/', status) FROM complaint WHERE content = '${text}'`, `${cat[0]}/1/PENDING`)

      await h.loginOps()
      await ui.goto('/ops/governance/complaints')
      await ui.click('核实处理', { within: text.slice(0, 11) })
      await ui.fill('核实过程与结论', '已回访并核对排班表，该岗位公示的就是站岗两班倒，与岗位信息一致。')
      await ui.click('驳回投诉')
      await ui.see('已驳回投诉')
      expectDb(`SELECT status FROM complaint WHERE content = '${text}'`, 'REJECTED')
    },

    /**
     * 简历：求职者从「我的」进我的简历，选期望工种、加期望地点和技能标签（加两个删一个）、填年限 / 简介 / 微信 / 紧急联系人，保存后重新打开核对。
     * 先跑 mhire（或 hire）。
     * 接口：PUT /seeker/resume
     */
    async mresume() {
      const ui = h.ui
      const s = hired()
      const intro = `验收简介 ${tail()}：做过两年电子厂流水线，能适应两班倒`
      const wechat = 'yanshou_' + tail()
      const row = `FROM user_resume WHERE user_id = '${s.userId}'`
      await h.loginSeeker(s.phone)
      await ui.goto('/me')
      await ui.click('我的简历')
      await ui.see('求职意向')
      // 期望工种是开关：已经选上的不再点
      if (!(await ui.ev(`[...document.querySelectorAll('button.chip-tap')].some((b) => (b.innerText || '').trim() === '普工 / 流水线' && b.getAttribute('aria-pressed') === 'true')`))) await ui.click('普工 / 流水线')
      await ui.fill('如 昆山', '昆山')
      await pressEnter()
      await ui.fill('如 3', '3')
      await ui.fill('如 叉车证', '叉车证')
      await pressEnter()
      await ui.fill('如 叉车证', '验收临时标签')
      await pressEnter()
      await ui.clickSel('button[aria-label="删除 验收临时标签"]')
      await ui.fill('做过什么工作', intro)
      await ui.fill('如 zhangsan_1990', wechat)
      await ui.fill('姓名，如 父亲', '验收联系人')
      await ui.fill('11 位手机号', '13900001234')
      await ui.click('保存简历')
      await ui.see('简历已保存')
      expectDb(`SELECT CONCAT(work_years, '/', wechat_id, '/', emergency_name, '/', intro) ${row}`, `3/${wechat}/验收联系人/${intro}`)
      expectDb(`SELECT COUNT(*) ${row} AND CAST(expect_job_types AS CHAR) LIKE '%GENERAL%' AND CAST(expect_regions AS CHAR) LIKE '%昆山%' AND CAST(skill_tags AS CHAR) LIKE '%叉车证%' AND CAST(skill_tags AS CHAR) NOT LIKE '%验收临时标签%' AND emergency_phone_enc IS NOT NULL`, 1)
      await ui.goto('/resume')
      await ui.see('叉车证')
      if (await ui.has('验收临时标签')) throw new Error('删掉的技能标签重新打开后还在')
    },

    /**
     * 工资申诉：有工资条的员工从「我的台账 → 工资」点开工资条提出申诉 → 项目经理在公司后台受理并回复 → 员工在工资条上看到回复。
     * 借用演示公司有工资条的员工（没有先跑 payroll）；申诉在流程里处理完，同一个人可以反复跑。
     * 接口：POST /seeker/payslips/{id}/appeals
     */
    async mpayappeal() {
      const ui = h.ui
      let cur = st.mPay
      let open = cur?.text && sql(`SELECT payslip_id FROM payslip_appeal WHERE content = '${cur.text}' AND status = 'OPEN'`)[0]
      let pid = open?.[0]
      if (!open) { // 上次提交了没处理完的接着处理，否则新提一条
        const r = sql("SELECT u.phone_enc, p.company_id FROM payslip p JOIN user u ON u.user_id = p.user_id WHERE p.company_id IN ('C10001', 'C10002', 'C10003') AND NOT EXISTS (SELECT 1 FROM payslip_appeal a WHERE a.user_id = p.user_id AND a.status = 'OPEN') ORDER BY p.created_at DESC LIMIT 1")[0]
        if (!r) throw new Error('库里没有可以申诉的工资条，先跑 payroll')
        cur = st.mPay = { phone: dec(r[0]), company: r[1], text: `验收申诉 ${tail()}：上月出勤 26 天，应发少算了 3 天加班` }
        save()
        await h.loginSeeker(cur.phone)
        await ui.goto('/ledger')
        await ui.click('工资')
        await ui.clickSel('.acard.tap')
        await ui.see('扣款项')
        pid = (await ui.url()).match(/payslips\/([A-Za-z0-9_-]+)/)[1]
        await ui.click('对这张工资条提出申诉')
        await ui.click('应发工资')
        await ui.fill('本月出勤 26 天', cur.text)
        await ui.click('提交申诉')
        await ui.see('申诉已提交，公司处理后会通知你')
        await ui.see('申诉处理中')
        expectDb(`SELECT CONCAT(status, '/', item_code, '/', payslip_id) FROM payslip_appeal WHERE content = '${cur.text}'`, `OPEN/GROSS/${pid}`)
      }
      const reply = `验收回复 ${tail()}：已核对考勤，漏记的 3 天加班费随下月工资补发`
      await h.loginConsole(DEMO[cur.company].pm)
      await ui.goto('/admin/payroll/appeals')
      await ui.click('处理', { within: cur.text.slice(0, 11) })
      await ui.fill('写明核对结果', reply)
      await ui.click('受理并回复')
      await ui.see('已处理，员工会收到通知')
      expectDb(`SELECT CONCAT(status, '/', reply) FROM payslip_appeal WHERE content = '${cur.text}'`, 'RESOLVED/' + reply)

      await h.loginSeeker(cur.phone)
      await ui.goto('/payslips/' + pid)
      await ui.see('公司回复')
      await ui.see(reply)
      await ui.see('对这张工资条提出申诉') // 处理完可以再次申诉
    },

    /**
     * 在岗员工把只读的几屏点一遍：我的 → 我的合同 → 合同详情；我的工作 → 我的报名 → 报名详情；我的台账四个页签；
     * 薪资预支（未满 7 天不能申请）→ 预支记录；实名认证、我的申诉。没有写接口。先跑 mhire（或 hire）。
     */
    async mtour() {
      const ui = h.ui
      const s = hired()
      await h.loginSeeker(s.phone)
      await ui.goto('/me')
      await ui.see('身份档案')
      await ui.click('我的合同')
      await ui.see('签约公司')
      await ui.click('查看详情')
      await ui.see('签约主体')
      await ui.see('签署记录')
      await ui.goto('/work')
      await ui.see(s.no)
      await ui.click('我的报名')
      await ui.see('报名编号')
      await ui.click('查看报名详情')
      await ui.see('报名记录')
      await ui.click('查看我的工作')
      await ui.see(s.no)
      await ui.goto('/ledger')
      await ui.see('报名')
      await ui.click('面试')
      await ui.see(/面试时间|还没有面试记录/)
      await ui.click('入职')
      await ui.see('至今')
      await ui.click('工资')
      await ui.see(/还没有工资记录|实发/)
      await ui.goto('/advance')
      await ui.see('准入条件')
      await ui.click('预支记录与还款')
      await ui.see('当前欠款')
      await ui.goto('/kyc')
      await ui.see('已完成实名认证')
      await ui.goto('/kyc/appeals')
      await ui.see(/暂无申诉记录|提交于/)
      await ui.click('返回实名认证')
      await ui.see('已完成实名认证')
    },

    /**
     * 求职者退出登录：在「我的」点退出 → 回到未登录首页，服务端会话被吊销，再开「我的」会去登录页。
     * 用验收入职的员工；没有就拿一个新手机号注册后再退出。
     * 接口：POST /seeker/auth/logout
     */
    async mlogout() {
      const ui = h.ui
      let phone
      try { phone = hired().phone } catch { phone = '134' + String(Date.now()).slice(-8) }
      await h.loginSeeker(phone)
      await ui.goto('/me')
      await ui.see('身份档案')
      const uid = (await ui.bodyText()).match(/用户 ID\s*([A-Za-z0-9_-]+)/)?.[1]
      if (!uid) throw new Error('「我的」页上没读到用户 ID')
      const before = logouts('SEEKER', uid)
      await ui.click('退出登录')
      await ui.click('退出')
      await ui.see('已退出登录')
      if ((await ui.url()) !== '/') throw new Error('求职者退出后没有回到首页，停在 ' + (await ui.url()))
      if (logouts('SEEKER', uid) !== before + 1) throw new Error('求职者退出后服务端会话没有被吊销')
      await ui.goto('/me')
      if (!(await ui.url()).startsWith('/login')) throw new Error('求职者退出后还能直接打开「我的」')
    },
  }
}
