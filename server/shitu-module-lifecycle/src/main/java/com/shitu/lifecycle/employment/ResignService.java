package com.shitu.lifecycle.employment;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.shitu.common.Constants;
import com.shitu.common.enums.ActorRole;
import com.shitu.common.enums.ContractStatus;
import com.shitu.common.enums.UserStatus;
import com.shitu.common.exception.BizException;
import com.shitu.common.exception.ErrorCode;
import com.shitu.common.util.Masks;
import com.shitu.framework.audit.AuditLogger;
import com.shitu.framework.crypto.FieldCipher;
import com.shitu.framework.outbox.OutboxWriter;
import com.shitu.framework.security.AuthPrincipal;
import com.shitu.framework.tenant.TenantContext;
import com.shitu.lifecycle.domain.LifecycleEvent;
import com.shitu.lifecycle.domain.TransitionContext;
import com.shitu.lifecycle.mapper.EmploymentMapper;
import com.shitu.lifecycle.mapper.LaborContractMapper;
import com.shitu.lifecycle.mapper.SeekerUserMapper;
import com.shitu.lifecycle.seeker.LifecycleService;
import com.shitu.lifecycle.seeker.SeekerUser;
import com.shitu.tenant.scope.DataScope;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 离职（T-308）与公司注销批量解绑（R-11 / P-08）。
 * <ul>
 *   <li>驻场 / 项目经理发起离职 → 项目经理审核通过 → RESIGN：任职结束（离职日不计费）、合同解除、释放至公域；</li>
 *   <li>欠款结清：预支模块（Sprint 5）在离职审核前校验，这里预留 {@code advance_debt} 检查；</li>
 *   <li>公司注销 / 倒闭：该公司所有私域与在岗用户 COMPANY_CLOSED → 公域，任职当天结束；来源归属保留仅存证（R-05）。</li>
 * </ul>
 */
@Service
public class ResignService {

    public record ResignRow(long id, String employmentId, String userId, String name, String projectId, LocalDate resignDate,
                            String reason, String status, String requestedBy, String approvedBy, LocalDateTime createdAt,
                            String projectName, String jobTitle, String employeeNo, String requestedByName, String approvedByName) {
    }

    private final LifecycleService lifecycle;
    private final EmploymentMapper employments;
    private final LaborContractMapper contracts;
    private final SeekerUserMapper users;
    private final DataScope scope;
    private final FieldCipher cipher;
    private final JdbcTemplate jdbc;
    private final OutboxWriter outbox;
    private final AuditLogger audit;
    private final Clock clock;

    public ResignService(LifecycleService lifecycle, EmploymentMapper employments, LaborContractMapper contracts,
                         SeekerUserMapper users, DataScope scope, FieldCipher cipher, JdbcTemplate jdbc, OutboxWriter outbox,
                         AuditLogger audit, Clock clock) {
        this.lifecycle = lifecycle;
        this.employments = employments;
        this.contracts = contracts;
        this.users = users;
        this.scope = scope;
        this.cipher = cipher;
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.audit = audit;
        this.clock = clock;
    }

    /** 发起离职（驻场 / 项目经理）。同一段任职只能有一条待审核申请。 */
    @Transactional
    public long request(AuthPrincipal p, String employmentId, LocalDate resignDate, String reason) {
        BizException.check(p.hasAnyRole(ActorRole.SITE.name(), ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED);
        Employment e = active(employmentId);
        scope.checkProject(p, e.getProjectId());
        LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
        BizException.check(resignDate != null && resignDate.isAfter(e.getStartDate()) && !resignDate.isBefore(today.minusDays(31))
                        && !resignDate.isAfter(today.plusDays(30)),
                ErrorCode.SYS_BAD_REQUEST, "离职日期须晚于入职日期，且在近 31 天到未来 30 天之间");
        Long pending = jdbc.queryForObject("SELECT COUNT(*) FROM resign_request WHERE employment_id = ? AND status = 'PENDING'",
                Long.class, employmentId);
        BizException.check(pending == null || pending == 0, ErrorCode.SYS_CONFLICT, "该员工已有待审核的离职申请");
        jdbc.update("INSERT INTO resign_request (employment_id, user_id, company_id, resign_date, reason, requested_by) VALUES (?, ?, ?, ?, ?, ?)",
                employmentId, e.getUserId(), e.getCompanyId(), Date.valueOf(resignDate), reason, p.subjectId());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        audit.log("RESIGN_REQUEST", "EMPLOYMENT", employmentId, Map.of("resignDate", resignDate.toString()));
        return id == null ? 0 : id;
    }

    /** 离职审核（仅项目经理，T-308）。通过 → RESIGN。 */
    @Transactional
    public void decide(AuthPrincipal p, long requestId, boolean approve, String remark) {
        BizException.check(p.hasRole(ActorRole.PM.name()), ErrorCode.LC_ACTOR_NOT_ALLOWED, "离职审核由项目经理处理");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT employment_id, resign_date, reason, status FROM resign_request "
                + "WHERE id = ? AND company_id = ? FOR UPDATE", requestId, p.companyId());
        BizException.check(!rows.isEmpty(), ErrorCode.SYS_NOT_FOUND);
        BizException.check("PENDING".equals(rows.get(0).get("status")), ErrorCode.SYS_CONFLICT, "该申请已处理");
        String employmentId = (String) rows.get(0).get("employment_id");
        Employment e = active(employmentId);
        scope.checkProject(p, e.getProjectId());
        if (approve) {
            SeekerUser u = TenantContext.runAsSystem(() -> users.selectById(e.getUserId()));
            BizException.check(u == null || u.getAdvanceDebt() == null || u.getAdvanceDebt().signum() == 0,
                    ErrorCode.SYS_CONFLICT, "该员工有未结清的预支欠款，请先在工资中抵扣结清");
            LocalDate resignDate = ((java.sql.Date) rows.get(0).get("resign_date")).toLocalDate();
            end(e, resignDate, "RESIGNED");
            lifecycle.transition(e.getUserId(), LifecycleEvent.RESIGN, TransitionContext.tenant(ActorRole.PM, p.companyId()),
                    p.subjectId(), (String) rows.get(0).get("reason"));
        }
        jdbc.update("UPDATE resign_request SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?",
                approve ? "APPROVED" : "REJECTED", p.subjectId(), LocalDateTime.now(clock), requestId);
        audit.log(approve ? "RESIGN_APPROVE" : "RESIGN_REJECT", "EMPLOYMENT", employmentId,
                remark == null ? null : Map.of("remark", remark));
    }

