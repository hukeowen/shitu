// 游客先答题（D-62 ①）：扫渠道码 → 不登录直接做 AI 问薪 → 看到打码的预览卡片 → 点「看完整岗位 / 报名」→ 手机号登录（注册）
// → 用同一份答案自动正式匹配，落到正常的匹配结果页；渠道归属照常在注册时绑定。由 e2e.mjs 自动加载，写法和约定同 e2e.mjs。
// 接口：GET /seeker/public/quiz、POST /seeker/public/match/preview（不落库）、POST /seeker/auth/sms-login（带渠道码）、POST /seeker/match
export default (h) => {
  const one = (q) => h.sql(q)[0]?.[0]
  const num = (q) => Number(one(q) ?? 0)
  function userIdOf(phone) {
    for (const [id, enc] of h.sql('SELECT user_id, phone_enc FROM `user` ORDER BY registered_at DESC LIMIT 40')) if (h.dec(enc) === phone) return id
    throw new Error('库里找不到刚注册的求职者 ' + phone)
  }

  return {
    async guestQuiz() {
      const ui = h.ui
      const companyId = one('SELECT company_id FROM company ORDER BY company_id LIMIT 1')
      const channel = one(`SELECT code FROM channel_code WHERE company_id = '${companyId}' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`)
      if (!channel) throw new Error(`${companyId} 没有启用中的渠道码`)
      const names = h.sql(`SELECT name, IFNULL(short_name, '') FROM company WHERE company_id = '${companyId}'`)[0]
      const phone = '136' + String(Date.now()).slice(-8)
      const sessions = 'SELECT COUNT(*) FROM match_session'

      await ui.fresh('mobile')
      await ui.goto('/r/' + channel)
      await ui.sleep(3000) // 启动页
      // 游客首页「开始匹配」直接进答题，不先登录
      await ui.click('开始匹配')
      await ui.see('这次会给你找')
      await ui.see('不用先登录')
      if ((await ui.url()).startsWith('/login')) throw new Error('游客点「开始匹配」被带去了登录页')
      const n0 = num(sessions)
      await ui.clickSel('.bottom-bar .van-button--primary') // 开始回答
      await h.answerQuiz()
      await ui.click('看看有哪些活')

      // 打码预览：有卡片、有「看完整岗位 / 报名」、公司只说「××一家劳务公司」、有按到手工资排的小字
      await ui.see('看完整岗位 / 报名', 20000)
      // 扫公司码进来的人知道是哪家公司：卡片写这家公司，地址和名额留到登录后
      await ui.see('地址、名额登录后显示')
      await ui.see('按到手工资高低')
      const text = await ui.bodyText()
      const addr = one(`SELECT address FROM project WHERE company_id = '${companyId}' AND address IS NOT NULL LIMIT 1`)
      if (addr && text.includes(addr)) throw new Error('预览卡片露出了项目地址：' + addr)
      if ((await ui.url()) !== '/match/preview') throw new Error('答完题没有到预览页：' + (await ui.url()))
      h.expectDb(sessions, n0) // 预览不落匹配会话

      // 看完整岗位 → 登录（新号 = 注册，带着扫码的渠道码）→ 自动正式匹配 → 正常结果页
      await ui.click('看完整岗位 / 报名')
      await ui.see('手机号登录 / 注册')
      await ui.fill('手机号', phone)
      h.clearSmsLimits()
      await ui.click('获取验证码')
      await h.solveCaptcha()
      await ui.clickSel('.agree .van-checkbox')
      await ui.click('登录 / 注册并开始匹配')
      await ui.see('为你锁定', 20000)
      if ((await ui.url()) !== '/match/result') throw new Error('登录后没有落到匹配结果页：' + (await ui.url()))
      await ui.see('查看并报名')

      const userId = userIdOf(phone)
      h.expectDb(`SELECT bound_company_id FROM \`user\` WHERE user_id = '${userId}'`, companyId)
      h.expectDb(`SELECT register_channel_code FROM \`user\` WHERE user_id = '${userId}'`, channel)
      h.expectDb(`SELECT COUNT(*) FROM match_session WHERE user_id = '${userId}' AND scope = 'OWN_COMPANY' AND answers LIKE '%matrix%'`, 1)
      const left = await ui.ev(`(() => { try { return localStorage.getItem('shitu.match.pending') } catch (e) { return null } })()`)
      if (left) throw new Error('登录前的答案用完没有删')
      h.st.guest = { phone, userId }
      h.save()
    },
  }
}
