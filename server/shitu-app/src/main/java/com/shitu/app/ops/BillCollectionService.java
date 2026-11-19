package com.shitu.app.ops;

import com.shitu.billing.service.BillPaymentService;
import com.shitu.billing.service.MonthlyBillService;
import com.shitu.common.Constants;
import com.shitu.common.enums.CompanyStatus;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.tenant.company.CompanyService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * 账单收款：付款凭证的确认 / 退回、到期前提醒、逾期催款与自动限流。
 * <ul>
 *   <li>结算截止前 N 天（bill.remind_before_days）提醒一次；</li>
 *   <li>逾期后第 1 天催一次，之后每隔 bill.overdue_remind_interval_days 天催一次；</li>
 *   <li>逾期满 bill.overdue_throttle_days 天、公司状态为正常时自动限流，账单结清后自动恢复；
 *       同一张账单只自动限流一次——运营手工恢复正常后不会再被这张账单限流。</li>
 *   <li>有待确认付款凭证的账单、异议处理中的账单、应付为 0 的账单不催款也不限流。</li>
 * </ul>
 */
@Service
public class BillCollectionService {

    private static final Logger log = LoggerFactory.getLogger(BillCollectionService.class);
    /** 自动限流写入的状态说明前缀；恢复时只恢复说明仍是这个前缀的公司（运营改过说明的视为人工接管） */
    static final String AUTO_REMARK = "账单逾期未结清，系统自动限流";

    public record Payee(String name, String bank, String account) {
    }

    public record Summary(long paymentPending, long overdueBills, BigDecimal overdueAmount) {
    }

    public record RunResult(int dueSoonReminded, int overdueReminded, int throttled) {
    }

    private final JdbcTemplate jdbc;
    private final MonthlyBillService bills;
    private final BillPaymentService payments;
    private final CompanyService companies;
    private final SysParams params;
    private final OutboxWriter outbox;
    private final Clock clock;
    private final TransactionTemplate tx;

    public BillCollectionService(JdbcTemplate jdbc, MonthlyBillService bills, BillPaymentService payments, CompanyService companies,
                                 SysParams params, OutboxWriter outbox, Clock clock, PlatformTransactionManager txManager) {
        this.tx = new TransactionTemplate(txManager);
        this.jdbc = jdbc;
        this.bills = bills;
        this.payments = payments;
        this.companies = companies;
        this.params = params;
        this.outbox = outbox;
        this.clock = clock;
    }

    /** 平台收款账户（系统参数里维护），显示在公司后台的付款说明里。 */
    public Payee payee() {
        return new Payee(params.getString("bill.payee_name", ""), params.getString("bill.payee_bank", ""),
                params.getString("bill.payee_account", ""));
    }

    /** 平台对账页顶部的待办数。 */
    public Summary summary() {
        Long pending = jdbc.queryForObject("SELECT COUNT(*) FROM bill_payment WHERE status = 'PENDING'", Long.class);
        Map<String, Object> o = jdbc.queryForMap("SELECT COUNT(*) AS n, COALESCE(SUM(service_fee + transfer_payable), 0) AS amt "
                + "FROM monthly_bill WHERE status IN ('ISSUED','CONFIRMED') AND (service_fee + transfer_payable) > 0 AND settle_deadline < ?",
                Date.valueOf(today()));
        return new Summary(pending == null ? 0 : pending, ((Number) o.get("n")).longValue(), (BigDecimal) o.get("amt"));
    }

    @Transactional
    public BillPaymentService.Payment confirm(long paymentId, String remark, String operatorId) {
        BillPaymentService.Payment p = payments.confirm(paymentId, remark, operatorId);
        MonthlyBillService.Bill b = bills.get(p.billId(), null);
        restoreIfAutoThrottled(b);
        notifyOwner(b, b.billMonth() + " 账单的付款已确认到账，账单已结清。");
        return p;
    }

