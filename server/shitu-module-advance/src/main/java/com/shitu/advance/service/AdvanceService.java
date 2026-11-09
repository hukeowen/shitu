package com.shitu.advance.service;

import com.shitu.advance.domain.AdvancePolicy;
import com.shitu.advance.domain.DebtDeduction;
import com.shitu.common.Constants;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.id.BizIdGenerator;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.param.SysParams;
import com.shitu.framework.security.AuthPrincipal;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 薪酬预支（C-601 ~ C-604、M-11、T-309、J-11 / J-12，D-22 / D-25 / D-26 / D-27）。
 * <pre>
 * 准入 5 项：在岗、有归属、在岗满 7 天、本月 &lt; 4 次、本月剩余机会 &gt; 0（机会按在岗日滚动发放，月末清零 —— 实时计算不落表）
 * 审批：驻场初审 → 项目经理终审 → 公司登记拨款（欠款 +500）；任何一级驳回都退回机会（驳回的不计入本月次数）
 * 抵扣：工资表导入时按欠款自动抵扣，扣不完结转下月；离职前必须结清（D-22）
 * </pre>
 * 在岗日 = 入职以来的自然日（含入职当天）− 驻场标记的请假 / 旷工（D-27）。
 * 预支模块不依赖生命周期模块（ArchitectureTest），任职 / 用户事实通过 SQL 读取。
 */
@Service
public class AdvanceService {

    private static final Set<String> COUNTED = Set.of("SUBMITTED", "SITE_APPROVED", "PM_APPROVED", "PAID", "PARTIALLY_REPAID", "REPAID");

    public record Quota(boolean eligible, List<String> reasons, int dutyDays, int progressInCycle, int daysPerChance,
                        int grantedThisMonth, int usedThisMonth, int remainingThisMonth, int monthlyLimit,
                        BigDecimal amount, BigDecimal debt) {
    }

    public record AdvanceRow(String advanceId, String userId, String seekerName, String projectId, BigDecimal amount,
                             String bizMonth, String status, BigDecimal repaidAmount, LocalDateTime paidAt,
                             LocalDateTime createdAt, List<String> allowedActions) {
    }

    public record DebtLogEntry(String changeType, BigDecimal amount, BigDecimal balanceAfter, String advanceId, String payslipId,
                               LocalDateTime createdAt) {
    }

    /** step：SITE / PM / PAYOUT；decision：APPROVE / REJECT。 */
    public record ApprovalStep(String step, String decision, String opinion, LocalDateTime at) {
    }

    public record AdvanceDetail(AdvanceRow advance, List<ApprovalStep> approvals, List<DebtLogEntry> ledger) {
    }

    private record Emp(String employmentId, String companyId, String projectId, LocalDate startDate) {
    }

