package com.shitu.advance.service;

import com.shitu.common.util.Rows;
import com.shitu.advance.domain.DebtDeduction;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.security.AuthPrincipal;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 工资（D-28 精简版）：工资表导入 → 自动计算预支抵扣（J-11）→ C 端工资条（C-701）。核算与代发审批放到 V1.5。
 * 每行独立事务；同一人同一任职同一月份只能导入一次（唯一索引，防止重复抵扣）。
 */
@Service
public class PayrollService {

    /** 一行工资：按手机号或工号定位本公司员工。 */
    public record PayRow(int rowNo, String phone, String employeeNo, BigDecimal grossPay, BigDecimal socialInsurance,
                         BigDecimal incomeTax, BigDecimal otherDeduct) {
    }

    public record PayRowResult(int rowNo, boolean success, String error, String payslipId, BigDecimal advanceDeduct,
                               BigDecimal netPay, String phoneMasked, String employeeNo) {
    }

    public record BatchResult(String batchId, String payMonth, int headcount, BigDecimal grossTotal, BigDecimal advanceDeductTotal,
                              BigDecimal netTotal, List<PayRowResult> rows) {
    }

    public record Payslip(String payslipId, String payMonth, String companyName, BigDecimal grossPay, BigDecimal socialInsurance,
                          BigDecimal incomeTax, BigDecimal otherDeduct, BigDecimal advanceDeduct, BigDecimal netPay) {
    }

    private final JdbcTemplate jdbc;
    private final AdvanceService advances;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final TransactionTemplate tx;
    private final AuditLogger audit;

    public PayrollService(JdbcTemplate jdbc, AdvanceService advances, FieldCipher cipher, BizIdGenerator ids,
                          TransactionTemplate tx, AuditLogger audit) {
        this.jdbc = jdbc;
        this.advances = advances;
        this.cipher = cipher;
        this.ids = ids;
        this.tx = tx;
        this.audit = audit;
    }

    public BatchResult importBatch(AuthPrincipal p, YearMonth month, String fileName, List<PayRow> rows) {
        BizException.check(p.hasAnyRole("PM", "OWNER"), ErrorCode.LC_ACTOR_NOT_ALLOWED, "工资表由项目经理或老板导入");
        BizException.check(rows != null && !rows.isEmpty() && rows.size() <= 5000, ErrorCode.SYS_BAD_REQUEST, "表格为空或超过 5000 行");
        String batchId = ids.dated("PB", 4);
        jdbc.update("INSERT INTO payroll_batch (batch_id, company_id, pay_month, file_key, operator_id, status) VALUES (?, ?, ?, ?, ?, 'PUBLISHED')",
                batchId, p.companyId(), month.toString(), fileName == null ? "-" : fileName, p.subjectId());
        List<PayRowResult> results = new ArrayList<>();
        BigDecimal gross = BigDecimal.ZERO;
        BigDecimal deduct = BigDecimal.ZERO;
        BigDecimal net = BigDecimal.ZERO;
        for (PayRow r : rows) {
            PayRowResult res;
            try {
                res = tx.execute(s -> one(p.companyId(), batchId, month, r));
            } catch (BizException e) {
                res = new PayRowResult(r.rowNo(), false, e.getMessage(), null, null, null, mask(r.phone()), r.employeeNo());
            } catch (DuplicateKeyException e) {
                res = new PayRowResult(r.rowNo(), false, "该员工本月工资已导入过", null, null, null, mask(r.phone()), r.employeeNo());
            }
            results.add(res);
            if (res.success()) {
                gross = gross.add(r.grossPay());
                deduct = deduct.add(res.advanceDeduct());
                net = net.add(res.netPay());
            }
        }
        int ok = (int) results.stream().filter(PayRowResult::success).count();
        if (ok == 0) {
            // 全部失败不留空批次：修正表格后重新导入即可
            jdbc.update("DELETE FROM payroll_batch WHERE batch_id = ?", batchId);
            return new BatchResult(null, month.toString(), 0, gross, deduct, net, results);
        }
        jdbc.update("UPDATE payroll_batch SET headcount = ?, gross_total = ?, advance_deduct_total = ?, net_total = ? WHERE batch_id = ?",
                ok, gross, deduct, net, batchId);
        audit.log("PAYROLL_IMPORT", "PAYROLL_BATCH", batchId, Map.of("month", month.toString(), "headcount", ok,
                "advanceDeduct", deduct.toPlainString()));
        return new BatchResult(batchId, month.toString(), ok, gross, deduct, net, results);
    }

