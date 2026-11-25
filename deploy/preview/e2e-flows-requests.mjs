// 求职者自助申请：申请取消报名、申请离职（都只是提出申请，由驻场 / 项目经理处理）。
// 覆盖：POST /seeker/applications/*/cancel-request、POST /tenant/cancel-requests/*/decide（不同意、同意）、
//       POST /seeker/resign-request、POST /seeker/resign-request/withdraw，以及离职审核里的「本人申请」。
export default (h) => ({
  /**
   * 申请取消报名：求职者提交 → 驻场在手机端不同意并写说明 → 求职者看到后重新申请 → 项目经理在公司后台同意并取消。
   * 自己注册一个求职者，不动演示数据。
   */
  async reqCancel() {
    const ui = h.ui
    const one = (q) => h.sql(q)[0]?.[0]
    const channel = one("SELECT code FROM channel_code WHERE company_id = 'C10001' AND status = 'ACTIVE' LIMIT 1")
    const p = await h.registerAndApply(channel)
    const app = one(`SELECT a.application_id FROM application a JOIN user u ON u.user_id = a.user_id WHERE u.phone_hash IS NOT NULL AND a.status = 'PENDING_INTERVIEW' ORDER BY a.created_at DESC LIMIT 1`)
    const reqStatus = () => one(`SELECT status FROM application_cancel_request WHERE application_id = '${app}' ORDER BY id DESC LIMIT 1`)
    const reply = '验收回复 ' + String(Date.now()).slice(-6) + '：名额已为你保留，面试完再决定'

    // ---- 求职者第一次申请（registerAndApply 结束时停在「我的报名」）
    await ui.goto('/reports')
    await ui.click('不去了或报错了岗位？申请取消报名')
    await ui.see('驻场老师同意后报名才会取消')
    await ui.click('找到其他工作了')
    await ui.click('提交申请')
    await ui.see('申请已提交，等待驻场老师处理')
    await ui.see('待驻场处理')
    if (reqStatus() !== 'PENDING') throw new Error('提交后申请状态不是 PENDING：' + reqStatus())
    h.expectDb(`SELECT status FROM application WHERE application_id = '${app}'`, 'PENDING_INTERVIEW')

    // ---- 驻场在手机端不同意
    await h.loginStaff('13800000003')
    await ui.see('取消申请')
    await ui.goto('/staff/cancel-requests')
    await ui.see('找到其他工作了')
    await ui.click('不同意')
    await ui.see('不同意取消')
    await ui.fill('请填写不同意的原因（必填，求职者可见）', reply)
    await ui.click('确认不同意')
    await ui.see('已回复求职者')
    if (reqStatus() !== 'REJECTED') throw new Error('不同意后申请状态不是 REJECTED：' + reqStatus())

    // ---- 求职者看到回复，重新申请
    await h.loginSeeker(p.phone)
    await ui.goto('/reports/' + app)
    await ui.see('未获同意')
    await ui.see('名额已为你保留')
    await ui.click('重新申请取消报名')
    await ui.click('家里有事去不了')
    await ui.click('提交申请')
    await ui.see('申请已提交，等待驻场老师处理')
    if (reqStatus() !== 'PENDING') throw new Error('重新申请后状态不是 PENDING：' + reqStatus())

    // ---- 项目经理在公司后台同意并取消
    await h.loginConsole('13800000002')
    await ui.goto('/admin/site/todo?tab=cancel')
    await ui.see('家里有事去不了')
    await ui.click('同意并取消', { within: app })
    await ui.see('同意取消报名')
    await ui.click('同意并取消')
    await ui.see('已同意，报名已取消')
    if (reqStatus() !== 'APPROVED') throw new Error('同意后申请状态不是 APPROVED：' + reqStatus())
    h.expectDb(`SELECT COUNT(*) FROM application WHERE application_id = '${app}' AND status IN ('PENDING_INTERVIEW', 'PENDING_CONFIRM')`, 0)
    h.expectDb(`SELECT end_remark LIKE '求职者申请取消：%' FROM application WHERE application_id = '${app}'`, 1)

    // ---- 求职者：报名已取消，可以重新匹配
    await h.loginSeeker(p.phone)
    await ui.goto('/reports/' + app)
    if (await ui.has('申请取消报名')) throw new Error('报名已取消，页面上不该再出现「申请取消报名」')
  },

  /**
   * 申请离职：员工本人申请 → 撤回 → 重新申请 → 项目经理在离职审核里看到「本人申请」并确认。
   * 先跑一遍主链路 hire 办一个新员工入职（st.phone），不动演示员工。
   */
  async reqResign() {
    const ui = h.ui
    const one = (q) => h.sql(q)[0]?.[0]
    await h.flows.hire()
    const phone = h.st.phone
    const no = 'E2E' + phone.slice(-5)
    const status = () => one(`SELECT r.status FROM resign_request r JOIN employment e ON e.employment_id = r.employment_id WHERE e.employee_no = '${no}' ORDER BY r.id DESC LIMIT 1`)

    const apply = async (entry) => {
      await ui.click(entry)
      await ui.see('申请由项目经理审核')
      await ui.click('请选择离职日期')
      await ui.see('选择离职日期')
      await ui.click('确定')
      await ui.click('家里有事要回去')
      await ui.click('提交离职申请')
      await ui.see('离职申请已提交，等待项目经理审核')
      await ui.see('审核中')
    }
    await h.loginSeeker(phone)
    await ui.goto('/work')
    await apply('申请离职')
    if (status() !== 'PENDING') throw new Error('申请后状态不是 PENDING：' + status())

    // 撤回
    await ui.click('撤回申请')
    await ui.see('撤回后这次申请作废')
    await ui.click('撤回')
    await ui.see('已撤回离职申请')
    if (status() !== 'WITHDRAWN') throw new Error('撤回后状态不是 WITHDRAWN：' + status())
    await ui.see('已撤回')

    // 重新申请
    await apply('重新申请离职')
    h.expectDb(`SELECT r.source FROM resign_request r JOIN employment e ON e.employment_id = r.employment_id WHERE e.employee_no = '${no}' ORDER BY r.id DESC LIMIT 1`, 'SEEKER')

    // 项目经理确认
    await h.loginConsole('13800000002')
    await ui.goto('/admin/pm/resign')
    await ui.see('本人申请')
    await ui.click('确认离职', { within: no })
    await ui.click('确认离职')
    await ui.see('已确认')
    if (!['SCHEDULED', 'APPROVED'].includes(status())) throw new Error('确认后状态不对：' + status())

    // 本人看到结果
    await h.loginSeeker(phone)
    await ui.goto('/work')
    await ui.sleep(800)
    if (status() === 'SCHEDULED') await ui.see('已通过')
    for (let i = 0; i < 10; i++) {
      if (Number(one(`SELECT COUNT(*) FROM notification n JOIN user u ON u.user_id = n.recipient_id WHERE n.template_code = 'SEEKER_NOTICE' AND n.content LIKE '你的离职申请已通过%' AND n.created_at > NOW() - INTERVAL 5 MINUTE`)) > 0) return
      await ui.sleep(1500)
    }
    throw new Error('本人没有收到离职申请通过的通知')
  },
})