    @Transactional
    public BillPaymentService.Payment reject(long paymentId, String remark, String operatorId) {
        BillPaymentService.Payment p = payments.reject(paymentId, remark, operatorId);
        MonthlyBillService.Bill b = bills.get(p.billId(), null);
        notifyOwner(b, b.billMonth() + " 账单的付款凭证被退回：" + remark.trim() + "。请核对后重新提交。");
        return p;
    }

    /** 不经凭证直接登记结算（线下已核对到账）。 */
    @Transactional
    public void settle(String billId, String operatorId) {
        jdbc.queryForList("SELECT bill_id FROM monthly_bill WHERE bill_id = ? FOR UPDATE", billId);
        Integer pending = jdbc.queryForObject("SELECT COUNT(*) FROM bill_payment WHERE bill_id = ? AND status = 'PENDING'", Integer.class, billId);
        com.shitu.common.exception.BizException.check(pending == null || pending == 0, com.shitu.common.exception.ErrorCode.SYS_CONFLICT,
                "企业已提交付款凭证，请在「付款凭证」里确认到账或退回，不要直接登记结算");
        bills.markSettled(billId, operatorId);
        restoreIfAutoThrottled(bills.get(billId, null));
    }

    // ------------------------------------------------------------------ 每日催款与限流

    @Scheduled(cron = "${shitu.jobs.bill-collection-cron:0 30 9 * * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "bill_collection", lockAtMostFor = "PT20M")
    public void scheduled() {
        RunResult r = run(today());
        log.info("账单催收：到期前提醒 {} 张，逾期催款 {} 张，自动限流 {} 家", r.dueSoonReminded(), r.overdueReminded(), r.throttled());
    }

    /** 可重复执行：同一天对同一张账单只催一次。每张账单单独一个事务，某一张处理失败只记日志，不影响其他账单。 */
    public RunResult run(LocalDate today) {
        int before = params.getInt("bill.remind_before_days", 3);
        int interval = Math.max(1, params.getInt("bill.overdue_remind_interval_days", 3));
        int throttleDays = params.getInt("bill.overdue_throttle_days", 7);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT b.bill_id, b.company_id, b.bill_month, b.settle_deadline, "
                + "b.last_reminded_on, (b.service_fee + b.transfer_payable) AS payable FROM monthly_bill b "
                + "WHERE b.status IN ('ISSUED','CONFIRMED') AND b.settle_deadline IS NOT NULL "
                + "AND (b.service_fee + b.transfer_payable) > 0 "
                + "AND NOT EXISTS (SELECT 1 FROM bill_payment p WHERE p.bill_id = b.bill_id AND p.status = 'PENDING')");
        int[] n = new int[3];
        for (Map<String, Object> r : rows) {
            try {
                tx.executeWithoutResult(st -> handle(r, today, before, interval, throttleDays, n));
            } catch (RuntimeException e) {
                log.error("账单催收失败 billId={} companyId={}", r.get("bill_id"), r.get("company_id"), e);
            }
        }
        return new RunResult(n[0], n[1], n[2]);
    }

