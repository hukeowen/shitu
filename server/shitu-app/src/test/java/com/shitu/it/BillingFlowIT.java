package com.shitu.it;

import com.shitu.billing.service.DailyBillingService;
import com.shitu.billing.service.MonthlyBillService;
import com.shitu.common.exception.BizException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 计费黄金用例（docs/03 Sprint 4 验收：不少于 30 个场景值）：直接构造任职事实，逐日跑 J-01，核对每一个金额。
 * <pre>
 * A 公司 2026-04-01 入驻（免费期至 06-30，07-01 锁定存量基数）
 *   e1 05-10 入职（免费期内，存量）       e2 06-30 入职（免费期最后一天入职：不计入存量，07-01 起算增量）
 *   e3 07-15 入职 07-20 离职（计 16–19 共 4 天）  e4 07-10 当日入职当日离职（不计）
 * B 公司 2026-01-05 入驻（免费期满，存量 0），7 月 1 日接收 4 名流转人员（7-02 起计 30 天）：
 *   t1 来源 A（8 / 2 分账）  t2 来源平台（10 全归平台）  t3 来源已注销公司 C（全归平台）  t4 来源被取消收费权限公司 D（全归平台）
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "SHITU_IT", matches = "true")
@SpringBootTest(properties = {FlowItSupport.IT_DB, "shitu.scheduling.enabled=false", "shitu.ops.init-password=ItSuper2026"})
class BillingFlowIT {

    static final SecureRandom RND = new SecureRandom();
    static final YearMonth JULY = YearMonth.of(2026, 7);

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    DailyBillingService daily;
    @Autowired
    MonthlyBillService monthly;

    final String tag = String.valueOf(100000 + RND.nextInt(899999));
    final String a = "CA" + tag;
    final String b = "CB" + tag;
    final String c = "CC" + tag;
    final String d = "CD" + tag;