    private final JdbcTemplate jdbc;
    private final SysParams params;
    private final FieldCipher cipher;
    private final BizIdGenerator ids;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public AdvanceService(JdbcTemplate jdbc, SysParams params, FieldCipher cipher, BizIdGenerator ids, OutboxWriter outbox,
                          AuditLogger audit, Clock clock) {
        this.jdbc = jdbc;
        this.params = params;
        this.cipher = cipher;
        this.ids = ids;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    AdvancePolicy policy() {
        return new AdvancePolicy(params.getInt("advance.days_per_chance", 7),
                params.getDecimal("advance.amount", new BigDecimal("500.00")), params.getInt("advance.monthly_limit", 4));
    }

    // ================================================================== C 端

    public Quota quota(String userId) {
        AdvancePolicy pol = policy();
        LocalDate today = today();
        Map<String, Object> u = jdbc.queryForMap("SELECT user_status, bound_company_id, advance_debt, blacklist_flag FROM `user` WHERE user_id = ?", userId);
        Emp e = activeEmployment(userId);
        int now = e == null ? 0 : dutyDays(e, today);
        LocalDate prevEnd = today.withDayOfMonth(1).minusDays(1);
        int prev = e == null || e.startDate().isAfter(prevEnd) ? 0 : dutyDays(e, prevEnd);
        String month = YearMonth.from(today).toString();
        int used = countUsed(userId, month);
        boolean pending = pending(userId);
        AdvancePolicy.Applicant a = new AdvancePolicy.Applicant(UserStatus.valueOf((String) u.get("user_status")),
                (String) u.get("bound_company_id"), now, prev, used, pending, Boolean.TRUE.equals(u.get("blacklist_flag")));
        List<String> reasons = pol.check(a);
        int granted = pol.chancesGrantedThisMonth(prev, now);
        return new Quota(reasons.isEmpty(), reasons, now, now % pol.daysPerChance(), pol.daysPerChance(), granted, used,
                Math.max(0, pol.remainingThisMonth(granted, used)), pol.monthlyLimit(), pol.amount(), (BigDecimal) u.get("advance_debt"));
    }

    /** C-602：本人发起，固定金额。同一时间只有一笔在审批（生成列唯一）。 */
    @Transactional
    public String apply(String userId) {
        Quota q = quota(userId);
        BizException.check(q.eligible(), ErrorCode.ADV_NOT_ELIGIBLE, String.join("；", q.reasons()));
        Emp e = activeEmployment(userId);
        String id = ids.dated("YZ", 4);
        try {
            jdbc.update("INSERT INTO advance_request (advance_id, user_id, company_id, project_id, employment_id, amount, biz_month) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, e.companyId(), e.projectId(), e.employmentId(), q.amount(),
                    YearMonth.from(today()).toString());
        } catch (DuplicateKeyException ex) {
            throw new BizException(ErrorCode.ADV_NOT_ELIGIBLE, "你有一笔预支正在审批中");
        }
        outbox.publish("ADVANCE_SUBMITTED", "ADVANCE", id, Map.of("userId", userId, "companyId", e.companyId(),
                "projectId", e.projectId(), "amount", q.amount().toPlainString()));
        return id;
    }

    public List<AdvanceRow> mine(String userId) {
        return rows("SELECT * FROM advance_request WHERE user_id = ? ORDER BY created_at DESC", null, userId);
    }

    public List<DebtLogEntry> debtLog(String userId) {
        return debtLog("user_id = ?", userId);
    }

    /** C-603：单笔预支详情 = 记录 + 审批节点（不含审批人身份）+ 该笔的拨款 / 抵扣流水。 */
    public AdvanceDetail detail(String userId, String advanceId) {
        List<AdvanceRow> r = rows("SELECT * FROM advance_request WHERE advance_id = ? AND user_id = ?", null, advanceId, userId);
        BizException.check(!r.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        List<ApprovalStep> steps = jdbc.query("SELECT step, decision, opinion, created_at FROM advance_approval WHERE advance_id = ? ORDER BY id",
                (rs, i) -> new ApprovalStep(rs.getString(1), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toLocalDateTime()),
                advanceId);
        // 该笔的流水：拨款（+）与按先到先还分摊到本笔的工资抵扣（−），balanceAfter 为本笔剩余未还
        List<DebtLogEntry> ledger = new java.util.ArrayList<>(jdbc.query(
                "SELECT 'DEDUCT', amount, remaining_after, advance_id, payslip_id, created_at FROM advance_repayment "
                        + "WHERE advance_id = ? AND user_id = ? ORDER BY id DESC",
                (rs, i) -> new DebtLogEntry(rs.getString(1), rs.getBigDecimal(2), rs.getBigDecimal(3), rs.getString(4), rs.getString(5),
                        rs.getTimestamp(6).toLocalDateTime()), advanceId, userId));
        AdvanceRow a = r.get(0);
        if (a.paidAt() != null) {
            ledger.add(new DebtLogEntry("PAYOUT", a.amount(), a.amount(), advanceId, null, a.paidAt()));
        }
        return new AdvanceDetail(a, steps, ledger);
    }

    private List<DebtLogEntry> debtLog(String where, Object... args) {
        return jdbc.query("SELECT change_type, amount, balance_after, advance_id, payslip_id, created_at FROM advance_debt_log "
                        + "WHERE " + where + " ORDER BY id DESC LIMIT 100",
                (rs, i) -> new DebtLogEntry(rs.getString(1), rs.getBigDecimal(2), rs.getBigDecimal(3), rs.getString(4), rs.getString(5),
                        rs.getTimestamp(6).toLocalDateTime()), args);
    }

    // ================================================================== 公司后台审批（D-25）

    /** 待我处理：驻场看待初审（负责项目），项目经理看待终审 / 待拨款。projectIds 为空表示全公司。 */
    public List<AdvanceRow> forTenant(AuthPrincipal p, Set<String> projectIds, boolean allProjects, String status) {
        StringBuilder sql = new StringBuilder("SELECT * FROM advance_request WHERE company_id = ?");
        List<Object> args = new java.util.ArrayList<>(List.of(p.companyId()));
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        if (!allProjects) {
            if (projectIds.isEmpty()) {
                return List.of();
            }
            sql.append(" AND project_id IN (").append(String.join(",", projectIds.stream().map(x -> "?").toList())).append(")");
            args.addAll(projectIds);
        }
        sql.append(" ORDER BY created_at DESC LIMIT 200");
        return rows(sql.toString(), p, args.toArray());
    }

    /** 驻场初审（M-11）。 */
    @Transactional
    public void siteReview(AuthPrincipal p, String advanceId, boolean approve, String opinion) {
        BizException.check(p.hasRole("SITE"), ErrorCode.LC_ACTOR_NOT_ALLOWED, "初审由驻场处理");
        step(p, advanceId, "SUBMITTED", approve ? "SITE_APPROVED" : "REJECTED", "SITE", approve, opinion);
    }

    /** 项目经理终审（T-309）。 */
    @Transactional
    public void pmReview(AuthPrincipal p, String advanceId, boolean approve, String opinion) {
        BizException.check(p.hasRole("PM"), ErrorCode.LC_ACTOR_NOT_ALLOWED, "终审由项目经理处理");
        step(p, advanceId, "SITE_APPROVED", approve ? "PM_APPROVED" : "REJECTED", "PM", approve, opinion);
    }

    /** 登记拨款（公司线下转账后登记）：欠款 + 金额，记欠款流水，通知求职者。 */
    @Transactional
    public void payout(AuthPrincipal p, String advanceId) {
        BizException.check(p.hasAnyRole("PM", "OWNER"), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        Map<String, Object> a = lock(p, advanceId);
        BizException.check("PM_APPROVED".equals(a.get("status")), ErrorCode.SYS_CONFLICT, "只有终审通过的预支可以登记拨款");
        String userId = (String) a.get("user_id");
        BigDecimal amount = (BigDecimal) a.get("amount");
        LocalDateTime now = LocalDateTime.now(clock);
        jdbc.update("UPDATE advance_request SET status = 'PAID', paid_at = ?, version = version + 1 WHERE advance_id = ?", now, advanceId);
        jdbc.update("INSERT INTO advance_approval (company_id, advance_id, step, decision, operator_id) VALUES (?, ?, 'PAYOUT', 'APPROVE', ?)",
                p.companyId(), advanceId, p.subjectId());
        BigDecimal balance = changeDebt(userId, amount);
        jdbc.update("INSERT INTO advance_debt_log (company_id, user_id, advance_id, change_type, amount, balance_after) VALUES (?, ?, ?, 'PAYOUT', ?, ?)",
                p.companyId(), userId, advanceId, amount, balance);
        outbox.publish("ADVANCE_RESULT", "ADVANCE", advanceId, Map.of("userId", userId, "amount", amount.toPlainString(),
                "result", "已拨款，将在发薪时从工资中抵扣"));
        audit.log("ADVANCE_PAYOUT", "ADVANCE", advanceId, Map.of("amount", amount.toPlainString()));
    }

    // ================================================================== 抵扣（J-11，工资表导入时调用）

    /**
     * 从本次实发工资中抵扣欠款：按预支先后（先拨款先还）更新每笔的已还金额与状态。
     *
     * @return 抵扣结果
     */
    @Transactional
    public DebtDeduction.Result deductFromPay(String companyId, String userId, String payslipId, BigDecimal netBeforeDeduction) {
        BigDecimal debt = jdbc.queryForObject("SELECT advance_debt FROM `user` WHERE user_id = ? FOR UPDATE", BigDecimal.class, userId);
        DebtDeduction.Result r = DebtDeduction.deduct(debt == null ? BigDecimal.ZERO : debt, netBeforeDeduction);
        if (r.deducted().signum() == 0) {
            return r;
        }
        BigDecimal balance = changeDebt(userId, r.deducted().negate());
        jdbc.update("INSERT INTO advance_debt_log (company_id, user_id, payslip_id, change_type, amount, balance_after) VALUES (?, ?, ?, 'DEDUCT', ?, ?)",
                companyId, userId, payslipId, r.deducted(), balance);
        BigDecimal left = r.deducted();
        for (Map<String, Object> a : jdbc.queryForList("SELECT advance_id, amount, repaid_amount FROM advance_request WHERE user_id = ? "
                + "AND status IN ('PAID','PARTIALLY_REPAID') ORDER BY paid_at, advance_id FOR UPDATE", userId)) {
            if (left.signum() <= 0) {
                break;
            }
            BigDecimal owe = ((BigDecimal) a.get("amount")).subtract((BigDecimal) a.get("repaid_amount"));
            BigDecimal pay = owe.min(left);
            left = left.subtract(pay);
            boolean done = pay.compareTo(owe) == 0;
            jdbc.update("UPDATE advance_request SET repaid_amount = repaid_amount + ?, status = ?, version = version + 1 WHERE advance_id = ?",
                    pay, done ? "REPAID" : "PARTIALLY_REPAID", a.get("advance_id"));
            BigDecimal remaining = owe.subtract(pay);
            jdbc.update("INSERT INTO advance_repayment (company_id, user_id, advance_id, payslip_id, amount, remaining_after) VALUES (?, ?, ?, ?, ?, ?)",
                    companyId, userId, a.get("advance_id"), payslipId, pay, remaining);
        }
        return r;
    }

    // ------------------------------------------------------------------

    private void step(AuthPrincipal p, String advanceId, String from, String to, String stepName, boolean approve, String opinion) {
        BizException.check(approve || (opinion != null && !opinion.isBlank()), ErrorCode.LC_REASON_REQUIRED, "驳回请填写原因");
        Map<String, Object> a = lock(p, advanceId);
        BizException.check(from.equals(a.get("status")), ErrorCode.SYS_CONFLICT, "该预支当前不在此审批环节");
        jdbc.update("UPDATE advance_request SET status = ?, version = version + 1 WHERE advance_id = ?", to, advanceId);
        jdbc.update("INSERT INTO advance_approval (company_id, advance_id, step, decision, opinion, operator_id) VALUES (?, ?, ?, ?, ?, ?)",
                p.companyId(), advanceId, stepName, approve ? "APPROVE" : "REJECT", opinion, p.subjectId());
        String userId = (String) a.get("user_id");
        if (!approve) {
            outbox.publish("ADVANCE_RESULT", "ADVANCE", advanceId, Map.of("userId", userId,
                    "amount", ((BigDecimal) a.get("amount")).toPlainString(), "result", "未通过：" + opinion.trim() + "（本次机会已退回）"));
        } else if ("SITE".equals(stepName)) {
            outbox.publish("ADVANCE_SITE_APPROVED", "ADVANCE", advanceId, Map.of("userId", userId,
                    "companyId", p.companyId(), "projectId", a.get("project_id"), "amount", ((BigDecimal) a.get("amount")).toPlainString()));
        }
        audit.log("ADVANCE_" + stepName + (approve ? "_APPROVE" : "_REJECT"), "ADVANCE", advanceId,
                opinion == null ? null : Map.of("opinion", opinion));
    }

    /** 加锁读取，限定本公司（advance_request 为租户表，这里用 JDBC 必须显式带公司）。 */
    private Map<String, Object> lock(AuthPrincipal p, String advanceId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM advance_request WHERE advance_id = ? AND company_id = ? FOR UPDATE",
                advanceId, p.companyId());
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        return rows.get(0);
    }

    private BigDecimal changeDebt(String userId, BigDecimal delta) {
        jdbc.update("UPDATE `user` SET advance_debt = advance_debt + ? WHERE user_id = ?", delta, userId);
        return jdbc.queryForObject("SELECT advance_debt FROM `user` WHERE user_id = ?", BigDecimal.class, userId);
    }

    private int countUsed(String userId, String month) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM advance_request WHERE user_id = ? AND biz_month = ? AND status IN ("
                + String.join(",", COUNTED.stream().map(s -> "'" + s + "'").toList()) + ")", Integer.class, userId, month);
        return n == null ? 0 : n;
    }

    private boolean pending(String userId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM advance_request WHERE pending_user_id = ?", Integer.class, userId);
        return n != null && n > 0;
    }

    private Emp activeEmployment(String userId) {
        List<Emp> l = jdbc.query("SELECT employment_id, company_id, project_id, start_date FROM employment WHERE user_id = ? AND end_date IS NULL",
                (rs, i) -> new Emp(rs.getString(1), rs.getString(2), rs.getString(3), rs.getDate(4).toLocalDate()), userId);
        return l.isEmpty() ? null : l.get(0);
    }

    /** D-27：入职以来的自然日（含入职当天）减去请假 / 旷工天数。 */
    int dutyDays(Emp e, LocalDate asOf) {
        if (asOf.isBefore(e.startDate())) {
            return 0;
        }
        long days = ChronoUnit.DAYS.between(e.startDate(), asOf) + 1;
        Integer absent = jdbc.queryForObject("SELECT COUNT(*) FROM duty_absence WHERE employment_id = ? AND absence_date BETWEEN ? AND ?",
                Integer.class, e.employmentId(), Date.valueOf(e.startDate()), Date.valueOf(asOf));
        return (int) Math.max(0, days - (absent == null ? 0 : absent));
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(Constants.ZONE));
    }

