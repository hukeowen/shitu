package com.shitu.app.tenant;

import com.shitu.common.api.ApiResponse;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.common.util.Rows;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.YearMonth;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 预支抵扣对账（T-505，只读）：某个工资月份里，哪些人的工资抵扣了预支、抵扣后还欠多少；
 * 以及截至现在仍有欠款的人。金额全部来自工资条与欠款流水，这里不做任何修改。
 * JDBC 不经过租户拦截器，语句显式带 company_id。
 */
@Tag(name = "公司后台 · 预支抵扣对账")
@RestController
@RequestMapping("/api/v1/tenant/payroll/recon")
public class AdvanceReconController {

    private final JdbcTemplate jdbc;
    private final FieldCipher cipher;
    private final Clock clock;

    public AdvanceReconController(JdbcTemplate jdbc, FieldCipher cipher, Clock clock) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.clock = clock;
    }

    @Operation(summary = "按工资月份对账")
    @PreAuthorize("hasAnyRole('OWNER','PM')")
    @GetMapping
    public ApiResponse<Map<String, Object>> recon(@RequestParam(required = false) String month) {
        String companyId = CurrentUser.companyId();
        List<String> months = jdbc.queryForList("SELECT DISTINCT pay_month FROM payslip WHERE company_id = ? ORDER BY pay_month DESC LIMIT 24",
                String.class, companyId);
        String m = month != null && !month.isBlank() ? month : months.isEmpty() ? YearMonth.now(clock).toString() : months.get(0);
        BizException.check(m.matches("^[0-9]{4}-(0[1-9]|1[0-2])$"), ErrorCode.SYS_BAD_REQUEST, "月份格式为 YYYY-MM");
        YearMonth ym = YearMonth.parse(m);

        List<Map<String, Object>> deductions = jdbc.queryForList("SELECT p.payslip_id, p.user_id, p.gross_pay, p.net_pay, p.advance_deduct, "
                + "e.employee_no, e.end_date, pr.name AS project_name, u.real_name_enc, "
                + "(SELECT l.balance_after FROM advance_debt_log l WHERE l.payslip_id = p.payslip_id AND l.company_id = p.company_id "
                + " ORDER BY l.id DESC LIMIT 1) AS debt_after "
                + "FROM payslip p JOIN `user` u ON u.user_id = p.user_id "
                + "LEFT JOIN employment e ON e.employment_id = p.employment_id AND e.company_id = p.company_id "
                + "LEFT JOIN project pr ON pr.project_id = e.project_id "
                + "WHERE p.company_id = ? AND p.pay_month = ? AND p.advance_deduct > 0 ORDER BY p.advance_deduct DESC, p.payslip_id LIMIT 1000",
                companyId, m);
        deductions.forEach(this::maskName);

        List<Map<String, Object>> outstanding = jdbc.queryForList("SELECT l.user_id, l.balance_after AS debt, l.created_at AS last_change_at, "
                + "e.employee_no, e.end_date, pr.name AS project_name, u.real_name_enc "
                + "FROM advance_debt_log l JOIN (SELECT user_id, MAX(id) AS mid FROM advance_debt_log WHERE company_id = ? GROUP BY user_id) t "
                + "ON t.mid = l.id JOIN `user` u ON u.user_id = l.user_id "
                + "LEFT JOIN employment e ON e.employment_id = (SELECT e2.employment_id FROM employment e2 WHERE e2.company_id = ? "
                + " AND e2.user_id = l.user_id ORDER BY e2.start_date DESC LIMIT 1) "
                + "LEFT JOIN project pr ON pr.project_id = e.project_id "
                + "WHERE l.balance_after > 0 ORDER BY (e.end_date IS NOT NULL) DESC, l.balance_after DESC LIMIT 1000", companyId, companyId);
        outstanding.forEach(this::maskName);

        Map<String, Object> payout = jdbc.queryForMap("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM advance_debt_log "
                + "WHERE company_id = ? AND change_type = 'PAYOUT' AND created_at >= ? AND created_at < ?",
                companyId, ym.atDay(1).atStartOfDay(), ym.plusMonths(1).atDay(1).atStartOfDay());

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("deductTotal", sum(deductions, "advance_deduct"));
        summary.put("deductCount", deductions.size());
        summary.put("payoutTotal", payout.get("total"));
        summary.put("payoutCount", payout.get("cnt"));
        summary.put("outstandingTotal", sum(outstanding, "debt"));
        summary.put("outstandingCount", outstanding.size());
        summary.put("outstandingLeftCount", outstanding.stream().filter(r -> r.get("end_date") != null).count());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("month", m);
        out.put("months", months);
        out.put("summary", summary);
        out.put("deductions", Rows.camel(deductions));
        out.put("outstanding", Rows.camel(outstanding));
        return ApiResponse.ok(out);
    }

    private void maskName(Map<String, Object> r) {
        Object enc = r.remove("real_name_enc");
        r.put("seeker_name", enc == null ? "未实名" : Masks.name(cipher.decrypt((String) enc)));
    }

    private static BigDecimal sum(List<Map<String, Object>> rows, String key) {
        return rows.stream().map(r -> (BigDecimal) r.get(key)).filter(v -> v != null).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
