package com.shitu.billing.service;

import com.shitu.billing.domain.Money;
import com.shitu.common.Constants;
import com.shitu.common.api.PageResult;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * J-10 月账单（T-403 / P-10）：每月 1 日汇总上月每日计费 → 生成并下发账单；
 * 异议期 = 下发后 5 个工作日（D-23，按节假日日历），结算截止 = 次月 15 日（参数化）。
 * 流入应付（服务费 + 流转费）与流出应收（作为来源方的 8 元部分）分开列示，不轧差。
 */
@Service
public class MonthlyBillService {

    public record Bill(String billId, String companyId, String billMonth, BigDecimal serviceFee, BigDecimal transferPayable,
                       BigDecimal transferReceivable, BigDecimal payable, String status, LocalDateTime issuedAt,
                       LocalDate disputeDeadline, LocalDate settleDeadline, LocalDateTime settledAt,
                       int overdueDays, String paymentStatus, LocalDate receivablePaidDate) {
    }

    /** 带上最近一条付款凭证的状态（PENDING / CONFIRMED / REJECTED，没有则为 null） */
    private static final String SELECT_BILL = "SELECT b.*, (SELECT p.status FROM bill_payment p WHERE p.bill_id = b.bill_id "
            + "ORDER BY p.id DESC LIMIT 1) AS payment_status, (SELECT r.paid_date FROM bill_receivable_payout r WHERE r.bill_id = b.bill_id) "
            + "AS receivable_paid_date FROM monthly_bill b";
    /** 还没结清、需要公司付款的状态 */
    private static final String UNPAID = "b.status IN ('ISSUED','CONFIRMED')";

    public record DayLine(LocalDate bizDate, boolean inFreePeriod, int employedCount, int stockBase, int incrementCount,
                          BigDecimal serviceFee, BigDecimal transferPayable, BigDecimal transferReceivable) {
    }

    /** 流转账本（T-404）：作为接收方付出 / 作为来源方收入，按人汇总。 */
    public record LedgerLine(String direction, String userId, String counterpartCompanyId, int days, BigDecimal amount,
                             String counterpartCompanyName) {
    }

    public record Dispute(long id, String billId, String content, String status, String raisedBy, String reply,
                          LocalDateTime createdAt, LocalDateTime repliedAt) {
    }

    private final JdbcTemplate jdbc;
    private final BizIdGenerator ids;
    private final SysParams params;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.transaction.PlatformTransactionManager txManager;

