// 运营中台：把公司设为「已注销」（不可逆）。只对验收流程自己建的、已被封禁的测试公司操作。
// 覆盖：POST /ops/companies/*/close
// 前置：库里有一家名字带「验收」且已封禁的公司（onboard、opsRisk、conCleanup 任一流程都会留下）。
export default (h) => ({
  async opsClose() {
    const ui = h.ui
    const co = h.sql("SELECT company_id, name FROM company WHERE name LIKE '%验收%' AND company_status = 'BANNED' ORDER BY created_at DESC LIMIT 1")[0]
    if (!co) throw new Error('没有可注销的测试公司：先跑 onboard 或 opsRisk')
    const [id, name] = co
    const reason = '验收注销 ' + String(Date.now()).slice(-6) + '：界面验收用的测试公司'
    await h.loginOps()
    await ui.goto('/ops/companies/list')
    await ui.click('全部')
    await ui.fill('公司名称 / 公司 ID', name)
    await ui.click('查询')
    await ui.click('详情', { within: name })
    await ui.click('调整状态')
    await ui.sleep(500)
    await ui.click('已注销')
    await ui.see('不可恢复')
    await ui.fill('将记录到审计日志并通知该公司', reason)
    await ui.click('确认调整')
    await ui.see('此操作不可撤销')
    await ui.click('确认执行')
    await ui.see('已设为「已注销」')
    h.expectDb(`SELECT company_status FROM company WHERE company_id = '${id}'`, 'DEREGISTERED')
    h.expectDb(`SELECT COUNT(*) FROM member WHERE company_id = '${id}' AND status = 'NORMAL'`, 0)
  },
})