    private List<AdvanceRow> rows(String sql, AuthPrincipal p, Object... args) {
        return jdbc.query(sql, (rs, i) -> {
            String status = rs.getString("status");
            String uid = rs.getString("user_id");
            List<String> actions = p == null ? List.of()
                    : "SUBMITTED".equals(status) && p.hasRole("SITE") ? List.of("SITE_APPROVE", "SITE_REJECT")
                    : "SITE_APPROVED".equals(status) && p.hasRole("PM") ? List.of("PM_APPROVE", "PM_REJECT")
                    : "PM_APPROVED".equals(status) && p.hasAnyRole("PM", "OWNER") ? List.of("PAYOUT") : List.of();
            String name = p == null ? null : seekerName(uid);
            return new AdvanceRow(rs.getString("advance_id"), uid, name, rs.getString("project_id"), rs.getBigDecimal("amount"),
                    rs.getString("biz_month"), status, rs.getBigDecimal("repaid_amount"),
                    rs.getTimestamp("paid_at") == null ? null : rs.getTimestamp("paid_at").toLocalDateTime(),
                    rs.getTimestamp("created_at").toLocalDateTime(), actions);
        }, args);
    }

    private String seekerName(String userId) {
        List<String> enc = jdbc.queryForList("SELECT real_name_enc FROM `user` WHERE user_id = ?", String.class, userId);
        return enc.isEmpty() || enc.get(0) == null ? "未实名" : Masks.name(cipher.decrypt(enc.get(0)));
    }
}