    public MonthlyBillService(JdbcTemplate jdbc, BizIdGenerator ids, SysParams params, OutboxWriter outbox, AuditLogger audit,
                              Clock clock) {
        this.jdbc = jdbc;
        this.ids = ids;
        this.params = params;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    @Scheduled(cron = "${shitu.jobs.monthly-bill-cron:0 0 6 1 * *}", zone = "Asia/Shanghai")
    @SchedulerLock(name = "monthly_bill", lockAtMostFor = "PT30M")
    public void scheduled() {
        YearMonth last = YearMonth.from(LocalDate.now(clock.withZone(Constants.ZONE))).minusMonths(1);
        // 定时任务线程里直接调本类方法不经过事务代理：下发要写发件箱（必须在事务里），这里显式开事务。
        // 生成和下发各一个事务：下发失败时已生成的账单保留为「已生成」，可在中台手动下发
        org.springframework.transaction.support.TransactionTemplate tx = new org.springframework.transaction.support.TransactionTemplate(txManager);
        tx.executeWithoutResult(s -> generate(last));
        tx.executeWithoutResult(s -> issueAll(last));
    }

    /** 汇总生成（可重复执行：只覆盖还未下发的账单）。 */
    @Transactional
    public int generate(YearMonth month) {
        LocalDate from = month.atDay(1);
        LocalDate to = month.atEndOfMonth();
        List<Object[]> sums = jdbc.query("SELECT company_id, SUM(service_fee), SUM(transfer_payable), SUM(transfer_receivable) "
                        + "FROM company_fee_daily WHERE biz_date BETWEEN ? AND ? GROUP BY company_id",
                (rs, i) -> new Object[]{rs.getString(1), rs.getBigDecimal(2), rs.getBigDecimal(3), rs.getBigDecimal(4)},
                Date.valueOf(from), Date.valueOf(to));
        int n = 0;
        for (Object[] s : sums) {
            String cid = (String) s[0];
            List<String> existing = jdbc.queryForList("SELECT status FROM monthly_bill WHERE company_id = ? AND bill_month = ?",
                    String.class, cid, month.toString());
            if (!existing.isEmpty() && !"GENERATED".equals(existing.get(0))) {
                continue;
            }
            if (existing.isEmpty()) {
                jdbc.update("INSERT INTO monthly_bill (bill_id, company_id, bill_month, service_fee, transfer_payable, transfer_receivable, status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, 'GENERATED')", ids.dated("BL", 4), cid, month.toString(),
                        Money.round((BigDecimal) s[1]), Money.round((BigDecimal) s[2]), Money.round((BigDecimal) s[3]));
            } else {
                jdbc.update("UPDATE monthly_bill SET service_fee = ?, transfer_payable = ?, transfer_receivable = ?, version = version + 1 "
                                + "WHERE company_id = ? AND bill_month = ? AND status = 'GENERATED'",
                        Money.round((BigDecimal) s[1]), Money.round((BigDecimal) s[2]), Money.round((BigDecimal) s[3]), cid, month.toString());
            }
            n++;
        }
        return n;
    }

    /** 下发：写异议期与结算截止日，通知老板。 */
    @Transactional
    public int issueAll(YearMonth month) {
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        LocalDate disputeDeadline = addWorkdays(today, params.getInt("bill.dispute_workdays", 5));
        LocalDate settle = month.plusMonths(1).atDay(Math.min(params.getInt("bill.settle_day_of_next_month", 15),
                month.plusMonths(1).lengthOfMonth()));
        List<Map<String, Object>> bills = jdbc.queryForList("SELECT bill_id, company_id, service_fee, transfer_payable "
                + "FROM monthly_bill WHERE bill_month = ? AND status = 'GENERATED'", month.toString());
        for (Map<String, Object> b : bills) {
            jdbc.update("UPDATE monthly_bill SET status = 'ISSUED', issued_at = ?, dispute_deadline = ?, settle_deadline = ?, "
                            + "version = version + 1 WHERE bill_id = ? AND status = 'GENERATED'",
                    LocalDateTime.now(clock), Date.valueOf(disputeDeadline), Date.valueOf(settle), b.get("bill_id"));
            BigDecimal payable = ((BigDecimal) b.get("service_fee")).add((BigDecimal) b.get("transfer_payable"));
            outbox.publish("MONTHLY_BILL_ISSUED", "BILL", (String) b.get("bill_id"), Map.of("companyId", b.get("company_id"),
                    "month", month.toString(), "payable", payable.toPlainString(), "disputeDeadline", disputeDeadline.toString()));
        }
        return bills.size();
    }

    /** 加 n 个工作日：跳过周末与法定节假日，调休上班日算工作日（holiday 表）。 */
    LocalDate addWorkdays(LocalDate from, int n) {
        Map<LocalDate, Boolean> h = new HashMap<>();
        jdbc.query("SELECT holiday_date, is_workday FROM holiday WHERE holiday_date BETWEEN ? AND ?", rs -> {
            h.put(rs.getDate(1).toLocalDate(), rs.getBoolean(2));
        }, Date.valueOf(from), Date.valueOf(from.plusDays(40)));
        LocalDate d = from;
        int added = 0;
        while (added < n) {
            d = d.plusDays(1);
            boolean weekend = d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY;
            boolean workday = h.containsKey(d) ? h.get(d) : !weekend;
            if (workday) {
                added++;
            }
        }
        return d;
    }

    // ------------------------------------------------------------------ 查询（公司后台 T-403 / 平台 P-10）

    public PageResult<Bill> list(String companyId, String status, String month, int page, int pageSize) {
        return list(companyId, status, month, null, page, pageSize);
    }

    /** @param flag PAYMENT_PENDING 有待确认的付款凭证；OVERDUE 已过结算截止日仍未结清；RECEIVABLE_UNPAID 流转分成还没付给这家公司 */
    public PageResult<Bill> list(String companyId, String status, String month, String flag, int page, int pageSize) {
        StringBuilder where = new StringBuilder(" WHERE 1 = 1");
        List<Object> args = new java.util.ArrayList<>();
        if (companyId != null) {
            where.append(" AND b.company_id = ?");
            args.add(companyId);
        }
        if (status != null && !status.isBlank()) {
            where.append(" AND b.status = ?");
            args.add(status);
        }
        if (month != null && !month.isBlank()) {
            where.append(" AND b.bill_month = ?");
            args.add(month);
        }
        if ("PAYMENT_PENDING".equals(flag)) {
            where.append(" AND EXISTS (SELECT 1 FROM bill_payment p WHERE p.bill_id = b.bill_id AND p.status = 'PENDING')");
        } else if ("OVERDUE".equals(flag)) {
            where.append(" AND ").append(UNPAID).append(" AND (b.service_fee + b.transfer_payable) > 0 AND b.settle_deadline < ?");
            args.add(Date.valueOf(LocalDate.now(clock.withZone(Constants.ZONE))));
        } else if ("RECEIVABLE_UNPAID".equals(flag)) {
            // 已下发但还在异议期内的金额未定、现在付不了，不算「待付」
            where.append(" AND b.status IN ('ISSUED','CONFIRMED','SETTLED') AND (b.status <> 'ISSUED' OR b.dispute_deadline < CURDATE()) "
                    + "AND b.transfer_receivable > 0 "
                    + "AND NOT EXISTS (SELECT 1 FROM bill_receivable_payout r WHERE r.bill_id = b.bill_id)");
        }
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM monthly_bill b" + where, Long.class, args.toArray());
        int p = Math.max(1, page);
        int s = Math.min(100, Math.max(1, pageSize));
        args.add(s);
        args.add((p - 1) * s);
        List<Bill> rows = jdbc.query(SELECT_BILL + where + " ORDER BY b.bill_month DESC, b.company_id LIMIT ? OFFSET ?",
                (rs, i) -> bill(rs), args.toArray());
        return new PageResult<>(rows, total == null ? 0 : total, p, s);
    }

    public Bill get(String billId, String companyId) {
        List<Bill> b = jdbc.query(SELECT_BILL + " WHERE b.bill_id = ?" + (companyId == null ? "" : " AND b.company_id = ?"),
                (rs, i) -> bill(rs), companyId == null ? new Object[]{billId} : new Object[]{billId, companyId});
        BizException.check(!b.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        return b.get(0);
    }

    public List<DayLine> days(String companyId, YearMonth month) {
        return jdbc.query("SELECT biz_date, in_free_period, employed_count, stock_base, increment_count, service_fee, "
                        + "transfer_payable, transfer_receivable FROM company_fee_daily WHERE company_id = ? AND biz_date BETWEEN ? AND ? "
                        + "ORDER BY biz_date",
                (rs, i) -> new DayLine(rs.getDate(1).toLocalDate(), rs.getBoolean(2), rs.getInt(3), rs.getInt(4), rs.getInt(5),
                        rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getBigDecimal(8)),
                companyId, Date.valueOf(month.atDay(1)), Date.valueOf(month.atEndOfMonth()));
    }

    /** 流转账本：流入（我付给来源方 / 平台）与流出（别人付给我）分开（T-404）。来源方只看到人员 ID 与天数，不看到去向公司的业务数据。 */
    public List<LedgerLine> ledger(String companyId, YearMonth month) {
        Date from = Date.valueOf(month.atDay(1));
        Date to = Date.valueOf(month.atEndOfMonth());
        List<LedgerLine> in = jdbc.query("SELECT b.user_id, b.supply_company_id, COUNT(*), SUM(b.payer_amount), MAX(COALESCE(c.short_name, c.name)) FROM billing_daily b "
                        + "LEFT JOIN company c ON c.company_id = b.supply_company_id "
                        + "WHERE b.company_id = ? AND b.fee_type = 'TRANSFER' AND b.biz_date BETWEEN ? AND ? GROUP BY b.user_id, b.supply_company_id",
                (rs, i) -> new LedgerLine("PAYABLE", rs.getString(1), rs.getString(2), rs.getInt(3), rs.getBigDecimal(4),
                        rs.getString(5) != null ? rs.getString(5) : com.shitu.common.Constants.PLATFORM.equals(rs.getString(2)) ? "平台" : null),
                companyId, from, to);
        List<LedgerLine> out = jdbc.query("SELECT user_id, COUNT(*), SUM(supply_amount) FROM billing_daily "
                        + "WHERE supply_company_id = ? AND fee_type = 'TRANSFER' AND biz_date BETWEEN ? AND ? GROUP BY user_id",
                (rs, i) -> new LedgerLine("RECEIVABLE", rs.getString(1), null, rs.getInt(2), rs.getBigDecimal(3), null),
                companyId, from, to);
        List<LedgerLine> all = new java.util.ArrayList<>(in);
        all.addAll(out);
        return all;
    }

    // ------------------------------------------------------------------ 异议与结算

    @Transactional
    public Dispute raiseDispute(String companyId, String billId, String content, String memberId) {
        Bill b = get(billId, companyId);
        BizException.check("ISSUED".equals(b.status()), ErrorCode.SYS_BAD_REQUEST, "只有已下发的账单可以提出异议");
        BizException.check(!LocalDate.now(clock.withZone(Constants.ZONE)).isAfter(b.disputeDeadline()),
                ErrorCode.SYS_BAD_REQUEST, "已过异议期（" + b.disputeDeadline() + "）");
        BizException.check(content != null && !content.isBlank() && content.length() <= 1000, ErrorCode.SYS_BAD_REQUEST, "请填写异议内容");
        jdbc.queryForList("SELECT bill_id FROM monthly_bill WHERE bill_id = ? FOR UPDATE", billId);
        Integer pendingVoucher = jdbc.queryForObject("SELECT COUNT(*) FROM bill_payment WHERE bill_id = ? AND status = 'PENDING'", Integer.class, billId);
        BizException.check(pendingVoucher == null || pendingVoucher == 0, ErrorCode.SYS_BAD_REQUEST,
                "这张账单已提交付款凭证，正在等平台确认；如需提异议，请先联系平台退回凭证");
        jdbc.update("INSERT INTO bill_dispute (company_id, bill_id, content, raised_by) VALUES (?, ?, ?, ?)",
                companyId, billId, content.trim(), memberId);
        jdbc.update("UPDATE monthly_bill SET status = 'DISPUTED', version = version + 1 WHERE bill_id = ?", billId);
        audit.logForCompany(companyId, "BILL_DISPUTE", "BILL", billId, Map.of("content", content.trim()));
        return disputes(billId).get(0);
    }

    public List<Dispute> disputes(String billId) {
        return jdbc.query("SELECT id, bill_id, content, status, raised_by, reply, created_at, replied_at FROM bill_dispute "
                        + "WHERE bill_id = ? ORDER BY id DESC",
                (rs, i) -> new Dispute(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        rs.getString(6), rs.getTimestamp(7).toLocalDateTime(),
                        rs.getTimestamp(8) == null ? null : rs.getTimestamp(8).toLocalDateTime()), billId);
    }

    /** 平台处理异议：接受（账单退回 GENERATED，修正后重新下发）或驳回（回到 ISSUED）。 */
    @Transactional
    public void replyDispute(long disputeId, boolean accept, String reply, String operatorId) {
        BizException.check(reply != null && !reply.isBlank(), ErrorCode.SYS_BAD_REQUEST, "请填写处理说明");
        List<String> billIds = jdbc.queryForList("SELECT bill_id FROM bill_dispute WHERE id = ? AND status = 'OPEN'", String.class, disputeId);
        BizException.check(!billIds.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        jdbc.update("UPDATE bill_dispute SET status = ?, reply = ?, replied_by = ?, replied_at = ? WHERE id = ?",
                accept ? "ACCEPTED" : "REJECTED", reply.trim(), operatorId, LocalDateTime.now(clock), disputeId);
        jdbc.update("UPDATE monthly_bill SET status = ?, version = version + 1 WHERE bill_id = ?",
                accept ? "GENERATED" : "ISSUED", billIds.get(0));
        audit.log(accept ? "BILL_DISPUTE_ACCEPT" : "BILL_DISPUTE_REJECT", "BILL", billIds.get(0), Map.of("reply", reply.trim()));
    }

    /** 确认（异议期满或公司确认）与登记结算。 */
    @Transactional
    public void markSettled(String billId, String operatorId) {
        Bill b = get(billId, null);
        BizException.check("ISSUED".equals(b.status()) || "CONFIRMED".equals(b.status()), ErrorCode.SYS_BAD_REQUEST,
                "DISPUTED".equals(b.status()) ? "账单有未处理的异议，处理完再结算" : "当前状态不能登记结算");
        jdbc.update("UPDATE monthly_bill SET status = 'SETTLED', settled_at = ?, version = version + 1 WHERE bill_id = ?",
                LocalDateTime.now(clock), billId);
        audit.log("BILL_SETTLE", "BILL", billId, null);
    }

    private static Bill bill(java.sql.ResultSet rs) throws java.sql.SQLException {
        BigDecimal service = rs.getBigDecimal("service_fee");
        BigDecimal pay = rs.getBigDecimal("transfer_payable");
        String status = rs.getString("status");
        LocalDate settle = rs.getDate("settle_deadline") == null ? null : rs.getDate("settle_deadline").toLocalDate();
        // 逾期天数：已下发未结清、应付大于 0、且过了结算截止日；异议处理中的、应付为 0 的不算逾期
        long overdue = settle != null && service.add(pay).signum() > 0 && ("ISSUED".equals(status) || "CONFIRMED".equals(status))
                ? java.time.temporal.ChronoUnit.DAYS.between(settle, LocalDate.now(Constants.ZONE)) : 0;
        return new Bill(rs.getString("bill_id"), rs.getString("company_id"), rs.getString("bill_month"), service, pay,
                rs.getBigDecimal("transfer_receivable"), service.add(pay), status,
                rs.getTimestamp("issued_at") == null ? null : rs.getTimestamp("issued_at").toLocalDateTime(),
                rs.getDate("dispute_deadline") == null ? null : rs.getDate("dispute_deadline").toLocalDate(),
                rs.getDate("settle_deadline") == null ? null : rs.getDate("settle_deadline").toLocalDate(),
                rs.getTimestamp("settled_at") == null ? null : rs.getTimestamp("settled_at").toLocalDateTime(),
                (int) Math.max(0, overdue), rs.getString("payment_status"),
                rs.getDate("receivable_paid_date") == null ? null : rs.getDate("receivable_paid_date").toLocalDate());
    }
}
