// 账单收款闭环：公司老板提交付款凭证 → 平台退回 → 老板重新提交 → 平台确认到账 → 账单结清。
// 覆盖：POST /tenant/files（category=payment）、POST /tenant/bills/*/payments、POST /ops/bill-payments/*/reject、
//       POST /ops/bill-payments/*/confirm、GET /ops/bills-summary、GET /ops/bills?flag=
// 前置：第三家演示公司（C10003）有一张「已下发」且没有待确认凭证的账单。跑之前执行 e2e-prepare.sql，跑完执行 e2e-clean.sql 恢复。
export default (h) => ({
  async billPay() {
    const ui = h.ui
    const one = (q) => h.sql(q)[0]?.[0]
    const co = 'C10003'
    const bill = h.sql(`SELECT b.bill_id, b.bill_month, b.service_fee + b.transfer_payable FROM monthly_bill b WHERE b.company_id = '${co}' AND b.status = 'ISSUED' `
      + `AND b.service_fee + b.transfer_payable > 0 AND NOT EXISTS (SELECT 1 FROM bill_payment p WHERE p.bill_id = b.bill_id AND p.status = 'PENDING') ORDER BY b.bill_month DESC LIMIT 1`)[0]
    if (!bill) throw new Error('第三家演示公司没有可付款的「已下发」账单：先执行 e2e-prepare.sql')
    const [billId, month] = bill
    const owner = '13800000021' // 第三家演示公司的老板
    const tag = String(Date.now()).slice(-6)
    const voucher = `${h.out}/pay-voucher-${tag}.png`
    const payState = () => one(`SELECT status FROM bill_payment WHERE bill_id = '${billId}' ORDER BY id DESC LIMIT 1`)

    // 借一张真实的 PNG 当转账回单
    await h.loginConsole(owner)
    await ui.goto('/admin/owner/bills')
    await ui.see('待付款')
    await ui.shot(voucher)

    // ---- 老板第一次提交
    const submit = async (ref) => {
      await ui.see('平台收款账户')
      await ui.see(`${month} 账单应付金额`)
      await ui.fill('转账回单上的流水号', ref)
      await ui.upload(voucher)
      await ui.see(`pay-voucher-${tag}.png`)
      await ui.fill('需要平台了解的其他情况', '验收付款 ' + tag)
      await ui.click('提交凭证')
      await ui.see('付款凭证已提交，等待平台确认到账')
    }
    await ui.click('提交付款凭证')
    await submit('YS' + tag + '01')
    h.expectDb(`SELECT CONCAT(status, '|', bank_ref) FROM bill_payment WHERE bill_id = '${billId}' ORDER BY id DESC LIMIT 1`, `PENDING|YS${tag}01`)
    await ui.see('凭证待确认')

    // ---- 平台退回
    await h.loginOps()
    await ui.goto('/ops/workbench')
    await ui.see('待确认付款')
    await ui.goto('/ops/settlement/bills?flag=PAYMENT_PENDING')
    await ui.see('凭证待确认')
    await ui.click('确认付款')
    await ui.see('企业已提交付款凭证')
    await ui.see('YS' + tag + '01')
    await ui.click('退回')
    await ui.see('退回付款凭证')
    await ui.fill('请填写退回原因（必填，将通知企业）', '验收退回 ' + tag + '：未查到这笔入账')
    await ui.click('退回')
    await ui.see('已退回付款凭证')
    if (payState() !== 'REJECTED') throw new Error('退回后凭证状态不是 REJECTED：' + payState())
    h.expectDb(`SELECT status FROM monthly_bill WHERE bill_id = '${billId}'`, 'ISSUED')

    // ---- 老板看到退回原因，重新提交
    await h.loginConsole(owner)
    await ui.goto('/admin/owner/bills')
    await ui.see('凭证被退回')
    await ui.click('重新提交凭证')
    await ui.see('上次提交的凭证被退回')
    await ui.see('未查到这笔入账')
    await submit('YS' + tag + '02')
    if (payState() !== 'PENDING') throw new Error('重新提交后凭证状态不是 PENDING：' + payState())

    // ---- 平台确认到账
    await h.loginOps()
    await ui.goto('/ops/settlement/bills?flag=PAYMENT_PENDING')
    await ui.click('确认付款')
    await ui.see('YS' + tag + '02')
    await ui.click('确认到账')
    await ui.see('不可撤销')
    await ui.click('确认到账')
    await ui.see('已确认到账，账单已结算')
    h.expectDb(`SELECT status FROM monthly_bill WHERE bill_id = '${billId}'`, 'SETTLED')
    h.expectDb(`SELECT CONCAT(status, '|', bank_ref) FROM bill_payment WHERE bill_id = '${billId}' ORDER BY id DESC LIMIT 1`, `CONFIRMED|YS${tag}02`)

    // ---- 老板看到已结清，并收到通知
    await h.loginConsole(owner)
    await ui.goto('/admin/owner/bills')
    await ui.see('已结清')
    for (let i = 0; i < 10; i++) {
      if (Number(one(`SELECT COUNT(*) FROM notification WHERE template_code = 'BILL_NOTICE' AND content LIKE '%${month} 账单的付款已确认到账%'`)) > 0) return
      await ui.sleep(1500)
    }
    throw new Error('老板没有收到「付款已确认到账」的通知')
  },
})