    @Test
    void goldenCases() {
        // 7 月账单若被上次运行下发过，先清理（测试库）
        jdbc.update("DELETE FROM bill_dispute WHERE bill_id IN (SELECT bill_id FROM monthly_bill WHERE bill_month = ?)", JULY.toString());
        jdbc.update("DELETE FROM monthly_bill WHERE bill_month = ?", JULY.toString());

        company(a, "2026-04-01", "NORMAL", false);
        company(b, "2026-01-05", "NORMAL", false);
        company(c, "2026-01-05", "DEREGISTERED", false);
        company(d, "2026-01-05", "NORMAL", true);
        String e1 = emp(a, a, "2026-05-10", null);
        String e2 = emp(a, a, "2026-06-30", null);
        String e3 = emp(a, a, "2026-07-15", "2026-07-20");
        emp(a, a, "2026-07-10", "2026-07-10");
        String t1 = emp(b, a, "2026-07-01", null);
        String t2 = emp(b, "PLATFORM", "2026-07-01", null);
        String t3 = emp(b, c, "2026-07-01", null);
        String t4 = emp(b, d, "2026-07-01", null);

        for (int day = 1; day <= 31; day++) {
            daily.run(JULY.atDay(day));
        }

        // ---------------------------------------------------------------- 存量基数（J-07）
        assertThat(jdbc.queryForObject("SELECT base_count FROM stock_base WHERE company_id = ?", Integer.class, a)).as("A 存量 = e1").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT base_count FROM stock_base WHERE company_id = ?", Integer.class, b)).as("B 存量 = 0").isZero();

        // ---------------------------------------------------------------- A 公司增长服务费
        assertThat(day(a, "2026-07-01")).containsEntry("employed_count", 2).containsEntry("increment_count", 1)
                .containsEntry("in_free_period", false);
        assertThat(money(day(a, "2026-07-01"), "service_fee")).isEqualByComparingTo("0.10");
        assertThat(day(a, "2026-07-10").get("employed_count")).as("当日入离职不计").isEqualTo(2);
        assertThat(day(a, "2026-07-15").get("employed_count")).as("入职当天不计").isEqualTo(2);
        assertThat(day(a, "2026-07-16").get("employed_count")).isEqualTo(3);
        assertThat(money(day(a, "2026-07-16"), "service_fee")).isEqualByComparingTo("0.20");
        assertThat(day(a, "2026-07-19").get("employed_count")).isEqualTo(3);
        assertThat(day(a, "2026-07-20").get("employed_count")).as("离职当天不计").isEqualTo(2);
        assertThat(sum("service_fee", a)).as("A 7 月服务费 = 31×0.10 + 4×0.10").isEqualByComparingTo("3.50");

        // ---------------------------------------------------------------- 流转费
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM company_fee_daily WHERE company_id = ? AND biz_date = ?", Long.class,
                b, Date.valueOf("2026-07-01"))).as("7-01 入职当天不计：当天无计费，不产生汇总行").isZero();
        assertThat(money(day(b, "2026-07-02"), "transfer_payable")).isEqualByComparingTo("40.00");
        assertThat(money(day(b, "2026-07-02"), "service_fee")).as("B 存量 0，4 人增量").isEqualByComparingTo("0.40");
        assertThat(sum("transfer_payable", b)).as("B 应付流转费 = 4 人 × 30 天 × 10").isEqualByComparingTo("1200.00");
        assertThat(sum("service_fee", b)).isEqualByComparingTo("12.00");
        assertThat(sum("transfer_receivable", a)).as("A 作为来源方应收 = 30 天 × 8").isEqualByComparingTo("240.00");
        assertThat(line(t1, "supply_amount")).isEqualByComparingTo("8.00");
        assertThat(line(t1, "platform_amount")).isEqualByComparingTo("2.00");
        assertThat(line(t2, "supply_amount")).as("来源平台").isEqualByComparingTo("0.00");
        assertThat(line(t2, "platform_amount")).isEqualByComparingTo("10.00");
        assertThat(line(t3, "platform_amount")).as("来源公司已注销").isEqualByComparingTo("10.00");
        assertThat(line(t4, "platform_amount")).as("来源公司被取消收费权限").isEqualByComparingTo("10.00");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM billing_daily WHERE employment_id IN (?, ?, ?)", Long.class, e1, e2, e3))
                .as("本公司员工不产生流转明细").isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM company_fee_daily WHERE company_id = ? AND biz_date BETWEEN ? AND ?",
                Long.class, c, Date.valueOf("2026-07-01"), Date.valueOf("2026-07-31"))).as("已注销来源不记应收").isZero();

        // ---------------------------------------------------------------- 重跑幂等
        daily.run(LocalDate.of(2026, 7, 15));
        daily.run(LocalDate.of(2026, 7, 15));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM billing_daily WHERE company_id = ? AND biz_date = ?", Long.class, b,
                Date.valueOf("2026-07-15"))).isEqualTo(4);
        assertThat(sum("transfer_payable", b)).isEqualByComparingTo("1200.00");

        // ---------------------------------------------------------------- 月账单（J-10）
        assertThat(monthly.generate(JULY)).isGreaterThanOrEqualTo(2);
        MonthlyBillService.Bill billA = bill(a);
        assertThat(billA.serviceFee()).isEqualByComparingTo("3.50");
        assertThat(billA.transferPayable()).isEqualByComparingTo("0.00");
        assertThat(billA.transferReceivable()).as("流出应收单列，不轧差").isEqualByComparingTo("240.00");
        MonthlyBillService.Bill billB = bill(b);
        assertThat(billB.payable()).isEqualByComparingTo("1212.00");
        monthly.issueAll(JULY);
        billB = bill(b);
        assertThat(billB.status()).isEqualTo("ISSUED");
        assertThat(billB.disputeDeadline()).isAfter(LocalDate.now());
        assertThat(billB.settleDeadline()).isEqualTo(LocalDate.of(2026, 8, 15));
        assertThatThrownBy(() -> daily.run(LocalDate.of(2026, 7, 20))).as("已下发月份不能重算").isInstanceOf(BizException.class);

        // ---------------------------------------------------------------- 异议
        monthly.raiseDispute(b, billB.billId(), "7 月 t3 已于 7-20 离职，应停止计费", "M-TEST");
        assertThat(bill(b).status()).isEqualTo("DISPUTED");
        long disputeId = monthly.disputes(billB.billId()).get(0).id();
        monthly.replyDispute(disputeId, true, "核实属实，修正后重新下发", "A1001");
        assertThat(bill(b).status()).isEqualTo("GENERATED");
    }

    // ==================================================================== fixtures

    private void company(String id, String onboard, String status, boolean revoked) {
        String credit = "91" + tag + String.format("%010d", RND.nextInt(1_000_000_000)).substring(0, 10);
        jdbc.update("INSERT INTO company (company_id, name, unified_credit_code, contact_name, contact_phone_enc, company_status, "
                        + "onboard_date, fee_rights_revoked) VALUES (?, ?, ?, '测试', 'x', ?, ?, ?)",
                id, "计费测试公司" + id, credit.substring(0, 18), status, Date.valueOf(onboard), revoked);
    }

    private String emp(String company, String source, String start, String end) {
        String id = "EMT" + tag + RND.nextInt(1_000_000);
        jdbc.update("INSERT INTO employment (employment_id, user_id, company_id, project_id, start_date, end_date, "
                        + "source_company_id_snapshot, is_transfer, origin) VALUES (?, ?, ?, 'P-TEST', ?, ?, ?, ?, 'PLATFORM_ONBOARD')",
                id, "UT" + id, company, Date.valueOf(start), end == null ? null : Date.valueOf(end), source, !source.equals(company));
        return id;
    }

    private Map<String, Object> day(String company, String date) {
        return jdbc.queryForMap("SELECT employed_count, increment_count, in_free_period, service_fee, transfer_payable, transfer_receivable "
                + "FROM company_fee_daily WHERE company_id = ? AND biz_date = ?", company, Date.valueOf(date));
    }

    private static BigDecimal money(Map<String, Object> row, String col) {
        return (BigDecimal) row.get(col);
    }

    private BigDecimal sum(String col, String company) {
        return jdbc.queryForObject("SELECT COALESCE(SUM(" + col + "), 0) FROM company_fee_daily WHERE company_id = ? AND biz_date BETWEEN ? AND ?",
                BigDecimal.class, company, Date.valueOf(JULY.atDay(1)), Date.valueOf(JULY.atEndOfMonth()));
    }

    private BigDecimal line(String employmentId, String col) {
        return jdbc.queryForObject("SELECT " + col + " FROM billing_daily WHERE employment_id = ? AND biz_date = ?",
                BigDecimal.class, employmentId, Date.valueOf("2026-07-10"));
    }

    private MonthlyBillService.Bill bill(String company) {
        return monthly.list(company, null, JULY.toString(), 1, 1).records().get(0);
    }
}
