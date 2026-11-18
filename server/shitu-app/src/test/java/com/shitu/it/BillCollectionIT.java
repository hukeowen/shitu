package com.shitu.it;

import com.shitu.app.ops.BillCollectionService;
import com.shitu.billing.service.BillPaymentService;
import com.shitu.billing.service.MonthlyBillService;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.common.exception.BizException;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.tenant.company.CompanyService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 账单收款闭环：到期前提醒 → 逾期催款 → 逾期自动限流 → 公司提交付款凭证 → 平台退回 / 确认到账 → 账单结清、限流自动恢复。
 * 催款任务的「今天」由参数传入，账单的结算截止日固定为 {@link #DUE}。
 */
@EnabledIfEnvironmentVariable(named = "SHITU_IT", matches = "true")
@SpringBootTest(properties = {FlowItSupport.IT_DB, "shitu.scheduling.enabled=false", "shitu.ops.init-password=ItSuper2026"})
class BillCollectionIT {

    static final SecureRandom RND = new SecureRandom();
    /** 结算截止日：取过去的日期，这样「付款日期不晚于今天、不早于下发日」始终成立 */
    static final LocalDate DUE = LocalDate.now().minusDays(20);

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    BillCollectionService collection;
    @Autowired
    BillPaymentService payments;
    @Autowired
    MonthlyBillService bills;
    @Autowired
    CompanyService companies;
    @Autowired
    FieldCipher cipher;

    final String tag = String.valueOf(100000 + RND.nextInt(899999));

    @Test
    void remindThrottlePayAndRestore() {
        String co = company("CX" + tag);
        String bill = bill(co, "2031-01", "100.00", "20.00");
        int events = events(bill);

        // ---------------------------------------------------------------- 到期前提醒：进入窗口后只提醒一次
        collection.run(DUE.minusDays(4));
        assertThat(events(bill)).as("提前 4 天还不提醒（参数是 3 天）").isEqualTo(events);
        collection.run(DUE.minusDays(3));
        assertThat(events(bill)).isEqualTo(events + 1);
        collection.run(DUE.minusDays(2));
        collection.run(DUE);
        assertThat(events(bill)).as("到期前只提醒一次").isEqualTo(events + 1);

        // ---------------------------------------------------------------- 逾期催款：第 1 天催，之后每 3 天一次
        collection.run(DUE.plusDays(1));
        assertThat(events(bill)).isEqualTo(events + 2);
        collection.run(DUE.plusDays(1));
        collection.run(DUE.plusDays(2));
        collection.run(DUE.plusDays(3));
        assertThat(events(bill)).as("同一天重复执行、间隔未到都不再催").isEqualTo(events + 2);
        collection.run(DUE.plusDays(4));
        assertThat(events(bill)).isEqualTo(events + 3);
        assertThat(status(co)).isEqualTo("NORMAL");

        // ---------------------------------------------------------------- 逾期满 7 天自动限流
        BillCollectionService.RunResult r = collection.run(DUE.plusDays(7));
        assertThat(r.throttled()).isGreaterThanOrEqualTo(1);
        assertThat(status(co)).isEqualTo("THROTTLED");
        assertThat(jdbc.queryForObject("SELECT auto_throttled_bill FROM company WHERE company_id = ?", String.class, co)).isEqualTo(bill);
        assertThat(jdbc.queryForObject("SELECT status_remark FROM company WHERE company_id = ?", String.class, co))
                .startsWith("账单逾期未结清，系统自动限流");

        // ---------------------------------------------------------------- 提交付款凭证
        assertThatThrownBy(() -> payments.submit(co, bill, cmd("100.00"), "M-TEST")).as("金额须等于应付 120")
                .isInstanceOf(BizException.class).hasMessageContaining("120.00");
        assertThatThrownBy(() -> payments.submit(co, bill, new BillPaymentService.SubmitCommand(new BigDecimal("120.00"),
                LocalDate.now().plusDays(1), "测试付款户", null, "payment/x.png", null), "M-TEST")).as("付款日期不能晚于今天")
                .isInstanceOf(BizException.class);
        BillPaymentService.Payment p1 = payments.submit(co, bill, cmd("120.00"), "M-TEST");
        assertThat(p1.status()).isEqualTo("PENDING");
        assertThat(bills.get(bill, co).paymentStatus()).isEqualTo("PENDING");
        assertThatThrownBy(() -> payments.submit(co, bill, cmd("120.00"), "M-TEST")).as("已有待确认的凭证")
                .isInstanceOf(BizException.class);
        assertThat(bills.list(null, null, null, "PAYMENT_PENDING", 1, 100).records()).extracting(MonthlyBillService.Bill::billId).contains(bill);
        int beforeWait = events(bill);
        collection.run(DUE.plusDays(30));
        assertThat(events(bill)).as("有待确认凭证时不再催款").isEqualTo(beforeWait);

        // ---------------------------------------------------------------- 平台退回 → 重新提交 → 确认到账
        assertThatThrownBy(() -> collection.reject(p1.id(), " ", "A1001")).as("退回必须写原因").isInstanceOf(BizException.class);
        collection.reject(p1.id(), "未查到这笔入账", "A1001");
        assertThat(payments.get(p1.id()).status()).isEqualTo("REJECTED");
        assertThat(bills.get(bill, co).status()).as("退回后账单仍未结清").isEqualTo("ISSUED");
        assertThatThrownBy(() -> collection.confirm(p1.id(), null, "A1001")).as("处理过的凭证不能再确认").isInstanceOf(BizException.class);
        BillPaymentService.Payment p2 = payments.submit(co, bill, cmd("120.00"), "M-TEST");
        collection.confirm(p2.id(), "已核对银行流水", "A1001");
        MonthlyBillService.Bill settled = bills.get(bill, co);
        assertThat(settled.status()).isEqualTo("SETTLED");
        assertThat(settled.paymentStatus()).isEqualTo("CONFIRMED");
        assertThat(settled.overdueDays()).as("结清后不再算逾期").isZero();
        assertThat(status(co)).as("结清后自动恢复正常").isEqualTo("NORMAL");
        assertThat(jdbc.queryForObject("SELECT auto_throttled_bill FROM company WHERE company_id = ?", String.class, co)).isNull();
        assertThatThrownBy(() -> payments.submit(co, bill, cmd("120.00"), "M-TEST")).as("已结清的账单不能再付款").isInstanceOf(BizException.class);
    }

    @Test
    void manualOverrideAndExclusions() {
        // 运营手工恢复正常后，不会再被同一张账单自动限流
        String co = company("CY" + tag);
        String bill = bill(co, "2031-02", "50.00", "0.00");
        collection.run(DUE.plusDays(8));
        assertThat(status(co)).isEqualTo("THROTTLED");
        TenantContext.runAsSystem(() -> companies.changeStatus(co, CompanyStatus.NORMAL, "已与客户约定付款日", "A1001"));
        collection.run(DUE.plusDays(9));
        collection.run(DUE.plusDays(20));
        assertThat(status(co)).as("人工恢复后不重复限流").isEqualTo("NORMAL");

        // 运营把限流说明改成别的原因（人工接管）后，账单结清不自动恢复
        String co2 = company("CZ" + tag);
        String bill2 = bill(co2, "2031-02", "30.00", "0.00");
        collection.run(DUE.plusDays(8));
        TenantContext.runAsSystem(() -> companies.changeStatus(co2, CompanyStatus.THROTTLED, "投诉核实属实，人工限流", "A1001"));
        collection.settle(bill2, "A1001");
        assertThat(bills.get(bill2, co2).status()).isEqualTo("SETTLED");
        assertThat(status(co2)).as("限流原因被人工改过，不自动恢复").isEqualTo("THROTTLED");

        // 应付为 0、异议处理中的账单：不催款、不限流
        String co3 = company("CW" + tag);
        String zero = bill(co3, "2031-02", "0.00", "0.00");
        String co4 = company("CV" + tag);
        String disputed = bill(co4, "2031-02", "80.00", "0.00");
        jdbc.update("UPDATE monthly_bill SET status = 'DISPUTED' WHERE bill_id = ?", disputed);
        collection.run(DUE.plusDays(30));
        assertThat(events(zero)).isZero();
        assertThat(events(disputed)).isZero();
        assertThat(status(co3)).isEqualTo("NORMAL");
        assertThat(status(co4)).isEqualTo("NORMAL");
        assertThatThrownBy(() -> payments.submit(co3, zero, cmd("0.00"), "M-TEST")).as("应付为 0 无需付款").isInstanceOf(BizException.class);
        assertThatThrownBy(() -> payments.submit(co4, disputed, cmd("80.00"), "M-TEST")).as("异议中不能付款").isInstanceOf(BizException.class);
        assertThatThrownBy(() -> payments.submit(co3, disputed, cmd("80.00"), "M-TEST")).as("不能给别家公司的账单付款").isInstanceOf(BizException.class);
    }

    // ==================================================================== fixtures

    private BillPaymentService.SubmitCommand cmd(String amount) {
        return new BillPaymentService.SubmitCommand(new BigDecimal(amount), LocalDate.now(), "测试付款户", "SN" + tag, "payment/it-" + tag + ".png", null);
    }

    private String company(String id) {
        String credit = "91" + tag + String.format("%010d", RND.nextInt(1_000_000_000)).substring(0, 10);
        jdbc.update("INSERT INTO company (company_id, name, unified_credit_code, contact_name, contact_phone_enc, company_status, "
                        + "onboard_date, fee_rights_revoked) VALUES (?, ?, ?, '测试', ?, 'NORMAL', ?, 0)",
                id, "收款测试公司" + id, credit.substring(0, 18), cipher.encrypt("13800000000"), Date.valueOf("2026-01-05"));
        return id;
    }

    private String bill(String company, String month, String serviceFee, String transferPayable) {
        String id = "BLT" + tag + RND.nextInt(1_000_000);
        jdbc.update("INSERT INTO monthly_bill (bill_id, company_id, bill_month, service_fee, transfer_payable, transfer_receivable, status, "
                        + "issued_at, dispute_deadline, settle_deadline) VALUES (?, ?, ?, ?, ?, 0, 'ISSUED', ?, ?, ?)",
                id, company, month, new BigDecimal(serviceFee), new BigDecimal(transferPayable),
                Timestamp.valueOf(DUE.minusDays(14).atStartOfDay()), Date.valueOf(DUE.minusDays(7)), Date.valueOf(DUE));
        return id;
    }

    private String status(String company) {
        return jdbc.queryForObject("SELECT company_status FROM company WHERE company_id = ?", String.class, company);
    }

    /** 这张账单发出的通知事件数 */
    private int events(String billId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM outbox_event WHERE event_type = 'BILL_NOTICE' AND aggregate_id = ?",
                Integer.class, billId);
        return n == null ? 0 : n;
    }
}
