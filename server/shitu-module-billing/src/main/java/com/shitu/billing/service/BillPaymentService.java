package com.shitu.billing.service;

import com.shitu.common.Constants;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 账单付款凭证：公司老板对已下发的账单提交付款凭证（一次付清，金额须等于应付），平台核对到账后确认 → 账单置为已结算；
 * 核对不上则退回并写明原因，公司可重新提交。同一张账单同时只能有一条待确认的凭证。
 */
@Service
public class BillPaymentService {

    public record Payment(long id, String billId, String companyId, BigDecimal amount, LocalDate paidDate, String payerName,
                          String bankRef, String voucherKey, String remark, String status, String submittedBy,
                          LocalDateTime createdAt, String reviewedBy, LocalDateTime reviewedAt, String reviewRemark) {
    }

    public record SubmitCommand(BigDecimal amount, LocalDate paidDate, String payerName, String bankRef, String voucherKey,
                                String remark) {
    }

    private final JdbcTemplate jdbc;
    private final MonthlyBillService bills;
    private final AuditLogger audit;
    private final Clock clock;

    public BillPaymentService(JdbcTemplate jdbc, MonthlyBillService bills, AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.bills = bills;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    public Payment submit(String companyId, String billId, SubmitCommand cmd, String memberId) {
        MonthlyBillService.Bill b = bills.get(billId, companyId);
        BizException.check("ISSUED".equals(b.status()) || "CONFIRMED".equals(b.status()), ErrorCode.SYS_BAD_REQUEST,
                "DISPUTED".equals(b.status()) ? "账单正在异议处理中，处理完再付款" : "当前状态的账单不需要付款");
        BizException.check(b.payable().signum() > 0, ErrorCode.SYS_BAD_REQUEST, "这张账单应付为 0，无需付款");
        BizException.check(cmd.amount() != null && cmd.amount().compareTo(b.payable()) == 0, ErrorCode.SYS_BAD_REQUEST,
                "付款金额须等于应付金额 " + b.payable().toPlainString() + " 元（请一次付清）");
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        BizException.check(cmd.paidDate() != null && !cmd.paidDate().isAfter(today), ErrorCode.SYS_BAD_REQUEST, "付款日期不能晚于今天");
        BizException.check(b.issuedAt() == null || !cmd.paidDate().isBefore(b.issuedAt().toLocalDate()), ErrorCode.SYS_BAD_REQUEST,
                "付款日期不能早于账单下发日期");
        BizException.check(notBlank(cmd.payerName()) && cmd.payerName().trim().length() <= 100, ErrorCode.SYS_BAD_REQUEST, "请填写付款户名");
        BizException.check(cmd.bankRef() == null || cmd.bankRef().trim().length() <= 64, ErrorCode.SYS_BAD_REQUEST, "流水号最多 64 个字符");
        BizException.check(cmd.remark() == null || cmd.remark().trim().length() <= 255, ErrorCode.SYS_BAD_REQUEST, "备注最多 255 个字");
        BizException.check(notBlank(cmd.voucherKey()), ErrorCode.SYS_BAD_REQUEST, "请上传付款凭证");
        // 锁住账单行，避免同时提交出两条待确认
        jdbc.queryForList("SELECT bill_id FROM monthly_bill WHERE bill_id = ? FOR UPDATE", billId);
        Integer pending = jdbc.queryForObject("SELECT COUNT(*) FROM bill_payment WHERE bill_id = ? AND status = 'PENDING'",
                Integer.class, billId);
        BizException.check(pending == null || pending == 0, ErrorCode.SYS_CONFLICT, "已有一条付款凭证在等待平台确认");

        GeneratedKeyHolder key = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("INSERT INTO bill_payment (company_id, bill_id, amount, paid_date, payer_name, "
                    + "bank_ref, voucher_key, remark, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, companyId);
            ps.setString(2, billId);
            ps.setBigDecimal(3, cmd.amount());
            ps.setDate(4, Date.valueOf(cmd.paidDate()));
            ps.setString(5, cmd.payerName().trim());
            ps.setString(6, notBlank(cmd.bankRef()) ? cmd.bankRef().trim() : null);
            ps.setString(7, cmd.voucherKey());
            ps.setString(8, notBlank(cmd.remark()) ? cmd.remark().trim() : null);
            ps.setString(9, memberId);
            return ps;
        }, key);
        long id = key.getKey().longValue();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("paymentId", id);
        detail.put("amount", cmd.amount().toPlainString());
        detail.put("paidDate", cmd.paidDate().toString());
        audit.logForCompany(companyId, "BILL_PAYMENT_SUBMIT", "BILL", billId, detail);
        return get(id);
    }

    /** 平台确认到账：凭证置为已到账，账单置为已结算。 */
    @Transactional
    public Payment confirm(long paymentId, String remark, String operatorId) {
        Payment p = pending(paymentId);
        jdbc.update("UPDATE bill_payment SET status = 'CONFIRMED', reviewed_by = ?, reviewed_at = ?, review_remark = ? WHERE id = ?",
                operatorId, LocalDateTime.now(clock), notBlank(remark) ? remark.trim() : null, paymentId);
        bills.markSettled(p.billId(), operatorId);
        audit.log("BILL_PAYMENT_CONFIRM", "BILL", p.billId(), Map.of("paymentId", paymentId, "amount", p.amount().toPlainString()));
        return get(paymentId);
    }

    /** 平台退回凭证（金额不符、查不到入账等）：必须写原因，公司可重新提交。 */
    @Transactional
    public Payment reject(long paymentId, String remark, String operatorId) {
        BizException.check(notBlank(remark) && remark.trim().length() <= 255, ErrorCode.SYS_BAD_REQUEST, "请填写退回原因（255 字以内）");
        Payment p = pending(paymentId);
        jdbc.update("UPDATE bill_payment SET status = 'REJECTED', reviewed_by = ?, reviewed_at = ?, review_remark = ? WHERE id = ?",
                operatorId, LocalDateTime.now(clock), remark.trim(), paymentId);
        audit.log("BILL_PAYMENT_REJECT", "BILL", p.billId(), Map.of("paymentId", paymentId, "remark", remark.trim()));
        return get(paymentId);
    }

    public Payment get(long paymentId) {
        List<Payment> rows = jdbc.query("SELECT * FROM bill_payment WHERE id = ?", (rs, i) -> payment(rs), paymentId);
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        return rows.get(0);
    }

    /** 某张账单的全部付款凭证，最新的在前。 */
    public List<Payment> ofBill(String billId) {
        return jdbc.query("SELECT * FROM bill_payment WHERE bill_id = ? ORDER BY id DESC", (rs, i) -> payment(rs), billId);
    }

    private Payment pending(long paymentId) {
        Payment p = get(paymentId);
        BizException.check("PENDING".equals(p.status()), ErrorCode.SYS_CONFLICT, "这条付款凭证已处理过");
        return p;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static Payment payment(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Payment(rs.getLong("id"), rs.getString("bill_id"), rs.getString("company_id"), rs.getBigDecimal("amount"),
                rs.getDate("paid_date").toLocalDate(), rs.getString("payer_name"), rs.getString("bank_ref"),
                rs.getString("voucher_key"), rs.getString("remark"), rs.getString("status"), rs.getString("submitted_by"),
                rs.getTimestamp("created_at").toLocalDateTime(), rs.getString("reviewed_by"),
                rs.getTimestamp("reviewed_at") == null ? null : rs.getTimestamp("reviewed_at").toLocalDateTime(),
                rs.getString("review_remark"));
    }
}
