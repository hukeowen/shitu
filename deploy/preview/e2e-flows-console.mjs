// 公司后台（web/apps/console，/admin/ 下）的补充验收流程，由 e2e.mjs 自动加载。
// 运行顺序就是下面的书写顺序：conCompany → conOrg → conChannel → conMessages → conJob → conApps → conKb → conBroker
//   → conRoster → conIncident → conCleanup。
// 数据约定：
//   · 组织类操作（成员、甲方、项目、合同、渠道码、退出、消息）在 conCompany 新建并审核通过的一家验收公司里做，conCleanup 最后把它封禁；
//   · 岗位、知识库、报名、流转池、花名册、工伤要用到求职者 / 在招岗位，在演示公司 C10001 里做，
//     只动自己建的数据（名字以「验收」开头）。
export default (h) => {
  const { sql, expectDb, dec, st, save, out, xlsx, fs, hanzi, idCard, spaced, clearSmsLimits, solveCaptcha, captchaAnswer } = h
  const DEMO = 'C10001'
  const DEMO_PROJECT = '立讯精密昆山二期'
  const OWNERS = { C10001: '13800000001', C10002: '13800000011', C10003: '13800000021' }
  const tail6 = () => String(Date.now()).slice(-6)
  const one = (q) => sql(q)[0]?.[0]
  const mask = (p) => p.slice(0, 3) + '****' + p.slice(-4)

  /** 异步落库的结果（站内信等）轮询等一会儿。 */
  const waitDb = async (q, ok, ms = 15000) => {
    const t0 = Date.now()
    for (;;) {
      const v = one(q)
      if (ok(v)) return v
      if (Date.now() - t0 > ms) throw new Error(`库里一直没等到预期结果，当前 ${v}（${q.slice(0, 80)}）`)
      await h.ui.sleep(500)
    }
  }
  /** 表格分页时翻到出现这段文字的那一页。 */
  const pageTo = async (text) => {
    const ui = h.ui
    for (let i = 0; i < 15; i++) {
      if (await ui.has(text)) return
      if (!(await ui.count('.el-pagination .btn-next:not([disabled])'))) break
      await ui.clickSel('.el-pagination .btn-next')
    }
    throw new Error(`列表里翻完也没找到「${text}」`)
  }
  /** 点了「退出」以后应该回到登录页。 */
  const backToLogin = async () => {
    const ui = h.ui
    for (let i = 0; i < 20; i++) {
      if ((await ui.url()).includes('/login')) return
      await ui.sleep(300)
    }
    throw new Error('退出后没有回到登录页，当前 ' + (await ui.url()))
  }
  /** 验收公司：conCompany 建好并审核通过后记在 st.conCo 里。 */
  const needCo = () => {
    const co = st.conCo
    if (!co?.id) throw new Error('先跑 conCompany')
    const s = one(`SELECT company_status FROM company WHERE company_id = '${co.id}'`)
    if (s !== 'NORMAL') throw new Error(`验收公司 ${co.id} 当前状态是 ${s}，先重新跑 conCompany`)
    return co
  }
  const memberIdOf = (companyId, phone) => sql(`SELECT member_id, phone_enc FROM member WHERE company_id = '${companyId}'`).find((r) => dec(r[1]) === phone)?.[0]
  const userIdOf = (phone) => sql('SELECT user_id, phone_enc FROM `user` ORDER BY created_at DESC LIMIT 20').find((r) => dec(r[1]) === phone)?.[0]
  const demoChannel = () => {
    const c = one(`SELECT code FROM channel_code WHERE company_id = '${DEMO}' AND status = 'ACTIVE' AND name NOT LIKE '验收%' ORDER BY created_at LIMIT 1`)
    if (!c) throw new Error(`${DEMO} 没有启用中的渠道码`)
    return c
  }
  const lastSessionReason = (companyId) => one(`SELECT IFNULL(s.revoke_reason, s.status) FROM auth_session s JOIN member m ON m.member_id = s.subject_id WHERE m.company_id = '${companyId}' ORDER BY s.created_at DESC LIMIT 1`)

  /** 运营中台：在公司列表里按名称查到这家公司并打开抽屉。 */
  async function opsOpenCompany(name, all) {
    const ui = h.ui
    await h.loginOps()
    await ui.goto('/ops/companies/list')
    if (all) await ui.click('全部')
    await ui.fill('公司名称 / 公司 ID', name)
    await ui.click('查询')
    await ui.click(all ? '详情' : '审核', { within: name })
  }
  /** 扫渠道码注册并做完问薪，但不报名：得到一个「私域待匹配」的求职者。 */
  async function registerNoApply(channel) {
    const ui = h.ui
    const phone = '137' + String(Date.now()).slice(-8)
    await ui.fresh('mobile')
    await ui.goto('/r/' + channel)
    await ui.sleep(3000) // 启动页
    await ui.click('开始匹配')
    await ui.click('立即匹配工作')
    await ui.fill('手机号', phone)
    clearSmsLimits()
    await ui.click('获取验证码')
    await solveCaptcha()
    await ui.clickSel('.agree .van-checkbox')
    await ui.click('登录 / 注册并开始匹配')
    await ui.see('专属服务')
    await ui.click('开始 AI 问薪')
    await ui.see('本次匹配范围')
    await ui.clickSel('.bottom-bar .van-button--primary')
    for (const pick of ['能接受，我就是找厂里的活儿', '不限，哪里合适去哪里', '普工 / 流水线', '6,500 – 8,000 元', '两班倒可以', '必须包住', '没做过']) {
      await ui.click(pick, { wait: 2500 })
      await ui.sleep(500)
    }
    await ui.click('生成我的求职画像')
    await ui.see('为你锁定', 20000)
    const userId = userIdOf(phone)
    if (!userId) throw new Error('库里没找到刚注册的求职者 ' + phone)
    return { phone, userId }
  }

  return {
    /**
     * 入驻申请驳回后重新提交：新手机号提交入驻 → 平台驳回 → 老板修改资料、补传一份文件后重新提交 → 在入驻进度页退出 → 平台通过 → 老板登录进工作台。
     * 覆盖：PUT /tenant/company/application、POST /tenant/files（category=license）、POST /tenant/auth/logout（入驻进度页的「退出」）。
     * 建好的公司记在 st.conCo，给 conOrg / conChannel / conMessages 用，conCleanup 负责封禁。
     */
    async conCompany() {
      const ui = h.ui
      const tail = String(Date.now()).slice(-5)
      const co = { phone: '132' + String(Date.now()).slice(-8), name: `昆山验收后台${tail}劳务服务有限公司`, short: '验收后台' + tail }
      st.conCo = co; save()
      const lic = `${out}/con-licence.png`, lic2 = `${out}/con-licence-2.png`
      await ui.fresh('pc')
      await ui.goto('/admin/login')
      await ui.shot(lic) // 借一张真实的 PNG 当执照扫描件
      clearSmsLimits()
      await ui.fill('请输入 11 位手机号', co.phone)
      await ui.clickSel('.send')
      if (await ui.count('input[placeholder="请输入右侧字符"]')) {
        await ui.fill('请输入右侧字符', captchaAnswer())
        await ui.clickSel('.send')
      }
      await ui.click('登录')
      await ui.see('劳务公司入驻申请')
      await ui.fill('与营业执照一致', co.name)
      await ui.fill('求职者端展示', co.short)
      await ui.fill('18 位', '91320583MA1HU' + tail)
      await ui.fill('负责对接平台的联系人姓名', '验收联系人')
      await ui.upload(lic)
      await ui.click('提交入驻申请')
      await ui.see('入驻申请已提交')
      co.id = one(`SELECT company_id FROM company WHERE name = '${co.name}'`)
      if (!co.id) throw new Error('库里没有刚提交的入驻申请')
      save()
      await ui.shot(lic2) // 入驻进度页的截图，当作补传的第二份文件

      // 平台驳回
      const reason = `验收驳回${tail}：请补充劳务派遣许可证并更正联系人`
      await opsOpenCompany(co.name, false)
      await ui.see('验收联系人')
      await ui.click('驳回')
      await ui.fill('请填写原因', reason)
      await ui.click('驳回')
      await ui.see('已驳回入驻申请')
      expectDb(`SELECT company_status FROM company WHERE company_id = '${co.id}'`, 'REJECTED')

      // 老板看到驳回原因，修改后重新提交
      await h.loginConsole(co.phone)
      await ui.see('入驻申请被驳回')
      await ui.see(reason)
      await ui.click('修改并重新提交')
      await ui.see('修改入驻资料')
      await ui.fill('负责对接平台的联系人姓名', '验收复核人')
      await ui.upload(lic2)
      await ui.see('con-licence-2.png')
      await ui.click('重新提交审核')
      await ui.see('资料已重新提交，等待平台审核')
      await ui.see('入驻资料审核中')
      expectDb(`SELECT CONCAT(company_status, '|', contact_name, '|', JSON_LENGTH(license_files)) FROM company WHERE company_id = '${co.id}'`, 'PENDING_AUDIT|验收复核人|2')

      // 入驻进度页的「退出」
      await ui.click('退出')
      await backToLogin()
      expectDb(`SELECT IFNULL(s.revoke_reason, s.status) FROM auth_session s JOIN member m ON m.member_id = s.subject_id WHERE m.company_id = '${co.id}' ORDER BY s.created_at DESC LIMIT 1`, 'LOGOUT')

      // 平台通过，老板进工作台
      await opsOpenCompany(co.name, false)
      await ui.see('验收复核人')
      await ui.click('通过入驻')
      await ui.click('通过')
      await ui.sleep(1500)
      expectDb(`SELECT company_status FROM company WHERE company_id = '${co.id}'`, 'NORMAL')
      await h.loginConsole(co.phone)
      await ui.see(co.short)
      if ((await ui.url()).includes('onboarding')) throw new Error('审核通过后老板登录仍停在入驻页')
    },

    /**
     * 组织与项目（验收公司的老板）：新增成员后改名；新建甲方企业和项目、编辑项目、上传合作合同、结束项目；最后从顶栏退出登录。
     * 覆盖：PUT /tenant/members/*、POST /tenant/clients、POST /tenant/projects、PUT /tenant/projects/*、POST /tenant/files（category=contract）、
     *       POST /tenant/client-contracts、POST /tenant/projects/* /close、POST /tenant/auth/logout（顶栏「退出」带确认框）。
     * 前置：conCompany。
     */
    async conOrg() {
      const ui = h.ui
      const co = needCo()
      const tail = tail6()
      await h.loginConsole(co.phone)

      // ---- 成员：新增 → 编辑
      const mPhone = '134' + String(Date.now()).slice(-8)
      const mName = '验收成员' + hanzi() + hanzi(), mName2 = '验收改名' + hanzi() + hanzi()
      await ui.goto('/admin/settings/org')
      await ui.click('新增成员')
      await ui.sleep(600)
      await ui.fill('成员真实姓名', mName)
      await ui.fill('成员用此手机号登录', mPhone)
      await ui.click('驻场')
      await ui.click('保存')
      await ui.see('成员已添加，可使用该手机号登录')
      await ui.fill('姓名 / 完整手机号', mPhone) // 手机号加密存储，按完整号码查
      await ui.click('查询')
      await ui.click('编辑', { within: mName })
      await ui.sleep(600)
      await ui.see('手机号创建后不可修改')
      await ui.fill('成员真实姓名', mName2)
      await ui.click('保存')
      await ui.see('已保存')
      await ui.see(mName2)
      const mid = memberIdOf(co.id, mPhone)
      if (!mid) throw new Error('库里没有刚新增的成员')
      expectDb(`SELECT name FROM member WHERE member_id = '${mid}'`, mName2)

      // ---- 甲方企业 + 项目：新建 → 编辑
      const cName = `验收甲方${tail}电子有限公司`, pName = '验收项目' + tail
      await ui.goto('/admin/settings/projects')
      await ui.click('新建项目')
      await ui.sleep(600)
      await ui.fill('如：立讯精密昆山二期', pName)
      await ui.click('新建甲方企业')
      await ui.sleep(600)
      await ui.fill('与合同上的甲方名称一致', cName)
      await ui.fill('如：苏州', '苏州')
      await ui.click('添加')
      await ui.see('甲方企业已添加')
      expectDb(`SELECT COUNT(*) FROM client_company WHERE name = '${cName}'`, 1)
      await ui.sleep(800) // 等上层弹窗收起
      await ui.see('该甲方暂无审核通过且在有效期内的合作合同')
      await ui.fill('如：昆山', '昆山')
      await ui.fill('厂区地址', '昆山市验收路 1 号')
      await ui.click('保存')
      await ui.see('项目已创建')
      expectDb(`SELECT CONCAT(status, '|', city) FROM project WHERE company_id = '${co.id}' AND name = '${pName}'`, 'ACTIVE|苏州')
      await ui.click('编辑', { within: pName })
      await ui.sleep(600)
      await ui.see('项目创建后不能更换甲方企业')
      await ui.fill('厂区地址', '昆山市验收路 2 号东门')
      await ui.click('保存')
      await ui.see('项目已保存')
      await ui.see('昆山市验收路 2 号东门')
      expectDb(`SELECT address FROM project WHERE company_id = '${co.id}' AND name = '${pName}'`, '昆山市验收路 2 号东门')

      // ---- 合作合同：选甲方、有效期（本月 1 日 ~ 下月 28 日）、传文件、提交审核
      const pdf = `${out}/con-contract.png`
      await ui.shot(pdf)
      await ui.goto('/admin/settings/projects?tab=contracts')
      await ui.click('上传合同')
      await ui.sleep(600)
      // 甲方用弹窗里的「新建甲方企业」带出来：同名甲方后端复用上面建的那条并直接选中（远程搜索下拉里点选项选不上，opsContract 也是这么选的）
      await ui.click('新建甲方企业')
      await ui.sleep(600)
      await ui.fill('与合同上的甲方名称一致', cName)
      await ui.click('添加')
      await ui.see('甲方企业已添加')
      await ui.sleep(800) // 等上层弹窗收起
      expectDb(`SELECT COUNT(*) FROM client_company WHERE name = '${cName}'`, 1)
      await ui.fill('开始日期', null) // 打开日期面板
      await ui.sleep(400)
      await ui.clickSel('.el-date-range-picker__content.is-left td.available', { wait: 1500 })
      await ui.clickSel('.el-date-range-picker__content.is-right td.available', { nth: 27, wait: 1500 })
      await ui.sleep(400)
      await ui.upload(pdf)
      await ui.see('con-contract.png')
      await ui.click('提交审核')
      await ui.see('合同已提交，等待平台审核')
      await ui.see(cName)
      expectDb(`SELECT COUNT(*) FROM client_contract cc JOIN client_company c ON c.client_id = cc.client_id WHERE cc.company_id = '${co.id}' AND c.name = '${cName}' AND cc.audit_status = 'PENDING' AND cc.valid_to >= CURDATE()`, 1)

      // ---- 结束项目
      await ui.goto('/admin/settings/projects')
      await ui.click('结束', { within: pName })
      await ui.click('结束项目')
      await ui.see('项目已结束')
      expectDb(`SELECT status FROM project WHERE company_id = '${co.id}' AND name = '${pName}'`, 'CLOSED')

      // ---- 顶栏退出（带确认框）
      await ui.click('退出')
      await ui.see('确定退出登录？')
      await ui.click('退出')
      await backToLogin()
      if (lastSessionReason(co.id) !== 'LOGOUT') throw new Error('退出后库里最近一次会话没有被吊销：' + lastSessionReason(co.id))
    },

    /**
     * 渠道二维码（验收公司的老板）：生成 → 停用 → 启用。
     * 覆盖：POST /tenant/channel-codes、POST /tenant/channel-codes/* /disable、POST /tenant/channel-codes/* /enable。
     * 前置：conCompany。
     */
    async conChannel() {
      const ui = h.ui
      const co = needCo()
      const name = '验收渠道' + tail6()
      const status = () => one(`SELECT status FROM channel_code WHERE company_id = '${co.id}' AND name = '${name}'`)
      await h.loginConsole(co.phone)
      await ui.goto('/admin/settings/channels')
      await ui.click('生成渠道码')
      await ui.sleep(600)
      await ui.fill('如：抖音信息流', name)
      await ui.click('生成')
      await ui.see('渠道码已生成')
      await ui.see(name)
      if (status() !== 'ACTIVE') throw new Error('库里没有刚生成的渠道码：' + status())

      await ui.click('停用', { within: name })
      await ui.click('停用')
      await ui.sleep(800)
      if (status() !== 'DISABLED') throw new Error('停用后库里状态是 ' + status())
      if (await ui.has(name)) throw new Error('停用后渠道码还留在「启用中」页签')
      await ui.clickSel('.filter-tabs button', { nth: 1 }) // 已停用
      await ui.see(name)

      await ui.click('启用', { within: name })
      await ui.click('启用')
      await ui.see('已启用')
      await ui.sleep(500)
      if (status() !== 'ACTIVE') throw new Error('启用后库里状态是 ' + status())
      await ui.clickSel('.filter-tabs button', { nth: 0 }) // 启用中
      await ui.see(name)
    },

    /**
     * 消息铃铛：打开消息抽屉，只看未读，点一条未读消息标为已读；验收公司的老板再点「全部已读」。
     * 覆盖：POST /tenant/messages/read（带 ids 和不带 ids 两种）。
     * 前置：conCompany（审核驳回 / 通过会给老板发站内信）；验收公司没有未读时退回用演示公司的项目经理、老板，那时只读一条，不点「全部已读」。
     */
    async conMessages() {
      const ui = h.ui
      const unreadQ = (mid) => `SELECT COUNT(*) FROM notification WHERE recipient_type = 'MEMBER' AND recipient_id = '${mid}' AND read_at IS NULL`
      const cands = []
      if (st.conCo?.id && one(`SELECT company_status FROM company WHERE company_id = '${st.conCo.id}'`) === 'NORMAL') cands.push([st.conCo.phone, st.conCo.id, true])
      cands.push(['13800000002', DEMO, false], ['13800000001', DEMO, false])
      let pick = null
      for (const [phone, companyId, own] of cands) {
        const mid = memberIdOf(companyId, phone)
        if (!mid) continue
        // 站内信是异步发的，自己的公司多等一会儿
        const n = own ? await waitDb(unreadQ(mid), (v) => Number(v) > 0, 20000).catch(() => '0') : one(unreadQ(mid))
        if (Number(n) > 0) { pick = { phone, mid, own }; break }
      }
      if (!pick) throw new Error('没有带未读站内信的后台账号：先跑 conCompany（或 conIncident，上报工伤会给老板和项目经理发站内信）')

      await h.loginConsole(pick.phone)
      await ui.clickSel('.bell', { any: true })
      await ui.see('只看未读')
      await ui.clickSel('.el-switch')
      await ui.sleep(600)
      const before = await ui.count('.msg.unread')
      if (!before) throw new Error('库里有未读消息，但消息抽屉「只看未读」里一条也没有')
      // 列表按优先级、编号倒序，第一条就是这条
      const target = one(`SELECT id FROM notification WHERE recipient_type = 'MEMBER' AND recipient_id = '${pick.mid}' AND read_at IS NULL ORDER BY priority DESC, id DESC LIMIT 1`)
      await ui.clickSel('.msg.unread')
      await ui.sleep(800)
      expectDb(`SELECT COUNT(*) FROM notification WHERE id = ${target} AND read_at IS NOT NULL`, 1)
      const stillOpen = (await ui.count('.el-switch')) > 0 // 带链接的消息点了会跳转并收起抽屉
      if (stillOpen && (await ui.count('.msg.unread')) !== before - 1) throw new Error('点开未读消息后，列表里的未读标记没有少一条')

      if (pick.own && Number(one(unreadQ(pick.mid))) > 0) {
        if (!stillOpen) { await ui.clickSel('.bell', { any: true }); await ui.see('只看未读') }
        await ui.click('全部已读')
        await ui.see('已全部标为已读')
        expectDb(unreadQ(pick.mid), 0)
      }
    },

    /**
     * 岗位（演示公司项目经理，自己新建的岗位）：发布 → 平台审核通过 → 暂停 → 调名额 → 恢复 → 编辑（重新进审核）→ 下架。
     * 覆盖：POST /tenant/jobs/* /pause、PUT /tenant/jobs/* /quota、POST /tenant/jobs/* /resume、PUT /tenant/jobs/*。
     */
    async conJob() {
      const ui = h.ui
      const title = '验收控岗' + tail6()
      st.conJobTitle = title; save()
      const col = (c) => one(`SELECT ${c} FROM job WHERE title = '${title}'`)
      const find = async () => {
        await ui.goto('/admin/pm/jobs')
        await ui.fill('岗位名称', title)
        await ui.key('Enter', 'Enter', 13)
        await ui.idle()
        await ui.see(title)
      }
      await h.loginConsole('13800000002')
      await ui.goto('/admin/pm/jobs/edit')
      await ui.fill('如：SMT 贴片操作工', title)
      await ui.select('所属项目', DEMO_PROJECT)
      await ui.select('工种', '普工')
      await ui.fill('逐条描述岗位工作内容', '1. 按作业指导书完成外观检查\n2. 服从班组长安排')
      await ui.fill('最低，如 5800', '5300')
      await ui.fill('最高，如 6800', '6400')
      await ui.select('班次', '白班')
      await ui.fill('如：立讯精密二期 · 招聘大厅', '昆山市锦溪镇长云路 1 号东门招聘中心')
      await ui.fill('如：每日 09:00', '工作日 09:00')
      await ui.click('提交审核并发布')
      await ui.see('岗位已提交，等待平台审核')
      expectDb(`SELECT job_status FROM job WHERE title = '${title}'`, 'PENDING_AUDIT')

      await h.loginOps()
      await ui.goto('/ops/governance/job-audit')
      await ui.fill('岗位名称 / 岗位 ID', title)
      await ui.click('查询')
      await ui.click('审核', { within: title })
      await ui.click('审核通过')
      await ui.click('通过')
      await ui.see('审核通过，岗位已上架')
      expectDb(`SELECT job_status FROM job WHERE title = '${title}'`, 'RECRUITING')

      // 暂停（先暂停，后面的名额调整不让它留在匹配池里）
      await h.loginConsole('13800000002')
      await find()
      await ui.click('暂停', { within: title })
      await ui.click('暂停招聘')
      await ui.see('已暂停招聘')
      expectDb(`SELECT job_status FROM job WHERE title = '${title}'`, 'PAUSED')

      // 名额 +1
      const quota = Number(col('quota_total'))
      await ui.click('名额', { within: title })
      await ui.see('调整招聘名额')
      await ui.clickSel('.el-input-number__increase')
      await ui.click('保存')
      await ui.see('名额已调整')
      expectDb(`SELECT quota_total FROM job WHERE title = '${title}'`, quota + 1)
      await ui.see(`/ ${quota + 1}`)

      // 恢复
      await ui.click('恢复招聘', { within: title })
      await ui.click('恢复招聘')
      await ui.see('已恢复招聘')
      expectDb(`SELECT job_status FROM job WHERE title = '${title}'`, 'RECRUITING')

      // 编辑：招聘中的岗位保存要二次确认，保存后重新进平台审核
      await ui.click('编辑', { within: title })
      await ui.see('编辑岗位')
      await ui.see('保存后将重新提交平台审核')
      await ui.fill('如：每日 09:00', '工作日 14:00')
      await ui.fill('如：五险、全勤奖', '五险、全勤奖 200')
      await ui.click('保存并提交审核')
      await ui.see('确定保存？')
      await ui.click('保存并提交审核')
      await ui.see('已保存，岗位已重新提交平台审核')
      expectDb(`SELECT CONCAT(job_status, '|', interview_time_desc, '|', benefits) FROM job WHERE title = '${title}'`, 'PENDING_AUDIT|工作日 14:00|五险、全勤奖 200')

      // 收尾：下架，不留在平台审核队列和匹配结果里
      await find()
      await ui.click('更多', { within: title })
      await ui.click('下架')
      await ui.clickSel('.el-message-box .el-button--primary')
      await ui.see('已下架')
      expectDb(`SELECT job_status FROM job WHERE title = '${title}'`, 'OFFLINE')
    },

    /**
     * 报名处理（演示公司驻场，在公司后台的待办清单里）：一个新报名「取消报名」（填原因），另一个新报名标「爽约」。
     * 覆盖：POST /tenant/applications/* /cancel、POST /tenant/applications/* /no-show。
     * 被取消的求职者回到私域待匹配，记在 st.conPriv，给 conKb 提问用。
     */
    async conApps() {
      const ui = h.ui
      const channel = demoChannel()
      const apply = async () => {
        const p = await h.registerAndApply(channel)
        const row = sql('SELECT application_id, user_id, job_id, company_id FROM application ORDER BY created_at DESC LIMIT 1')[0]
        if (row[3] !== DEMO) throw new Error('扫演示公司渠道码注册的求职者报到了别的公司 ' + row[3])
        return { ...p, appId: row[0], userId: row[1], jobId: row[2] }
      }
      const openMore = async (appId) => {
        await h.loginConsole('13800000003')
        await ui.goto('/admin/site/todo')
        await pageTo(appId)
        await ui.click('更多', { within: appId })
      }

      // ---- 取消报名
      const a = await apply()
      await openMore(a.appId)
      await ui.click('取消报名')
      await ui.see('用户无法自行取消')
      await ui.fill('请填写取消原因', '验收：求职者来电说要换岗位，先取消这次报名')
      await ui.click('确认取消')
      await ui.see('报名已取消')
      expectDb(`SELECT status FROM application WHERE application_id = '${a.appId}'`, 'CANCELLED')
      expectDb(`SELECT user_status FROM \`user\` WHERE user_id = '${a.userId}'`, 'PRIVATE_PENDING')
      st.conPriv = { phone: a.phone, userId: a.userId, jobId: a.jobId }; save()

      // ---- 爽约
      const b = await apply()
      await openMore(b.appId)
      await ui.click('爽约')
      await ui.see('简历释放至全平台公域')
      await ui.click('确认爽约')
      await ui.see('已标记爽约')
      expectDb(`SELECT status FROM application WHERE application_id = '${b.appId}'`, 'NO_SHOW')
      expectDb(`SELECT user_status FROM \`user\` WHERE user_id = '${b.userId}'`, 'PUBLIC_SEEKING')
    },

    /**
     * 知识库（演示公司老板）：新增项目级问答 → 编辑 → 删除；求职者在岗位详情页问两个知识库里没有的问题 → 后台「待补充问题」里一个补充答案、一个忽略 → 把补充出来的条目删掉。
     * 覆盖：POST /tenant/kb、PUT /tenant/kb/*、DELETE /tenant/kb/*、POST /tenant/kb/pending/* /answer、POST /tenant/kb/pending/* /ignore。
     * 前置：conApps（用被取消报名的那个求职者提问）；没跑过就用 hire 入职的那个人。
     */
    async conKb() {
      const ui = h.ui
      const phone = st.conPriv?.phone ?? st.phone
      if (!phone) throw new Error('先跑 conApps 或 hire，拿到一个求职者手机号')
      const job = sql(`SELECT j.job_id, p.name FROM job j JOIN project p ON p.project_id = j.project_id WHERE j.company_id = '${DEMO}' AND j.job_status = 'RECRUITING' AND j.title NOT LIKE '验收%' ORDER BY (j.job_id = '${st.conPriv?.jobId ?? ''}') DESC, j.job_id LIMIT 1`)[0]
      if (!job) throw new Error(`${DEMO} 没有招聘中的岗位，求职者没地方提问`)
      const [jobId, projectName] = job
      const tail = tail6()
      const search = async (kw) => {
        await ui.fill('搜索问题 / 答案', kw)
        await ui.key('Enter', 'Enter', 13)
        await ui.idle()
      }
      const remove = async (q) => {
        await ui.click('删除', { within: q })
        await ui.see('删除后求职者提问将不再命中此条')
        await ui.click('删除')
        await ui.see('已删除')
        await ui.sleep(600)
      }

      await h.loginConsole(OWNERS[DEMO])
      await ui.goto('/admin/pm/kb')
      // 上次跑到一半留下的「验收提问」条目先删掉，不然这次的提问会命中它们，进不了待补充
      await search('验收提问')
      for (let i = 0; i < 10 && (await ui.count('.el-table__row')) > 0; i++) await remove('验收提问')
      expectDb(`SELECT COUNT(*) FROM kb_entry WHERE company_id = '${DEMO}' AND status = 'ACTIVE' AND question LIKE '验收提问%'`, 0)

      // ---- 新增 → 编辑 → 删除
      const q = `验收问答${tail}：夜班补贴怎么算`
      await ui.click('新增问答')
      await ui.sleep(600)
      await ui.click('项目') // 适用范围：老板默认是「公司通用」，改成项目级
      await ui.sleep(300)
      await ui.select('项目', projectName)
      await ui.fill('如：工资什么时候发？', q)
      await ui.fill('统一、可追溯的口径', '夜班补贴 25 元 / 班，随当月工资发放。')
      await ui.click('保存')
      await ui.see('条目已新增')
      expectDb(`SELECT CONCAT(status, '|', IFNULL(job_id, '-'), '|', (project_id IS NOT NULL)) FROM kb_entry WHERE company_id = '${DEMO}' AND question = '${q}'`, 'ACTIVE|-|1')
      await search(q)
      await ui.click('编辑', { within: q })
      await ui.sleep(600)
      await ui.see('编辑问答')
      await ui.fill('统一、可追溯的口径', '夜班补贴 30 元 / 班，随当月工资发放。')
      await ui.click('保存')
      await ui.see('条目已更新')
      await ui.see('夜班补贴 30 元')
      expectDb(`SELECT answer FROM kb_entry WHERE company_id = '${DEMO}' AND question = '${q}'`, '夜班补贴 30 元 / 班，随当月工资发放。')
      await remove(q)
      expectDb(`SELECT status FROM kb_entry WHERE company_id = '${DEMO}' AND question = '${q}'`, 'DELETED')

      // ---- 求职者提两个没有现成答案的问题
      const q1 = `验收提问${tail}乌龟鹦鹉仓鼠蜥蜴`, q2 = `验收提问${tail}琵琶唢呐箜篌编钟`
      await h.loginSeeker(phone)
      await ui.goto('/jobs/' + jobId)
      await ui.click('问问这个岗位')
      await ui.sleep(600)
      for (const x of [q1, q2]) {
        await ui.fill('输入你的问题', x)
        await ui.click('发送')
        await ui.sleep(1200)
      }
      await ui.see('已转岗位负责人')
      const pendQ = (x) => `SELECT COUNT(*) FROM kb_query_log WHERE company_id = '${DEMO}' AND job_id = '${jobId}' AND question = '${x}' AND answered_by = 'HUMAN_PENDING' AND hit_entry_id IS NULL`
      for (const x of [q1, q2]) if (one(pendQ(x)) !== '1') throw new Error(`提问「${x}」没有进入待补充（可能命中了已有的知识库条目）`)

      // ---- 待补充：一个补充答案，一个忽略
      await h.loginConsole(OWNERS[DEMO])
      await ui.goto('/admin/pm/kb?tab=pending')
      await pageTo(q1)
      await ui.click('补充答案', { within: q1 })
      await ui.sleep(600)
      await ui.see('答案将写入该岗位的知识库条目')
      await ui.fill('答案', '验收答复：宿舍不能养宠物。')
      await ui.click('保存并通知')
      await ui.see('答案已写入岗位知识库')
      expectDb(pendQ(q1), 0)
      expectDb(`SELECT CONCAT(status, '|', job_id) FROM kb_entry WHERE company_id = '${DEMO}' AND question = '${q1}'`, 'ACTIVE|' + jobId)
      await pageTo(q2)
      await ui.click('忽略', { within: q2 })
      await ui.see('忽略后不再出现在待补充列表')
      await ui.click('忽略')
      await ui.see('已忽略')
      expectDb(`SELECT COUNT(*) FROM kb_query_log WHERE company_id = '${DEMO}' AND question = '${q2}' AND answered_by = 'IGNORED'`, 1)

      // ---- 收尾：补充出来的岗位级条目删掉，演示岗位的知识库保持原样
      await ui.clickSel('.filter-tabs button', { nth: 0 }) // 问答条目
      await search(q1)
      await remove(q1)
      expectDb(`SELECT status FROM kb_entry WHERE company_id = '${DEMO}' AND question = '${q1}'`, 'DELETED')
    },

    /**
     * 流转池（演示公司人才经纪人）：自己注册一个私域待匹配的求职者 → 驻场在手机端一键流转给经纪人 → 经纪人标记已联系、生成 AI 报告、释放至公域。
     * 覆盖：POST /tenant/broker/cases/* /contact、POST /tenant/broker/cases/* /report、POST /tenant/broker/cases/* /release；
     *       顺带走了 POST /tenant/seekers/* /transfer-to-broker（公司后台没有这个入口，只在驻场手机端「24h 提醒」里，这里当作前置步骤从手机端点）。
     */
    async conBroker() {
      const ui = h.ui
      const p = await registerNoApply(demoChannel())
      st.conBrokerSeeker = p; save()
      expectDb(`SELECT CONCAT(user_status, '|', bound_company_id) FROM \`user\` WHERE user_id = '${p.userId}'`, 'PRIVATE_PENDING|' + DEMO)
      const openCase = () => one(`SELECT id FROM broker_case WHERE user_id = '${p.userId}' AND company_id = '${DEMO}' AND status IN ('OPEN', 'CONTACTED', 'RECOMMENDED') ORDER BY id DESC LIMIT 1`)

      // 匹配度不足时系统会自动转入流转池；没有自动转入就由驻场在手机端流转
      if (!openCase()) {
        await h.loginStaff('13800000003')
        await ui.goto('/staff/reminders?f=private')
        await ui.see(spaced(p.phone))
        await ui.click('一键流转经纪人', { within: spaced(p.phone) })
        await ui.see('转交本公司人才经纪人二次匹配')
        await ui.click('确认流转')
        await ui.see('已流转至人才经纪人')
      }
      const caseId = openCase()
      if (!caseId) throw new Error('流转后库里没有处理中的流转工单')

      await h.loginConsole('13800000004')
      await ui.goto('/admin/broker/pool')
      await ui.see(mask(p.phone))
      await ui.click('标记已联系', { within: mask(p.phone) })
      await ui.see('确认已电话联系')
      await ui.click('已联系')
      await ui.see('已标记联系')
      expectDb(`SELECT CONCAT(status, '|', (contacted_at IS NOT NULL)) FROM broker_case WHERE id = ${caseId}`, 'CONTACTED|1')

      await ui.click('AI 报告', { within: mask(p.phone) })
      await ui.see('流转工单 #' + caseId)
      await ui.sleep(800)
      const reports = Number(one(`SELECT COUNT(*) FROM ai_report WHERE broker_case_id = ${caseId}`))
      await ui.click((await ui.has('暂无 AI 分析报告')) ? '生成报告' : '重新生成')
      await ui.see('AI 分析报告已生成', 15000)
      await ui.see('AI 结论')
      expectDb(`SELECT COUNT(*) FROM ai_report WHERE broker_case_id = ${caseId}`, reports + 1)

      await ui.click('释放至公域') // 抽屉里的页签
      await ui.see('此操作不可逆')
      await ui.click('用户明确表示放弃本公司岗位')
      await ui.fill('补充说明', '验收：电话沟通后本人表示不考虑本公司岗位')
      await ui.click('确认释放')
      await ui.see('确定释放？')
      await ui.click('确认释放')
      await ui.see('已释放至公域，用户可匹配全平台岗位')
      expectDb(`SELECT status FROM broker_case WHERE id = ${caseId}`, 'RELEASED')
      expectDb(`SELECT CONCAT(user_status, '|', IFNULL(bound_company_id, '-')) FROM \`user\` WHERE user_id = '${p.userId}'`, 'PUBLIC_SEEKING|-')
    },

    /**
     * 花名册导入与内部调岗（演示公司项目经理）：上传一行花名册 → 新员工建档在岗 → 调到本项目的一个岗位 → 发起并确认离职（收尾，不给演示公司留一个在岗的验收员工）。
     * 覆盖：POST /tenant/roster/import、POST /tenant/employments/* /transfer。
     */
    async conRoster() {
      const ui = h.ui
      const pid = one(`SELECT project_id FROM project WHERE company_id = '${DEMO}' AND name = '${DEMO_PROJECT}' AND status = 'ACTIVE'`)
      if (!pid) throw new Error(`${DEMO} 没有进行中的项目「${DEMO_PROJECT}」`)
      if (one(`SELECT COUNT(*) FROM job WHERE project_id = '${pid}' AND job_status IN ('RECRUITING', 'PAUSED')`) === '0') throw new Error(`「${DEMO_PROJECT}」下没有招聘中或暂停的岗位，调岗没有可选的岗位`)
      const no = 'YS' + tail6()
      const phone = '133' + String(Date.now()).slice(-8)
      const name = '验收' + hanzi() + hanzi()
      const day = one("SELECT DATE_FORMAT(CURDATE() - INTERVAL 1 DAY, '%Y-%m-%d')")
      const file = `${out}/验收花名册${no}.xlsx`
      fs.writeFileSync(file, xlsx([['姓名', '手机号', '身份证号', '项目（编号或名称）', '岗位编号（选填）', '入职日期（yyyy-MM-dd）', '工号（选填）'],
        [name, phone, idCard(), DEMO_PROJECT, '', day, no]]))
      const emp = (c) => one(`SELECT ${c} FROM employment WHERE company_id = '${DEMO}' AND employee_no = '${no}'`)

      await h.loginConsole('13800000002')
      await ui.goto('/admin/pm/roster')
      await ui.upload(file)
      await ui.see(`验收花名册${no}.xlsx`)
      await ui.click('开始导入')
      await ui.see('成功的行不可撤销')
      await ui.click('开始导入') // 确认框
      await ui.see('导入完成：1 行全部成功', 20000)
      await ui.see('全部导入成功')
      expectDb(`SELECT CONCAT(origin, '|', project_id, '|', IFNULL(job_id, '-'), '|', (end_date IS NULL)) FROM employment WHERE company_id = '${DEMO}' AND employee_no = '${no}'`, `ROSTER_IMPORT|${pid}|-|1`)

      // ---- 调岗：项目不变，选本项目的第一个岗位
      const find = async () => {
        await ui.goto('/admin/pm/staff')
        await ui.fill('工号或完整手机号', no)
        await ui.click('查询')
        await ui.see(no)
      }
      await find()
      await ui.click('调岗', { within: no })
      await ui.see('内部调岗')
      await ui.sleep(1000) // 等岗位下拉加载
      await ui.fill('调入岗位', null)
      await ui.sleep(400)
      await ui.clickSel('.el-select-dropdown__item:not(.is-disabled)', { wait: 2000 })
      await ui.click('确认调岗')
      await ui.see('调岗不影响在岗天数与归属')
      await ui.click('确认调岗') // 确认框
      await ui.see('调岗完成')
      if (!emp('job_id') || emp('job_id') === 'NULL') throw new Error('调岗后库里的岗位还是空的')
      expectDb(`SELECT COUNT(*) FROM employment_change_log WHERE employment_id = '${emp('employment_id')}'`, 1)

      // ---- 收尾：离职
      await ui.click('离职', { within: no })
      await ui.see('发起离职')
      await ui.select('离职原因', '个人 / 家庭原因')
      await ui.click('提交审核')
      await ui.see('离职申请已提交，待项目经理审核')
      await ui.goto('/admin/pm/resign')
      await ui.click('确认离职', { within: no })
      await ui.click('确认离职')
      await ui.see('已确认')
      expectDb(`SELECT COUNT(*) FROM resign_request r JOIN employment e ON e.employment_id = r.employment_id WHERE e.employee_no = '${no}' AND r.status IN ('SCHEDULED', 'APPROVED')`, 1)
    },

    /**
     * 工伤上报（演示公司项目经理）：上报 → 登记处理结论结案。
     * 覆盖：POST /tenant/incidents、POST /tenant/incidents/* /close。
     */
    async conIncident() {
      const ui = h.ui
      const tag = '验收工伤' + tail6()
      const detail = `${tag}：包装线搬运时左手食指被纸箱划伤，已在医务室消毒包扎`
      const person = '验收伤员' + hanzi()
      await h.loginConsole('13800000002')
      await ui.goto('/admin/pm/incidents')
      await ui.click('上报工伤')
      await ui.sleep(600)
      await ui.select('项目', DEMO_PROJECT)
      await ui.fill('姓名', person)
      await ui.fill('哪里、怎么受的伤', detail)
      await ui.click('立即上报')
      await ui.see('已上报，老板和项目经理会立刻收到通知')
      await ui.see(tag)
      expectDb(`SELECT CONCAT(status, '|', person_name) FROM incident WHERE company_id = '${DEMO}' AND detail = '${detail}'`, 'OPEN|' + person)

      await ui.click('结案', { within: tag })
      await ui.see('登记处理结论')
      await ui.fill('救治情况', '验收：已复查无大碍，医药费公司承担，不申报工伤认定')
      await ui.click('结案')
      await ui.sleep(1000)
      expectDb(`SELECT CONCAT(status, '|', handle_note) FROM incident WHERE company_id = '${DEMO}' AND detail = '${detail}'`, 'CLOSED|验收：已复查无大碍，医药费公司承担，不申报工伤认定')
      if (await ui.has(tag)) throw new Error('结案后这条工伤还留在「处理中」页签')
      await ui.click('已结案')
      await ui.see(tag)
      await ui.see('处理结论')
    },

    // POST /tenant/bills/*/disputes 不在这里：e2e-flows-ops.mjs 的 opsBillDispute 已经让演示公司老板在公司后台提异议、平台再驳回。

    /**
     * 收尾：平台把 conCompany 建的验收公司封禁，并把它名下还在待备案的合作合同驳回，不在演示数据里留一家「正常」的空公司和待审合同。
     * 不覆盖本端接口。前置：conCompany。
     */
    async conCleanup() {
      const ui = h.ui
      const co = st.conCo
      if (!co?.id) throw new Error('先跑 conCompany')
      const status = () => one(`SELECT company_status FROM company WHERE company_id = '${co.id}'`)
      if (status() === 'NORMAL') {
        await opsOpenCompany(co.name, true)
        await ui.click('调整状态')
        await ui.sleep(600)
        await ui.click('封禁')
        await ui.fill('将记录到审计日志并通知该公司', '界面验收用的测试公司，验收完成后停用。')
        await ui.click('确认调整')
        await ui.sleep(1500)
        if (status() === 'NORMAL') throw new Error('封禁后验收公司仍是正常状态')
      } else if (status() === 'PENDING_AUDIT') {
        // conCompany 跑到一半留下的待审核申请：驳回掉
        await opsOpenCompany(co.name, false)
        await ui.click('驳回')
        await ui.fill('请填写原因', '界面验收用的测试申请，验收完成后驳回。')
        await ui.click('驳回')
        await ui.see('已驳回入驻申请')
      }
      const pendingQ = `SELECT COUNT(*) FROM client_contract WHERE company_id = '${co.id}' AND audit_status = 'PENDING'`
      for (let i = 0; i < 5 && one(pendingQ) !== '0'; i++) {
        const left = Number(one(pendingQ))
        if (i === 0) await h.loginOps()
        await ui.goto('/ops/governance/job-audit?tab=contracts')
        await ui.fill('公司 ID', co.id)
        await ui.click('查询')
        await ui.click('驳回', { within: co.id })
        await ui.see('驳回原因将展示给劳务公司')
        await ui.fill('请填写原因', '界面验收用的测试合同，验收完成后驳回。')
        await ui.click('驳回')
        await ui.sleep(1200)
        expectDb(pendingQ, left - 1)
      }
    },
  }
}
