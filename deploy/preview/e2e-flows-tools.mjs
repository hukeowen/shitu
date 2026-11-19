// 运营中台的两个「删错了能撤」操作，以及各端的导出按钮。
// 覆盖：DELETE /ops/quiz/versions/*、DELETE /ops/billing/rules/*；导出走各页已有的列表接口，这里验证按钮能用、条数提示正确。
export default (h) => ({
  /** 题库草稿：新建 → 在版本列表里删除。库里已有草稿时直接删那一份（草稿只是生效版本的副本，删除不影响线上）。 */
  async opsQuizDraftDelete() {
    const ui = h.ui
    const drafts = () => Number(h.sql("SELECT COUNT(*) FROM quiz_version WHERE status = 'DRAFT'")[0][0])
    await h.loginOps()
    await ui.goto('/ops/engine/quiz')
    if (drafts() === 0) {
      await ui.click('新建草稿')
      await ui.sleep(1500)
      if (drafts() !== 1) throw new Error('点「新建草稿」后库里没有草稿')
      await ui.goto('/ops/engine/quiz')
    }
    await ui.click('删除')
    await ui.see('删除后不可恢复')
    await ui.click('删除')
    await ui.see('草稿已删除')
    h.expectDb("SELECT COUNT(*) FROM quiz_version WHERE status = 'DRAFT'", 0)
    h.expectDb("SELECT COUNT(*) FROM quiz_version WHERE status = 'ACTIVE'", 1)
  },

  /** 计费规则：删掉一版还没生效的规则（没有就先用 opsBillingRule 新增一版和现行规则相同的）。已生效的规则没有删除按钮。 */
  async opsRuleDelete() {
    const ui = h.ui
    const future = () => h.sql('SELECT version FROM billing_rule WHERE effective_from > CURDATE() ORDER BY version DESC LIMIT 1')[0]?.[0]
    if (!future()) await h.flows.opsBillingRule()
    const v = future()
    if (!v) throw new Error('没有待生效的计费规则可删')
    const effective = Number(h.sql('SELECT COUNT(*) FROM billing_rule WHERE effective_from <= CURDATE()')[0][0])
    await h.loginOps()
    await ui.goto('/ops/settlement/rules')
    await ui.see('待生效')
    await ui.click('删除', { within: 'v' + v })
    await ui.see('这版规则还没有生效')
    await ui.click('删除')
    await ui.see('已删除 v' + v)
    h.expectDb(`SELECT COUNT(*) FROM billing_rule WHERE version = ${v}`, 0)
    h.expectDb('SELECT COUNT(*) FROM billing_rule WHERE effective_from <= CURDATE()', effective)
  },

  /** 导出：公司后台人员管理、费用账单、岗位管理、待办清单，运营中台对账管理、公司管理、审计日志。每页点「导出」并等到条数提示。 */
  async exports() {
    const ui = h.ui
    // tab：先切到有数据的页签（空页签的导出按钮是禁用的，这是对的）
    const click = async (path, label = '导出', tab) => {
      await ui.goto(path)
      await ui.sleep(800)
      if (tab) { await ui.click(tab); await ui.sleep(800) }
      await ui.click(label)
      await ui.see(/已导出 \d+ 条|只导出了前 5000 条/, 30000)
    }
    await h.loginConsole('13800000002')
    await click('/admin/pm/staff')
    await click('/admin/pm/jobs')
    await click('/admin/site/todo')
    await click('/admin/pm/resign', '导出', '已通过')
    await h.loginConsole('13800000001')
    await click('/admin/owner/bills')
    await click('/admin/owner/channel-report')
    await h.loginOps()
    await click('/ops/settlement/bills')
    await click('/ops/companies/list', '导出', '全部')
    await click('/ops/settlement/audit')
  },
})