    private PayRowResult one(String companyId, String batchId, YearMonth month, PayRow r) {
        BizException.check(r.grossPay() != null && r.grossPay().signum() >= 0, ErrorCode.SYS_BAD_REQUEST, "应发工资为空或为负数");
        String sql = "SELECT e.employment_id, e.user_id FROM employment e WHERE e.company_id = ? AND e.start_date <= ? "
                + "AND (e.end_date IS NULL OR e.end_date >= ?) AND ";
        Object key;
        if (r.employeeNo() != null && !r.employeeNo().isBlank()) {
            sql += "e.employee_no = ?";
            key = r.employeeNo().trim();
        } else {
            BizException.check(Masks.isMobile(r.phone()), ErrorCode.SYS_BAD_REQUEST, "请填写工号或正确的手机号");
            sql += "e.user_id = (SELECT user_id FROM `user` WHERE phone_hash = ?)";
            key = cipher.blindIndex(r.phone().trim());
        }
        List<Map<String, Object>> emp = jdbc.queryForList(sql + " ORDER BY e.start_date DESC LIMIT 1", companyId,
                java.sql.Date.valueOf(month.atEndOfMonth()), java.sql.Date.valueOf(month.atDay(1)), key);
        BizException.check(!emp.isEmpty(), ErrorCode.SYS_NOT_FOUND, "本月在本公司没有这名员工的任职记录");
        String employmentId = (String) emp.get(0).get("employment_id");
        String userId = (String) emp.get(0).get("user_id");
        BigDecimal social = nz(r.socialInsurance());
        BigDecimal tax = nz(r.incomeTax());
        BigDecimal other = nz(r.otherDeduct());
        BigDecimal before = r.grossPay().subtract(social).subtract(tax).subtract(other).setScale(2, RoundingMode.HALF_UP);
        String payslipId = ids.dated("GZ", 5);
        jdbc.update("INSERT INTO payslip (payslip_id, company_id, batch_id, user_id, employment_id, pay_month, gross_pay, social_insurance, "
                        + "income_tax, other_deduct, advance_deduct, net_pay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
                payslipId, companyId, batchId, userId, employmentId, month.toString(), r.grossPay(), social, tax, other, before);
        DebtDeduction.Result d = advances.deductFromPay(companyId, userId, payslipId, before);
        jdbc.update("UPDATE payslip SET advance_deduct = ?, net_pay = ? WHERE payslip_id = ?", d.deducted(), d.netPayAfter(), payslipId);
        settleOnFinalPay(companyId, employmentId, userId, month, payslipId);
        return new PayRowResult(r.rowNo(), true, null, payslipId, d.deducted(), d.netPayAfter(), mask(r.phone()), r.employeeNo());
    }

    /**
     * D-22：任职已在本工资月内结束（最后一笔工资）而欠款仍未扣完 → 打平台失信标记（UNPAID_ADVANCE），新公司不承接旧债。
     * 欠款已清零时，解除此前由系统自动打上的同类标记。
     */
    private void settleOnFinalPay(String companyId, String employmentId, String userId, YearMonth month, String payslipId) {
        BigDecimal debt = jdbc.queryForObject("SELECT advance_debt FROM `user` WHERE user_id = ?", BigDecimal.class, userId);
        if (debt == null || debt.signum() == 0) {
            int lifted = jdbc.update("UPDATE blacklist SET status = 'LIFTED', lifted_at = NOW(3) WHERE user_id = ? AND status = 'ACTIVE' "
                    + "AND reason_code = 'UNPAID_ADVANCE' AND created_by = 'SYSTEM'", userId);
            if (lifted > 0) {
                jdbc.update("UPDATE `user` SET blacklist_flag = 0 WHERE user_id = ? AND NOT EXISTS "
                        + "(SELECT 1 FROM blacklist b WHERE b.user_id = ? AND b.status = 'ACTIVE')", userId, userId);
                audit.logAs("SYSTEM", "payroll", companyId, "BLACKLIST_AUTO_LIFT", "USER", userId, Map.of("payslipId", payslipId));
            }
            return;
        }
        Integer ended = jdbc.queryForObject("SELECT COUNT(*) FROM employment WHERE employment_id = ? AND end_date IS NOT NULL AND end_date <= ?",
                Integer.class, employmentId, java.sql.Date.valueOf(month.atEndOfMonth()));
        if (ended == null || ended == 0) {
            return;
        }
        Integer exists = jdbc.queryForObject("SELECT COUNT(*) FROM blacklist WHERE user_id = ? AND status = 'ACTIVE' AND reason_code = 'UNPAID_ADVANCE'",
                Integer.class, userId);
        if (exists != null && exists > 0) {
            return;
        }
        jdbc.update("INSERT INTO blacklist (user_id, id_card_hash, reason_code, detail, created_by) "
                        + "SELECT user_id, id_card_hash, 'UNPAID_ADVANCE', ?, 'SYSTEM' FROM `user` WHERE user_id = ?",
                "离职后最后一笔工资未能结清预支欠款，剩余 " + debt.toPlainString() + " 元", userId);
        jdbc.update("UPDATE `user` SET blacklist_flag = 1 WHERE user_id = ?", userId);
        audit.logAs("SYSTEM", "payroll", companyId, "BLACKLIST_AUTO_ADD", "USER", userId,
                Map.of("reason", "UNPAID_ADVANCE", "debt", debt.toPlainString(), "payslipId", payslipId));
    }

    private static String mask(String phone) {
        return phone != null && Masks.isMobile(phone.trim()) ? Masks.phone(phone.trim()) : phone;
    }

    /** C-701：我的工资条（按月倒序）。 */
    public List<Payslip> mine(String userId) {
        return jdbc.query("SELECT p.payslip_id, p.pay_month, COALESCE(c.short_name, c.name), p.gross_pay, p.social_insurance, p.income_tax, "
                        + "p.other_deduct, p.advance_deduct, p.net_pay FROM payslip p JOIN company c ON c.company_id = p.company_id "
                        + "JOIN payroll_batch b ON b.batch_id = p.batch_id AND b.status = 'PUBLISHED' "
                        + "WHERE p.user_id = ? ORDER BY p.pay_month DESC",
                (rs, i) -> new Payslip(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBigDecimal(4), rs.getBigDecimal(5),
                        rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getBigDecimal(8), rs.getBigDecimal(9)), userId);
    }

    public List<Map<String, Object>> batches(String companyId) {
        return Rows.camel(jdbc.queryForList("SELECT batch_id, pay_month, headcount, gross_total, advance_deduct_total, net_total, status, operator_id, created_at "
                + "FROM payroll_batch WHERE company_id = ? ORDER BY created_at DESC LIMIT 50", companyId));
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }
}