    public List<ResignRow> list(AuthPrincipal p, String status) {
        DataScope.Scope s = scope.of(p);
        List<ResignRow> rows = jdbc.query("SELECT r.id, r.employment_id, r.user_id, e.project_id, r.resign_date, r.reason, r.status, "
                        + "r.requested_by, r.approved_by, r.created_at, p.name, j.title, e.employee_no, mr.name, ma.name "
                        + "FROM resign_request r JOIN employment e ON e.employment_id = r.employment_id "
                        + "LEFT JOIN project p ON p.project_id = e.project_id LEFT JOIN job j ON j.job_id = e.job_id "
                        + "LEFT JOIN member mr ON mr.member_id = r.requested_by LEFT JOIN member ma ON ma.member_id = r.approved_by "
                        + "WHERE r.company_id = ?" + (status == null ? "" : " AND r.status = ?") + " ORDER BY r.id DESC LIMIT 200",
                (rs, i) -> new ResignRow(rs.getLong(1), rs.getString(2), rs.getString(3), null, rs.getString(4),
                        rs.getDate(5).toLocalDate(), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9),
                        rs.getTimestamp(10).toLocalDateTime(), rs.getString(11), rs.getString(12), rs.getString(13), rs.getString(14),
                        rs.getString(15)),
                status == null ? new Object[]{p.companyId()} : new Object[]{p.companyId(), status});
        return rows.stream().filter(r -> s.covers(r.projectId())).map(r -> {
            SeekerUser u = TenantContext.runAsSystem(() -> users.selectById(r.userId()));
            String name = u == null || u.getRealNameEnc() == null ? "未实名" : Masks.name(cipher.decrypt(u.getRealNameEnc()));
            return new ResignRow(r.id(), r.employmentId(), r.userId(), name, r.projectId(), r.resignDate(), r.reason(), r.status(),
                    r.requestedBy(), r.approvedBy(), r.createdAt(), r.projectName(), r.jobTitle(), r.employeeNo(), r.requestedByName(),
                    r.approvedByName());
        }).toList();
    }

    /**
     * 公司注销 / 倒闭批量解绑（运营操作，SYSTEM / OPS 模式）：在岗的结束任职，所有私域 / 报名中的用户释放至公域。
     *
     * @return 解绑人数
     */
    @Transactional
    public int unbindCompany(String companyId, String operatorId) {
        return TenantContext.runAsSystem(() -> {
            LocalDate today = LocalDate.now(clock.withZone(Constants.ZONE));
            employments.selectList(new LambdaQueryWrapper<Employment>().eq(Employment::getCompanyId, companyId)
                    .isNull(Employment::getEndDate)).forEach(e -> end(e, today, "COMPANY_CLOSED"));
            List<SeekerUser> bound = users.selectList(new LambdaQueryWrapper<SeekerUser>()
                    .eq(SeekerUser::getBoundCompanyId, companyId)
                    .in(SeekerUser::getUserStatus, UserStatus.PRIVATE_PENDING, UserStatus.PENDING_INTERVIEW,
                            UserStatus.PENDING_CONFIRM, UserStatus.EMPLOYED));
            for (SeekerUser u : bound) {
                lifecycle.transition(u.getUserId(), LifecycleEvent.COMPANY_CLOSED, TransitionContext.of(ActorRole.OPS),
                        operatorId, "公司注销 / 倒闭，批量解绑");
            }
            outbox.publish("COMPANY_UNBOUND", "COMPANY", companyId, Map.of("companyId", companyId, "count", bound.size()));
            return bound.size();
        });
    }

    private void end(Employment e, LocalDate endDate, String reason) {
        employments.update(null, new LambdaUpdateWrapper<Employment>().eq(Employment::getEmploymentId, e.getEmploymentId())
                .isNull(Employment::getEndDate).set(Employment::getEndDate, endDate).set(Employment::getEndReason, reason));
        if (e.getContractId() != null) {
            contracts.update(null, new LambdaUpdateWrapper<LaborContract>().eq(LaborContract::getContractId, e.getContractId())
                    .eq(LaborContract::getStatus, ContractStatus.EFFECTIVE)
                    .set(LaborContract::getStatus, "RESIGNED".equals(reason) ? ContractStatus.DISSOLVED : ContractStatus.TERMINATED)
                    .set(LaborContract::getEndedAt, LocalDateTime.now(clock)));
        }
    }

    private Employment active(String employmentId) {
        Employment e = employments.selectById(employmentId);
        BizException.check(e != null, ErrorCode.SYS_NOT_FOUND);
        BizException.check(e.getEndDate() == null, ErrorCode.LC_ILLEGAL_TRANSITION, "该员工已离职");
        return e;
    }
}
