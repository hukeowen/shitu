// 流转分成付款（平台 → 来源公司）：老板登记收款账户 → 平台在对账管理登记已付款 → 老板看到已到账并收到通知。
// 覆盖：PUT /tenant/payee、POST /ops/bills/*/receivable-payout、GET /ops/receivables-summary、GET /ops/bills?flag=RECEIVABLE_UNPAID
// 前置：第一家演示公司（C10001）有一张已下发 / 已结算、流转费应收大于 0、还没付过分成的账单。
// 跑之前执行 e2e-prepare.sql（会清掉上次留下的付款记录和收款账户），跑完执行 e2e-clean.sql。
export default (h) => ({
  async payout() {
    const ui = h.ui
    const one = (q) => h.sql(q)[0]?.[0]
    const co = 'C10001'
    const owner = '13800000001'
    const bill = h.sql(`SELECT b.bill_id, b.bill_month, b.transfer_receivable FROM monthly_bill b WHERE b.company_id = '${co}' AND b.status IN ('ISSUED', 'CONFIRMED', 'SETTLED') `
      + `AND b.transfer_receivable > 0 AND NOT EXISTS (SELECT 1 FROM bill_receivable_payout r WHERE r.bill_id = b.bill_id) ORDER BY b.bill_month DESC LIMIT 1`)[0]
    if (!bill) throw new Error('第一家演示公司没有待付流转分成的账单：先执行 e2e-prepare.sql')
    if (Number(one(`SELECT COUNT(*) FROM company_payee WHERE company_id = '${co}'`)) > 0) throw new Error('第一家演示公司已经登记过收款账户：先执行 e2e-prepare.sql')
    const [billId, month] = bill
    const tag = String(Date.now()).slice(-6)
    const account = '62220000' + String(Date.now()).slice(-8)
    const tail = account.slice(-4)

    // ---- 老板：页面提示还没登记收款账户 → 登记
    await h.loginConsole(owner)
    await ui.goto('/admin/owner/bills')
    await ui.see('还没有登记收款账户')
    await ui.see('平台待付款')
    await ui.click('登记收款账户')
    await ui.see('收款户名')
    await ui.fill('请写到支行', '中国工商银行昆山锦溪支行')
    await ui.fill('8–30 位数字', account)
    await ui.click('保存')
    await ui.see('收款账户已保存')
    await ui.see('尾号 ' + tail)
    h.expectDb(`SELECT account_tail FROM company_payee WHERE company_id = '${co}'`, tail)
    h.expectDb(`SELECT account_no_enc LIKE '%${account}%' FROM company_payee WHERE company_id = '${co}'`, 0)

    // ---- 平台：工作台待办 → 对账管理筛选 → 登记已付款
    await h.loginOps()
    await ui.goto('/ops/workbench')
    await ui.see('待付流转分成')
    await ui.goto('/ops/settlement/bills?flag=RECEIVABLE_UNPAID')
    await ui.see('待付分成')
    await ui.click('登记付款', { within: billId })
    await ui.see('流转分成付款')
    await ui.see(account) // 财务看到完整账号才能转账
    await ui.click('登记已付款')
    await ui.see('登记流转分成付款')
    await ui.fill('转账回单上的流水号', 'FC' + tag)
    await ui.fill('需要企业了解的其他情况', '验收付款 ' + tag)
    await ui.click('确认已付款')
    await ui.see('已登记付款')
    h.expectDb(`SELECT CONCAT(amount, '|', bank_ref, '|', account_tail) FROM bill_receivable_payout WHERE bill_id = '${billId}'`, `${bill[2]}|FC${tag}|${tail}`)

    // ---- 老板：看到已到账，并收到通知
    await h.loginConsole(owner)
    await ui.goto('/admin/owner/bills')
    await ui.see('已到账 · ')
    for (let i = 0; i < 10; i++) {
      if (Number(one(`SELECT COUNT(*) FROM notification WHERE template_code = 'BILL_NOTICE' AND content LIKE '${month} 的流转分成%尾号 ${tail}%'`)) > 0) return
      await ui.sleep(1500)
    }
    throw new Error('老板没有收到流转分成已付款的通知')
  },
})