    private void handle(Map<String, Object> r, LocalDate today, int before, int interval, int throttleDays, int[] n) {
        {
            String billId = (String) r.get("bill_id");
            // 列表是事务外一次查出来的：轮到这一张时锁行重读，期间已结清、进入异议或刚提交了凭证的跳过
            List<Map<String, Object>> now = jdbc.queryForList("SELECT b.status, b.last_reminded_on, (SELECT COUNT(*) FROM bill_payment p "
                    + "WHERE p.bill_id = b.bill_id AND p.status = 'PENDING') AS pending FROM monthly_bill b WHERE b.bill_id = ? FOR UPDATE", billId);
            if (now.isEmpty() || !List.of("ISSUED", "CONFIRMED").contains(now.get(0).get("status"))
                    || ((Number) now.get(0).get("pending")).intValue() > 0) {
                return;
            }
            r.put("last_reminded_on", now.get(0).get("last_reminded_on"));
            String companyId = (String) r.get("company_id");
            String month = (String) r.get("bill_month");
            String payable = ((BigDecimal) r.get("payable")).toPlainString();
            LocalDate deadline = ((Date) r.get("settle_deadline")).toLocalDate();
            LocalDate last = r.get("last_reminded_on") == null ? null : ((Date) r.get("last_reminded_on")).toLocalDate();
            long days = ChronoUnit.DAYS.between(deadline, today);
            if (days <= 0) {
                // 到期前提醒：进入提醒窗口后只提醒一次
                if (before > 0 && -days <= before && last == null) {
                    remind(billId, companyId, month + " 账单应付 " + payable + " 元，请在 " + deadline
                            + " 前付款，并在「费用账单」里提交付款凭证。", today);
                    n[0]++;
                }
                return;
            }
            boolean firstOverdue = last == null || !last.isAfter(deadline);
            if (firstOverdue || ChronoUnit.DAYS.between(last, today) >= interval) {
                String tail = throttleDays > 0 && days < throttleDays
                        ? "逾期满 " + throttleDays + " 天将自动限流（岗位匹配权重降低）。" : "";
                remind(billId, companyId, month + " 账单应付 " + payable + " 元，已逾期 " + days
                        + " 天，请尽快付款并在「费用账单」里提交付款凭证。" + tail, today);
                n[1]++;
            }
            if (throttleDays > 0 && days >= throttleDays && throttle(companyId, billId, month, days)) {
                n[2]++;
            }
        }
    }

    private void remind(String billId, String companyId, String content, LocalDate today) {
        jdbc.update("UPDATE monthly_bill SET last_reminded_on = ?, remind_count = remind_count + 1 WHERE bill_id = ?",
                Date.valueOf(today), billId);
        outbox.publish("BILL_NOTICE", "BILL", billId, Map.of("companyId", companyId, "content", content));
    }

    /** 公司状态为正常、且没有因这张账单被自动限流过时才限流。 */
    private boolean throttle(String companyId, String billId, String month, long days) {
        List<Map<String, Object>> c = jdbc.queryForList("SELECT company_status, auto_throttled_bill FROM company WHERE company_id = ?",
                companyId);
        if (c.isEmpty() || !CompanyStatus.NORMAL.name().equals(c.get(0).get("company_status"))
                || billId.equals(c.get(0).get("auto_throttled_bill"))) {
            return false;
        }
        String remark = AUTO_REMARK + "（" + month + " 账单逾期 " + days + " 天），结清后自动恢复";
        TenantContext.runAsSystem(() -> companies.changeStatus(companyId, CompanyStatus.THROTTLED, remark, "SYSTEM"));
        jdbc.update("UPDATE company SET auto_throttled_bill = ? WHERE company_id = ?", billId, companyId);
        outbox.publish("BILL_NOTICE", "BILL", billId, Map.of("companyId", companyId,
                "content", month + " 账单逾期 " + days + " 天未结清，公司已被自动限流（岗位匹配权重降低）。付款并经平台确认到账后自动恢复。"));
        return true;
    }

    /** 账单结清后：如果公司是因这张账单被自动限流、且限流说明没被人工改过，恢复为正常。 */
    private void restoreIfAutoThrottled(MonthlyBillService.Bill b) {
        List<Map<String, Object>> c = jdbc.queryForList("SELECT company_status, status_remark, auto_throttled_bill FROM company "
                + "WHERE company_id = ?", b.companyId());
        if (c.isEmpty() || !b.billId().equals(c.get(0).get("auto_throttled_bill"))) {
            return;
        }
        jdbc.update("UPDATE company SET auto_throttled_bill = NULL WHERE company_id = ?", b.companyId());
        String remark = (String) c.get(0).get("status_remark");
        if (CompanyStatus.THROTTLED.name().equals(c.get(0).get("company_status")) && remark != null && remark.startsWith(AUTO_REMARK)) {
            TenantContext.runAsSystem(() -> companies.changeStatus(b.companyId(), CompanyStatus.NORMAL, "账单已结清，自动恢复", "SYSTEM"));
        }
    }

    private void notifyOwner(MonthlyBillService.Bill b, String content) {
        outbox.publish("BILL_NOTICE", "BILL", b.billId(), Map.of("companyId", b.companyId(), "content", content));
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(Constants.ZONE));
    }
}
