// 运营中台（web/apps/ops，/ops/ 下）的界面验收流程，由 e2e.mjs 自动加载。
// 建议顺序就是下面的书写顺序；每个流程都能单独跑（需要的公司、求职者、岗位、合同都在流程里从界面上现造）。
// 只有 opsBillDispute、opsBillSettle 依赖库里已有的月账单，没有合适的账单时会直接报明原因。
// 造出来的数据都带「验收」字样：公司叫「昆山验收…」、岗位叫「验收岗位…」（e2e-clean.sql 能清掉），平台账号叫 e2e_…。
export default (h) => {
  const { sql, expectDb, dec, st, save, out } = h
  const OWNER = { C10001: '13800000001', C10002: '13800000011', C10003: '13800000021' }
  const digits = (n = 6) => String(Date.now()).slice(-n)
  const pad = (n) => String(n).padStart(2, '0')
  /** 拼进 SQL 字符串字面量前转义单引号。 */
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")
  const one = (query) => sql(query)[0]?.[0]

  /** 确认框（ElMessageBox）里的确认按钮：标题和按钮常常同名，按样式点。 */
  const boxOk = () => h.ui.clickSel('.el-message-box__btns .el-button--primary')
  /** 前端分页的表格：目标行不在当前页就一直翻下一页。 */
  async function pageTo(text) {
    for (let i = 0; i < 40; i++) {
      if (await h.ui.has(text)) return
      if (!(await h.ui.count('.el-pagination .btn-next:not([disabled])'))) break
      await h.ui.clickSel('.el-pagination .btn-next:not([disabled])')
    }
    throw new Error(`翻完所有页也没找到「${text}」`)
  }
  /** 手机号密文存库，按最近注册的几个人解密比对出用户 ID。 */
  function userIdOf(phone) {
    for (const [id, enc] of sql('SELECT user_id, phone_enc FROM `user` ORDER BY registered_at DESC LIMIT 40')) if (dec(enc) === phone) return id
    throw new Error('库里找不到刚注册的求职者 ' + phone)
  }
  /** 用新手机号登录求职者端（即注册），返回手机号和用户 ID。 */
  async function newSeeker() {
    const phone = '134' + digits(8)
    await h.loginSeeker(phone)
    return { phone, uid: userIdOf(phone) }
  }
  /** 用指定平台账号登录运营中台（loginOps 只会登 admin）。登录后可能停在「首次登录 · 修改密码」。 */
  async function opsLoginAs(username, password, freshSession = true) {
    const ui = h.ui
    if (freshSession) { await ui.fresh('pc'); await ui.goto('/ops/login') }
    await ui.fill('请输入用户名', username)
    await ui.fill('请输入密码', password)
    if (!ui.captchaId) await ui.clickSel('.cap')
    await ui.fill('请输入右侧字符', h.captchaAnswer())
    await ui.click('登录')
  }
  /** 一次性密码弹窗里把密码读出来再关掉。 */
  async function readOtp(title) {
    const ui = h.ui
    await ui.see(title)
    await ui.sleep(400)
    const pwd = (await ui.ev(`(() => { const e = [...document.querySelectorAll('.el-dialog .pwd')].filter((x) => x.getClientRects().length).pop(); return e ? e.innerText.trim() : '' })()`))
      || /"initialPassword":"([^"]+)"/.exec(ui.lastWrite?.body ?? '')?.[1]
    if (!pwd) throw new Error('一次性密码弹窗里没读到密码')
    await ui.click('我已记录，关闭')
    return pwd
  }

  /** 新手机号在公司后台提交入驻申请（同 onboard 流程的前半段），返回 { phone, name, short, id }。 */
  async function applyCompany(tag) {
    const ui = h.ui
    const tail = digits(5)
    const co = { phone: '137' + digits(8), name: `昆山验收${tag}${tail}人力资源有限公司`, short: '验收' + tag + tail }
    await ui.fresh('pc')
    await ui.goto('/admin/login')
    await ui.shot(`${out}/licence.png`) // 借一张真实的 PNG 当执照扫描件
    h.clearSmsLimits()
    await ui.fill('请输入 11 位手机号', co.phone)
    await ui.clickSel('.send')
    if (await ui.count('input[placeholder="请输入右侧字符"]')) {
      await ui.fill('请输入右侧字符', h.captchaAnswer())
      await ui.clickSel('.send')
    }
    await ui.click('登录')
    await ui.see('劳务公司入驻申请')
    await ui.fill('与营业执照一致', co.name)
    await ui.fill('求职者端展示', co.short)
    await ui.fill('18 位', '91320583MA2' + digits(7))
    await ui.fill('负责对接平台的联系人姓名', '验收联系人')
    await ui.upload(`${out}/licence.png`)
    await ui.click('提交入驻申请')
    await ui.see('入驻申请已提交')
    co.id = one(`SELECT company_id FROM company WHERE name = '${q(co.name)}'`)
    if (!co.id) throw new Error('入驻申请提交后库里没有这家公司')
    return co
  }
  /** 运营中台公司管理里按名称找到待审核的公司并打开审核抽屉。 */
  async function openCompanyAudit(co) {
    const ui = h.ui
    await h.loginOps()
    await ui.goto('/ops/companies/list')
    await ui.fill('公司名称 / 公司 ID', co.name)
    await ui.click('查询')
    await ui.click('审核', { within: co.name })
    await ui.see('验收联系人')
  }
  /** 一家状态正常的验收公司（老板手机号能登公司后台）：上次造的还正常就接着用，否则现造一家并审核通过。 */
  async function testCompany() {
    if (st.opsCo && one(`SELECT company_status FROM company WHERE company_id = '${q(st.opsCo.id)}'`) === 'NORMAL') return st.opsCo
    const co = await applyCompany('甲')
    await openCompanyAudit(co)
    await h.ui.click('通过入驻')
    await h.ui.click('通过')
    await h.ui.sleep(1500)
    expectDb(`SELECT company_status FROM company WHERE company_id = '${co.id}'`, 'NORMAL')
    st.opsCo = co; save()
    return co
  }
  /** 演示公司 A 的项目经理发布一个验收岗位并提交审核（步骤同 job 流程）。 */
  async function publishJob(title) {
    const ui = h.ui
    await h.loginConsole('13800000002')
    await ui.goto('/admin/pm/jobs/edit')
    await ui.fill('如：SMT 贴片操作工', title)
    await ui.select('所属项目', '立讯精密昆山二期')
    await ui.select('工种', '普工')
    await ui.fill('逐条描述岗位工作内容', '1. 按作业指导书完成包装、贴标\n2. 服从班组长安排')
    await ui.fill('最低，如 5800', '5200')
    await ui.fill('最高，如 6800', '6300')
    await ui.select('班次', '白班')
    await ui.fill('如：立讯精密二期 · 招聘大厅', '昆山市锦溪镇长云路 1 号东门招聘中心')
    await ui.fill('如：每日 09:00', '工作日 09:00')
    await ui.click('提交审核并发布')
    await ui.see('岗位已提交，等待平台审核')
    expectDb(`SELECT job_status FROM job WHERE title = '${title}'`, 'PENDING_AUDIT')
  }
  /** 运营中台岗位审核里按名称找到岗位并打开抽屉。 */
  async function openJobAudit(title) {
    const ui = h.ui
    await h.loginOps()
    await ui.goto('/ops/governance/job-audit')
    await ui.fill('岗位名称 / 岗位 ID', title)
    await ui.click('查询')
    await ui.click('审核', { within: title })
    await ui.see('审核记录')
  }
  /** 对账管理里按公司筛出账单，点开指定账单的抽屉（按钮是「复核」或「详情」）。 */
  async function openBill(companyId, billId, button) {
    const ui = h.ui
    await h.loginOps()
    await ui.goto('/ops/settlement/bills')
    await ui.fill('公司 ID', companyId)
    await ui.click('查询')
    await pageTo(billId)
    await ui.click(button, { within: billId })
    await ui.see('账单信息')
  }
  /** 题库某个版本的题目内容指纹：发布前确认界面保存没有改动题目。 */
  const quizHash = (versionId) => one(`SELECT MD5(GROUP_CONCAT(MD5(CONCAT_WS('|', seq, question_type, stem, IFNULL(hint, ''), profile_field, match_role, CAST(options AS CHAR))) ORDER BY seq)) FROM quiz_question WHERE version_id = ${Number(versionId)}`)

  return {
    // ================================================================ 平台账号
    // POST /ops/admins、PUT /ops/admins/*、POST /ops/admins/*/status（停用、启用）、POST /ops/admins/*/reset-password、
    // PUT /ops/me/password（用新建的账号改密，不动 admin）、POST /ops/auth/logout
    /** 平台账号：新建 → 改姓名加角色 → 停用 → 启用 → 重置密码 → 新账号首次登录强制改密 → 用新密码登录 → 退出登录；收尾停用。 */
    async opsAdmin() {
      const ui = h.ui
      const username = 'e2e_' + digits(8)
      const name = '验收运营' + h.hanzi() + h.hanzi()
      const admin = () => `FROM ops_admin WHERE username = '${username}'`
      const findRow = async () => { await ui.fill('用户名 / 姓名', username); await ui.click('查询') }

      await h.loginOps()
      await ui.goto('/ops/system/admins')
      await ui.click('新建账号')
      await ui.fill('3–32 位小写字母', username)
      await ui.fill('使用人真实姓名', name)
      await ui.click('运营')
      await ui.click('创建')
      await readOtp('账号已创建')
      expectDb(`SELECT CONCAT(display_name, '|', roles, '|', status, '|', must_change_password) ${admin()}`, `${name}|OPERATOR|NORMAL|1`)
      const adminId = one(`SELECT admin_id ${admin()}`)

      await findRow()
      await ui.click('编辑', { within: username })
      await ui.fill('使用人真实姓名', name + '改')
      await ui.click('财务')
      await ui.click('保存')
      await ui.see('已保存')
      expectDb(`SELECT COUNT(*) ${admin()} AND display_name = '${name}改' AND roles LIKE '%OPERATOR%' AND roles LIKE '%FINANCE%'`, 1)

      await ui.click('停用', { within: username })
      await boxOk()
      await ui.see('已停用')
      expectDb(`SELECT status ${admin()}`, 'DISABLED')
      await ui.click('启用', { within: username })
      await boxOk()
      await ui.see('已启用')
      expectDb(`SELECT status ${admin()}`, 'NORMAL')

      const hashBefore = one(`SELECT password_hash ${admin()}`)
      await ui.click('重置密码', { within: username })
      await boxOk()
      const otp = await readOtp('密码已重置')
      if (one(`SELECT password_hash ${admin()}`) === hashBefore) throw new Error('重置密码后库里的密码没有变')
      expectDb(`SELECT must_change_password ${admin()}`, 1)

      // 新账号用一次性密码登录：被强制改密，改完要重新登录
      const pwd = 'Yanshou' + digits(6) + 'a'
      await opsLoginAs(username, otp)
      await ui.see('首次登录 · 修改密码')
      await ui.fill('请输入当前密码（或初始密码）', otp)
      await ui.fill('至少 8 位，包含字母和数字', pwd)
      await ui.fill('再次输入新密码', pwd)
      await ui.click('修改密码并重新登录')
      await ui.see('密码修改成功，请使用新密码重新登录')
      expectDb(`SELECT must_change_password ${admin()}`, 0)
      expectDb(`SELECT COUNT(*) FROM auth_session WHERE domain = 'OPS' AND subject_id = '${adminId}' AND status = 'ACTIVE'`, 0)

      await opsLoginAs(username, pwd, false)
      if ((await ui.url()).includes('/login')) throw new Error('新账号改密后用新密码登录还停在登录页')
      await ui.see(name + '改')
      // 退出登录：右上角账号菜单
      await ui.clickSel('.me')
      await ui.click('退出登录')
      await ui.see('登录运营中台')
      if (ui.lastWrite?.u !== '/ops/auth/logout') throw new Error('点「退出登录」后最后一次写请求不是 /ops/auth/logout，而是 ' + ui.lastWrite?.u)
      expectDb(`SELECT COUNT(*) FROM auth_session WHERE domain = 'OPS' AND subject_id = '${adminId}' AND revoke_reason = 'LOGOUT'`, 1)
      await ui.goto('/ops/workbench')
      if (!(await ui.url()).includes('/login')) throw new Error('退出登录后还能直接进工作台')

      // 收尾：把这个验收账号停用（平台账号没有删除功能）
      await h.loginOps()
      await ui.goto('/ops/system/admins')
      await findRow()
      await ui.click('停用', { within: username })
      await boxOk()
      await ui.see('已停用')
      expectDb(`SELECT status ${admin()}`, 'DISABLED')
    },

    // ================================================================ 系统配置
    // POST /ops/holidays、DELETE /ops/holidays/*
    /** 节假日：在下个月挑没录过的连续 3 天录成放假（界面自动跳过周末）→ 逐天删除，日历恢复原样。 */
    async opsHoliday() {
      const ui = h.ui
      const now = new Date()
      const first = new Date(now.getFullYear(), now.getMonth() + 1, 1) // 录入弹窗的日期面板右半边就是下个月
      const y = first.getFullYear(), m = first.getMonth()
      const iso = (d) => `${y}-${pad(m + 1)}-${pad(d)}`
      const taken = new Set(sql(`SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') FROM holiday WHERE holiday_date BETWEEN '${iso(1)}' AND '${iso(28)}'`).map((r) => r[0]))
      let d = 0
      for (let c = 8; c <= 24 && !d; c++) if (![c, c + 1, c + 2].some((x) => taken.has(iso(x)))) d = c
      if (!d) throw new Error(`${y}-${pad(m + 1)} 找不到连续 3 天都没录过节假日的日期`)
      const want = [d, d + 1, d + 2].filter((x) => { const w = new Date(y, m, x).getDay(); return w !== 0 && w !== 6 }).map(iso)
      const name = '验收假日' + digits(4)

      await h.loginOps()
      await ui.goto('/ops/system/holidays')
      await ui.click('录入')
      await ui.sleep(500)
      await ui.fill('例如：春节', name)
      await ui.fill('开始', null) // 打开日期范围面板
      await ui.sleep(400)
      await ui.clickSel('.el-date-range-picker__content.is-right td.available', { nth: d - 1 })
      await ui.clickSel('.el-date-range-picker__content.is-right td.available', { nth: d + 1 })
      await ui.sleep(400)
      await ui.see(`将录入 ${want.length} 天`)
      await ui.see(want[0])
      await ui.click('保存')
      await ui.see(`已录入 ${want.length} 天`)
      expectDb(`SELECT COUNT(*) FROM holiday WHERE name = '${name}' AND is_workday = 0 AND holiday_date IN ('${want.join("','")}')`, want.length)

      // 删除：本次录的，连同以前跑到一半留下的验收假日
      const mine = sql(`SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') FROM holiday WHERE name LIKE '验收假日%' AND YEAR(holiday_date) = ${y} ORDER BY holiday_date`).map((r) => r[0])
      for (const date of mine) {
        await pageTo(date)
        await ui.click('删除', { within: date })
        await boxOk()
        await ui.see('已删除')
        expectDb(`SELECT COUNT(*) FROM holiday WHERE holiday_date = '${date}'`, 0)
      }
      expectDb(`SELECT COUNT(*) FROM holiday WHERE holiday_date BETWEEN '${iso(1)}' AND '${iso(28)}'`, taken.size)
    },

    // PUT /ops/sys-params/*
    /** 系统参数：把「匹配次数提醒阈值」加 1 再改回原值（两次都走界面，都要写修改原因）。 */
    async opsSysParam() {
      const ui = h.ui
      const key = 'matching.rematch_alert_count'
      const value = () => one(`SELECT param_value FROM sys_param WHERE param_key = '${key}'`)
      const cur = value()
      if (cur == null) throw new Error('库里没有系统参数 ' + key)
      // 上次改完没来得及改回时，原值记在状态文件里
      const orig = st.opsParamOrig ?? cur
      st.opsParamOrig = orig; save()
      const edit = async (to, remark) => {
        await ui.click('修改', { within: key })
        await ui.sleep(400)
        await ui.fill('新的值', to)
        await ui.fill('写明为什么改，会记入审计日志', remark)
        await ui.click('保存')
        await ui.see('已修改，1 分钟内全部生效')
        expectDb(`SELECT CONCAT(param_value, '|', update_remark) FROM sys_param WHERE param_key = '${key}'`, `${to}|${remark}`)
      }
      await h.loginOps()
      await ui.goto('/ops/system/params')
      await ui.see(key)
      if (cur === orig) await edit(String(Number(orig) + 1), '验收：临时调大 ' + digits(4))
      await edit(orig, '验收：改回原值 ' + digits(4))
      await ui.see('验收：改回原值')
      delete st.opsParamOrig; save()
    },

    // PUT /ops/notify-templates/*
    /** 通知模板：给一个模板的标题加上「（验收）」保存，再打开改回原标题保存。 */
    async opsTemplate() {
      const ui = h.ui
      const MARK = '（验收）'
      const row = sql(`SELECT template_code, title FROM notify_template WHERE title LIKE '%${MARK}' LIMIT 1`)[0] // 上次没改回来的优先
        ?? sql('SELECT template_code, title FROM notify_template WHERE enabled = 1 AND CHAR_LENGTH(title) <= 56 ORDER BY template_code DESC LIMIT 1')[0]
      if (!row) throw new Error('库里没有可用来验收的通知模板')
      const code = row[0]
      const orig = row[1].endsWith(MARK) ? row[1].slice(0, -MARK.length) : row[1]
      const edit = async (title) => {
        await ui.click('编辑', { within: code })
        await ui.see('编辑模板')
        await ui.fill('标题', title)
        await ui.click('保存')
        await ui.see('模板已保存，立即生效')
        expectDb(`SELECT title FROM notify_template WHERE template_code = '${code}'`, title)
      }
      await h.loginOps()
      await ui.goto('/ops/system/templates')
      await ui.fill('模板编码 / 标题 / 内容', code)
      await ui.sleep(500)
      if (row[1] === orig) { await edit(orig + MARK); await ui.sleep(2500) } // 等上一条轻提示消失，免得第二次保存的提示被当成已出现
      await edit(orig)
      expectDb(`SELECT COUNT(*) FROM notify_template WHERE title LIKE '%${MARK}'`, 0)
    },

    // ================================================================ 匹配配置
    // POST /ops/quiz/drafts、PUT /ops/quiz/versions/*、POST /ops/quiz/versions/*/publish
    /** 题库：从生效版本复制草稿 → 改版本名保存 → 版本名改回与生效版本一致再保存 → 核对题目与复制时一字不差后发布。 */
    async opsQuizPublish() {
      const ui = h.ui
      const act = sql("SELECT version_id, name FROM quiz_version WHERE status = 'ACTIVE'")[0]
      if (!act) throw new Error('库里没有生效的题库版本')
      let draft = one("SELECT version_id FROM quiz_version WHERE status = 'DRAFT'")
      // 别人留下的草稿内容可能和生效版本不同，不能替人发布
      if (draft && String(st.opsQuizDraft) !== String(draft)) throw new Error(`题库已有一个不是本流程建的草稿 v${draft}，不动它；请先在界面上处理掉这个草稿再跑`)
      await h.loginOps()
      await ui.goto('/ops/engine/quiz')
      if (draft) await ui.click('继续编辑草稿')
      else {
        await ui.click('新建草稿')
        await ui.see('已从生效版本复制草稿')
        draft = one("SELECT version_id FROM quiz_version WHERE status = 'DRAFT'")
        if (!draft) throw new Error('点「新建草稿」后库里没有草稿版本')
        st.opsQuizDraft = draft; st.opsQuizHash = quizHash(draft); save()
      }
      await ui.see('草稿编辑')
      const same = (when) => { if (quizHash(draft) !== st.opsQuizHash) throw new Error(`${when}后草稿 v${draft} 的题目和从生效版本复制时不一样了，不发布`) }
      same('打开草稿')

      const tmp = '验收题库' + digits(6)
      await ui.fill('如：v1.3 住宿题简化', tmp)
      await ui.see('未保存')
      await ui.click('保存草稿')
      await ui.see('草稿已保存')
      expectDb(`SELECT name FROM quiz_version WHERE version_id = ${draft}`, tmp)
      same('保存')
      await ui.fill('如：v1.3 住宿题简化', act[1])
      await ui.click('保存草稿')
      expectDb(`SELECT name FROM quiz_version WHERE version_id = ${draft}`, act[1])
      same('改回版本名保存')

      await ui.click('发布生效')
      await boxOk()
      await ui.see('已发布生效')
      expectDb("SELECT CONCAT(version_id, '|', name) FROM quiz_version WHERE status = 'ACTIVE'", `${draft}|${act[1]}`)
      expectDb(`SELECT status FROM quiz_version WHERE version_id = ${act[0]}`, 'ARCHIVED')
      expectDb("SELECT COUNT(*) FROM quiz_version WHERE status = 'DRAFT'", 0)
      delete st.opsQuizDraft; delete st.opsQuizHash; save()
    },

    // POST /ops/engine/versions/*/publish
    /** 匹配引擎参数：从生效版本复制草稿，一项不改直接发布（已有草稿只在与生效版本完全一致时才发布）。 */
    async opsEnginePublish() {
      const ui = h.ui
      const act = one("SELECT version_id FROM engine_config WHERE status = 'ACTIVE'")
      if (!act) throw new Error('库里没有生效的引擎参数版本')
      const sameAsActive = () => one(`SELECT d.config = a.config FROM engine_config d JOIN engine_config a ON a.version_id = ${act} WHERE d.status = 'DRAFT'`)
      const had = sameAsActive()
      if (had != null && had !== '1') throw new Error('引擎参数已有一个与生效版本不同的草稿，不能替人发布；先处理掉它（engine 流程会删草稿）再跑')
      await h.loginOps()
      await ui.goto('/ops/engine/params')
      if (had == null) { await ui.click('新建草稿'); await ui.see('已从生效版本复制草稿') } // 已有草稿时页面默认就停在草稿上
      const draft = one("SELECT version_id FROM engine_config WHERE status = 'DRAFT'")
      if (!draft || sameAsActive() !== '1') throw new Error('草稿与生效版本不一致，不发布')
      await ui.see('与生效版本完全一致')
      await ui.click('发布')
      await boxOk()
      await ui.see(`v${draft} 已发布生效`)
      expectDb("SELECT version_id FROM engine_config WHERE status = 'ACTIVE'", draft)
      expectDb(`SELECT status FROM engine_config WHERE version_id = ${act}`, 'ARCHIVED')
      expectDb(`SELECT a.config = b.config FROM engine_config a JOIN engine_config b ON b.version_id = ${act} WHERE a.version_id = ${draft}`, 1)
      expectDb("SELECT COUNT(*) FROM engine_config WHERE status = 'DRAFT'", 0)
    },

    // ================================================================ 审核
    // POST /ops/companies/*/reject
    /** 入驻驳回：新手机号提交入驻申请 → 平台驳回并写原因 → 申请人登录公司后台看到驳回原因。 */
    async opsCompanyReject() {
      const ui = h.ui
      const co = await applyCompany('驳')
      const reason = '验收驳回 ' + digits(6) + '：营业执照照片不清晰，请重新上传'
      await openCompanyAudit(co)
      await ui.click('驳回')
      await ui.fill('请填写原因', reason)
      await boxOk()
      await ui.see('已驳回入驻申请')
      expectDb(`SELECT CONCAT(company_status, '|', audit_remark) FROM company WHERE company_id = '${co.id}'`, 'REJECTED|' + reason)

      await h.loginConsole(co.phone)
      await ui.see('入驻申请被驳回')
      await ui.see(reason)
    },

    // POST /ops/jobs/*/reject、POST /ops/jobs/*/force-offline（中间用到已覆盖过的 /ops/jobs/*/approve）
    /** 岗位：演示公司 A 的项目经理发两个验收岗位 → 平台驳回第一个；第二个审核通过后强制下架。不碰演示岗位。 */
    async opsJobReview() {
      const ui = h.ui
      const t1 = '验收岗位驳' + digits(6)
      await publishJob(t1)
      await openJobAudit(t1)
      await ui.click('驳回')
      await ui.fill('请填写原因', '验收驳回：薪资范围与合同约定不一致，请核对后重新提交')
      await boxOk()
      await ui.see('已驳回')
      expectDb(`SELECT CONCAT(job_status, '|', audit_remark) FROM job WHERE title = '${t1}'`, 'REJECTED|验收驳回：薪资范围与合同约定不一致，请核对后重新提交')
      expectDb(`SELECT COUNT(*) FROM job_audit a JOIN job j ON j.job_id = a.job_id WHERE j.title = '${t1}' AND a.action = 'REJECT'`, 1)

      const t2 = '验收岗位下' + digits(6)
      await publishJob(t2)
      await openJobAudit(t2)
      await ui.click('审核通过')
      await ui.click('通过')
      await ui.see('审核通过，岗位已上架')
      expectDb(`SELECT job_status FROM job WHERE title = '${t2}'`, 'RECRUITING')
      await ui.see('强制下架') // 抽屉重新加载后才有这个按钮
      await ui.click('强制下架')
      await ui.fill('请填写原因', '验收强制下架：界面验收用的测试岗位')
      await boxOk()
      await ui.see('已强制下架')
      expectDb(`SELECT CONCAT(job_status, '|', audit_remark) FROM job WHERE title = '${t2}'`, 'FORCE_OFFLINE|验收强制下架：界面验收用的测试岗位')
      expectDb(`SELECT COUNT(*) FROM job_audit a JOIN job j ON j.job_id = a.job_id WHERE j.title = '${t2}' AND a.action = 'FORCE_OFFLINE'`, 1)
    },

    // POST /ops/client-contracts/*/approve、POST /ops/client-contracts/*/reject
    /** 合同备案：验收公司的老板在公司后台给两家新甲方各传一份合作合同 → 平台通过一份、驳回一份。验收公司留给 opsRisk 接着用。 */
    async opsContract() {
      const ui = h.ui
      const co = await testCompany()
      const tag = digits(5)
      const clients = [`验收甲方${tag}一电子有限公司`, `验收甲方${tag}二电子有限公司`]
      const status = (client) => `FROM client_contract cc JOIN client_company c ON c.client_id = cc.client_id WHERE cc.company_id = '${co.id}' AND c.name = '${client}'`

      await h.loginConsole(co.phone)
      await ui.shot(`${out}/contract.png`) // 借一张真实的 PNG 当合同扫描件
      await ui.goto('/admin/settings/projects?tab=contracts')
      await ui.click('合作合同')
      for (const client of clients) {
        await ui.click('上传合同')
        await ui.sleep(600)
        await ui.click('新建甲方企业')
        await ui.sleep(600)
        await ui.fill('与合同上的甲方名称一致', client)
        await ui.click('添加')
        await ui.see('甲方企业已添加')
        await ui.sleep(600)
        await ui.fill('开始日期', null) // 打开日期范围面板：今天 ~ 下月 15 日
        await ui.sleep(400)
        await ui.clickSel('.el-date-range-picker__content.is-left td.today')
        await ui.clickSel('.el-date-range-picker__content.is-right td.available', { nth: 14 })
        await ui.sleep(400)
        const inputs = await ui.ev('document.querySelectorAll("input[type=file]").length')
        await ui.upload(`${out}/contract.png`, inputs - 1)
        await ui.see('已上传')
        await ui.click('提交审核')
        await ui.see('合同已提交，等待平台审核')
        expectDb(`SELECT cc.audit_status ${status(client)}`, 'PENDING')
        await ui.sleep(800)
      }

      await h.loginOps()
      await ui.goto('/ops/governance/job-audit?tab=contracts')
      await ui.fill('公司 ID', co.id)
      await ui.click('查询')
      await ui.click('通过', { within: clients[0] })
      await boxOk()
      await ui.see('合同已备案')
      expectDb(`SELECT cc.audit_status ${status(clients[0])}`, 'APPROVED')
      await ui.click('驳回', { within: clients[1] })
      await ui.fill('请填写原因', '验收驳回：合同缺少双方盖章页')
      await boxOk()
      await ui.see('已驳回')
      expectDb(`SELECT CONCAT(cc.audit_status, '|', cc.audit_remark) ${status(clients[1])}`, 'REJECTED|验收驳回：合同缺少双方盖章页')
    },

    // POST /ops/blacklist、POST /ops/kyc-reviews/*/decide、POST /ops/blacklist/*/lift
    /**
     * 实名与合规：新注册一个求职者 → 平台拉黑 → 求职者实名时被拦下（APP_4008，预期内）并提交失信申诉 →
     * 平台驳回申诉 → 平台解除黑名单。求职者留给 opsAttribution 用。
     */
    async opsCompliance() {
      const ui = h.ui
      const p = await newSeeker()
      st.opsSeeker = p; save()
      const detail = '验收拉黑 ' + digits(6) + '：界面验收用的测试账号'

      await h.loginOps()
      await ui.goto('/ops/governance/compliance')
      await ui.click('平台黑名单')
      await ui.click('拉黑用户')
      await ui.sleep(500)
      await ui.fill('如 U10001', p.uid)
      await ui.select('原因', '恶意行为')
      await ui.fill('具体事实与证据（内部可见）', detail)
      await ui.click('确认拉黑')
      await ui.see('已加入平台黑名单')
      await ui.see(detail)
      expectDb(`SELECT CONCAT(reason_code, '|', status) FROM blacklist WHERE user_id = '${p.uid}' AND detail = '${detail}'`, 'MALICIOUS|ACTIVE')
      expectDb(`SELECT blacklist_flag FROM \`user\` WHERE user_id = '${p.uid}'`, 1)

      // 求职者实名：命中黑名单被拦下，提交失信申诉
      const appeal = '验收申诉 ' + digits(6) + '：我没有恶意行为，请平台核查'
      const idCard = h.idCard()
      await h.loginSeeker(p.phone)
      await ui.goto('/kyc')
      await ui.see('验证你的真实身份')
      await ui.fill('与身份证上的姓名一致', '验收' + h.hanzi() + h.hanzi())
      await ui.fill('18 位身份证号码', idCard)
      await ui.fill('请再输入一次', idCard)
      await ui.click('提交实名认证')
      await ui.see('账号受限')
      await ui.click('我有异议，提交申诉')
      await ui.sleep(600)
      await ui.fill('例如：我从未在', appeal)
      await ui.click('提交申诉')
      await ui.see('申诉已提交')
      expectDb(`SELECT CONCAT(review_type, '|', status) FROM kyc_review WHERE user_id = '${p.uid}' AND remark = '${appeal}'`, 'BLACKLIST_APPEAL|PENDING')

      // 平台驳回申诉（通过会顺带解除黑名单，这里留着黑名单给下一步单独解除）
      await h.loginOps()
      await ui.goto('/ops/governance/compliance')
      await pageTo(p.uid)
      await ui.click('驳回', { within: p.uid })
      await ui.see('驳回申诉')
      await ui.fill('处理意见', '验收：核查后维持原判')
      await ui.click('驳回')
      await ui.see('申诉已驳回')
      expectDb(`SELECT CONCAT(status, '|', reviewer_remark) FROM kyc_review WHERE user_id = '${p.uid}' AND remark = '${appeal}'`, 'REJECTED|验收：核查后维持原判')
      expectDb(`SELECT COUNT(*) FROM blacklist WHERE user_id = '${p.uid}' AND status = 'ACTIVE'`, 1)

      await ui.click('平台黑名单')
      await ui.click('解除', { within: p.uid })
      await ui.fill('解除原因', '验收：测试账号，验收完成后解除')
      await boxOk()
      await ui.see('已解除')
      expectDb(`SELECT COUNT(*) FROM blacklist WHERE user_id = '${p.uid}' AND status = 'LIFTED' AND lifted_at IS NOT NULL`, 1)
      expectDb(`SELECT blacklist_flag FROM \`user\` WHERE user_id = '${p.uid}'`, 0)
    },

    // POST /ops/attribution/disputes、POST /ops/attribution/disputes/*/resolve
    /** 归属争议：按手机号查到验收求职者 → 登记一条争议 → 写结论结案。用 opsCompliance 留下的求职者，没有就现注册一个。 */
    async opsAttribution() {
      const ui = h.ui
      let p = st.opsSeeker
      if (!p || one(`SELECT COUNT(*) FROM \`user\` WHERE user_id = '${q(p.uid)}'`) !== '1') { p = await newSeeker(); st.opsSeeker = p; save() }
      const content = '验收争议 ' + digits(6) + '：公司称该求职者由其驻场线下带来，主张来源归属'
      const dispute = `FROM attribution_dispute WHERE user_id = '${p.uid}' AND content = '${content}'`

      await h.loginOps()
      await ui.goto('/ops/ops/attribution')
      await ui.fill('完整 11 位手机号', p.phone)
      await ui.click('查询')
      await ui.see(p.uid)
      await ui.click('登记争议')
      await ui.sleep(500)
      await ui.fill('谁提出、主张什么、依据是什么', content)
      await ui.click('登记')
      await ui.see('已登记')
      await ui.see(content)
      expectDb(`SELECT status ${dispute}`, 'OPEN')

      await pageTo(content)
      await ui.click('写结论', { within: content })
      await ui.sleep(500)
      await ui.fill('核查了什么', '验收结论：核对注册渠道与状态日志，该求职者为自然注册，维持原归属')
      await ui.click('结案')
      await ui.see('已结案')
      expectDb(`SELECT CONCAT(status, '|', conclusion) ${dispute}`, 'RESOLVED|验收结论：核对注册渠道与状态日志，该求职者为自然注册，维持原归属')
      expectDb(`SELECT COUNT(*) ${dispute} AND resolved_at IS NOT NULL`, 1)
    },

    // ================================================================ 风控
    // POST /ops/companies/*/credit、POST /ops/companies/*/penalty
    /**
     * 诚信与处罚：对验收公司人工调分 −5 → 三级处罚（封禁，要输入公司 ID 确认）。只对验收公司做，三级处罚同时也是收尾：
     * 验收公司被封禁，不留一家「正常」的空公司。接着用 opsContract 建的那家，没有就现造一家。
     */
    async opsRisk() {
      const ui = h.ui
      const co = await testCompany()
      if (Object.keys(OWNER).includes(co.id) || !co.name.includes('验收')) throw new Error('不对演示公司做调分和处罚：' + co.id)
      const before = Number(one(`SELECT credit_score FROM company WHERE company_id = '${co.id}'`))
      const after = Math.max(0, before - 5)
      const remark = '验收调分 ' + digits(6) + '：界面验收用的测试公司'

      await h.loginOps()
      await ui.goto('/ops/governance/credit?companyId=' + co.id)
      await ui.see(co.name)
      await ui.click('人工调分')
      await ui.sleep(500)
      await ui.fill('调分依据', remark) // 分值用弹窗默认的 −5
      await ui.click('确认调分')
      await ui.see(`已调整，当前诚信分 ${after}`)
      await ui.see(remark)
      expectDb(`SELECT credit_score FROM company WHERE company_id = '${co.id}'`, after)
      expectDb(`SELECT CONCAT(delta, '|', score_after, '|', rule_code) FROM credit_score_log WHERE company_id = '${co.id}' AND remark = '${remark}'`, `${after - before}|${after}|MANUAL`)

      const reason = '验收处罚 ' + digits(6) + '：界面验收用的测试公司，验收完成后封禁'
      await ui.click('处罚')
      await ui.sleep(500)
      await ui.click('三级 · 封禁')
      await ui.fill('输入公司 ID 确认', co.id)
      await ui.fill('写违规事实', reason)
      await ui.click('执行处罚')
      await boxOk()
      await ui.see('处罚已执行')
      await ui.see(reason)
      expectDb(`SELECT level FROM penalty WHERE company_id = '${co.id}' AND reason = '${reason}'`, 3)
      expectDb(`SELECT CONCAT(company_status, '|', penalty_level, '|', fee_rights_revoked) FROM company WHERE company_id = '${co.id}'`, 'BANNED|3|1')
      delete st.opsCo; save()
    },

    // ================================================================ 计费与对账
    // POST /ops/billing/rules
    /**
     * 计费规则：新增一个规则版本，单价、分成、免费期都和最新一版相同（不改变任何计费结果）。规则没有删除功能，每跑一次多一版；
     * 生效日期取明天，明天已有规则就取最晚一版的后一天。
     */
    async opsBillingRule() {
      const ui = h.ui
      const rules = sql("SELECT version, service_unit_price, transfer_unit_price, supply_share, free_months, effective_from <= CURDATE() FROM billing_rule ORDER BY effective_from DESC")
      const last = rules[0], cur = rules.find((r) => r[5] === '1')
      if (!cur) throw new Error('库里没有生效中的计费规则')
      const tomorrow = one("SELECT DATE_FORMAT(CURDATE() + INTERVAL 1 DAY, '%Y-%m-%d')")
      const date = one("SELECT DATE_FORMAT(GREATEST(CURDATE(), MAX(effective_from)) + INTERVAL 1 DAY, '%Y-%m-%d') FROM billing_rule")
      const values = last.slice(1, 5).join('|')

      await h.loginOps()
      await ui.goto('/ops/settlement/rules')
      await ui.click('新增规则版本')
      await ui.sleep(500)
      if (date !== tomorrow) { // 弹窗默认明天；明天已有规则就改日期
        await ui.fill('生效日期', date)
        await ui.key('Enter', 'Enter', 13)
        await ui.sleep(400)
      }
      if (cur.slice(1, 5).join('|') !== values) { // 弹窗默认带出生效中那版的数；有待生效的不同版本时照最新一版填，免得把它改回去
        await ui.fill('服务费单价', last[1])
        await ui.fill('流转费单价', last[2])
        await ui.fill('供给方分成比例', String(Math.round(Number(last[3]) * 100)))
        await ui.fill('新入驻免费期', last[4])
        await ui.click('新入驻免费期', { wait: 1500 }) // 点一下标签让数字框失焦生效
      }
      await ui.click('新增')
      await ui.see(`自 ${date} 起`)
      await boxOk()
      await ui.see('已新增规则 v')
      expectDb(`SELECT CONCAT_WS('|', service_unit_price, transfer_unit_price, supply_share, free_months) FROM billing_rule WHERE effective_from = '${date}'`, values)
      expectDb('SELECT COUNT(*) FROM billing_rule', rules.length + 1)
      await ui.see('待生效')
    },

    // POST /ops/billing/daily、POST /ops/billing/monthly
    /**
     * 重算昨天的日计费（幂等，灌演示数据时也是这样补跑的）→ 生成并下发上月账单（已下发的不会重复下发，通常是 0 份）。
     * 每月 1 号上月账单已下发时没有可重算的日期，会报明原因。
     */
    async opsBillingRun() {
      const ui = h.ui
      const yday = one("SELECT DATE_FORMAT(CURDATE() - INTERVAL 1 DAY, '%Y-%m-%d')")
      const prevYm = one("SELECT DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m')")
      if (one(`SELECT COUNT(*) FROM monthly_bill WHERE bill_month = '${yday.slice(0, 7)}' AND status <> 'GENERATED'`) !== '0') {
        throw new Error(`昨天（${yday}）所在月份的账单已下发，日计费不能重算；每月 2 号以后再跑这个流程`)
      }
      await h.loginOps()
      await ui.goto('/ops/settlement/bills')
      await ui.click('重算日计费')
      await ui.sleep(500)
      await ui.click('重算') // 日期用弹窗默认的昨天
      await boxOk()
      await ui.see(`${yday} 计费已重算`, 30000)
      await ui.see('规则版本')
      expectDb(`SELECT COUNT(*) > 0 FROM company_fee_daily WHERE biz_date = '${yday}' AND created_at >= NOW() - INTERVAL 3 MINUTE`, 1)
      await ui.click('关闭')

      await ui.click('生成并下发月账单')
      await ui.sleep(500)
      await ui.click('生成并下发') // 月份用弹窗默认的上月
      await boxOk()
      await ui.see(new RegExp(`${prevYm} 账单已下发 \\d+ 份`), 30000)
      if (!/billing\/monthly\?month=/.test(ui.lastWrite?.u ?? '') || ui.lastWrite.code !== '0') throw new Error('下发月账单的请求没有成功：' + JSON.stringify(ui.lastWrite ?? null).slice(0, 200))
      expectDb(`SELECT COUNT(*) FROM monthly_bill WHERE bill_month = '${prevYm}' AND status = 'GENERATED'`, 0)
    },

    // POST /ops/disputes/*/reply
    /**
     * 账单异议：演示公司老板在公司后台对最新一期、还在异议期内的已下发账单提异议 → 平台驳回异议，账单回到「已下发」（改了又恢复）。
     * 库里没有这样的账单（异议期已过、已结算或已有异议）时报明原因；不处理演示数据里原有的那条异议。
     */
    async opsBillDispute() {
      const ui = h.ui
      const open = () => sql("SELECT id, bill_id, company_id FROM bill_dispute WHERE status = 'OPEN' AND content LIKE '验收异议%' ORDER BY id DESC LIMIT 1")[0]
      let d = open() // 上次提了没处理完的接着用
      if (!d) {
        const b = sql(`SELECT b.bill_id, b.company_id, b.bill_month FROM monthly_bill b WHERE b.status = 'ISSUED' AND b.dispute_deadline >= CURDATE() AND b.company_id IN ('${Object.keys(OWNER).join("','")}') AND b.bill_month = (SELECT MAX(m.bill_month) FROM monthly_bill m WHERE m.company_id = b.company_id) ORDER BY b.company_id DESC LIMIT 1`)[0]
        if (!b) throw new Error('三家演示公司最新一期账单都不是「已下发且在异议期内」（异议期 5 个工作日已过、已结算或已有异议），没法从公司后台提异议；等下月账单下发或重灌演示数据后再跑')
        const text = '验收异议 ' + digits(6) + '：界面验收，核对流转费天数，无需调整账单'
        await h.loginConsole(OWNER[b[1]])
        await ui.goto('/admin/owner/bills')
        await ui.click('提出异议', { within: b[2] })
        await ui.fill('请说明有异议的日期', text)
        await ui.click('提交异议')
        await ui.see('异议已提交')
        expectDb(`SELECT status FROM monthly_bill WHERE bill_id = '${b[0]}'`, 'DISPUTED')
        d = open()
        if (!d) throw new Error('公司后台提交异议后库里没有这条异议')
      }
      await openBill(d[2], d[1], '复核')
      await ui.see('验收异议')
      await ui.click('驳回异议')
      await ui.sleep(500)
      await ui.fill('处理说明', '验收：已核对，流转费天数无误，维持原账单')
      await ui.click('驳回')
      await ui.see('已驳回异议')
      expectDb(`SELECT CONCAT(status, '|', reply) FROM bill_dispute WHERE id = ${d[0]}`, 'REJECTED|验收：已核对，流转费天数无误，维持原账单')
      expectDb(`SELECT status FROM monthly_bill WHERE bill_id = '${d[1]}'`, 'ISSUED')
    },

    // POST /ops/bills/*/settle
    /**
     * 登记结算（不可撤销）：只结算验收公司的账单。验收公司没有在岗员工、通常没有账单，所以默认会报「没有可安全结算的账单」；
     * 要用演示公司最早一期待结算账单来验收，运行时加环境变量 E2E_SETTLE_DEMO_BILL=1（每跑一次用掉一张，用完同样会报明原因）。
     */
    async opsBillSettle() {
      const ui = h.ui
      const pick = (where) => sql(`SELECT b.bill_id, b.company_id FROM monthly_bill b JOIN company c ON c.company_id = b.company_id WHERE b.status IN ('ISSUED', 'CONFIRMED') AND ${where} ORDER BY b.bill_month, b.company_id DESC LIMIT 1`)[0]
      let b = pick("c.name LIKE '%验收%'")
      if (!b && process.env.E2E_SETTLE_DEMO_BILL === '1') b = pick(`b.company_id IN ('${Object.keys(OWNER).join("','")}')`)
      if (!b) throw new Error('没有可安全结算的账单：验收公司没有待结算账单，演示公司的账单结算后不可撤销所以默认不动；确认可以用掉一张演示账单时加 E2E_SETTLE_DEMO_BILL=1 再跑')
      await openBill(b[1], b[0], '详情')
      await ui.click('登记结算')
      await boxOk()
      await ui.see('已登记结算')
      expectDb(`SELECT CONCAT(status, '|', settled_at IS NOT NULL) FROM monthly_bill WHERE bill_id = '${b[0]}'`, 'SETTLED|1')
    },
  }
}
