package com.shitu.app.ops;

import com.shitu.billing.service.MonthlyBillService;
import com.shitu.common.Constants;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.outbox.OutboxWriter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 流转分成付款（平台 → 来源公司）：公司老板维护收款账户，平台财务线下转账后登记付款记录，公司在账单里看到「已到账」。
 * 应收与应付不轧差：和这家公司自己的应付是否结清无关。一张账单的应收一次付清，只登记一条。
 */
@Service
public class ReceivablePayoutService {

    /** 公司收款账户。accountNo 只在本公司老板和平台财务处返回完整值，其余场景用 accountTail */
    public record Payee(String accountName, String bankName, String accountNo, String accountTail, LocalDateTime updatedAt) {
    }

    public record Payout(long id, String billId, String companyId, BigDecimal amount, LocalDate paidDate, String bankRef,
                         String voucherKey, String remark, String accountName, String bankName, String accountTail,
                         String paidBy, LocalDateTime createdAt) {
    }

    public record Summary(long unpaidBills, BigDecimal unpaidAmount, long withoutPayee) {
    }

    public record PayoutCommand(LocalDate paidDate, String bankRef, String voucherKey, String remark) {
    }

    private final JdbcTemplate jdbc;
    private final MonthlyBillService bills;
    private final FieldCipher cipher;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public ReceivablePayoutService(JdbcTemplate jdbc, MonthlyBillService bills, FieldCipher cipher, OutboxWriter outbox,
                                   AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.bills = bills;
        this.cipher = cipher;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ 收款账户

    public Optional<Payee> payee(String companyId) {
        return jdbc.query("SELECT account_name, bank_name, account_no_enc, account_tail, updated_at FROM company_payee WHERE company_id = ?",
                (rs, i) -> new Payee(rs.getString(1), rs.getString(2), cipher.decrypt(rs.getString(3)), rs.getString(4),
                        rs.getTimestamp(5).toLocalDateTime()), companyId).stream().findFirst();
    }

    @Transactional
    public Payee savePayee(String companyId, String accountName, String bankName, String accountNo, String memberId) {
        String name = accountName == null ? "" : accountName.trim();
        String bank = bankName == null ? "" : bankName.trim();
        String no = accountNo == null ? "" : accountNo.replaceAll("[\\s-]", "");
        BizException.check(name.length() >= 2 && name.length() <= 100, ErrorCode.SYS_BAD_REQUEST, "请填写收款户名（一般是公司全称）");
        BizException.check(bank.length() >= 2 && bank.length() <= 100, ErrorCode.SYS_BAD_REQUEST, "请填写开户行（写到支行）");
        BizException.check(no.matches("\\d{8,30}"), ErrorCode.SYS_BAD_REQUEST, "收款账号应为 8–30 位数字");
        String tail = no.substring(no.length() - 4);
        jdbc.update("INSERT INTO company_payee (company_id, account_name, bank_name, account_no_enc, account_tail, updated_by) "
                        + "VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE account_name = VALUES(account_name), bank_name = VALUES(bank_name), "
                        + "account_no_enc = VALUES(account_no_enc), account_tail = VALUES(account_tail), updated_by = VALUES(updated_by)",
                companyId, name, bank, cipher.encrypt(no), tail, memberId);
        // 审计里只留尾号，不留完整账号
        audit.logForCompany(companyId, "COMPANY_PAYEE_SAVE", "COMPANY", companyId, Map.of("accountName", name, "bankName", bank, "accountTail", tail));
        return payee(companyId).orElseThrow();
    }

    // ------------------------------------------------------------------ 付款记录

    public Optional<Payout> ofBill(String billId) {
        return jdbc.query("SELECT * FROM bill_receivable_payout WHERE bill_id = ?", (rs, i) -> payout(rs), billId).stream().findFirst();
    }

    /** 平台登记已付款：账单须已下发且不在异议处理中（金额已定），应收大于 0，公司已登记收款账户，且还没付过。 */
    @Transactional
    public Payout register(String billId, PayoutCommand cmd, String operatorId) {
        jdbc.queryForList("SELECT bill_id FROM monthly_bill WHERE bill_id = ? FOR UPDATE", billId);
        MonthlyBillService.Bill b = bills.get(billId, null);
        BizException.check(List.of("ISSUED", "CONFIRMED", "SETTLED").contains(b.status()), ErrorCode.SYS_BAD_REQUEST,
                "DISPUTED".equals(b.status()) ? "账单有未处理的异议，金额可能调整，处理完再付款" : "账单还没下发，金额未定");
        LocalDate todayNow = LocalDate.now(clock.withZone(Constants.ZONE));
        BizException.check(!"ISSUED".equals(b.status()) || b.disputeDeadline() == null || b.disputeDeadline().isBefore(todayNow),
                ErrorCode.SYS_BAD_REQUEST, "账单还在异议期内（到 " + b.disputeDeadline() + "），金额可能调整，异议期结束后再付款");
        BizException.check(b.transferReceivable().signum() > 0, ErrorCode.SYS_BAD_REQUEST, "这张账单没有流转应收，不需要付款");
        BizException.check(ofBill(billId).isEmpty(), ErrorCode.SYS_CONFLICT, "这张账单的流转分成已经登记过付款");
        Payee p = payee(b.companyId()).orElseThrow(() ->
                new BizException(ErrorCode.SYS_BAD_REQUEST, "这家公司还没有登记收款账户，请先联系对方在公司后台填写"));
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        BizException.check(cmd.paidDate() != null && !cmd.paidDate().isAfter(today), ErrorCode.SYS_BAD_REQUEST, "付款日期不能晚于今天");
        BizException.check(b.issuedAt() == null || !cmd.paidDate().isBefore(b.issuedAt().toLocalDate()), ErrorCode.SYS_BAD_REQUEST,
                "付款日期不能早于账单下发日期");
        BizException.check(cmd.bankRef() == null || cmd.bankRef().trim().length() <= 64, ErrorCode.SYS_BAD_REQUEST, "流水号最多 64 个字符");
        BizException.check(cmd.remark() == null || cmd.remark().trim().length() <= 255, ErrorCode.SYS_BAD_REQUEST, "备注最多 255 个字");
        jdbc.update("INSERT INTO bill_receivable_payout (bill_id, company_id, amount, paid_date, bank_ref, voucher_key, remark, "
                        + "account_name, bank_name, account_tail, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                billId, b.companyId(), b.transferReceivable(), Date.valueOf(cmd.paidDate()), blankToNull(cmd.bankRef()),
                blankToNull(cmd.voucherKey()), blankToNull(cmd.remark()), p.accountName(), p.bankName(), p.accountTail(), operatorId);
        audit.log("BILL_RECEIVABLE_PAYOUT", "BILL", billId, Map.of("amount", b.transferReceivable().toPlainString(),
                "paidDate", cmd.paidDate().toString(), "accountTail", p.accountTail()));
        outbox.publish("BILL_NOTICE", "BILL", billId, Map.of("companyId", b.companyId(), "content", b.billMonth() + " 的流转分成 "
                + b.transferReceivable().toPlainString() + " 元已付款到尾号 " + p.accountTail() + " 的账户，请查收。可在「费用账单」里查看付款记录。"));
        return ofBill(billId).orElseThrow();
    }

    /** 待付款的流转分成：金额已定（过了异议期或已确认 / 已结算）、应收大于 0、还没登记付款的账单。 */
    public Summary summary() {
        Map<String, Object> m = jdbc.queryForMap("SELECT COUNT(*) AS n, COALESCE(SUM(b.transfer_receivable), 0) AS amt, "
                + "COALESCE(SUM(p.company_id IS NULL), 0) AS nopayee FROM monthly_bill b LEFT JOIN company_payee p ON p.company_id = b.company_id "
                + "WHERE b.status IN ('ISSUED','CONFIRMED','SETTLED') AND (b.status <> 'ISSUED' OR b.dispute_deadline < CURDATE()) "
                + "AND b.transfer_receivable > 0 "
                + "AND NOT EXISTS (SELECT 1 FROM bill_receivable_payout r WHERE r.bill_id = b.bill_id)");
        return new Summary(((Number) m.get("n")).longValue(), (BigDecimal) m.get("amt"), ((Number) m.get("nopayee")).longValue());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static Payout payout(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Payout(rs.getLong("id"), rs.getString("bill_id"), rs.getString("company_id"), rs.getBigDecimal("amount"),
                rs.getDate("paid_date").toLocalDate(), rs.getString("bank_ref"), rs.getString("voucher_key"), rs.getString("remark"),
                rs.getString("account_name"), rs.getString("bank_name"), rs.getString("account_tail"), rs.getString("paid_by"),
                rs.getTimestamp("created_at").toLocalDateTime());
    }
}
